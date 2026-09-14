from types import SimpleNamespace

import pytest

from app.services import job_link_import


class _FakeClient:
    def __init__(self, response):
        self.response = response

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def get(self, _url):
        return self.response


async def test_import_job_link_extracts_structured_job(monkeypatch) -> None:
    page = """
      <html><head><title>Ignored title</title>
      <script type="application/ld+json">{
        "@context":"https://schema.org", "@type":"JobPosting",
        "title":"后端工程师", "description":"负责平台服务开发、API 设计与稳定性建设。需要熟悉 Python、数据库、分布式系统、消息队列、服务监控及团队协作，并持续改进开发流程与线上服务质量。参与架构评审、故障复盘和技术方案沉淀，保障高并发业务稳定运行。",
        "hiringOrganization":{"name":"示例科技"},
        "jobLocation":{"address":{"addressLocality":"上海"}}
      }</script></head></html>
    """
    response = SimpleNamespace(status_code=200, headers={"content-type": "text/html"}, content=page.encode(), text=page)

    async def public_host(_hostname):
        return None

    monkeypatch.setattr(job_link_import, "_verify_public_host", public_host)
    monkeypatch.setattr(job_link_import.httpx, "AsyncClient", lambda **_kwargs: _FakeClient(response))
    imported = await job_link_import.import_job_link("https://jobs.example.com/role/1#tracking")

    assert imported["title"] == "后端工程师"
    assert imported["company"] == "示例科技"
    assert imported["location"] == "上海"
    assert imported["has_full_jd"] is True
    assert imported["original_url"] == "https://jobs.example.com/role/1"


async def test_import_job_link_rejects_private_target() -> None:
    with pytest.raises(job_link_import.JobLinkImportError, match="内网"):
        await job_link_import.import_job_link("http://127.0.0.1:8000/private")
