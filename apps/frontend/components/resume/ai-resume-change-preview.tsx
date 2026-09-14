'use client';

import type { ResumeData } from '@/components/dashboard/resume-component';

type PreviewChange = {
  label: string;
  before: string;
  after: string;
};

function addChange(
  changes: PreviewChange[],
  label: string,
  before: unknown,
  after: unknown
) {
  const oldText = Array.isArray(before) ? before.join('、') : String(before ?? '').trim();
  const newText = Array.isArray(after) ? after.join('、') : String(after ?? '').trim();
  if (oldText !== newText) changes.push({ label, before: oldText || '（空）', after: newText || '（空）' });
}

export function getAiResumeChanges(original: ResumeData, proposal: ResumeData): PreviewChange[] {
  const changes: PreviewChange[] = [];
  addChange(changes, '个人简介', original.summary, proposal.summary);

  proposal.workExperience?.forEach((entry, entryIndex) => {
    const previous = original.workExperience?.[entryIndex];
    entry.description?.forEach((bullet, bulletIndex) => {
      addChange(
        changes,
        `${entry.company || entry.title || `经历 ${entryIndex + 1}`} · 第 ${bulletIndex + 1} 条`,
        previous?.description?.[bulletIndex],
        bullet
      );
    });
  });

  proposal.personalProjects?.forEach((entry, entryIndex) => {
    const previous = original.personalProjects?.[entryIndex];
    entry.description?.forEach((bullet, bulletIndex) => {
      addChange(
        changes,
        `${entry.name || `项目 ${entryIndex + 1}`} · 第 ${bulletIndex + 1} 条`,
        previous?.description?.[bulletIndex],
        bullet
      );
    });
  });

  proposal.education?.forEach((entry, index) => {
    addChange(
      changes,
      `${entry.institution || `教育 ${index + 1}`} · 描述`,
      original.education?.[index]?.description,
      entry.description
    );
  });

  addChange(
    changes,
    '专业技能',
    original.additional?.technicalSkills,
    proposal.additional?.technicalSkills
  );
  addChange(changes, '语言', original.additional?.languages, proposal.additional?.languages);
  addChange(
    changes,
    '证书与培训',
    original.additional?.certificationsTraining,
    proposal.additional?.certificationsTraining
  );
  addChange(changes, '奖项', original.additional?.awards, proposal.additional?.awards);
  return changes;
}

export function AiResumeChangePreview({
  original,
  proposal,
}: {
  original: ResumeData;
  proposal: ResumeData;
}) {
  const changes = getAiResumeChanges(original, proposal);

  return (
    <section className="no-print border-b-2 border-blue-700 bg-blue-50 p-4" aria-label="AI 修改差异">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-mono text-sm font-bold text-blue-950">本次修改 · {changes.length} 处</h3>
        <div className="flex items-center gap-3 text-xs">
          <span className="border border-red-300 bg-red-50 px-2 py-1 text-red-800">红色：原内容</span>
          <span className="border border-blue-400 bg-white px-2 py-1 text-blue-800">蓝色：新内容</span>
        </div>
      </div>
      <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
        {changes.map((change, index) => (
          <article key={`${change.label}-${index}`} className="border border-blue-300 bg-white p-3">
            <p className="mb-2 font-mono text-[11px] font-bold text-ink">{change.label}</p>
            <p className="bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-800 line-through decoration-red-500">
              {change.before}
            </p>
            <p className="mt-1.5 border-l-4 border-blue-600 bg-blue-50 px-2 py-1.5 text-sm font-medium leading-6 text-blue-950">
              {change.after}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
