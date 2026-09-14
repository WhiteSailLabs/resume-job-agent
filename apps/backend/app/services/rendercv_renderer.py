"""Thin Resume Matcher -> RenderCV adapter.

Resume Matcher remains the source of truth for content and versions. RenderCV
only receives a transient normalized document and returns PDF bytes.
"""

from __future__ import annotations

import io
import re
import shutil
import tempfile
import threading
from pathlib import Path
from typing import Any

from rendercv.renderer.pdf_png import generate_pdf, get_package_path, get_typst_compiler
from rendercv.renderer.typst import generate_typst
from rendercv.schema.rendercv_model_builder import build_rendercv_dictionary_and_model
from ruamel.yaml import YAML


class RenderCVRenderError(RuntimeError):
    """A safe, user-facing professional-template rendering failure."""


_RENDER_LOCK = threading.Lock()
_THEMES = {
    "rendercv-engineering": "engineeringresumes",
    "rendercv-classic": "classic",
    "rendercv-modern": "moderncv",
    # ASu's high-density single-column visual rules are expressed as a
    # constrained EngineeringResumes design overlay, not a second editor.
    "rendercv-asu": "engineeringresumes",
}


def _ensure_offline_fontawesome_package() -> None:
    """Work around RenderCV 2.8's wheel omitting its pinned Typst submodule."""
    source = Path(__file__).parents[1] / "assets" / "typst_fontawesome"
    destination = get_package_path() / "preview" / "fontawesome" / "0.6.0"
    if destination.exists():
        return
    destination.mkdir(parents=True, exist_ok=True)
    for filename in (
        "typst.toml",
        "lib.typ",
        "lib-impl.typ",
        "lib-gen-func.typ",
        "lib-gen-map.typ",
    ):
        shutil.copy2(source / filename, destination / filename)


def _clean(value: Any) -> str:
    return str(value or "").strip()


