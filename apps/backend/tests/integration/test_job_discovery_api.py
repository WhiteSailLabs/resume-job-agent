"""API-level contracts for the jobfindsme adapter boundary."""

import json

from types import SimpleNamespace

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def client():
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


async def test_search_persists_normalized_rows_and_fixed_routes_win(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    async def fake_search(query: str, limit: int, allow_boss_browser: bool):
        assert query == "上海 AI 产品经理"
        assert limit == 10
        assert allow_boss_browser is False
        return (
            [{
                "title": "AI 产品经理",
                "company": "示例公司",
                "location": "上海",
                "source": "企业官网",
                "original_url": "https://careers.example.test/jobs/1",
                "jd": "负责 AI 产品规划与交付。",
                "has_full_jd": True,
            }],
            [{"source": "企业官网", "status": "success", "count": 1, "error": None}],
        )

    monkeypatch.setattr(jobs_router, "discover_jobs", fake_search)
    async with client:
        response = await client.post(
            "/api/v1/jobs/discovery/search",
            json={"query": "上海 AI 产品经理", "resume_id": "resume-1", "limit": 10},
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["source_status"][0]["status"] == "success"
        job_id = payload["data"][0]["job_id"]

        # This specifically catches a bad route order where `/discovery/list`
        # would be swallowed by the generic `/{job_id}` handler.
        listed = await client.get("/api/v1/jobs/discovery/list?resume_id=resume-1")
        assert listed.status_code == 200
        assert [item["job_id"] for item in listed.json()["data"]] == [job_id]

        # A repeated source scan refreshes its own list-card snapshot rather
        # than multiplying rows in the approval queue.
        repeated = await client.post(
            "/api/v1/jobs/discovery/search",
            json={"query": "上海 AI 产品经理", "resume_id": "resume-1", "limit": 10},
        )
        assert repeated.status_code == 200
        assert repeated.json()["data"][0]["job_id"] == job_id
        assert repeated.json()["data"][0]["jd_origin"] == "source_search"


async def test_search_stream_emits_each_persisted_job_before_completion(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    async def fake_search(query: str, limit: int, allow_boss_browser: bool):
        return (
            [
                {
                    "title": "AI 产品经理",
                    "company": "甲公司",
                    "location": "上海",
                    "source": "企业官网",
                    "original_url": "https://careers.example.test/jobs/stream-1",
                    "jd": "职位列表摘要 1",
                    "has_full_jd": False,
                },
                {
                    "title": "大模型产品经理",
                    "company": "乙公司",
                    "location": "杭州",
                    "source": "企业官网",
                    "original_url": "https://careers.example.test/jobs/stream-2",
                    "jd": "职位列表摘要 2",
                    "has_full_jd": False,
                },
            ],
            [{"source": "企业官网", "status": "success", "count": 2, "error": None}],
        )

    monkeypatch.setattr(jobs_router, "discover_jobs", fake_search)
    async with client:
        response = await client.post(
            "/api/v1/jobs/discovery/search-stream",
            json={"query": "AI 产品经理", "resume_id": "resume-stream"},
        )

    assert response.status_code == 200
    events = [json.loads(line) for line in response.text.splitlines()]
    assert [event["type"] for event in events] == [
        "phase", "phase", "job", "job", "complete"
    ]
    assert [event["data"]["company"] for event in events if event["type"] == "job"] == [
        "甲公司", "乙公司"
    ]
    assert events[-1]["count"] == 2


async def test_live_dedicated_browser_state_gates_boss_search(client, monkeypatch) -> None:
    import app.routers.jobs as jobs_router

    async def fake_search(query: str, limit: int, allow_boss_browser: bool):
        assert allow_boss_browser is True
        return [], []

    monkeypatch.setattr(jobs_router, "discover_jobs", fake_search)
    monkeypatch.setattr(
        jobs_router,
        "get_boss_browser_status",
        lambda: {"source": "boss", "status": "not_logged_in", "page_url": "https://www.zhipin.com/web/user/"},
    )
    async with client:
        blocked = await client.post(
            "/api/v1/jobs/discovery/search",
            json={"query": "AI 产品经理", "resume_id": "resume-1", "allow_boss_browser": True},
        )
        assert blocked.status_code == 409

        monkeypatch.setattr(
            jobs_router,
            "get_boss_browser_status",
            lambda: {"source": "boss", "status": "connected", "page_url": "https://www.zhipin.com/web/geek/job"},
        )

        state = await client.get("/api/v1/jobs/browser-session/status")
        assert state.status_code == 200
        assert state.json()["data"]["status"] == "connected"

        allowed = await client.post(
            "/api/v1/jobs/discovery/search",
            json={"query": "AI 产品经理", "resume_id": "resume-1", "allow_boss_browser": True},
        )
        assert allowed.status_code == 200


async def test_user_authorized_browser_capture_saves_one_complete_boss_jd(
    isolated_db, client
) -> None:
    import app.routers.jobs as jobs_router

    jobs_router.browser_authorizations._authorized_at.clear()
    payload = {
        "source": "boss",
        "page_url": "https://www.zhipin.com/job_detail/demo-job.html",
        "title": "AI 产品经理",
        "company": "示例科技",
        "location": "上海",
        "jd": "职位描述\n负责 AI 产品规划、需求梳理、模型能力评估和跨团队交付，持续跟踪业务目标、竞品变化和用户反馈，并形成清晰的产品路线图。\n\n任职要求\n具备三年以上产品经验，能够独立完成数据分析、用户研究与项目推进，并和算法、工程团队协作；具有复杂业务场景抽象能力，能把模型能力转化为稳定可验证的用户价值。",
        "resume_id": "resume-1",
    }
    async with client:
        blocked = await client.post("/api/v1/jobs/discovery/browser-capture", json=payload)
        assert blocked.status_code == 409
        authorized = await client.post(
            "/api/v1/jobs/browser-authorizations/complete",
            json={
                "source": "boss",
                "page_url": "https://www.zhipin.com/web/geek/job",
                "logged_in": True,
            },
        )
        assert authorized.status_code == 200
        captured = await client.post("/api/v1/jobs/discovery/browser-capture", json=payload)
        assert captured.status_code == 201
        assert captured.json()["duplicate"] is False
        job = captured.json()["data"]
        assert job["has_full_jd"] is True
        assert job["jd_origin"] == "browser_capture"
        duplicate = await client.post("/api/v1/jobs/discovery/browser-capture", json=payload)
        assert duplicate.status_code == 201
        assert duplicate.json()["duplicate"] is True


async def test_browser_search_plan_and_visible_card_capture(isolated_db, client) -> None:
    import app.routers.jobs as jobs_router

    jobs_router.browser_authorizations._authorized_at.clear()
    async with client:
        plan = await client.post(
            "/api/v1/jobs/discovery/browser-search-plan",
            json={"query": "帮我找上海和杭州的 AI 产品经理"},
        )
        assert plan.status_code == 200
        searches = plan.json()["data"]["searches"]
        assert [item["location"] for item in searches] == ["上海", "杭州"]
        assert all("zhipin.com/web/geek/jobs" in item["url"] for item in searches)

        authorization = await client.post(
            "/api/v1/jobs/browser-authorizations/complete",
            json={"source": "boss", "page_url": searches[0]["url"], "logged_in": True},
        )
        assert authorization.status_code == 200
        captured = await client.post(
            "/api/v1/jobs/discovery/browser-list-capture",
            json={
                "source": "boss",
                "page_url": searches[0]["url"],
                "original_url": "https://www.zhipin.com/job_detail/visible-card.html",
                "title": "AI 产品经理",
                "company": "真实公司",
                "location": "上海",
                "summary": "AI 产品经理 真实公司 上海 3-5年",
                "resume_id": "resume-visible",
            },
        )
        assert captured.status_code == 201
        job = captured.json()["data"]
        assert job["source"] == "BOSS直聘"
        assert job["has_full_jd"] is False
        assert job["original_url"].endswith("visible-card.html")


async def test_batch_task_runs_through_existing_tailoring_endpoint(
    isolated_db, client, monkeypatch
) -> None:
    import app.services.generation_tasks as task_service

    # The task module retains its own imported database facade; production has
    # one shared singleton, while this test deliberately substitutes it.
    monkeypatch.setattr(task_service, "db", isolated_db)

    job = await isolated_db.create_job("完整职位描述", "resume-1")
    await isolated_db.update_job(
        job["job_id"],
        {"discovery": True, "has_full_jd": True, "status": "approved"},
    )

    async def fake_improve(request):
        assert request.resume_id == "resume-1"
        assert request.job_id == job["job_id"]
        return SimpleNamespace(data=SimpleNamespace(resume_id="tailored-resume-1"))

    monkeypatch.setattr("app.routers.resumes.improve_resume_endpoint", fake_improve)
    async with client:
        created = await client.post(
            "/api/v1/jobs/generation-tasks",
            json={"resume_id": "resume-1", "job_ids": [job["job_id"]]},
        )
        assert created.status_code == 201
        task_id = created.json()["task_id"]

    # BackgroundTasks completed after the response. The task itself remains
    # durable and links the source job to the primary project's draft id.
    task = await isolated_db.get_generation_task(task_id)
    assert task and task["status"] == "completed"
    assert task["generated_resume_ids"] == {job["job_id"]: "tailored-resume-1"}
    saved_job = await isolated_db.get_job(job["job_id"])
    assert saved_job and saved_job["status"] == "generated"
    assert saved_job["tailored_resume_id"] == "tailored-resume-1"
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as task_client:
        listed = await task_client.get("/api/v1/jobs/generation-tasks?resume_id=resume-1")
    assert listed.status_code == 200
    assert listed.json()["data"][0]["task_id"] == task_id


async def test_link_import_deduplicates_and_master_selection_persists(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    async def fake_import(_url: str):
        return {
            "title": "产品经理",
            "company": "示例公司",
            "location": "杭州",
            "source": "careers.example.test",
            "original_url": "https://careers.example.test/jobs/1",
            "jd": "这是一段足够长的完整职位描述，用于测试从用户粘贴链接导入到岗位审核队列的行为。",
            "has_full_jd": True,
        }

    monkeypatch.setattr(jobs_router, "import_job_link", fake_import)
    first = await isolated_db.create_resume("第一份", filename="first.pdf")
    second = await isolated_db.create_resume("第二份", filename="second.pdf")
    async with client:
        selected = await client.post(f"/api/v1/resumes/{second['resume_id']}/set-master")
        assert selected.status_code == 200
        assert (await isolated_db.get_master_resume())["resume_id"] == second["resume_id"]

        imported = await client.post(
            "/api/v1/jobs/discovery/import-link",
            json={"url": "https://careers.example.test/jobs/1", "resume_id": second["resume_id"]},
        )
        assert imported.status_code == 201
        assert imported.json()["duplicate"] is False
        duplicate = await client.post(
            "/api/v1/jobs/discovery/import-link",
            json={"url": "https://careers.example.test/jobs/1", "resume_id": second["resume_id"]},
        )
        assert duplicate.status_code == 201
        assert duplicate.json()["duplicate"] is True
    assert first["resume_id"] != second["resume_id"]


async def test_batch_detail_completion_upgrades_only_readable_job_pages(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    readable = await isolated_db.create_job("列表摘要", "resume-1")
    unreadable = await isolated_db.create_job("列表摘要", "resume-1")
    await isolated_db.update_job(
        readable["job_id"],
        {
            "discovery": True,
            "status": "approved",
            "original_url": "https://careers.example.test/jobs/1",
            "has_full_jd": False,
        },
    )
    await isolated_db.update_job(
        unreadable["job_id"],
        {
            "discovery": True,
            "status": "approved",
            "original_url": "https://boss.example.test/jobs/2",
            "has_full_jd": False,
        },
    )

    async def fake_import(url: str):
        if "boss" in url:
            raise jobs_router.JobLinkImportError("需要已登录的浏览器会话")
        return {
            "title": "AI 产品经理",
            "company": "示例公司",
            "location": "杭州",
            "original_url": url,
            "jd": "可用于定制的完整职位描述，包含足够的岗位职责、任职资格与协作信息。",
            "has_full_jd": True,
        }

    monkeypatch.setattr(jobs_router, "import_job_link", fake_import)
    async with client:
        response = await client.post(
            "/api/v1/jobs/discovery/complete-details",
            json={"resume_id": "resume-1", "job_ids": [readable["job_id"], unreadable["job_id"]]},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["completed_job_ids"] == [readable["job_id"]]
    assert payload["failed_jobs"] == {unreadable["job_id"]: "需要已登录的浏览器会话"}
    upgraded = await isolated_db.get_job(readable["job_id"])
    assert upgraded and upgraded["has_full_jd"] is True
    assert upgraded["jd_origin"] == "detail_fetch"


async def test_boss_detail_completion_preserves_discovered_job_identity(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    job = await isolated_db.create_job("列表摘要", "resume-1")
    original_url = "https://www.zhipin.com/job_detail/requested-job.html"
    await isolated_db.update_job(
        job["job_id"],
        {
            "discovery": True,
            "status": "approved",
            "title": "AI产品经理",
            "company": "原公司",
            "location": "杭州",
            "original_url": original_url,
            "has_full_jd": False,
        },
    )

    def fake_boss_detail(url: str, *, expected_title: str):
        assert url == original_url
        assert expected_title == "AI产品经理"
        return {
            "title": "错误页面标题",
            "company": "错误公司",
            "location": "错误地点",
            "original_url": "https://www.zhipin.com/web/geek/jobs",
            "jd": "完整职位描述" * 30,
            "has_full_jd": True,
        }

    monkeypatch.setattr(jobs_router, "read_boss_detail", fake_boss_detail)
    async with client:
        response = await client.post(
            "/api/v1/jobs/discovery/complete-details",
            json={"resume_id": "resume-1", "job_ids": [job["job_id"]]},
        )

    assert response.status_code == 200
    upgraded = await isolated_db.get_job(job["job_id"])
    assert upgraded
    assert upgraded["title"] == "AI产品经理"
    assert upgraded["company"] == "原公司"
    assert upgraded["location"] == "杭州"
    assert upgraded["original_url"] == original_url
    assert upgraded["has_full_jd"] is True


async def test_only_approved_jobs_can_generate_and_failed_work_can_retry(
    isolated_db, client, monkeypatch
) -> None:
    import app.routers.jobs as jobs_router

    job = await isolated_db.create_job("完整职位描述", "resume-1")
    await isolated_db.update_job(
        job["job_id"], {"discovery": True, "has_full_jd": True, "status": "pending"}
    )
    async with client:
        blocked = await client.post(
            "/api/v1/jobs/generation-tasks",
            json={"resume_id": "resume-1", "job_ids": [job["job_id"]]},
        )
        assert blocked.status_code == 409

        previous = await isolated_db.create_generation_task("resume-1", [job["job_id"]])
        await isolated_db.update_generation_task(
            previous["task_id"], status="completed_with_errors", failed_jobs={job["job_id"]: "temporary failure"}
        )
        ran: list[str] = []

        async def fake_worker(task_id: str):
            ran.append(task_id)

        monkeypatch.setattr(jobs_router, "run_generation_task", fake_worker)
        retried = await client.post(f"/api/v1/jobs/generation-tasks/{previous['task_id']}/retry", json={})
        assert retried.status_code == 201
        retry_id = retried.json()["task_id"]
        cancelled = await client.post(f"/api/v1/jobs/generation-tasks/{retry_id}/cancel")
        assert cancelled.status_code == 200
        assert cancelled.json()["status"] == "cancelled"
    assert ran == [retry_id]
