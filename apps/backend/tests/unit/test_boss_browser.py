"""Contracts for the visible jobfindsme/BOSS integration boundary."""

from __future__ import annotations

import json

import pytest

from app.services import boss_browser


def test_open_cdp_reconnects_after_dedicated_chrome_restart(monkeypatch) -> None:
    class ClosedCdp:
        def send(self, method, params=None, sid=None):
            raise RuntimeError("socket is already closed")

        def close(self):
            return None

    replacement = object()
    boss_browser._persistent_cdp = ClosedCdp()
    boss_browser._persistent_page = boss_browser._AttachedPage("old", "old")
    monkeypatch.setattr(boss_browser, "_CDPSession", lambda _port: replacement)

    cdp, should_close = boss_browser._open_cdp(
        boss_browser.DEFAULT_CDP_PORT, boss_browser._CDPSession
    )

    assert cdp is replacement
    assert should_close is True
    assert boss_browser._persistent_cdp is None
    assert boss_browser._persistent_page is None


def test_reveal_existing_chrome_forces_a_visible_isolated_window(monkeypatch) -> None:
    launched = []

    class ExistingChrome:
        def exists(self):
            return True

        def expanduser(self):
            return self

        def __str__(self):
            return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    monkeypatch.setattr(boss_browser, "Path", lambda value: ExistingChrome())
    monkeypatch.setattr(
        boss_browser.subprocess,
        "Popen",
        lambda command, **kwargs: launched.append((command, kwargs)),
    )

    boss_browser._reveal_existing_chrome()

    assert len(launched) == 1
    assert "--new-window" in launched[0][0]
    assert boss_browser.BOSS_VISIBLE_SEARCH_PAGE in launched[0][0]


def test_wait_for_cdp_allows_chrome_startup_delay(monkeypatch) -> None:
    checks = iter((False, False, True))
    sleeps = []
    monkeypatch.setattr(boss_browser, "_cdp_reachable", lambda _port: next(checks))
    monkeypatch.setattr(boss_browser.time, "sleep", lambda seconds: sleeps.append(seconds))

    boss_browser._wait_for_cdp(timeout=2)

    assert len(sleeps) == 2


