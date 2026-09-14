"""Integration tests for resume CRUD endpoints."""

import json
from unittest.mock import patch, AsyncMock, MagicMock
from uuid import uuid4

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import app
from app.schemas import ImproveDiffResult, InterviewPrepData, ResumeChange


SAMPLE_INTERVIEW_PREP = {
    "role_fit_analysis": ["Backend API experience maps to the role."],
    "resume_questions": [
        {
            "question": "How did you design the FastAPI service on your resume?",
            "focus_area": "Backend architecture",
            "suggested_answer_points": ["Discuss the documented API work only."],
        }
    ],
    "project_follow_ups": [
        {
            "question": "What tradeoffs did you make in the resume matcher project?",
            "focus_area": "Project implementation",
            "suggested_answer_points": ["Explain real project choices from the resume."],
        }
    ],
    "skill_gaps": [
        {
            "skill": "Kubernetes",
            "why_it_matters": "The job description mentions production deployment.",
            "preparation_suggestion": "Review core concepts without claiming production use.",
        }
    ],
    "talking_points": ["Connect API work to the job's backend requirements."],
}


@pytest.fixture
def client():
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


@pytest.fixture
def mock_resume_record(sample_resume):
    """A resume DB record with all fields."""
    return {
        "resume_id": "res-123",
        "content": "# Jane Doe\nSenior Backend Engineer",
        "content_type": "md",
        "filename": "resume.pdf",
        "is_master": True,
        "parent_id": None,
        "processed_data": sample_resume,
        "processing_status": "ready",
        "cover_letter": None,
        "outreach_message": None,
        "interview_prep": None,
        "title": None,
        "original_markdown": "# Jane Doe\nSenior Backend Engineer",
        "created_at": "2026-01-01T00:00:00Z",
        "updated_at": "2026-01-01T00:00:00Z",
    }


