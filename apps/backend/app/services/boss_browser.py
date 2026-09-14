"""Visible, user-authorized BOSS browser adapter backed by jobfindsme CDP.

This is deliberately a thin integration boundary.  jobfindsme owns the
isolated Chrome profile and CDP transport; Resume Matcher owns search review,
JD approval, persistence, and resume generation.
"""

from __future__ import annotations

import json
import re
import subprocess
import threading
import time
from contextlib import suppress
from dataclasses import dataclass
from functools import wraps
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode, urlsplit

from jobfindsme.connectors.boss_zhipin import (
    BOSS_API_PATH,
    BOSS_CITY_CODES,
    BOSS_ORIGIN,
    BOSS_PROFILE_DIR,
    DEFAULT_CDP_PORT,
    BossConnectorError,
    BossZhipinConnector,
    _CDPSession,
    _JS_FETCH_API,
    _cdp_reachable,
    setup_chrome,
)

BOSS_VISIBLE_SEARCH_PAGE = "https://www.zhipin.com/web/geek/jobs"


class BossBrowserError(RuntimeError):
    """A user-facing BOSS session or page extraction failure."""


class BossLoginRequired(BossBrowserError):
    """The dedicated Chrome is running but its BOSS session is signed out."""


@dataclass(frozen=True)
class _AttachedPage:
    target_id: str
    session_id: str
    owned: bool = False


SessionFactory = Callable[[int], Any]
_persistent_cdp: Any | None = None
_persistent_page: _AttachedPage | None = None
_cdp_operation_lock = threading.RLock()


def _serialized_cdp(operation: Callable[..., Any]) -> Callable[..., Any]:
    """Keep status polling from invalidating an active search/detail session."""
    @wraps(operation)
    def wrapped(*args: Any, **kwargs: Any) -> Any:
        with _cdp_operation_lock:
            return operation(*args, **kwargs)

    return wrapped

_LOGIN_MARKERS = ("验证码登录/注册", "扫码登录", "密码登录")
_VERIFICATION_MARKERS = ("安全验证", "访问验证", "完成验证", "滑动验证")

_PAGE_STATE_JS = """
JSON.stringify({
  url: location.href,
  title: document.title,
  ready: document.readyState,
  body: (document.body && document.body.innerText || '').slice(0, 2500),
  loggedMarker: Boolean(document.querySelector(
    '.user-nav, .nav-figure, [class*="user-nav"], [class*="user-avatar"]'
  )),
  loginMarker: Boolean(document.querySelector(
    'a[href*="/web/user/"], .header-login, [class*="login-btn"]'
  ))
})
"""

_DETAIL_JS = """
JSON.stringify((() => {
  const text = (selector) => document.querySelector(selector)?.innerText?.trim() || '';
  const first = (selectors) => {
    for (const selector of selectors) {
      const value = text(selector);
      if (value) return value;
    }
    return '';
  };
  const detailNodes = [...document.querySelectorAll(
    '.job-sec-text, .job-detail-section .text, .job-detail-body, '
    + '[class*="job-detail"] [class*="text"], [class*="job-desc"]'
  )];
  const detailParts = [];
  const seen = new Set();
  for (const node of detailNodes) {
    const value = (node.innerText || '').trim();
    if (value.length >= 80 && !seen.has(value)) {
      seen.add(value);
      detailParts.push(value);
    }
  }
  return {
    url: location.href,
    title: first(['.job-name', 'h1', '[class*="job-name"]']),
    company: first([
      '.company-info .name', '.sider-company .company-name',
      '.company-name', '[class*="company-name"]'
    ]),
    location: first([
      '.location-address', '.job-address', '.job-location', '[class*="job-area"]'
    ]),
    jd: detailParts.join('\\n\\n').slice(0, 30000),
    body: (document.body && document.body.innerText || '').slice(0, 12000),
  };
})())
"""


def _json_value(value: Any, *, context: str) -> dict[str, Any]:
    if not isinstance(value, str):
        raise BossBrowserError(f"{context}未返回可读取的数据")
    try:
        payload = json.loads(value)
    except json.JSONDecodeError as exc:
        raise BossBrowserError(f"{context}返回格式异常") from exc
    if not isinstance(payload, dict):
        raise BossBrowserError(f"{context}返回格式异常")
    return payload


