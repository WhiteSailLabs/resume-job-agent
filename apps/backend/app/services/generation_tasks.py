"""Durable sequential execution for approved batch tailoring tasks."""

import asyncio
import logging
from datetime import datetime

from app.config import settings
from app.database import db
from app.schemas import ImproveResumeRequest
from app.services.tailoring_progress import reset_progress_reporter, set_progress_reporter

logger = logging.getLogger(__name__)


async def run_generation_task(task_id: str) -> None:
    """Run saved jobs one at a time, preserving partial progress on failure."""
    task = await db.get_generation_task(task_id)
    if not task or task["status"] not in {"queued", "running"}:
        return
    await db.update_generation_task(task_id, status="running")
    completed = list(task["completed_job_ids"])
    generated = dict(task.get("generated_resume_ids") or {})
    failed = dict(task["failed_jobs"])
    # Local import prevents a router import cycle during application startup.
    from app.routers.resumes import improve_resume_endpoint

    for job_id in task["job_ids"]:
        latest = await db.get_generation_task(task_id)
        if not latest or latest["status"] == "cancelled":
            return
        if job_id in completed:
            continue
        try:
            async def report(stage: str, detail: str) -> None:
                await db.update_generation_task(
                    task_id, current_stage=stage, current_job_id=job_id, stage_detail=detail
                )

            token = set_progress_reporter(report)
            # A provider can leave an HTTP request open while it is computing a
            # long structured answer.  Bound the *whole* job so the queue never
            # remains stuck in "running" indefinitely; the error is persisted
            # per job and can be retried from the UI.
            try:
                result = await asyncio.wait_for(
                    improve_resume_endpoint(
                        ImproveResumeRequest(
                            resume_id=task["resume_id"], job_id=job_id, batch_mode=True
                        )
                    ),
                    timeout=settings.request_timeout_seconds,
                )
            finally:
                reset_progress_reporter(token)
            generated_resume_id = result.data.resume_id
            if not generated_resume_id:
                raise RuntimeError("Tailoring completed without a persisted resume draft")
            completed.append(job_id)
            generated[job_id] = generated_resume_id
            job = await db.get_job(job_id)
            if job:
                date = datetime.fromisoformat(task["created_at"]).date().isoformat()
                company = job.get("company") or "未命名公司"
                title = job.get("title") or "未命名职位"
                try:
                    await db.update_resume(
                        generated_resume_id,
                        {
                            "title": f"{company}｜{title}｜{date}",
                        },
                    )
                except Exception:  # Naming is a convenience, not generation state.
                    logger.warning("Could not name tailored resume %s", generated_resume_id)
            await db.update_job(
                job_id,
                {"status": "generated", "tailored_resume_id": generated_resume_id},
            )
        except asyncio.TimeoutError:  # task-level isolation: remaining jobs still run
            logger.error("Batch generation timed out for task=%s job=%s", task_id, job_id)
            failed[job_id] = "生成超过 4 分钟未返回；请稍后重试。"
        except Exception as exc:  # task-level isolation: remaining jobs still run
            logger.exception("Batch generation failed for task=%s job=%s", task_id, job_id)
            failed[job_id] = (str(exc) or exc.__class__.__name__)[:500]
        await db.update_generation_task(
            task_id,
            completed_job_ids=completed,
            generated_resume_ids=generated,
            failed_jobs=failed,
        )

    await db.update_generation_task(
        task_id,
        status="completed" if not failed else "completed_with_errors",
        current_stage="completed",
        current_job_id=None,
        stage_detail="定制完成" if not failed else "部分岗位定制失败",
    )
