"""Create a clearly labelled, fictional resume for local template QA only.

This never replaces a master resume. It gives the PDF templates realistic
Chinese content for manual visual verification without mixing invented facts
into a user's real resume.
"""

from __future__ import annotations

import asyncio
import json

from app.database import db
from app.services.render_profiles import DEFAULT_RENDER_PROFILE


DEMO_RESUME = {
    "personalInfo": {
        "name": "模板测试候选人",
        "title": "AI 产品经理（测试样例）",
        "email": "demo.resume@example.com",
        "phone": "13800000000",
        "location": "上海",
        "website": "https://example.com/portfolio",
        "linkedin": "",
        "github": "github.com/example/demo-resume",
    },
    "summary": "AI 产品经理测试样例：具备模型评测、知识库检索和企业级工作流产品经验，以下经历均为模板验收用途的虚构内容。",
    "workExperience": [
        {
            "id": 1,
            "title": "AI 产品经理",
            "company": "示例智能科技（测试）",
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
            "company": "云端协作平台（测试）",
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
            "institution": "示例大学",
            "degree": "信息管理与信息系统（本科）",
            "years": "2017.09 - 2021.06",
            "description": "课程：数据分析、软件工程、用户研究、产品设计。",
        }
    ],
    "personalProjects": [
        {
            "id": 1,
            "name": "多模型评测工作台（测试项目）",
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
    content = json.dumps(DEMO_RESUME, ensure_ascii=False, sort_keys=True)
    resume = await db.create_resume(
        content=content,
        content_type="json",
        filename="template-demo-resume.json",
        is_master=False,
        processed_data=DEMO_RESUME,
        processing_status="ready",
        title="【模板测试用】AI 产品经理详细示例简历",
        render_profile=DEFAULT_RENDER_PROFILE,
    )
    print(resume["resume_id"])


if __name__ == "__main__":
    asyncio.run(main())
