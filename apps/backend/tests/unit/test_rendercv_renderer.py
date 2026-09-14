from io import BytesIO

from pdfminer.high_level import extract_text

from app.services.rendercv_renderer import render_resume_with_rendercv, resume_data_to_rendercv


SAMPLE = {
    "personalInfo": {
        "name": "陈立凡",
        "title": "AI 产品经理",
        "email": "test@example.com",
        "phone": "13900000000",
        "location": "上海",
    },
    "summary": "以真实项目证据说明个人贡献。",
    "workExperience": [
        {
            "title": "产品经理",
            "company": "示例科技",
            "location": "上海",
            "years": "2023 - 至今",
            "description": ["设计模型评测流程并推动上线验证"],
        }
    ],
    "education": [],
    "personalProjects": [],
    "additional": {"technicalSkills": ["产品规划", "模型评测"]},
}


def test_resume_data_adapter_keeps_source_content_and_selects_theme() -> None:
    document = resume_data_to_rendercv(SAMPLE, "rendercv-asu")
    assert document["cv"]["name"] == "陈立凡"
    assert document["cv"]["sections"]["工作经历"][0]["highlights"] == [
        "设计模型评测流程并推动上线验证"
    ]
    assert document["design"]["theme"] == "engineeringresumes"
    assert document["design"]["page"]["size"] == "a4"


def test_rendercv_pdf_is_text_based_and_keeps_chinese() -> None:
    pdf = render_resume_with_rendercv(SAMPLE, "rendercv-engineering")
    assert pdf.startswith(b"%PDF")
    text = extract_text(BytesIO(pdf))
    assert "工作经历" in text
    assert "设计模型评测流程并推动上线验证" in text