def _open_cdp(cdp_port: int, session_factory: SessionFactory) -> tuple[Any, bool]:
    """Reuse the login-page connection so Chrome does not discard its tab."""
    global _persistent_cdp, _persistent_page
    if (
        cdp_port == DEFAULT_CDP_PORT
        and session_factory is _CDPSession
        and _persistent_cdp is not None
    ):
        try:
            _persistent_cdp.send("Browser.getVersion")
            return _persistent_cdp, False
        except Exception:
            # A dedicated Chrome restart invalidates the websocket while the
            # Python process remains alive. Reconnect transparently instead of
            # leaving the UI stuck on "socket is already closed".
            with suppress(Exception):
                _persistent_cdp.close()
            _persistent_cdp = None
            _persistent_page = None
    return session_factory(cdp_port), True


def _reveal_existing_chrome() -> None:
    """Ask an existing isolated Chrome process to create a visible window.

    Chrome can survive a prior interrupted run with ``--no-startup-window``.
    CDP can still create page targets in that state, but the user sees nothing.
    Re-launching the same profile with ``--new-window`` is routed to that exact
    Chrome instance and turns the recoverable background session into a visible
    login window without touching the user's everyday Chrome profile.
    """
    chrome = Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    if not chrome.exists():
        return
    profile = str(Path(BOSS_PROFILE_DIR).expanduser())
    subprocess.Popen(
        [
            str(chrome),
            f"--remote-debugging-port={DEFAULT_CDP_PORT}",
            "--remote-allow-origins=http://127.0.0.1:9222",
            f"--user-data-dir={profile}",
            "--new-window",
            BOSS_VISIBLE_SEARCH_PAGE,
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
    )


def _existing_chrome_needs_window() -> bool:
    """Detect the known macOS stale-process state without touching any profile."""
    profile = str(Path(BOSS_PROFILE_DIR).expanduser())
    with suppress(Exception):
        processes = subprocess.run(
            ["ps", "ax", "-o", "command="],
            check=True,
            capture_output=True,
            text=True,
            timeout=3,
        ).stdout
        return any(
            profile in command and "--no-startup-window" in command
            for command in processes.splitlines()
        )
    return False


def _wait_for_cdp(*, timeout: float = 10.0) -> None:
    """Wait for a newly launched Chrome to expose its debugging endpoint."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if _cdp_reachable(DEFAULT_CDP_PORT):
            return
        time.sleep(0.15)
    raise BossBrowserError("专用 Chrome 已启动，但浏览器连接尚未就绪，请稍后重试")


def _attach_page(
    cdp: Any,
    *,
    preferred_host: str = "zhipin.com",
    create_url: str | None = None,
    force_create: bool = False,
    background: bool = False,
) -> _AttachedPage | None:
    global _persistent_page
    if (
        cdp is _persistent_cdp
        and not force_create
        and _persistent_page is not None
    ):
        # Reuse the healthy flattened session. Re-attaching on every four-second
        # status poll leaks CDP sessions and can make BOSS visibly flicker.
        try:
            cdp.send(
                "Runtime.evaluate",
                {"expression": "true", "returnByValue": True},
                sid=_persistent_page.session_id,
            )
            return _persistent_page
        except Exception:
            # BOSS can rebuild its SPA target. Re-discover and attach only when
            # the cached session is actually stale.
            _persistent_page = None
    targets = cdp.send("Target.getTargets").get("result", {}).get("targetInfos", [])
    pages = [item for item in targets if item.get("type") == "page"]
    preferred_pages = [
        item for item in pages if preferred_host in str(item.get("url", ""))
    ]

    def page_score(item: dict[str, Any]) -> int:
        """Prefer a usable signed-in page over stale login/challenge tabs."""
        url = str(item.get("url", ""))
        score = 0
        if "_security_check" in url:
            score -= 100
        if "/web/user/" in url:
            score -= 50
        if "/web/geek/jobs" in url or "/job_detail/" in url:
            score += 20
        return score

    selected = None if force_create else (
        max(preferred_pages, key=page_score) if preferred_pages else None
    )
    owned = False
    if selected is None and create_url:
        created = cdp.send(
            "Target.createTarget", {"url": create_url, "background": background}
        )
        selected = {"targetId": created["result"]["targetId"]}
        owned = True
    elif selected is None and pages:
        selected = pages[0]
    if selected is None:
        return None
    attached = cdp.send(
        "Target.attachToTarget",
        {"targetId": selected["targetId"], "flatten": True},
    )
    session_id = attached["result"]["sessionId"]
    cdp.send("Page.enable", sid=session_id)
    cdp.send("Runtime.enable", sid=session_id)
    return _AttachedPage(str(selected["targetId"]), str(session_id), owned)


def _show_page(cdp: Any, page: _AttachedPage) -> None:
    """Make the dedicated page visibly available for login or source review."""
    with suppress(Exception):
        window = cdp.send(
            "Browser.getWindowForTarget", {"targetId": page.target_id}
        )
        window_id = window.get("result", {}).get("windowId")
        if window_id is not None:
            cdp.send(
                "Browser.setWindowBounds",
                {"windowId": window_id, "bounds": {"windowState": "normal"}},
            )
    with suppress(Exception):
        cdp.send("Page.bringToFront", sid=page.session_id)


def _navigate(cdp: Any, page: _AttachedPage, url: str, *, timeout: float = 15) -> None:
    cdp.send("Page.navigate", {"url": url}, sid=page.session_id)
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        with suppress(Exception):
            state = _json_value(
                cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 页面"
            )
            if state.get("ready") in {"interactive", "complete"} and state.get("url") != "about:blank":
                # Give the client-rendered result list a short, bounded window.
                time.sleep(1.2)
                return
        time.sleep(0.25)
    raise BossBrowserError("BOSS 页面加载超时，请检查专用 Chrome 窗口")


def _is_logged_in(state: dict[str, Any]) -> bool:
    url = str(state.get("url", ""))
    body = str(state.get("body", ""))
    if (
        "/web/user/" in url
        or "_security_check" in url
        or any(marker in body for marker in (*_LOGIN_MARKERS, *_VERIFICATION_MARKERS))
    ):
        return False
    return "zhipin.com" in url and (
        bool(state.get("loggedMarker")) or not bool(state.get("loginMarker"))
    )


def _normalized_identity(value: str) -> str:
    """Normalize visible job identity text for conservative page matching."""
    return re.sub(r"[^0-9a-z\u4e00-\u9fff]+", "", value.lower())


def _same_job_title(expected: str, actual: str) -> bool:
    expected_value = _normalized_identity(expected)
    actual_value = _normalized_identity(actual)
    if not expected_value or not actual_value:
        return False
    return expected_value in actual_value or actual_value in expected_value


@_serialized_cdp
def get_status(
    *,
    cdp_port: int = DEFAULT_CDP_PORT,
    session_factory: SessionFactory = _CDPSession,
) -> dict[str, Any]:
    """Return live state inferred from the dedicated visible browser page."""
    if not _cdp_reachable(cdp_port):
        return {"source": "boss", "status": "not_running", "page_url": None}
    cdp = None
    try:
        cdp, should_close = _open_cdp(cdp_port, session_factory)
        page = _attach_page(cdp)
        if page is None:
            return {"source": "boss", "status": "not_logged_in", "page_url": None}
        state = _json_value(
            cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 页面"
        )
        url = str(state.get("url", ""))
        body = str(state.get("body", ""))
        if "_security_check" in url or any(marker in body for marker in _VERIFICATION_MARKERS):
            return {
                "source": "boss",
                "status": "verification_required",
                "page_url": state.get("url"),
            }
        return {
            "source": "boss",
            "status": "connected" if _is_logged_in(state) else "not_logged_in",
            "page_url": state.get("url"),
        }
    except Exception as exc:
        return {
            "source": "boss",
            "status": "unavailable",
            "page_url": None,
            "message": str(exc)[:300],
        }
    finally:
        if cdp is not None and should_close:
            with suppress(Exception):
                cdp.close()


@_serialized_cdp
def start() -> dict[str, Any]:
    """Start jobfindsme's isolated Chrome and ensure a visible BOSS page exists."""
    global _persistent_cdp, _persistent_page
    result = setup_chrome(("boss",))
    if not result.get("ok"):
        raise BossBrowserError(str(result.get("message") or "无法启动专用 Chrome"))
    if (
        "已在运行" in str(result.get("message") or "")
        and _existing_chrome_needs_window()
    ):
        _reveal_existing_chrome()
        # Give Chrome a short moment to register the forced visible window
        # before attaching to its page target.
        time.sleep(0.4)
    _wait_for_cdp()
    # setup_chrome may find a no-startup-window Chrome process. Create a visible
    # page in that exact profile so the user always has an obvious login UI.
    if _persistent_cdp is not None:
        with suppress(Exception):
            _persistent_cdp.close()
    _persistent_page = None
    try:
        cdp = _CDPSession(DEFAULT_CDP_PORT)
    except BossConnectorError as exc:
        raise BossBrowserError(str(exc)) from exc
    try:
        page = _attach_page(cdp, create_url=BOSS_VISIBLE_SEARCH_PAGE)
        if page is None:
            raise BossBrowserError("专用 Chrome 已启动，但未能打开 BOSS 页面")
        _show_page(cdp, page)
        state = _json_value(
            cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 页面"
        )
        if state.get("url") == "about:blank":
            _navigate(cdp, page, BOSS_VISIBLE_SEARCH_PAGE)
        _persistent_cdp = cdp
        _persistent_page = page
    except Exception:
        cdp.close()
        _persistent_cdp = None
        _persistent_page = None
        raise
    return {**get_status(), "message": result.get("message")}


@_serialized_cdp
def search(
    keyword: str,
    city: str = "",
    *,
    limit: int = 20,
    cdp_port: int = DEFAULT_CDP_PORT,
    session_factory: SessionFactory = _CDPSession,
) -> list[dict[str, Any]]:
    """Read one low-frequency result page through the visible logged-in tab.

    The same-origin API is the upstream jobfindsme mechanism used by the page
    itself.  Keeping the visible tab on the stable search shell avoids forcing
    a full navigation (and another security check) for every sentence search.
    """
    cdp, should_close = _open_cdp(cdp_port, session_factory)
    try:
        page = _attach_page(cdp, create_url=BOSS_VISIBLE_SEARCH_PAGE)
        if page is None:
            raise BossBrowserError("未找到专用 Chrome 页面")
        state = _json_value(
            cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 搜索页"
        )
        if "zhipin.com" not in str(state.get("url", "")):
            _navigate(cdp, page, BOSS_VISIBLE_SEARCH_PAGE)
            state = _json_value(
                cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 搜索页"
            )
        state_url = str(state.get("url", ""))
        state_body = str(state.get("body", ""))
        if "_security_check" in state_url or any(marker in state_body for marker in _VERIFICATION_MARKERS):
            raise BossBrowserError("BOSS 要求安全验证，请在专用 Chrome 中完成后重试")
        if not _is_logged_in(state):
            raise BossLoginRequired("请先在弹出的专用 Chrome 中登录 BOSS直聘")

        params: dict[str, str | int] = {
            "query": keyword.strip(),
            "page": 1,
            "pageSize": min(30, max(1, limit)),
        }
        if city:
            params["city"] = BOSS_CITY_CODES.get(city.strip(), city.strip())
        api_url = f"{BOSS_ORIGIN}{BOSS_API_PATH}?{urlencode(params)}"
        raw = cdp.eval_js(
            _JS_FETCH_API.replace("__API_URL__", json.dumps(api_url)),
            page.session_id,
        )
        items = BossZhipinConnector._parse_response(raw)
        jobs: list[dict[str, Any]] = []
        seen: set[str] = set()
        for row in items:
            if not isinstance(row, dict):
                continue
            url = str(row.get("job_link", "")).split("#", 1)[0]
            parsed_url = urlsplit(url)
            hostname = (parsed_url.hostname or "").lower()
            if (
                not url
                or not hostname.endswith("zhipin.com")
                or not re.fullmatch(r"/job_detail/[^/]+\.html", parsed_url.path)
                or url in seen
            ):
                continue
            title = str(row.get("title") or "未命名岗位")[:200]
            company = str(row.get("company") or "未注明公司")[:200]
            location = str(row.get("location") or "未注明")[:120]
            salary = str(row.get("salary") or "")[:80]
            summary = "\n".join(
                value
                for value in (
                    title,
                    salary,
                    str(row.get("experience") or ""),
                    str(row.get("degree") or ""),
                    company,
                    location,
                    str(row.get("skills") or ""),
                    str(row.get("job_labels") or ""),
                    str(row.get("welfare") or ""),
                )
                if value
            )
            seen.add(url)
            jobs.append(
                {
                    "title": title,
                    "company": company,
                    "location": location,
                    "source": "BOSS直聘",
                    "original_url": url,
                    "jd": summary or "职位列表摘要",
                    "salary": salary,
                    "has_full_jd": False,
                }
            )
            if len(jobs) >= limit:
                break
        return jobs
    except BossConnectorError as exc:
        raise BossBrowserError(str(exc)) from exc
    finally:
        if should_close:
            cdp.close()


@_serialized_cdp
def read_detail(
    url: str,
    *,
    expected_title: str = "",
    cdp_port: int = DEFAULT_CDP_PORT,
    session_factory: SessionFactory = _CDPSession,
) -> dict[str, Any]:
    """Visibly open one approved BOSS detail and extract its rendered JD."""
    hostname = (urlsplit(url).hostname or "").lower()
    if not hostname.endswith("zhipin.com") or "/job_detail/" not in url:
        raise BossBrowserError("该链接不是 BOSS 职位详情页")
    cdp, should_close = _open_cdp(cdp_port, session_factory)
    page: _AttachedPage | None = None
    try:
        # Use one short-lived background tab for each approved detail. This
        # keeps the user's stable BOSS search/login tab untouched and avoids
        # visibly refreshing or foregrounding Chrome throughout a batch.
        page = _attach_page(
            cdp,
            create_url="about:blank",
            force_create=True,
            background=True,
        )
        if page is None:
            raise BossBrowserError("未找到专用 Chrome 页面")
        _navigate(cdp, page, url)
        state = _json_value(
            cdp.eval_js(_PAGE_STATE_JS, page.session_id), context="BOSS 职位页"
        )
        state_url = str(state.get("url", ""))
        state_body = str(state.get("body", ""))
        if "_security_check" in state_url or any(marker in state_body for marker in _VERIFICATION_MARKERS):
            raise BossBrowserError("BOSS 要求安全验证，请在专用 Chrome 中完成后重试")
        if not _is_logged_in(state):
            raise BossLoginRequired("BOSS 登录状态已失效，请在专用 Chrome 中重新登录")
        # BOSS may briefly return to the SPA search shell while rendering the
        # requested detail in its side panel. Wait for that panel to identify
        # the approved job; never reuse whichever older detail happens to be
        # visible, otherwise a batch can silently attach one job's JD to
        # another job.
        deadline = time.monotonic() + 8
        detail: dict[str, Any] = {}
        while time.monotonic() < deadline:
            detail = _json_value(
                cdp.eval_js(_DETAIL_JS, page.session_id), context="BOSS 职位详情"
            )
            actual_title = str(detail.get("title") or "").strip()
            if not expected_title or _same_job_title(expected_title, actual_title):
                break
            time.sleep(0.35)
        actual_title = str(detail.get("title") or "").strip()
        if expected_title and not _same_job_title(expected_title, actual_title):
            raise BossBrowserError(
                f"BOSS 未打开所选岗位“{expected_title}”，为避免串用其他岗位 JD 已停止"
            )
        jd = str(detail.get("jd") or "").strip()
        if len(jd) < 120:
            body = str(detail.get("body") or "")
            # A conservative fallback: keep the visible page text only when it
            # clearly contains the standard job-description boundary.
            marker = next((item for item in ("职位描述", "岗位职责", "任职要求") if item in body), None)
            if marker:
                jd = body[body.index(marker) :].strip()[:30000]
        if len(jd) < 120:
            raise BossBrowserError("当前职位页没有读取到完整 JD，可能已下线或触发安全验证")
        return {
            "title": str(detail.get("title") or "").strip(),
            "company": str(detail.get("company") or "").strip(),
            "location": str(detail.get("location") or "").strip(),
            "original_url": str(detail.get("url") or url),
            "jd": jd,
            "has_full_jd": True,
        }
    except BossConnectorError as exc:
        raise BossBrowserError(str(exc)) from exc
    finally:
        if page is not None and page.owned:
            with suppress(Exception):
                cdp.send("Target.closeTarget", {"targetId": page.target_id})
        if should_close:
            cdp.close()
