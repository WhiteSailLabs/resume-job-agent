"""Seed a fictional master resume and a copied JD for local end-to-end QA.

The current master is backed up as a non-master record first. Every created
title is explicitly labelled as test data; this script must never be used for
production applications.
"""

from __future__ import annotations

import asyncio
import json

from app.database import db
from app.services.render_profiles import DEFAULT_RENDER_PROFILE


MASTER_ID = "50b90e10-f58e-40d6-9b60-1fc9f9857039"
SOURCE_JOB_ID = "0b53b8e3-5106-4a3d-aad3-2a0edf942f27"
BACKUP_TITLE = "【测试前备份】Lifan Chen Master Resume"

TEST_MASTER = {
    "personalInfo": {
        "name": "模板测试候选人",
        "title": "AI 产品经理（虚构测试简历）",
        "email": "demo.resume@example.com",
        "phone": "13800000000",
        "location": "上海",
        "website": "https://example.com/portfolio",
        "linkedin": "",
        "github": "github.com/example/demo-resume",
    },
    "summary": "本简历为本地功能测试的虚构样例：具备模型评测、知识库检索和企业级工作流产品经验，不代表真实个人经历。",
    "workExperience": [
        {
            "id": 1,
            "title": "AI 产品经理",
            "company": "示例智能科技（虚构）",
            "location": "上海",
            "years": "2023.07 - 至今",
            "description": [
                "设计企业知识助手从需求调研到上线验收的产品流程，协调算法、工程与客户成功团队完成 12 个试点场景验证。",
                "搭建模型回答质量评测看板，定义准确性、引用完整性与人工复核指标，使问题定位周期由 3 天缩短至 1 天。",
                "推动权限、数据脱敏与审计日志方案落地，支持金融和制造行业客户的私有化部署评审。",
            ],
        },
        {
            "id": 2,
            "title": "产品经理",
            "company": "云端协作平台（虚构）",
            "location": "杭州",
            "years": "2021.07 - 2023.06",
            "description": [
                "负责智能工单模块的路线图与迭代规划，基于客服访谈梳理 40 余项高频问题并完成优先级排序。",
                "设计检索、推荐与人工转接协同流程，联合数据团队建立埋点口径，为后续体验优化提供可复核证据。",
            ],
        },
    ],
    "education": [
        {
            "id": 1,
            "institution": "示例大学（虚构）",
            "degree": "信息管理与信息系统（本科）",
            "years": "2017.09 - 2021.06",
            "description": "课程：数据分析、软件工程、用户研究、产品设计。",
        }
    ],
    "personalProjects": [
        {
            "id": 1,
            "name": "多模型评测工作台（虚构测试项目）",
            "role": "产品负责人",
            "years": "2024.03 - 2024.09",
            "github": "https://github.com/example/demo-evaluation-workbench",
            "website": "",
            "description": [
                "规划提示词版本、测试集、模型对比和人工标注模块，形成覆盖召回、准确性和安全性的评测闭环。",
                "编写产品需求文档与验收清单，支持业务团队在同一界面对比 6 类典型问答任务的输出。",
            ],
        }
    ],
    "additional": {
        "technicalSkills": ["AI 产品规划", "LLM 应用", "RAG", "模型评测", "用户研究", "SQL", "Figma"],
        "languages": ["中文（母语）", "英语（工作交流）"],
        "certificationsTraining": [],
        "awards": [],
    },
    "sectionMeta": [],
    "customSections": {},
}


async def main() -> None:
    original = await db.get_resume(MASTER_ID)
    source_job = await db.get_job(SOURCE_JOB_ID)
    if not original or not source_job:
        raise RuntimeError("Expected local master resume or source JD was not found")

    existing = await db.list_resumes()
    if not any(item.get("title") == BACKUP_TITLE for item in existing):
        await db.create_resume(
            content=original["content"],
            content_type=original["content_type"],
            filename=original.get("filename"),
            is_master=False,
            processed_data=original.get("processed_data"),
            processing_status=original.get("processing_status", "ready"),
            title=BACKUP_TITLE,
            original_markdown=original.get("original_markdown"),
            render_profile=original.get("render_profile"),
        )

    content = json.dumps(TEST_MASTER, ensure_ascii=False, sort_keys=True)
    await db.update_resume(
        MASTER_ID,
        {
            "content": content,
            "content_type": "json",
            "filename": "fictional-master-resume-for-local-test.json",
            "processed_data": TEST_MASTER,
            "processing_status": "ready",
            "title": "【测试主简历】AI 产品经理详细虚构样例",
            "render_profile": DEFAULT_RENDER_PROFILE,
        },
    )

    test_job = await db.create_job(source_job["content"], resume_id=MASTER_ID)
    test_job = await db.update_job(
        test_job["job_id"],
        {
            "title": "AI 产品经理（JD 定制测试）",
            "company": "整数智能（测试复跑）",
            "location": source_job.get("location") or "杭州",
            "discovery": True,
            "status": "approved",
            "has_full_jd": True,
            "jd_origin": "copied_for_local_qa",
            "original_url": source_job.get("original_url"),
        },
    )
    print(json.dumps({"master_id": MASTER_ID, "job_id": test_job["job_id"]}))


if __name__ == "__main__":
    asyncio.run(main())
