'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Target from 'lucide-react/dist/esm/icons/target';
import {
  fetchJobDescription,
  fetchResume,
  getResumePdfPreviewUrl,
} from '@/lib/api/resume';

type ResumeRecord = Awaited<ReturnType<typeof fetchResume>>;

function counts(record: ResumeRecord | null) {
  const data = record?.processed_resume;
  return {
    experience: data?.workExperience?.length ?? 0,
    projects: data?.personalProjects?.length ?? 0,
    education: data?.education?.length ?? 0,
    skills: data?.additional?.technicalSkills?.length ?? 0,
  };
}

function CountCell({ label, before, after }: { label: string; before: number; after: number }) {
  return (
    <div className="border border-black bg-white p-3">
      <p className="font-mono text-[11px] font-bold uppercase text-steel-grey">{label}</p>
      <p className="mt-1 font-serif text-2xl font-bold">
        {before} <span className="font-mono text-base text-steel-grey">→</span> {after}
      </p>
    </div>
  );
}

function ResumeCompareContent() {
  const searchParams = useSearchParams();
  const baseId = searchParams.get('base');
  const tailoredId = searchParams.get('tailored');
  const [base, setBase] = useState<ResumeRecord | null>(null);
  const [tailored, setTailored] = useState<ResumeRecord | null>(null);
  const [jobDescription, setJobDescription] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!baseId || !tailoredId) {
      setError('请选择一份原始简历和一份 JD 定制简历进行对比。');
      setLoading(false);
      return;
    }

    Promise.all([
      fetchResume(baseId),
      fetchResume(tailoredId),
      fetchJobDescription(tailoredId).catch(() => null),
    ])
      .then(([baseResume, tailoredResume, job]) => {
        setBase(baseResume);
        setTailored(tailoredResume);
        setJobDescription(job?.content ?? '该版本未保存可供对照的职位描述。');
      })
      .catch(() => setError('无法加载新旧简历对比，请稍后重试。'))
      .finally(() => setLoading(false));
  }, [baseId, tailoredId]);

  const baseCounts = useMemo(() => counts(base), [base]);
  const tailoredCounts = useMemo(() => counts(tailored), [tailored]);
  const sourceIncomplete =
    baseCounts.experience + baseCounts.projects + baseCounts.education === 0;

  if (loading) {
    return <main className="p-8 font-mono text-sm">正在加载新旧简历对比…</main>;
  }

  if (error || !baseId || !tailoredId || !base || !tailored) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className="border-2 border-black bg-red-50 p-6 shadow-sw-default">
          <p className="font-bold">{error ?? '无法加载对比内容。'}</p>
          <Link href="/resumes" className="mt-4 inline-flex font-mono text-sm underline">
            返回简历库
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 md:px-8">
      <div className="mx-auto max-w-[104rem]">
        <Link href={`/resumes/${tailoredId}`} className="mb-4 inline-flex items-center gap-1 font-mono text-xs uppercase text-steel-grey hover:text-blue-700">
          <ArrowLeft className="h-3.5 w-3.5" /> 返回定制简历
        </Link>

        <header className="border-2 border-black bg-white p-6 shadow-sw-lg md:p-8">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.16em] text-blue-700">
            // Evidence-first comparison
          </p>
          <h1 className="mt-3 font-serif text-4xl font-bold md:text-6xl">新旧简历对比</h1>
          <p className="mt-3 max-w-3xl text-steel-grey">
            模板只改变呈现；这里核对 JD 定制是否仍然建立在原始简历的真实信息之上。
          </p>
        </header>

        <section className={`mt-5 border-2 p-5 shadow-sw-default ${sourceIncomplete ? 'border-orange-700 bg-orange-50' : 'border-green-700 bg-green-50'}`}>
          <div className="flex items-start gap-3">
            {sourceIncomplete ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-orange-700" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-700" />}
            <div>
              <h2 className="font-mono text-sm font-bold">
                {sourceIncomplete ? '不能确认这份定制简历可投递' : '原始简历具备可核对的经历基础'}
              </h2>
              <p className="mt-1 text-sm leading-6">
                {sourceIncomplete
                  ? '原始简历没有工作、项目或教育条目。任何新增的具体经历都无法核验，因此当前新简历仅适合作为界面与流程测试，不应直接投递。'
                  : '请继续逐条核对重点经历、数字与责任边界；系统不会把团队成果或未提供的经历自动写成个人事实。'}
              </p>
            </div>
          </div>
        </section>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountCell label="工作经历" before={baseCounts.experience} after={tailoredCounts.experience} />
          <CountCell label="项目" before={baseCounts.projects} after={tailoredCounts.projects} />
          <CountCell label="教育" before={baseCounts.education} after={tailoredCounts.education} />
          <CountCell label="技能" before={baseCounts.skills} after={tailoredCounts.skills} />
        </section>

        <section className="mt-5 grid gap-5 xl:grid-cols-2">
          <article className="border-2 border-black bg-white shadow-sw-default">
            <header className="border-b-2 border-black p-4">
              <p className="font-mono text-xs font-bold uppercase text-steel-grey">原始简历</p>
              <h2 className="mt-1 font-serif text-2xl font-bold">{base.title ?? '未命名原始简历'}</h2>
            </header>
            <iframe title="原始简历 PDF" src={getResumePdfPreviewUrl(baseId)} className="h-[78vh] min-h-[680px] w-full bg-white" />
          </article>

          <article className="border-2 border-blue-700 bg-white shadow-sw-default">
            <header className="border-b-2 border-blue-700 p-4">
              <p className="font-mono text-xs font-bold uppercase text-blue-700">JD 定制后</p>
              <h2 className="mt-1 font-serif text-2xl font-bold">{tailored.title ?? '未命名定制简历'}</h2>
            </header>
            <iframe title="定制简历 PDF" src={getResumePdfPreviewUrl(tailoredId)} className="h-[78vh] min-h-[680px] w-full bg-white" />
          </article>
        </section>

        <section className="mt-5 border-2 border-black bg-white p-5 shadow-sw-default">
          <div className="flex items-center gap-2">
            <Target className="h-5 w-5 text-blue-700" />
            <h2 className="font-serif text-2xl font-bold">对应职位描述</h2>
          </div>
          <pre className="mt-4 max-h-[28rem] overflow-auto whitespace-pre-wrap border border-black bg-paper-tint p-4 font-sans text-sm leading-6">
            {jobDescription}
          </pre>
        </section>

        <div className="mt-5 flex flex-wrap gap-3">
          <Link href={`/resumes/${baseId}`} className="inline-flex items-center gap-2 border-2 border-black bg-white px-4 py-2 font-mono text-sm font-bold shadow-sw-default hover:bg-paper-tint">
            <FileText className="h-4 w-4" /> 打开原始简历
          </Link>
          <Link href={`/resumes/${tailoredId}`} className="inline-flex items-center gap-2 border-2 border-blue-700 bg-blue-700 px-4 py-2 font-mono text-sm font-bold text-white shadow-sw-default hover:bg-blue-800">
            打开定制简历
          </Link>
        </div>
      </div>
    </main>
  );
}

export default function ResumeComparePage() {
  return (
    <Suspense fallback={<main className="p-8 font-mono text-sm">正在加载新旧简历对比…</main>}>
      <ResumeCompareContent />
    </Suspense>
  );
}
