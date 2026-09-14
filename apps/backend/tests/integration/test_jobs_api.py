"""Integration tests for job description endpoints."""

from unittest.mock import AsyncMock, patch, MagicMock

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


class TestJobUpload:
    """POST /api/v1/jobs/upload"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_upload_single_job(self, mock_db, client):
        mock_db.create_job.return_value = {
            "job_id": "job-123",
            "content": "Senior Engineer at TechCorp",
            "created_at": "2026-01-01T00:00:00Z",
        }
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["Senior Engineer at TechCorp"],
                "resume_id": None,
            })
        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "data successfully processed"
        assert len(data["job_id"]) == 1

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_upload_multiple_jobs(self, mock_db, client):
        mock_db.create_job.side_effect = [
            {"job_id": f"job-{i}", "content": f"JD {i}", "created_at": "2026-01-01T00:00:00Z"}
            for i in range(3)
        ]
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["JD 1", "JD 2", "JD 3"],
            })
        assert resp.status_code == 200
        assert len(resp.json()["job_id"]) == 3

    async def test_upload_empty_list_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": [],
            })
        assert resp.status_code == 400

    async def test_upload_empty_string_returns_400(self, client):
        async with client:
            resp = await client.post("/api/v1/jobs/upload", json={
                "job_descriptions": ["  "],
            })
        assert resp.status_code == 400


class TestGetJob:
    """GET /api/v1/jobs/{job_id}"""

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_get_existing_job(self, mock_db, client):
        mock_db.get_job.return_value = {
            "job_id": "job-123",
            "content": "Engineer role",
            "created_at": "2026-01-01T00:00:00Z",
        }
        async with client:
            resp = await client.get("/api/v1/jobs/job-123")
        assert resp.status_code == 200
        assert resp.json()["job_id"] == "job-123"

    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_get_nonexistent_job_returns_404(self, mock_db, client):
        mock_db.get_job.return_value = None
        async with client:
            resp = await client.get("/api/v1/jobs/nonexistent")
        assert resp.status_code == 404


class TestDiscoverySources:
    """The UI receives product-proven capabilities, not optimistic adapters."""

    @patch("app.routers.jobs.get_boss_browser_status")
    async def test_unverified_sources_are_not_searchable(self, boss_status, client):
        boss_status.return_value = {"status": "connected"}
        async with client:
            resp = await client.get("/api/v1/jobs/discovery/sources")

        assert resp.status_code == 200
        sources = {item["id"]: item for item in resp.json()["data"]}
        assert sources["boss"]["status"] == "available"
        assert sources["boss"]["searchable"] is True
        assert sources["link_import"]["supports_original_link"] is True
        for source_id in ("liepin", "zhilian", "51job"):
            assert sources[source_id]["status"] == "unverified"
            assert sources[source_id]["searchable"] is False


class TestStyledGenerationTask:
    """Job generation must not override the master resume layout."""

    @patch("app.routers.jobs.run_generation_task", new_callable=AsyncMock)
    @patch("app.routers.jobs.db", new_callable=AsyncMock)
    async def test_client_style_is_not_forced_onto_job(
        self, mock_db, _run_task, client
    ):
        job = {
            "job_id": "job-123",
            "resume_id": "master-1",
            "discovery": True,
            "status": "approved",
            "has_full_jd": True,
        }
        mock_db.get_job.return_value = job
        mock_db.update_job.side_effect = lambda _job_id, updates: {**job, **updates}
        mock_db.create_generation_task.return_value = {
            "task_id": "task-1",
            "resume_id": "master-1",
            "job_ids": ["job-123"],
            "status": "queued",
            "completed_job_ids": [],
            "generated_resume_ids": {},
            "failed_jobs": {},
        }

        async with client:
            resp = await client.post(
                "/api/v1/jobs/generation-tasks",
                json={
                    "resume_id": "master-1",
                    "job_ids": ["job-123"],
                    "render_profile": {
                        "engine": "rendercv",
                        "template": "rendercv-modern",
                    },
                },
            )

        assert resp.status_code == 201
        assert all(
            "render_profile" not in call.args[1]
            for call in mock_db.update_job.await_args_list
        )