def test_wait_for_cdp_reports_a_recoverable_startup_error(monkeypatch) -> None:
    clock = iter((0.0, 0.1, 0.2))
    monkeypatch.setattr(boss_browser.time, "monotonic", lambda: next(clock))
    monkeypatch.setattr(boss_browser.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(boss_browser, "_cdp_reachable", lambda _port: False)

    with pytest.raises(boss_browser.BossBrowserError, match="连接尚未就绪"):
        boss_browser._wait_for_cdp(timeout=0.15)


class FakeCdp:
    def __init__(self, *, logged_in: bool = True) -> None:
        self.logged_in = logged_in
        self.url = "https://www.zhipin.com/web/geek/job"
        self.closed = False
        self.created_targets: list[str] = []
        self.closed_targets: list[str] = []
        self.navigate_count = 0

    def send(self, method, params=None, sid=None):
        params = params or {}
        if method == "Target.getTargets":
            return {
                "result": {
                    "targetInfos": [
                        {"type": "page", "targetId": "page-1", "url": self.url}
                    ]
                }
            }
        if method == "Target.attachToTarget":
            return {"result": {"sessionId": "session-1"}}
        if method == "Target.createTarget":
            self.url = params["url"]
            self.created_targets.append("detail-page-1")
            return {"result": {"targetId": "detail-page-1"}}
        if method == "Target.closeTarget":
            self.closed_targets.append(params["targetId"])
            return {"result": {"success": True}}
        if method == "Page.navigate":
            self.navigate_count += 1
            self.url = (
                params["url"]
                if self.logged_in
                else "https://www.zhipin.com/web/user/"
            )
            return {"result": {"frameId": "page-1"}}
        return {"result": {}}

    def eval_js(self, js, sid):
        if "loggedMarker" in js:
            return json.dumps(
                {
                    "url": self.url,
                    "title": "BOSS直聘",
                    "ready": "complete",
                    "body": "岗位搜索" if self.logged_in else "验证码登录/注册",
                    "loggedMarker": self.logged_in,
                    "loginMarker": not self.logged_in,
                }
            )
        if "await fetch" in js:
            return json.dumps(
                {
                    "jobs": [
                        {
                            "job_id": "encrypted-1",
                            "title": "AI产品经理",
                            "company": "示例科技",
                            "location": "上海·浦东新区",
                            "salary": "25-35K",
                            "experience": "5-10年",
                            "degree": "本科",
                            "job_link": "https://www.zhipin.com/job_detail/encrypted-1.html",
                        }
                    ],
                }
            )
        if "detailNodes" in js:
            return json.dumps(
                {
                    "url": self.url,
                    "title": "AI产品经理",
                    "company": "示例科技",
                    "location": "上海",
                    "jd": "职位描述\n负责 AI 产品规划、需求分析、模型能力评估、数据指标设计和跨团队交付。"
                    "任职要求\n三年以上产品经验，能与算法和工程团队协作，并持续基于用户反馈验证产品价值。" * 2,
                    "body": "",
                }
            )
        raise AssertionError("unexpected script")

    def close(self):
        self.closed = True


def test_status_comes_from_live_visible_page(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser, "_cdp_reachable", lambda _port: True)
    fake = FakeCdp()

    result = boss_browser.get_status(session_factory=lambda _port: fake)

    assert result["status"] == "connected"
    assert result["page_url"].startswith("https://www.zhipin.com/")
    assert fake.closed is True


def test_status_prefers_signed_in_page_over_stale_verification_tab(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser, "_cdp_reachable", lambda _port: True)

    class MultiPageCdp(FakeCdp):
        def __init__(self) -> None:
            super().__init__()
            self.attached_target = ""

        def send(self, method, params=None, sid=None):
            params = params or {}
            if method == "Target.getTargets":
                return {
                    "result": {
                        "targetInfos": [
                            {
                                "type": "page",
                                "targetId": "stale-verification",
                                "url": "https://www.zhipin.com/web/geek/jobs?_security_check=1_123",
                            },
                            {
                                "type": "page",
                                "targetId": "signed-in-jobs",
                                "url": "https://www.zhipin.com/web/geek/jobs",
                            },
                        ]
                    }
                }
            if method == "Target.attachToTarget":
                self.attached_target = params["targetId"]
                return {"result": {"sessionId": "session-1"}}
            return {"result": {}}

        def eval_js(self, js, sid):
            if "loggedMarker" in js:
                return json.dumps(
                    {
                        "url": "https://www.zhipin.com/web/geek/jobs",
                        "title": "BOSS直聘",
                        "ready": "complete",
                        "body": "岗位搜索",
                        "loggedMarker": True,
                        "loginMarker": False,
                    }
                )
            raise AssertionError("unexpected script")

    fake = MultiPageCdp()
    result = boss_browser.get_status(session_factory=lambda _port: fake)

    assert result["status"] == "connected"
    assert fake.attached_target == "signed-in-jobs"


def test_search_reads_rendered_cards_and_keeps_detail_incomplete(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser.time, "sleep", lambda _seconds: None)
    monkeypatch.setattr(
        boss_browser,
        "_show_page",
        lambda *_args, **_kwargs: pytest.fail("background search must not steal focus"),
    )
    fake = FakeCdp()

    rows = boss_browser.search(
        "AI产品经理", "上海", session_factory=lambda _port: fake
    )

    assert rows == [
        {
            "title": "AI产品经理",
            "company": "示例科技",
            "location": "上海·浦东新区",
            "source": "BOSS直聘",
            "original_url": "https://www.zhipin.com/job_detail/encrypted-1.html",
            "jd": "AI产品经理\n25-35K\n5-10年\n本科\n示例科技\n上海·浦东新区",
            "salary": "25-35K",
            "has_full_jd": False,
        }
    ]
    assert fake.closed is True


def test_persistent_page_is_not_reattached_while_session_is_healthy() -> None:
    class CountingCdp(FakeCdp):
        def __init__(self):
            super().__init__()
            self.attach_count = 0

        def send(self, method, params=None, sid=None):
            if method == "Target.attachToTarget":
                self.attach_count += 1
            return super().send(method, params, sid)

    fake = CountingCdp()
    old_cdp = boss_browser._persistent_cdp
    old_page = boss_browser._persistent_page
    try:
        boss_browser._persistent_cdp = fake
        boss_browser._persistent_page = None
        first = boss_browser._attach_page(fake)
        boss_browser._persistent_page = first
        second = boss_browser._attach_page(fake)
        assert first == second
        assert fake.attach_count == 1
    finally:
        boss_browser._persistent_cdp = old_cdp
        boss_browser._persistent_page = old_page


def test_search_stops_at_visible_login_page(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser.time, "sleep", lambda _seconds: None)
    fake = FakeCdp(logged_in=False)

    with pytest.raises(boss_browser.BossLoginRequired, match="登录"):
        boss_browser.search("AI产品经理", session_factory=lambda _port: fake)


def test_approved_detail_is_read_from_visible_page(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser.time, "sleep", lambda _seconds: None)
    fake = FakeCdp()

    detail = boss_browser.read_detail(
        "https://www.zhipin.com/job_detail/encrypted-1.html",
        expected_title="AI产品经理",
        session_factory=lambda _port: fake,
    )

    assert detail["has_full_jd"] is True
    assert detail["title"] == "AI产品经理"
    assert len(detail["jd"]) >= 120
    assert fake.navigate_count == 1
    assert fake.created_targets == ["detail-page-1"]
    assert fake.closed_targets == ["detail-page-1"]


def test_detail_rejects_a_stale_different_job(monkeypatch) -> None:
    monkeypatch.setattr(boss_browser.time, "sleep", lambda _seconds: None)
    fake = FakeCdp()

    with pytest.raises(boss_browser.BossBrowserError, match="避免串用其他岗位 JD"):
        boss_browser.read_detail(
            "https://www.zhipin.com/job_detail/encrypted-1.html",
            expected_title="数据分析师",
            session_factory=lambda _port: fake,
        )
