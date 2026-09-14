"""Job description management endpoints."""

import asyncio
import json
import re
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from app.database import db
from app.schemas import BrowserAuthorizationCompleteRequest, BrowserJobCaptureRequest, BrowserJobListCaptureRequest, DiscoveryDetailCompletionRequest, DiscoveryJobCreate, DiscoveryJobStatusUpdate, DiscoveryLinkImportRequest, DiscoverySearchRequest, GenerationTaskCreate, GenerationTaskRetryRequest, JobUploadRequest, JobUploadResponse
from app.services.browser_authorization import browser_authorizations
from app.services.boss_browser import (
    BossBrowserError,
    get_status as get_boss_browser_status,
    read_detail as read_boss_detail,
    start as start_boss_browser,
)
from app.services.generation_tasks import run_generation_task
from app.services.job_discovery import build_boss_search_plan, parse_query, search as discover_jobs
from app.services.job_link_import import JobLinkImportError, import_job_link

router = APIRouter(prefix="/jobs", tags=["Jobs"])

_boss_search_lock = asyncio.Lock()
_last_boss_search_by_resume: dict[str, float] = {}
_BOSS_MIN_INTERVAL_SECONDS = 30
_SOURCE_HOSTS = {
    "boss": ("zhipin.com",),
    "liepin": ("liepin.com",),
    "zhilian": ("zhaopin.com",),
    "51job": ("51job.com",),
}


async def _persist_discovered_job(item: dict, resume_id: str | None) -> dict | None:
    """Persist one source result through Resume Matcher's existing job model."""
    original_url = item.get("original_url")
    existing = (
        await db.find_discovery_job_by_url(original_url, resume_id)
        if original_url
        else await db.find_discovery_job_by_identity(
            resume_id=resume_id,
            title=item["title"],
            company=item["company"],
            location=item["location"],
        )
    )
    if existing:
        if existing.get("jd_origin") != "link_import":
            refreshed = await db.update_job(
                existing["job_id"],
                {"content": item["jd"], **item, "jd_origin": "source_search"},
            )
            return refreshed or existing
        return existing
    job = await db.create_job(content=item["jd"], resume_id=resume_id)
    return await db.update_job(
        job["job_id"],
        {"discovery": True, **item, "jd_origin": "source_search", "status": "pending"},
    )


async def _validate_boss_search(request: DiscoverySearchRequest) -> None:
    """Apply the same connection and low-frequency guard to batch and streams."""
    if not request.allow_boss_browser:
        return
    boss_status = await asyncio.to_thread(get_boss_browser_status)
    if boss_status.get("status") != "connected":
        raise HTTPException(
            status_code=409,
            detail={
                "message": "请先连接可见的 BOSS Chrome 页面",
                "source": "boss",
                "browser_status": boss_status,
            },
        )
    scope = request.resume_id or "anonymous"
    async with _boss_search_lock:
        now = time.monotonic()
        last = _last_boss_search_by_resume.get(scope, 0)
        remaining = _BOSS_MIN_INTERVAL_SECONDS - (now - last)
        if remaining > 0:
            raise HTTPException(
                status_code=429,
                detail={"message": "BOSS 查询请低频进行", "retry_after_seconds": int(remaining) + 1},
            )
        _last_boss_search_by_resume[scope] = now


@router.post("/upload", response_model=JobUploadResponse)
async def upload_job_descriptions(request: JobUploadRequest) -> JobUploadResponse:
    """Upload one or more job descriptions.

    Stores the raw text for later use in resume tailoring.
    Returns an array of job_ids corresponding to the input array.
    """
    if not request.job_descriptions:
        raise HTTPException(status_code=400, detail="No job descriptions provided")

    job_ids = []
    for jd in request.job_descriptions:
        if not jd.strip():
            raise HTTPException(status_code=400, detail="Empty job description")

        job = await db.create_job(
            content=jd.strip(),
            resume_id=request.resume_id,
        )
        job_ids.append(job["job_id"])

    return JobUploadResponse(
        message="data successfully processed",
        job_id=job_ids,
        request={
            "job_descriptions": request.job_descriptions,
            "resume_id": request.resume_id,
        },
    )


