from app.services.resume_quality import analyze_resume_quality


def test_quality_flags_new_metrics_and_unproven_ownership() -> None:
    original = {
        "summary": "参与产品规划",
        "workExperience": [{"description": ["整理用户反馈并支持交付"]}],
    }
    candidate = {
        "summary": "AI 产品负责人",
        "workExperience": [
            {"description": ["主导产品上线并使用户增长 40%", "具备较强沟通能力"]}
        ],
    }
    report = analyze_resume_quality(candidate, original=original)
    assert report["status"] == "review"
    assert "40%" in report["checks"]["unsupported_metrics"]
    assert "主导" in report["checks"]["unsupported_strong_claims"]
    assert report["checks"]["vague_bullets"]


def test_quality_accepts_supported_action_and_evidence() -> None:
    data = {
        "summary": "AI 产品经理，负责模型评测产品交付",
        "workExperience": [
            {"description": ["设计评测流程并交付上线，覆盖 12 个业务场景"]}
        ],
    }
    report = analyze_resume_quality(data, original=data)
    assert not report["checks"]["unsupported_metrics"]
    assert not report["checks"]["unsupported_strong_claims"]


def test_quality_blocks_resume_without_source_experience() -> None:
    data = {
        "summary": "Motivated candidate with strong ability and passion for AI.",
        "workExperience": [],
        "personalProjects": [],
        "education": [],
        "additional": {"technicalSkills": []},
    }

    report = analyze_resume_quality(data, original=data)

    assert report["status"] == "review"
    assert report["score"] < 60
    assert report["checks"]["substantive_entry_count"] == 0
    assert report["recommendations"][0].startswith("原简历缺少")
