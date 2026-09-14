"""Bounded adapter from jobfindsme into Resume Matcher job records."""

import logging
import re
from urllib.parse import urlencode

logger = logging.getLogger(__name__)

_CITIES = (
    "北京", "上海", "广州", "深圳", "杭州", "南京", "苏州", "成都", "武汉", "西安",
    "厦门", "长沙", "重庆", "天津", "郑州", "合肥", "青岛", "大连", "宁波", "佛山",
)

# Common role endings are a much stronger signal than the surrounding natural
# language.  In particular, do not pass "帮我找上海和杭州的大厂 … 岗位" to a
# source matcher as though it were the job title.
_ROLE_PATTERN = re.compile(
    r"(?P<role>(?:(?:AI|AIGC|算法|后端|前端|全栈|数据|增长|商业化|策略|用户|测试|"
    r"Java|Python|C\+\+|iOS|Android|产品|项目|设计|研发|架构|安全|云|大模型|"
    r"智能体|LLM|SaaS|B端|C端)\s*)*(?:产品经理|工程师|设计师|分析师|运营|"
    r"项目经理|研究员|顾问|专员|总监|负责人))",
    re.IGNORECASE,
)


def _role_from_query(query: str) -> str:
    """Extract a concise role rather than using the whole natural sentence."""
    candidates = [match.group("role").strip() for match in _ROLE_PATTERN.finditer(query)]
    if candidates:
        # Prefer the most specific title (for example, "AI 产品经理" over
        # "产品经理") while keeping the original wording the source expects.
        return max(candidates, key=len)
    for separator in ("，", ",", "。", ";", "；"):
        query = query.split(separator, 1)[0]
    return query.strip()


def parse_query(query: str) -> dict[str, object]:
    """Extract the small set of constraints jobfindsme can enforce reliably."""
    locations = tuple(city for city in _CITIES if city in query)
    years = re.search(r"(?P<low>\d+)\s*(?:-|–|到|至)\s*(?P<high>\d+)\s*年", query)
    minimum = re.search(r"(?P<low>\d+)\s*年(?:以上|经验)", query)
    exclusions = tuple(
        phrase
        for phrase in ("外包", "劳务派遣", "销售", "实习")
        if re.search(rf"(?:不要|排除|不考虑|非){phrase}", query)
    )
    return {
        "target_role": _role_from_query(query),
        "locations": locations,
        "experience_min_years": int(years.group("low")) if years else int(minimum.group("low")) if minimum else None,
        "experience_max_years": int(years.group("high")) if years else None,
        "recruitment_track": "campus" if "校招" in query else None,
        "exclusions": exclusions,
    }


def build_boss_search_plan(query: str) -> dict[str, object]:
    """Turn one sentence into a small set of visible BOSS search pages."""
    from jobfindsme.connectors.boss_zhipin import BOSS_CITY_CODES

    parsed = parse_query(query)
    keyword = str(parsed["target_role"] or query).strip()
    locations = tuple(parsed["locations"]) or ("",)
    searches = []
    for location in locations[:3]:
        params = {"query": keyword}
        if location:
            params["city"] = BOSS_CITY_CODES.get(str(location), str(location))
        searches.append(
            {
                "location": str(location),
                "url": f"https://www.zhipin.com/web/geek/jobs?{urlencode(params)}",
            }
        )
    return {"keyword": keyword, "locations": list(locations[:3]), "searches": searches}


def has_complete_jd(detail_level: str, description: str | None) -> bool:
    """Keep list-card metadata out of the tailoring path."""
    return detail_level == "detail_page" and len((description or "").strip()) >= 200


def _run_search(query: str, limit: int, allow_boss_browser: bool) -> tuple[list[dict], list[dict]]:
    from app.services.boss_browser import search as search_boss

    parsed = parse_query(query)
    browser_jobs: list[dict] = []
    browser_statuses: list[dict] = []
    if allow_boss_browser:
        locations = tuple(parsed["locations"]) or ("",)
        per_city_limit = max(1, min(30, (limit + len(locations) - 1) // len(locations)))
        for location in locations[:3]:
            try:
                rows = search_boss(
                    str(parsed["target_role"]),
                    str(location),
                    limit=per_city_limit,
                )
                browser_jobs.extend(rows)
                browser_statuses.append(
                    {
                        "source": f"BOSS直聘{f'·{location}' if location else ''}",
                        "status": "success",
                        "count": len(rows),
                        "error": None,
                    }
                )
            except Exception as exc:
                browser_statuses.append(
                    {
                        "source": f"BOSS直聘{f'·{location}' if location else ''}",
                        "status": "failed",
                        "count": 0,
                        "error": str(exc)[:500],
                    }
                )

    # Only the BOSS path is exposed here because it is the only source whose
    # login detection, result capture, original link and detail completion are
    # verified end to end. Other sites enter through explicit link import until
    # their own adapters meet the same contract.
    statuses = browser_statuses
    jobs = list(browser_jobs)

    deduplicated: list[dict] = []
    seen: set[tuple[str, str, str]] = set()
    for item in jobs:
        identity = (
            str(item.get("original_url") or ""),
            str(item.get("title") or ""),
            str(item.get("company") or ""),
        )
        if identity in seen:
            continue
        seen.add(identity)
        deduplicated.append(item)
        if len(deduplicated) >= limit:
            break
    return deduplicated, statuses


async def search(query: str, limit: int, allow_boss_browser: bool) -> tuple[list[dict], list[dict]]:
    try:
        import asyncio

        return await asyncio.to_thread(_run_search, query, limit, allow_boss_browser)
    except Exception as exc:
        logger.exception("Job discovery adapter failed")
        return [], [{"source": "jobfindsme", "status": "failed", "count": 0, "error": str(exc)[:500]}]
