"""Stable render-profile helpers shared by storage, API, and PDF export."""

from __future__ import annotations

from typing import Any

from app.schemas import ResumeRenderProfile


DEFAULT_RENDER_PROFILE = ResumeRenderProfile().model_dump()


def normalize_render_profile(value: Any) -> dict[str, str]:
    """Return a valid profile, falling back for pre-migration resume rows."""
    try:
        return ResumeRenderProfile.model_validate(value or DEFAULT_RENDER_PROFILE).model_dump()
    except (TypeError, ValueError):
        return dict(DEFAULT_RENDER_PROFILE)
