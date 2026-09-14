"""Safe, bounded import of a user-pasted public job-detail page."""

import asyncio
import html
import ipaddress
import json
import re
import socket
from urllib.parse import urlsplit, urlunsplit

import httpx

_MAX_BYTES = 1_500_000
_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.IGNORECASE | re.DOTALL)
_META_RE = re.compile(
    r"<meta\s+[^>]*(?:name|property)=[\"'](?P<key>[^\"']+)[\"'][^>]*content=[\"'](?P<value>.*?)[\"'][^>]*>",
    re.IGNORECASE | re.DOTALL,
)
_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")


class JobLinkImportError(ValueError):
    """A safe message intended for the user-visible import flow."""


def canonicalize_url(raw_url: str) -> str:
    parts = urlsplit(raw_url.strip())
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise JobLinkImportError("请粘贴有效的 http 或 https 职位链接。")
    hostname = parts.hostname.lower()
    if hostname == "localhost" or hostname.endswith(".localhost"):
        raise JobLinkImportError("不支持本机或内网链接。")
    try:
        if ipaddress.ip_address(hostname).is_private or ipaddress.ip_address(hostname).is_loopback:
            raise JobLinkImportError("不支持本机或内网链接。")
    except ValueError:
        pass
    return urlunsplit((parts.scheme, parts.netloc, parts.path, parts.query, ""))


async def _verify_public_host(hostname: str) -> None:
    try:
        infos = await asyncio.get_running_loop().getaddrinfo(hostname, None)
    except OSError as exc:
        raise JobLinkImportError("无法解析该职位链接的域名。") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_reserved:
            raise JobLinkImportError("不支持指向内网的职位链接。")


def _plain_text(value: str) -> str:
    value = re.sub(r"<(script|style|noscript)[^>]*>.*?</\1>", " ", value, flags=re.IGNORECASE | re.DOTALL)
    value = _TAG_RE.sub(" ", value)
    return _SPACE_RE.sub(" ", html.unescape(value)).strip()


def _metadata(page: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for match in _META_RE.finditer(page):
        result[match.group("key").lower()] = _plain_text(match.group("value"))
    title = _TITLE_RE.search(page)
    if title:
        result.setdefault("title", _plain_text(title.group(1)))
    return result


def _json_ld_job(page: str) -> dict[str, str]:
    for raw in re.findall(r"<script[^>]+application/ld\+json[^>]*>(.*?)</script>", page, re.IGNORECASE | re.DOTALL):
        try:
            values = json.loads(html.unescape(raw))
        except json.JSONDecodeError:
            continue
        for value in values if isinstance(values, list) else [values]:
            if not isinstance(value, dict) or value.get("@type") != "JobPosting":
                continue
            organization = value.get("hiringOrganization") or {}
            location = value.get("jobLocation") or {}
            address = location.get("address") if isinstance(location, dict) else {}
            return {
                "title": _plain_text(str(value.get("title") or "")),
                "company": _plain_text(str(organization.get("name") or "")) if isinstance(organization, dict) else "",
                "location": _plain_text(str(address.get("addressLocality") or address.get("addressRegion") or "")) if isinstance(address, dict) else "",
                "jd": _plain_text(str(value.get("description") or "")),
            }
    return {}


async def import_job_link(raw_url: str) -> dict[str, str | bool]:
    """Fetch one public job page with bounded bytes and no redirect hopping."""
    url = canonicalize_url(raw_url)
    hostname = urlsplit(url).hostname
    assert hostname is not None
    await _verify_public_host(hostname)
    headers = {"User-Agent": "ResumeMatcher/1.0 (job-link import)"}
    try:
        async with httpx.AsyncClient(timeout=12, follow_redirects=False, headers=headers) as client:
            response = await client.get(url)
    except httpx.HTTPError as exc:
        raise JobLinkImportError("无法读取该职位链接；可稍后再试或改为从搜索结果打开详情。") from exc
    if response.status_code >= 400:
        raise JobLinkImportError(f"职位链接返回了 {response.status_code}，请确认链接仍然有效。")
    content_type = response.headers.get("content-type", "")
    if "html" not in content_type.lower():
        raise JobLinkImportError("该链接不是可读取的职位网页。")
    if len(response.content) > _MAX_BYTES:
        raise JobLinkImportError("职位页面过大，无法安全导入。")

    page = response.text
    structured = _json_ld_job(page)
    meta = _metadata(page)
    jd = structured.get("jd") or meta.get("description") or meta.get("og:description") or ""
    jd = _SPACE_RE.sub(" ", jd).strip()
    if len(jd) < 80:
        # Avoid pretending a navigation page or short social preview is a JD.
        raise JobLinkImportError("未能从页面读取完整职位描述；请打开职位详情页后重试。")
    source = hostname.removeprefix("www.")
    return {
        "title": structured.get("title") or meta.get("og:title") or meta.get("title") or "未命名职位",
        "company": structured.get("company") or source,
        "location": structured.get("location") or "未注明",
        "source": source,
        "original_url": url,
        "jd": jd,
        "has_full_jd": True,
    }
