from pathlib import Path
from types import SimpleNamespace

import pytest

from app.database import Database


@pytest.mark.asyncio
async def test_discovery_job_round_trips_and_generation_task_is_durable(tmp_path: Path) -> None:
    database = Database(tmp_path / "discovery.db")
    try:
        job = await database.create_job("Complete job description", "resume-1")
        saved = await database.update_job(
            job["job_id"],
            {
                "discovery": True,
                "title": "AI Product Manager",
                "company": "Example",
                "location": "Shanghai",
                "source": "official",
                "has_full_jd": True,
                "status": "approved",
            },
        )
        assert saved and saved["status"] == "approved"
        assert [item["job_id"] for item in await database.list_discovery_jobs("resume-1")] == [job["job_id"]]

        task = await database.create_generation_task("resume-1", [job["job_id"]])
        updated = await database.update_generation_task(
            task["task_id"],
            status="running",
            generated_resume_ids={job["job_id"]: "draft-1"},
        )
        assert updated and updated["status"] == "running"
        persisted = await database.get_generation_task(task["task_id"])
        assert persisted and persisted["job_ids"] == [job["job_id"]]
        assert persisted["generated_resume_ids"] == {job["job_id"]: "draft-1"}
        assert [item["task_id"] for item in await database.list_recoverable_generation_tasks()] == [task["task_id"]]
    finally:
        await database.close()


async def test_discovery_adapter_surfaces_source_failure(monkeypatch) -> None:
    from app.services import job_discovery

    def fail(*_args, **_kwargs):
        raise RuntimeError("source unavailable")

    monkeypatch.setattr(job_discovery, "_run_search", fail)
    jobs, statuses = await job_discovery.search("AI 产品经理", 10, False)

    assert jobs == []
    assert statuses == [
        {
            "source": "jobfindsme",
            "status": "failed",
            "count": 0,
            "error": "source unavailable",
        }
    ]


@pytest.mark.asyncio
async def test_task_names_and_links_the_real_generated_resume(tmp_path: Path, monkeypatch) -> None:
    """A completed task must leave a durable job -> editor-draft handoff."""
    from app.services import generation_tasks

    database = Database(tmp_path / "task-run.db")
    monkeypatch.setattr(generation_tasks, "db", database)
    base = await database.create_resume("base resume", filename="base.pdf")
    job = await database.create_job("完整 JD", base["resume_id"])
    await database.update_job(
        job["job_id"],
        {
            "discovery": True,
            "company": "示例公司",
            "title": "产品经理",
            "has_full_jd": True,
            "status": "approved",
        },
    )
    task = await database.create_generation_task(base["resume_id"], [job["job_id"]])

    async def fake_improve(_request):
        draft = await database.create_resume(
            "tailored", parent_id=base["resume_id"], filename="tailored.pdf"
        )
        return SimpleNamespace(data=SimpleNamespace(resume_id=draft["resume_id"]))

    monkeypatch.setattr("app.routers.resumes.improve_resume_endpoint", fake_improve)
    try:
        await generation_tasks.run_generation_task(task["task_id"])
        persisted = await database.get_generation_task(task["task_id"])
        assert persisted and persisted["status"] == "completed"
        draft_id = persisted["generated_resume_ids"][job["job_id"]]
        draft = await database.get_resume(draft_id)
        assert draft and draft["title"].startswith("示例公司｜产品经理｜")
        updated_job = await database.get_job(job["job_id"])
        assert updated_job and updated_job["tailored_resume_id"] == draft_id
    finally:
        await database.close()


def test_only_detail_pages_with_substantive_text_are_complete_jds() -> None:
    from app.services.job_discovery import has_complete_jd

    assert has_complete_jd("detail_page", "职责与要求。" * 40) is True
    assert has_complete_jd("structured_source", "职责与要求。" * 40) is False
    assert has_complete_jd("detail_page", "很短的摘要") is False


def test_natural_language_search_keeps_only_the_role_for_source_matching() -> None:
    from app.services.job_discovery import parse_query

    parsed = parse_query("帮我找上海和杭州的大厂 AI 产品经理岗位，3–5 年经验，优先官网")

    assert parsed["target_role"] == "AI 产品经理"
    assert parsed["locations"] == ("上海", "杭州")
    assert parsed["experience_min_years"] == 3
    assert parsed["experience_max_years"] == 5