class TestGetResume:
    """GET /api/v1/resumes?resume_id=..."""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_fetch_existing_resume(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = mock_resume_record
        async with client:
            resp = await client.get("/api/v1/resumes", params={"resume_id": "res-123"})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert data["resume_id"] == "res-123"
        assert data["processed_resume"] is not None
        assert data["processed_resume"]["summary"] != ""
        assert data["interview_prep"] is None

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_invalid_interview_prep_does_not_break_fetch(
        self, mock_db, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {
            **mock_resume_record,
            "interview_prep": "{not-json",
        }
        async with client:
            resp = await client.get("/api/v1/resumes", params={"resume_id": "res-123"})
        assert resp.status_code == 200
        assert resp.json()["data"]["interview_prep"] is None

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_fetch_nonexistent_returns_404(self, mock_db, client):
        mock_db.get_resume.return_value = None
        async with client:
            resp = await client.get("/api/v1/resumes", params={"resume_id": "nonexistent"})
        assert resp.status_code == 404


class TestListResumes:
    """GET /api/v1/resumes/list"""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_list_excludes_master_by_default(self, mock_db, client):
        mock_db.list_resumes.return_value = [
            {"resume_id": "master", "is_master": True, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
            {"resume_id": "tailored-1", "is_master": False, "created_at": "2026-01-02", "updated_at": "2026-01-02"},
        ]
        async with client:
            resp = await client.get("/api/v1/resumes/list")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) == 1
        assert data[0]["resume_id"] == "tailored-1"

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_list_includes_master_when_requested(self, mock_db, client):
        mock_db.list_resumes.return_value = [
            {"resume_id": "master", "is_master": True, "created_at": "2026-01-01", "updated_at": "2026-01-01"},
            {"resume_id": "tailored-1", "is_master": False, "created_at": "2026-01-02", "updated_at": "2026-01-02"},
        ]
        async with client:
            resp = await client.get("/api/v1/resumes/list", params={"include_master": True})
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert len(data) == 2


class TestDeleteResume:
    """DELETE /api/v1/resumes/{resume_id}"""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_delete_existing_resume(self, mock_db, client):
        mock_db.delete_resume.return_value = True
        async with client:
            resp = await client.delete("/api/v1/resumes/res-123")
        assert resp.status_code == 200

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_delete_nonexistent_returns_404(self, mock_db, client):
        mock_db.delete_resume.return_value = False
        async with client:
            resp = await client.delete("/api/v1/resumes/nonexistent")
        assert resp.status_code == 404


class TestUpdateTitle:
    """PATCH /api/v1/resumes/{resume_id}/title"""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_update_title(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = mock_resume_record
        mock_db.update_resume.return_value = {**mock_resume_record, "title": "New Title"}
        async with client:
            resp = await client.patch("/api/v1/resumes/res-123/title", json={"title": "New Title"})
        assert resp.status_code == 200

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_update_title_nonexistent_returns_404(self, mock_db, client):
        mock_db.get_resume.return_value = None
        async with client:
            resp = await client.patch("/api/v1/resumes/nonexistent/title", json={"title": "X"})
        assert resp.status_code == 404


class TestTailoredResumeWorkspace:
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_job_description_returns_workspace_metadata(
        self, mock_db, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {
            **mock_resume_record,
            "is_master": False,
            "parent_id": "master-1",
        }
        mock_db.get_improvement_by_tailored_resume.return_value = {"job_id": "job-1"}
        mock_db.get_job.return_value = {
            "job_id": "job-1",
            "content": "完整岗位描述",
            "title": "AI 产品经理",
            "company": "示例科技",
            "location": "上海",
            "source": "BOSS直聘",
            "original_url": "https://example.com/job/1",
        }

        async with client:
            resp = await client.get("/api/v1/resumes/res-123/job-description")

        assert resp.status_code == 200
        assert resp.json()["company"] == "示例科技"
        assert resp.json()["title"] == "AI 产品经理"

    @patch("app.routers.resumes.get_llm_config")
    @patch("app.routers.resumes.extract_job_keywords", new_callable=AsyncMock)
    @patch("app.routers.resumes.generate_resume_diffs", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_ai_adjustment_previews_without_saving(
        self,
        mock_db,
        mock_generate_diffs,
        mock_extract_keywords,
        mock_get_llm,
        client,
        mock_resume_record,
    ):
        tailored = {
            **mock_resume_record,
            "is_master": False,
            "parent_id": "master-1",
            "content": json.dumps(mock_resume_record["processed_data"]),
        }
        original_summary = tailored["processed_data"]["summary"]
        mock_db.get_resume.return_value = tailored
        mock_db.get_improvement_by_tailored_resume.return_value = {"job_id": "job-1"}
        mock_db.get_job.return_value = {
            "job_id": "job-1",
            "content": "需要模型评测平台经验，并能推动跨团队交付。",
        }
        mock_extract_keywords.return_value = {"keywords": ["模型评测"]}
        mock_generate_diffs.return_value = ImproveDiffResult(
            changes=[
                ResumeChange(
                    path="summary",
                    action="replace",
                    original=original_summary,
                    value=f"{original_summary} 聚焦模型评测平台交付。",
                    reason="突出岗位相关证据",
                )
            ],
            strategy_notes="突出模型评测",
        )
        mock_get_llm.return_value = MagicMock(provider="openai_compatible", model="mock")

        async with client:
            resp = await client.post(
                "/api/v1/resumes/res-123/ai-adjust/preview",
                json={"instruction": "突出模型评测经验"},
            )

        assert resp.status_code == 200
        payload = resp.json()
        assert payload["changed_paths"] == ["summary"]
        assert "模型评测平台交付" in payload["proposed_resume"]["summary"]
        mock_db.update_resume.assert_not_awaited()


class TestResumeRenderProfile:
    """Template changes are persisted independently from resume content."""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_fetch_old_resume_uses_professional_default(
        self, mock_db, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {**mock_resume_record, "render_profile": None}

        async with client:
            resp = await client.get("/api/v1/resumes", params={"resume_id": "res-123"})

        assert resp.status_code == 200
        assert resp.json()["data"]["render_profile"] == {
            "engine": "rendercv",
            "template": "rendercv-engineering",
        }

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_switch_profile_only_updates_render_profile(
        self, mock_db, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = mock_resume_record
        mock_db.update_resume.return_value = {
            **mock_resume_record,
            "render_profile": {"engine": "rendercv", "template": "rendercv-asu"},
        }

        async with client:
            resp = await client.patch(
                "/api/v1/resumes/res-123/render-profile",
                json={"engine": "rendercv", "template": "rendercv-asu"},
            )

        assert resp.status_code == 200
        assert resp.json()["render_profile"]["template"] == "rendercv-asu"
        mock_db.update_resume.assert_awaited_once_with(
            "res-123",
            {"render_profile": {"engine": "rendercv", "template": "rendercv-asu"}},
        )

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_tailored_style_creates_a_visual_version_with_same_job_lineage(
        self, mock_db, client, mock_resume_record
    ):
        source = {
            **mock_resume_record,
            "is_master": False,
            "parent_id": "master-1",
            "title": "腾讯｜AI 产品经理｜2026-09-07",
            "render_profile": {"engine": "rendercv", "template": "rendercv-engineering"},
        }
        mock_db.get_resume.return_value = source
        mock_db.get_improvement_by_tailored_resume.return_value = {
            "original_resume_id": "master-1",
            "job_id": "job-1",
            "improvements": [{"suggestion": "Preserve evidence"}],
        }
        mock_db.create_resume.return_value = {"resume_id": "visual-2"}

        async with client:
            resp = await client.post(
                "/api/v1/resumes/res-123/visual-versions",
                json={"engine": "rendercv", "template": "rendercv-modern"},
            )

        assert resp.status_code == 201
        assert resp.json()["resume_id"] == "visual-2"
        assert resp.json()["job_id"] == "job-1"
        assert mock_db.create_improvement.await_args.kwargs["job_id"] == "job-1"
        assert mock_db.create_improvement.await_args.kwargs["original_resume_id"] == "master-1"

    @patch("app.routers.resumes.render_resume_with_rendercv", return_value=b"%PDF-test")
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_pdf_uses_stored_profile_and_supports_inline_preview(
        self, mock_db, mock_render, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {
            **mock_resume_record,
            "render_profile": {"engine": "rendercv", "template": "rendercv-asu"},
        }

        async with client:
            resp = await client.get("/api/v1/resumes/res-123/pdf", params={"inline": True})

        assert resp.status_code == 200
        assert resp.content == b"%PDF-test"
        assert resp.headers["content-type"] == "application/pdf"
        assert resp.headers["content-disposition"].startswith("inline;")
        mock_render.assert_called_once_with(mock_resume_record["processed_data"], "rendercv-asu")

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_quality_compares_tailored_resume_to_original(
        self, mock_db, client, mock_resume_record
    ):
        tailored = {
            **mock_resume_record,
            "processed_data": {
                **mock_resume_record["processed_data"],
                "summary": "主导增长项目，提升 37%",
            },
        }
        mock_db.get_resume.side_effect = [tailored, mock_resume_record]
        mock_db.get_improvement_by_tailored_resume.return_value = {
            "original_resume_id": "master-1",
            "job_id": "job-1",
        }
        mock_db.get_job.return_value = {"job_keywords": {"keywords": ["Python"]}}

        async with client:
            resp = await client.get("/api/v1/resumes/res-123/quality")

        assert resp.status_code == 200
        report = resp.json()["data"]
        assert "37%" in report["checks"]["unsupported_metrics"]
        assert "主导" in report["checks"]["unsupported_strong_claims"]
        assert report["status"] == "review"


class TestUpdateCoverLetter:
    """PATCH /api/v1/resumes/{resume_id}/cover-letter"""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_update_cover_letter(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = mock_resume_record
        mock_db.update_resume.return_value = {**mock_resume_record, "cover_letter": "Dear hiring manager..."}
        async with client:
            resp = await client.patch("/api/v1/resumes/res-123/cover-letter", json={"content": "Dear hiring manager..."})
        assert resp.status_code == 200


class TestUpdateOutreachMessage:
    """PATCH /api/v1/resumes/{resume_id}/outreach-message"""

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_update_outreach(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = mock_resume_record
        mock_db.update_resume.return_value = {**mock_resume_record, "outreach_message": "Hi, I saw your posting..."}
        async with client:
            resp = await client.patch("/api/v1/resumes/res-123/outreach-message", json={"content": "Hi, I saw your posting..."})
        assert resp.status_code == 200


class TestGenerateInterviewPrep:
    """POST /api/v1/resumes/{resume_id}/generate-interview-prep"""

    @patch("app.routers.resumes.get_content_language", return_value="en")
    @patch("app.routers.resumes.generate_interview_prep", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_success_saves_structured_json(
        self, mock_db, mock_generate, _mock_language, client, mock_resume_record, sample_resume
    ):
        tailored = {
            **mock_resume_record,
            "parent_id": "master-1",
            "processed_data": sample_resume,
        }
        mock_db.get_resume.return_value = tailored
        mock_db.get_improvement_by_tailored_resume.return_value = {"job_id": "job-1"}
        mock_db.get_job.return_value = {"job_id": "job-1", "content": "Need FastAPI"}
        mock_generate.return_value = InterviewPrepData.model_validate(SAMPLE_INTERVIEW_PREP)

        async with client:
            resp = await client.post("/api/v1/resumes/res-123/generate-interview-prep")

        assert resp.status_code == 200
        data = resp.json()
        assert data["message"] == "Interview preparation generated successfully"
        assert data["interview_prep"]["role_fit_analysis"] == SAMPLE_INTERVIEW_PREP[
            "role_fit_analysis"
        ]
        mock_generate.assert_awaited_once_with(sample_resume, "Need FastAPI", "en")
        update_payload = mock_db.update_resume.await_args.args[1]
        saved_payload = json.loads(update_payload["interview_prep"])
        assert saved_payload == SAMPLE_INTERVIEW_PREP

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_rejects_non_tailored_resume(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = mock_resume_record

        async with client:
            resp = await client.post("/api/v1/resumes/res-123/generate-interview-prep")

        assert resp.status_code == 400
        assert "tailored resumes" in resp.json()["detail"]

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_rejects_missing_improvement_context(
        self, mock_db, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {**mock_resume_record, "parent_id": "master-1"}
        mock_db.get_improvement_by_tailored_resume.return_value = None

        async with client:
            resp = await client.post("/api/v1/resumes/res-123/generate-interview-prep")

        assert resp.status_code == 400
        assert "No job context" in resp.json()["detail"]

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_rejects_missing_processed_data(self, mock_db, client, mock_resume_record):
        mock_db.get_resume.return_value = {
            **mock_resume_record,
            "parent_id": "master-1",
            "processed_data": None,
        }
        mock_db.get_improvement_by_tailored_resume.return_value = {"job_id": "job-1"}
        mock_db.get_job.return_value = {"job_id": "job-1", "content": "Need FastAPI"}

        async with client:
            resp = await client.post("/api/v1/resumes/res-123/generate-interview-prep")

        assert resp.status_code == 400
        assert "processed data" in resp.json()["detail"]

    @patch("app.routers.resumes.generate_interview_prep", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_generation_failure_returns_500(
        self, mock_db, mock_generate, client, mock_resume_record, sample_resume
    ):
        mock_db.get_resume.return_value = {
            **mock_resume_record,
            "parent_id": "master-1",
            "processed_data": sample_resume,
        }
        mock_db.get_improvement_by_tailored_resume.return_value = {"job_id": "job-1"}
        mock_db.get_job.return_value = {"job_id": "job-1", "content": "Need FastAPI"}
        mock_generate.side_effect = RuntimeError("llm failed")

        async with client:
            resp = await client.post("/api/v1/resumes/res-123/generate-interview-prep")

        assert resp.status_code == 500
        assert "Failed to generate interview preparation" in resp.json()["detail"]


class TestRetryProcessing:
    """POST /api/v1/resumes/{resume_id}/retry-processing"""

    @patch("app.routers.resumes.parse_resume_to_json", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_retry_successful(self, mock_db, mock_parse, client, mock_resume_record, sample_resume):
        failed_record = {**mock_resume_record, "processing_status": "failed"}
        mock_db.get_resume.return_value = failed_record
        mock_parse.return_value = sample_resume
        mock_db.update_resume.return_value = {**failed_record, "processing_status": "ready", "processed_data": sample_resume}
        async with client:
            resp = await client.post("/api/v1/resumes/res-123/retry-processing")
        assert resp.status_code == 200
        data = resp.json()
        assert data["processing_status"] == "ready"

    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_retry_not_failed_returns_400(self, mock_db, client, mock_resume_record):
        # processing_status is "ready", not "failed"
        mock_db.get_resume.return_value = mock_resume_record
        async with client:
            resp = await client.post("/api/v1/resumes/res-123/retry-processing")
        assert resp.status_code == 400

    @patch("app.routers.resumes.parse_resume_to_json", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_retry_reports_missing_model_credentials_actionably(
        self, mock_db, mock_parse, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {**mock_resume_record, "processing_status": "failed"}
        mock_parse.side_effect = RuntimeError("OpenAIException - Missing credentials")

        async with client:
            response = await client.post("/api/v1/resumes/res-123/retry-processing")

        assert response.status_code == 200
        assert response.json()["processing_status"] == "failed"
        assert response.json()["processing_error"] == "llm_not_configured"

    @patch("app.routers.resumes.parse_resume_to_json", new_callable=AsyncMock)
    @patch("app.routers.resumes.db", new_callable=AsyncMock)
    async def test_retry_reports_model_activation_requirement_actionably(
        self, mock_db, mock_parse, client, mock_resume_record
    ):
        mock_db.get_resume.return_value = {**mock_resume_record, "processing_status": "failed"}
        mock_parse.side_effect = RuntimeError("Your account has not activated the model service")

        async with client:
            response = await client.post("/api/v1/resumes/res-123/retry-processing")

        assert response.status_code == 200
        assert response.json()["processing_error"] == "model_not_enabled"


class TestUploadResume:
    """POST /api/v1/resumes/upload"""

    @patch("app.routers.resumes.parse_resume_to_json", new_callable=AsyncMock)
    @patch("app.routers.resumes.parse_document", new_callable=AsyncMock)
    @patch("app.routers.resumes.db")
    async def test_upload_empty_extracted_text_returns_422(
        self, mock_db, mock_parse_document, mock_parse_resume_to_json, client
    ):
        mock_parse_document.return_value = "   "

        async with client:
            resp = await client.post(
                "/api/v1/resumes/upload",
                files={"file": ("resume.pdf", b"fake pdf bytes", "application/pdf")},
            )

        assert resp.status_code == 422
        assert "Could not extract text from the uploaded file" in resp.json()["detail"]
        mock_db.create_resume_atomic_master.assert_not_called()
        mock_parse_resume_to_json.assert_not_called()
