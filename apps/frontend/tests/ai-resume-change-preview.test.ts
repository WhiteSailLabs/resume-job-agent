import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { render, screen } from '@testing-library/react';
import { AiResumeChangePreview, getAiResumeChanges } from '@/components/resume/ai-resume-change-preview';
import type { ResumeData } from '@/components/dashboard/resume-component';

const base = {
  personalInfo: { name: '林凡', email: 'demo@example.com' },
  summary: '原简介',
  workExperience: [
    { id: 1, company: '示例公司', title: '产品经理', years: '2022-2025', description: ['原经历'] },
  ],
  education: [],
  personalProjects: [],
  additional: { technicalSkills: ['需求分析'], languages: [], certificationsTraining: [], awards: [] },
} as ResumeData;

describe('getAiResumeChanges', () => {
  it('returns only visibly changed resume fields', () => {
    const proposal = structuredClone(base);
    proposal.summary = '面向 AI 产品岗位的新简介';
    proposal.workExperience![0].description![0] = '围绕企业知识检索完成需求分析与交付';

    const changes = getAiResumeChanges(base, proposal);

    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ label: '个人简介', before: '原简介', after: '面向 AI 产品岗位的新简介' });
    expect(changes[1].label).toContain('示例公司');
  });

  it('shows skill reordering as a change', () => {
    const proposal = structuredClone(base);
    proposal.additional!.technicalSkills = ['AI 产品设计', '需求分析'];

    expect(getAiResumeChanges(base, proposal)).toEqual([
      expect.objectContaining({ label: '专业技能', before: '需求分析', after: 'AI 产品设计、需求分析' }),
    ]);
  });

  it('renders an explicit red-before and blue-after legend', () => {
    const proposal = structuredClone(base);
    proposal.summary = '新简介';

    render(createElement(AiResumeChangePreview, { original: base, proposal }));

    expect(screen.getByText('本次修改 · 1 处')).toBeInTheDocument();
    expect(screen.getByText('红色：原内容')).toBeInTheDocument();
    expect(screen.getByText('蓝色：新内容')).toBeInTheDocument();
    expect(screen.getByText('原简介')).toHaveClass('line-through');
    expect(screen.getByText('新简介')).toHaveClass('text-blue-950');
  });
});
