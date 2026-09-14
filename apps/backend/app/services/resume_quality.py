"""Deterministic quality checks inspired by ASu's claim/evidence workflow."""

from __future__ import annotations

import re
from typing import Any


_METRIC_RE = re.compile(r"(?<!\w)(?:\d+(?:\.\d+)?\s*(?:%|x|万\+?|亿|k\+?|K\+?)|\$\s*\d[\d,.]*)")
_STRONG_CLAIM_RE = re.compile(
    r"\b(?:owner|led|spearheaded|architected|founded|core author)\b|主导|负责人|架构|从\s*0\s*到\s*1|0\s*[→-]\s*1|核心作者",
    re.IGNORECASE,
)
_VAGUE_RE = re.compile(
    r"\b(?:responsible for|familiar with|passionate about|results[- ]driven|solid understanding|strong ability)\b|"
    r"负责相关|熟悉相关|具备较强|能力较强|热爱人工智能|良好的沟通|较强的学习|工作认真",
    re.IGNORECASE,
)
_ACTION_RE = re.compile(
    r"\b(?:built|designed|implemented|launched|delivered|optimized|analyzed|created|developed|coordinated|validated|deployed|reduced|increased)\b|"
    r"搭建|设计|实现|上线|交付|优化|分析|创建|开发|协调|验证|部署|降低|提升|推动|迭代",
    re.IGNORECASE,
)


def _texts(data: dict[str, Any]) -> list[str]:
    result: list[str] = []
    summary = str(data.get("summary") or "").strip()
    if summary:
        result.append(summary)
    for section in ("workExperience", "personalProjects"):
        for entry in data.get(section) or []:
            result.extend(
                str(item).strip()
                for item in entry.get("description") or []
                if str(item).strip()
            )
    for entry in data.get("education") or []:
        description = str(entry.get("description") or "").strip()
        if description:
            result.append(description)
    return result


def _terms(value: Any) -> set[str]:
    if isinstance(value, dict):
        items: list[Any] = []
        for item in value.values():
            items.extend(item if isinstance(item, list) else [item])
    elif isinstance(value, list):
        items = value
    else:
        items = []
    return {
        str(item).strip().casefold()
        for item in items
        if 2 <= len(str(item).strip()) <= 60
    }


def analyze_resume_quality(
    candidate: dict[str, Any],
    *,
    original: dict[str, Any] | None = None,
    job_keywords: Any = None,
) -> dict[str, Any]:
    """Return an explainable report; never changes or blocks the resume."""
    bullets = _texts(candidate)
    original_text = "\n".join(_texts(original or {}))
    candidate_text = "\n".join(bullets)

    unsupported_metrics = sorted(set(_METRIC_RE.findall(candidate_text)) - set(_METRIC_RE.findall(original_text))) if original else []
    unsupported_claims = []
    if original:
        original_claims = {match.group(0).casefold() for match in _STRONG_CLAIM_RE.finditer(original_text)}
        unsupported_claims = sorted(
            {
                match.group(0)
                for match in _STRONG_CLAIM_RE.finditer(candidate_text)
                if match.group(0).casefold() not in original_claims
            }
        )

    vague = [text for text in bullets if _VAGUE_RE.search(text)]
    substantive_entry_count = sum(
        len(candidate.get(section) or [])
        for section in ("workExperience", "personalProjects", "education")
    )
    skill_count = len((candidate.get("additional") or {}).get("technicalSkills") or [])
    action_count = sum(bool(_ACTION_RE.search(text)) for text in bullets)
    evidence_count = sum(bool(_METRIC_RE.search(text) or re.search(r"https?://|github\.com|doi\.org", text, re.I)) for text in bullets)
    keywords = _terms(job_keywords)
    matched = sorted(term for term in keywords if term in candidate_text.casefold())
    keyword_coverage = round(len(matched) / len(keywords) * 100) if keywords else None

    score = 100
    score -= min(35, len(unsupported_metrics) * 15)
    score -= min(25, len(unsupported_claims) * 10)
    score -= min(20, len(vague) * 4)
    if bullets and action_count / len(bullets) < 0.5:
        score -= 10
    if bullets and evidence_count / len(bullets) < 0.25:
        score -= 10
    if substantive_entry_count == 0:
        score -= 35
    if keyword_coverage is not None and keyword_coverage < 35:
        score -= 10

    recommendations: list[str] = []
    if unsupported_metrics:
        recommendations.append("删除或核对新增数字；最终 PDF 只保留原简历可支持的指标。")
    if unsupported_claims:
        recommendations.append("核对主导/负责人等强主张，明确个人贡献与团队成果边界。")
    if vague:
        recommendations.append("把空泛能力描述改成具体动作、对象、方法和可核验结果。")
    if bullets and evidence_count / len(bullets) < 0.25:
        recommendations.append("为最重要的经历补充可核验结果、链接或交付证据；没有数字时可用定性证据。")
    if substantive_entry_count == 0:
        recommendations.insert(0, "原简历缺少工作、项目或教育经历；请先补全主简历，Agent 不会凭空编造经历。")
    if keyword_coverage is not None and keyword_coverage < 35:
        recommendations.append("将原简历已经证明的 JD 关键词前置；不要补写没有证据的新技能。")

    return {
        "score": max(0, score),
        "status": "ready" if score >= 80 and substantive_entry_count > 0 and not unsupported_metrics and not unsupported_claims and not vague else "review",
        "checks": {
            "unsupported_metrics": unsupported_metrics,
            "unsupported_strong_claims": unsupported_claims,
            "vague_bullets": vague,
            "action_bullet_ratio": round(action_count / len(bullets), 2) if bullets else 0,
            "evidence_bullet_ratio": round(evidence_count / len(bullets), 2) if bullets else 0,
            "keyword_coverage": keyword_coverage,
            "matched_keywords": matched,
            "substantive_entry_count": substantive_entry_count,
            "skill_count": skill_count,
        },
        "recommendations": recommendations,
        "source": "ASu claim-evidence adaptation",
    }