def _valid_http_url(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    if not re.match(r"^https?://", value, flags=re.IGNORECASE):
        value = f"https://{value}"
    return value


def _entry_date(years: Any) -> str | None:
    value = _clean(years)
    return value or None


def resume_data_to_rendercv(data: dict[str, Any], template: str) -> dict[str, Any]:
    """Convert the primary project's ResumeData JSON to RenderCV's schema."""
    if template not in _THEMES:
        raise RenderCVRenderError("未知的专业简历模板")

    personal = data.get("personalInfo") or {}
    custom_connections: list[dict[str, Any]] = []
    phone = _clean(personal.get("phone"))
    if phone:
        custom_connections.append(
            {"fontawesome_icon": "phone", "placeholder": phone, "url": None}
        )
    for field, icon in (("linkedin", "linkedin"), ("github", "github")):
        value = _clean(personal.get(field))
        url = _valid_http_url(value)
        if value:
            custom_connections.append(
                {"fontawesome_icon": icon, "placeholder": value, "url": url}
            )

    cv: dict[str, Any] = {
        "name": _clean(personal.get("name")) or "Resume",
        "headline": _clean(personal.get("title")) or None,
        "location": _clean(personal.get("location")) or None,
        "email": _clean(personal.get("email")) or None,
        "website": _valid_http_url(_clean(personal.get("website"))),
        "custom_connections": custom_connections or None,
        "sections": {},
    }
    sections = cv["sections"]

    summary = _clean(data.get("summary"))
    if summary:
        sections["个人简介"] = [summary]

    experience_entries = []
    for item in data.get("workExperience") or []:
        experience_entries.append(
            {
                "company": _clean(item.get("company")) or "未命名公司",
                "position": _clean(item.get("title")) or "",
                "date": _entry_date(item.get("years")),
                "start_date": None,
                "end_date": None,
                "location": _clean(item.get("location")) or None,
                "summary": None,
                "highlights": [_clean(x) for x in item.get("description") or [] if _clean(x)],
            }
        )
    if experience_entries:
        sections["工作经历"] = experience_entries

    project_entries = []
    for item in data.get("personalProjects") or []:
        name = _clean(item.get("name")) or "未命名项目"
        url = _valid_http_url(_clean(item.get("github") or item.get("website")))
        if url:
            name = f"[{name}]({url})"
        project_entries.append(
            {
                "name": name,
                "date": _entry_date(item.get("years")),
                "start_date": None,
                "end_date": None,
                "location": None,
                "summary": _clean(item.get("role")) or None,
                "highlights": [_clean(x) for x in item.get("description") or [] if _clean(x)],
            }
        )
    if project_entries:
        sections["项目经历"] = project_entries

    education_entries = []
    for item in data.get("education") or []:
        degree = _clean(item.get("degree"))
        education_entries.append(
            {
                "institution": _clean(item.get("institution")) or "未命名院校",
                "area": degree,
                "degree": None,
                "date": _entry_date(item.get("years")),
                "start_date": None,
                "end_date": None,
                "location": None,
                "summary": None,
                "highlights": ([_clean(item.get("description"))] if _clean(item.get("description")) else []),
            }
        )
    if education_entries:
        sections["教育经历"] = education_entries

    additional = data.get("additional") or {}
    skill_entries = []
    for label, key in (
        ("技能", "technicalSkills"),
        ("语言", "languages"),
        ("证书与培训", "certificationsTraining"),
        ("奖项", "awards"),
    ):
        values = [_clean(x) for x in additional.get(key) or [] if _clean(x)]
        if values:
            skill_entries.append({"label": label, "details": "、".join(values)})
    if skill_entries:
        sections["技能与其他"] = skill_entries

    design: dict[str, Any] = {
        "theme": _THEMES[template],
        "page": {
            "size": "a4",
            "show_footer": False,
            "show_top_note": False,
        },
    }
    if template == "rendercv-asu":
        design.update(
            {
                "page": {
                    "size": "a4",
                    "top_margin": "1.0cm",
                    "bottom_margin": "1.0cm",
                    "left_margin": "1.15cm",
                    "right_margin": "1.15cm",
                    "show_footer": False,
                    "show_top_note": False,
                },
                "colors": {
                    "body": "rgb(24, 24, 27)",
                    "name": "rgb(36, 88, 184)",
                    "headline": "rgb(36, 88, 184)",
                    "connections": "rgb(55, 65, 81)",
                    "section_titles": "rgb(36, 88, 184)",
                    "links": "rgb(36, 88, 184)",
                    "footer": "rgb(107, 114, 128)",
                    "top_note": "rgb(107, 114, 128)",
                },
            }
        )

    return {"cv": cv, "design": design}


def render_resume_with_rendercv(data: dict[str, Any], template: str) -> bytes:
    """Render one validated ResumeData document to a text-based PDF."""
    source = resume_data_to_rendercv(data, template)
    yaml = YAML()
    yaml.default_flow_style = False
    buffer = io.StringIO()
    yaml.dump(source, buffer)

    try:
        with _RENDER_LOCK, tempfile.TemporaryDirectory(prefix="resume-matcher-rendercv-") as folder:
            root = Path(folder)
            input_path = root / "resume.yaml"
            input_path.write_text(buffer.getvalue(), encoding="utf-8")
            _, model = build_rendercv_dictionary_and_model(
                buffer.getvalue(),
                input_file_path=input_path,
                output_folder=root,
                typst_path=root / "resume.typ",
                pdf_path=root / "resume.pdf",
                dont_generate_png=True,
                dont_generate_markdown=True,
                dont_generate_html=True,
            )
            # Upstream caches a compiler by root. Clear it between isolated
            # temp directories so no render can reference a deleted root.
            _ensure_offline_fontawesome_package()
            get_typst_compiler.cache_clear()
            typst_path = generate_typst(model)
            pdf_path = generate_pdf(model, typst_path)
            if pdf_path is None or not pdf_path.exists():
                raise RenderCVRenderError("专业模板没有生成 PDF")
            return pdf_path.read_bytes()
    except RenderCVRenderError:
        raise
    except Exception as exc:
        raise RenderCVRenderError(f"专业模板渲染失败：{str(exc)[:240]}") from exc
    finally:
        get_typst_compiler.cache_clear()