@router.post("/discovery", status_code=201)
async def save_discovery_job(request: DiscoveryJobCreate) -> dict:
    """Persist a normalized job discovered by a source adapter or link import."""
    job = await db.create_job(content=request.jd.strip(), resume_id=request.resume_id)
    return await db.update_job(job["job_id"], {"discovery": True, "title": request.title, "company": request.company, "location": request.location, "source": request.source, "original_url": request.original_url, "has_full_jd": request.has_full_jd, "jd_origin": "manual", "status": "pending"}) or job


@router.post("/discovery/search")
async def search_discovery_jobs(request: DiscoverySearchRequest) -> dict:
    """Search approved low-frequency sources and persist normalized results."""
    await _validate_boss_search(request)
    jobs, sources = await discover_jobs(request.query, request.limit, request.allow_boss_browser)
    if not jobs and request.allow_boss_browser:
        parsed = parse_query(request.query)
        role = re.sub(r"\s+", "", str(parsed.get("target_role") or "")).lower()
        locations = tuple(str(item) for item in parsed.get("locations") or ())
        previous = await db.list_discovery_jobs(request.resume_id)
        jobs = [
            {
                "title": item.get("title") or "未命名岗位",
                "company": item.get("company") or "未注明公司",
                "location": item.get("location") or "未注明",
                "source": item.get("source") or "BOSS直聘",
                "original_url": item.get("original_url"),
                "jd": item.get("content") or "职位列表摘要",
                "has_full_jd": bool(item.get("has_full_jd")),
            }
            for item in previous
            if item.get("original_url")
            and "zhipin.com" in str(item.get("original_url"))
            and (not role or role in re.sub(r"\s+", "", str(item.get("title") or "")).lower())
            and (not locations or any(city in str(item.get("location") or "") for city in locations))
        ][: request.limit]
        if jobs:
            sources.append(
                {
                    "source": "BOSS历史结果",
                    "status": "cached",
                    "count": len(jobs),
                    "error": "实时查询暂不可用，展示此前真实保存且保留原链接的岗位。",
                }
            )
    saved = []
    for item in jobs:
        saved.append(await _persist_discovered_job(item, request.resume_id))
    return {"data": [item for item in saved if item], "source_status": sources}


@router.post("/discovery/search-stream")
async def stream_discovery_jobs(request: DiscoverySearchRequest) -> StreamingResponse:
    """Stream every persisted job so the review table fills during a search."""
    await _validate_boss_search(request)

    async def events():
        def line(event: dict) -> bytes:
            return (json.dumps(event, ensure_ascii=False) + "\n").encode("utf-8")

        yield line({"type": "phase", "phase": "searching", "message": "正在读取招聘网站中的岗位…"})
        try:
            jobs, sources = await discover_jobs(
                request.query, request.limit, request.allow_boss_browser
            )
            yield line({"type": "phase", "phase": "collecting", "total": len(jobs), "message": "正在把岗位加入列表…"})
            count = 0
            for item in jobs:
                saved = await _persist_discovered_job(item, request.resume_id)
                if saved:
                    count += 1
                    yield line({"type": "job", "index": count, "data": saved})
                    await asyncio.sleep(0)
            yield line({"type": "complete", "count": count, "source_status": sources})
        except Exception as exc:
            yield line({"type": "error", "message": str(exc)[:500]})

    return StreamingResponse(
        events(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.get("/browser-session/status")
async def browser_session_status() -> dict:
    """Detect the live dedicated Chrome/BOSS state without manual feedback."""
    return {"data": await asyncio.to_thread(get_boss_browser_status)}


@router.get("/discovery/sources")
async def discovery_sources() -> dict:
    """Return product capabilities, not optimistic connector declarations.

    A source is marked available only when this product exposes its complete
    user path through search/import, saved JD, original URL and tailoring.
    Experimental Jobfindsme connectors remain explicit and cannot be mistaken
    for working product features.
    """
    boss_status = await asyncio.to_thread(get_boss_browser_status)
    boss_connected = boss_status.get("status") == "connected"
    return {
        "data": [
            {
                "id": "boss",
                "label": "BOSS直聘",
                "status": "available" if boss_connected else "needs_login",
                "searchable": boss_connected,
                "supports_detail": True,
                "supports_original_link": True,
            },
            {
                "id": "link_import",
                "label": "岗位链接导入",
                "status": "available",
                "searchable": False,
                "supports_detail": True,
                "supports_original_link": True,
            },
            *[
                {
                    "id": source_id,
                    "label": label,
                    "status": "unverified",
                    "searchable": False,
                    "supports_detail": False,
                    "supports_original_link": False,
                }
                for source_id, label in (
                    ("liepin", "猎聘"),
                    ("zhilian", "智联招聘"),
                    ("51job", "前程无忧"),
                )
            ],
        ]
    }


@router.post("/browser-session/start")
async def start_browser_session() -> dict:
    """Open jobfindsme's visible isolated Chrome profile for one-time login."""
    try:
        state = await asyncio.to_thread(start_boss_browser)
    except BossBrowserError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return {"data": state}


@router.get("/browser-authorizations")
async def list_browser_authorizations() -> dict:
    """Return only source-level authorization state for the discovery Agent."""
    return {"data": browser_authorizations.list()}


@router.post("/browser-authorizations/complete")
async def complete_browser_authorization(request: BrowserAuthorizationCompleteRequest) -> dict:
    """Accept a visible-login result from Chrome without receiving cookies."""
    hostname = (urlsplit(request.page_url).hostname or "").lower()
    if not any(hostname == host or hostname.endswith(f".{host}") for host in _SOURCE_HOSTS[request.source]):
        raise HTTPException(status_code=422, detail="当前页面与选择的招聘网站不匹配")
    if not request.logged_in:
        return {"data": browser_authorizations.mark_not_connected(request.source)}
    return {"data": browser_authorizations.mark_authorized(request.source)}


@router.post("/discovery/browser-capture", status_code=201)
async def capture_browser_job(request: BrowserJobCaptureRequest) -> dict:
    """Save one visible BOSS detail page after a user explicitly imports it.

    This endpoint never receives browser cookies, account data, or a page dump.
    The browser bridge sends only the job fields visible on the current detail
    page, and only after it has confirmed the user's visible signed-in state.
    """
    hostname = (urlsplit(request.page_url).hostname or "").lower()
    if not any(hostname == host or hostname.endswith(f".{host}") for host in _SOURCE_HOSTS[request.source]):
        raise HTTPException(status_code=422, detail="当前页面不是 BOSS 职位详情页")
    if not browser_authorizations.is_authorized(request.source):
        raise HTTPException(status_code=409, detail="请先在 Chrome 中登录并连接 BOSS直聘")
    resume_id = request.resume_id
    if resume_id is None:
        master_resume = await db.get_master_resume()
        resume_id = master_resume.get("resume_id") if master_resume else None
    existing = await db.find_discovery_job_by_url(request.page_url, resume_id)
    if existing:
        return {"data": existing, "duplicate": True}
    job = await db.create_job(content=request.jd.strip(), resume_id=resume_id)
    saved = await db.update_job(
        job["job_id"],
        {
            "discovery": True,
            "title": request.title.strip(),
            "company": request.company.strip(),
            "location": request.location.strip(),
            "source": "BOSS直聘",
            "original_url": request.page_url,
            "has_full_jd": True,
            "jd_origin": "browser_capture",
            "status": "pending",
        },
    )
    return {"data": saved, "duplicate": False}


@router.post("/discovery/browser-list-capture", status_code=201)
async def capture_browser_job_card(request: BrowserJobListCaptureRequest) -> dict:
    """Persist one card that is visibly rendered in the user's BOSS search tab."""
    page_host = (urlsplit(request.page_url).hostname or "").lower()
    job_host = (urlsplit(request.original_url).hostname or "").lower()
    if not page_host.endswith("zhipin.com") or not job_host.endswith("zhipin.com"):
        raise HTTPException(status_code=422, detail="岗位卡片不是来自 BOSS 页面")
    if "/job_detail/" not in urlsplit(request.original_url).path:
        raise HTTPException(status_code=422, detail="岗位卡片缺少有效的职位详情链接")
    if not browser_authorizations.is_authorized("boss"):
        raise HTTPException(status_code=409, detail="请先连接已登录的 BOSS Chrome 页面")
    saved = await _persist_discovered_job(
        {
            "title": request.title.strip(),
            "company": request.company.strip(),
            "location": request.location.strip(),
            "source": "BOSS直聘",
            "original_url": request.original_url,
            "jd": request.summary.strip(),
            "has_full_jd": False,
        },
        request.resume_id,
    )
    return {"data": saved}


@router.post("/discovery/browser-search-plan")
async def browser_search_plan(request: DiscoverySearchRequest) -> dict:
    """Return visible navigation targets; the extension performs no hidden API call."""
    return {"data": build_boss_search_plan(request.query)}


@router.post("/discovery/import-link", status_code=201)
async def import_discovery_link(request: DiscoveryLinkImportRequest) -> dict:
    """Import one user-pasted public job-detail page into the review queue."""
    try:
        item = await import_job_link(request.url)
    except JobLinkImportError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    existing = await db.find_discovery_job_by_url(item["original_url"], request.resume_id)
    if existing:
        return {"data": existing, "duplicate": True}
    job = await db.create_job(content=str(item["jd"]), resume_id=request.resume_id)
    saved = await db.update_job(job["job_id"], {"discovery": True, **item, "jd_origin": "link_import", "status": "pending"})
    return {"data": saved, "duplicate": False}


@router.post("/discovery/complete-details")
async def complete_discovery_details(request: DiscoveryDetailCompletionRequest) -> dict:
    """Try to turn selected list cards into complete, tailorable JD records.

    Search providers often return only a card summary. Before blocking a batch
    tailor request, fetch the already-saved public detail URL once. Sources
    that require a logged-in browser (for example BOSS) remain explicitly
    blocked rather than silently generating from an incomplete summary.
    """
    jobs = [await db.get_job(job_id) for job_id in request.job_ids]
    if any(not job or not job.get("discovery") for job in jobs):
        raise HTTPException(status_code=404, detail="One or more discovered jobs do not exist")
    if any(job.get("resume_id") not in {None, request.resume_id} for job in jobs):
        raise HTTPException(status_code=409, detail="Selected jobs do not belong to this master resume")

    completed: list[dict] = []
    completed_ids: list[str] = []
    failed: dict[str, str] = {}
    for job in jobs:
        assert job is not None
        # Discovery deliberately works before the user chooses a base resume.
        # Bind only the selected records at the tailoring checkpoint so an
        # anonymous search can later become part of one resume workspace.
        if job.get("resume_id") is None:
            bound = await db.update_job(job["job_id"], {"resume_id": request.resume_id})
            job = bound or job
        if job.get("has_full_jd"):
            completed.append(job)
            completed_ids.append(job["job_id"])
            continue
        original_url = job.get("original_url")
        if not original_url:
            failed[job["job_id"]] = "该岗位没有可读取的职位详情链接"
            continue
        hostname = (urlsplit(str(original_url)).hostname or "").lower()
        if hostname == "zhipin.com" or hostname.endswith(".zhipin.com"):
            try:
                detail = await asyncio.to_thread(
                    read_boss_detail,
                    str(original_url),
                    expected_title=str(job.get("title") or ""),
                )
            except BossBrowserError as exc:
                failed[job["job_id"]] = str(exc)
                continue
            updated = await db.update_job(
                job["job_id"],
                {
                    "content": detail["jd"],
                    "has_full_jd": True,
                    "jd_origin": "boss_browser_detail",
                },
            )
            completed.append(updated or job)
            completed_ids.append(job["job_id"])
            continue
        try:
            detail = await import_job_link(str(original_url))
        except JobLinkImportError as exc:
            failed[job["job_id"]] = str(exc)
            continue
        updated = await db.update_job(
            job["job_id"],
            {
                "content": detail["jd"],
                "title": detail.get("title") or job.get("title"),
                "company": detail.get("company") or job.get("company"),
                "location": detail.get("location") or job.get("location"),
                "original_url": detail["original_url"],
                "has_full_jd": True,
                "jd_origin": "detail_fetch",
            },
        )
        completed.append(updated or job)
        completed_ids.append(job["job_id"])

    return {
        "data": completed,
        "completed_job_ids": completed_ids,
        "failed_jobs": failed,
    }


@router.get("/discovery/list")
async def list_discovery_jobs(resume_id: str | None = None) -> dict:
    return {"data": await db.list_discovery_jobs(resume_id)}


@router.patch("/discovery/{job_id}/status")
async def update_discovery_status(job_id: str, request: DiscoveryJobStatusUpdate) -> dict:
    job = await db.get_job(job_id)
    if not job or not job.get("discovery"):
        raise HTTPException(status_code=404, detail="Discovered job not found")
    return await db.update_job(job_id, {"status": request.status.value}) or job


@router.post("/generation-tasks", status_code=201)
async def create_generation_task(request: GenerationTaskCreate, background_tasks: BackgroundTasks) -> dict:
    jobs = [await db.get_job(job_id) for job_id in request.job_ids]
    if any(not job or not job.get("discovery") for job in jobs):
        raise HTTPException(status_code=404, detail="One or more discovered jobs do not exist")
    if any(job and job.get("resume_id") not in {None, request.resume_id} for job in jobs):
        raise HTTPException(status_code=409, detail="Selected jobs belong to a different master resume")
    jobs = [
        await db.update_job(job["job_id"], {"resume_id": request.resume_id}) if job and job.get("resume_id") is None else job
        for job in jobs
    ]
    not_approved = [job["job_id"] for job in jobs if job.get("status") != "approved"]
    if not_approved:
        raise HTTPException(status_code=409, detail={"message": "Only approved jobs can be tailored", "job_ids": not_approved})
    incomplete = [job["job_id"] for job in jobs if not job.get("has_full_jd")]
    if incomplete:
        raise HTTPException(status_code=409, detail={"message": "Full job details required", "job_ids": incomplete})
    task = await db.create_generation_task(request.resume_id, request.job_ids)
    background_tasks.add_task(run_generation_task, task["task_id"])
    return task


@router.get("/generation-tasks")
async def list_generation_tasks(resume_id: str) -> dict:
    return {"data": await db.list_generation_tasks(resume_id)}


@router.get("/generation-tasks/{task_id}")
async def get_generation_task(task_id: str) -> dict:
    task = await db.get_generation_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Generation task not found")
    return task


@router.post("/generation-tasks/{task_id}/retry", status_code=201)
async def retry_generation_task(
    task_id: str,
    request: GenerationTaskRetryRequest,
    background_tasks: BackgroundTasks,
) -> dict:
    """Create a new durable task for selected failures without rerunning successes."""
    previous = await db.get_generation_task(task_id)
    if not previous:
        raise HTTPException(status_code=404, detail="Generation task not found")
    failed_ids = set(previous["failed_jobs"])
    requested = set(request.job_ids or failed_ids)
    if not requested or not requested.issubset(failed_ids):
        raise HTTPException(status_code=400, detail="Only failed jobs from this task can be retried")
    task = await db.create_generation_task(previous["resume_id"], sorted(requested))
    background_tasks.add_task(run_generation_task, task["task_id"])
    return task


@router.post("/generation-tasks/{task_id}/cancel")
async def cancel_generation_task(task_id: str) -> dict:
    task = await db.get_generation_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Generation task not found")
    if task["status"] in {"completed", "completed_with_errors"}:
        raise HTTPException(status_code=409, detail="Completed tasks cannot be cancelled")
    return await db.update_generation_task(task_id, status="cancelled") or task


@router.get("/{job_id}")
async def get_job(job_id: str) -> dict:
    """Get one job after all fixed job routes have been considered."""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job
