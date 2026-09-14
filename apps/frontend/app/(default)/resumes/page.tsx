'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Search from 'lucide-react/dist/esm/icons/search';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { fetchResumeList, setMasterResume, type ResumeListItem } from '@/lib/api/resume';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';

function ResumeThumbnail({ title, isMaster }: { title: string; isMaster: boolean }) {
  return (
    <div className="aspect-[210/297] overflow-hidden border-2 border-black bg-white p-[9%] shadow-sw-default transition-transform group-hover:-translate-y-0.5">
      <div className="flex items-start justify-between border-b-2 border-black pb-[7%]">
        <div className="min-w-0">
          <div className="h-2.5 w-20 bg-black" />
          <p className="mt-2 line-clamp-1 font-mono text-[7px] font-bold uppercase leading-tight text-blue-700">
            {title}
          </p>
        </div>
        <div
          className={`h-5 w-5 shrink-0 border border-black ${isMaster ? 'bg-blue-700' : 'bg-green-500'}`}
        />
      </div>
      <div className="mt-[9%] space-y-[7%]">
        <div>
          <div className="h-1.5 w-12 bg-black" />
          <div className="mt-2 space-y-1">
            <div className="h-1 w-full bg-secondary" />
            <div className="h-1 w-[92%] bg-secondary" />
            <div className="h-1 w-[76%] bg-secondary" />
          </div>
        </div>
        <div>
          <div className="h-1.5 w-14 bg-black" />
          <div className="mt-2 space-y-1">
            <div className="h-1 w-full bg-secondary" />
            <div className="h-1 w-full bg-secondary" />
            <div className="h-1 w-[84%] bg-secondary" />
            <div className="h-1 w-[67%] bg-secondary" />
          </div>
        </div>
        <div>
          <div className="h-1.5 w-10 bg-black" />
          <div className="mt-2 flex flex-wrap gap-1">
            <span className="h-2 w-8 bg-blue-100" />
            <span className="h-2 w-11 bg-blue-100" />
            <span className="h-2 w-7 bg-blue-100" />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ResumeLibraryPage() {
  const router = useRouter();
  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentResumeId, setCurrentResumeId] = useState<string | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const nextResumes = await fetchResumeList(true);
        setResumes(nextResumes);
        setCurrentResumeId(
          localStorage.getItem('master_resume_id') ||
            nextResumes.find((item) => item.is_master)?.resume_id ||
            null
        );
      } catch {
        setError('暂时无法读取简历库，请稍后刷新。');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const filteredResumes = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const visibleResumes = resumes.filter((resume) => {
      const visibleIdentity = [resume.title, resume.company, resume.job_title]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return !visibleIdentity.includes('测试');
    });
    if (!normalizedQuery) return visibleResumes;
    return visibleResumes.filter((resume) =>
      [resume.title, resume.filename].some((value) =>
        value?.toLowerCase().includes(normalizedQuery)
      )
    );
  }, [query, resumes]);

  const originalResumes = useMemo(
    () => filteredResumes.filter((resume) => !resume.parent_id),
    [filteredResumes]
  );
  const tailoredGroups = useMemo(() => {
    const groups = new Map<string, ResumeListItem[]>();
    filteredResumes.filter((resume) => resume.parent_id).forEach((resume) => {
      const key = resume.job_id || resume.resume_id;
      groups.set(key, [...(groups.get(key) ?? []), resume]);
    });
    return [...groups.entries()]
      .map(([key, items]) => ({ key, items: items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)) }))
      .sort((a, b) => b.items[0].updated_at.localeCompare(a.items[0].updated_at));
  }, [filteredResumes]);

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[104rem]">
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1 font-mono text-xs uppercase text-ink-soft hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> 返回首页
        </Link>

        <section className="border border-black bg-background shadow-sw-lg">
          <header className="border-b border-black p-6 md:p-10">
            <div className="mt-3 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <h1 className="font-serif text-4xl font-semibold uppercase tracking-tight md:text-6xl">
                  简历库
                </h1>
                <p className="mt-3 font-mono text-sm text-steel-grey">
                  集中管理主简历和每个岗位生成的定制版本。
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => setIsUploadDialogOpen(true)}>
                  <FileText /> 添加基础简历
                </Button>
                <Button onClick={() => router.push('/jobs')}>
                  <Sparkles /> 寻找岗位
                </Button>
              </div>
            </div>
            <div className="relative mt-7 max-w-xl">
              <Search className="absolute left-3 top-3 h-4 w-4 text-steel-grey" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索公司、岗位或简历名称"
                className="h-10 border-2 border-black bg-white pl-9 font-mono text-sm"
              />
            </div>
          </header>

          {isLoading ? (
            <div className="flex min-h-64 items-center justify-center gap-2 font-mono text-sm text-steel-grey">
              <LoaderCircle className="h-5 w-5 animate-spin" /> 正在读取简历库
            </div>
          ) : error ? (
            <p className="p-6 font-mono text-sm text-red-700">{error}</p>
          ) : filteredResumes.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center">
              <FileText className="mb-3 h-9 w-9 text-steel-grey" />
              <p className="font-mono text-sm text-steel-grey">还没有符合条件的简历。</p>
            </div>
          ) : (
            <div className="space-y-8 p-5 md:p-8">
              <section>
                <h2 className="border-b-2 border-black pb-2 font-serif text-2xl font-semibold">基础简历 <span className="font-mono text-xs text-steel-grey">用于生成的原始版本</span></h2>
                <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(132px,1fr))] gap-x-4 gap-y-6">
              {originalResumes.map((resume) => {
                const isOriginal = !resume.parent_id;
                const title =
                  resume.title ||
                  resume.filename ||
                  (isOriginal ? '未命名基础简历' : '未命名定制简历');
                const updatedAt = new Date(
                  resume.updated_at || resume.created_at
                ).toLocaleDateString('zh-CN');
                return (
                    <article key={resume.resume_id} className="group min-w-0">
                      <div className="relative">
                        <button
                          type="button"
                          className="w-full text-left"
                          onClick={() => router.push(`/resumes/${resume.resume_id}`)}
                          aria-label={`打开 ${title}`}
                        >
                          <ResumeThumbnail
                            title={title}
                            isMaster={currentResumeId === resume.resume_id}
                          />
                        </button>
                        <span
                          className={`absolute left-2 top-2 border border-black px-1.5 py-0.5 font-mono text-[9px] font-bold uppercase ${currentResumeId === resume.resume_id ? 'bg-blue-700 text-white' : 'bg-green-100 text-green-900'}`}
                        >
                          {isOriginal
                            ? currentResumeId === resume.resume_id
                              ? '当前'
                              : '基础'
                            : '定制'}
                        </span>
                        <div className="absolute inset-x-2 bottom-2 flex translate-y-1 gap-1 opacity-0 transition-all group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100">
                          <Button
                            size="icon"
                            className="h-7 w-7 bg-white text-black hover:bg-secondary"
                            variant="outline"
                            title="打开简历"
                            aria-label={`打开 ${title}`}
                            onClick={() => router.push(`/resumes/${resume.resume_id}`)}
                          >
                            <FileText className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            className="h-7 w-7"
                            title="微调简历"
                            aria-label={`微调 ${title}`}
                            onClick={() => router.push(`/builder?id=${resume.resume_id}`)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2 min-w-0">
                        <h2 className="line-clamp-2 min-h-10 font-serif text-sm font-semibold leading-5">
                          {title}
                        </h2>
                        <p className="mt-0.5 truncate font-mono text-[10px] text-steel-grey">
                          更新于 {updatedAt}
                        </p>
                        {isOriginal && currentResumeId !== resume.resume_id && (
                          <button
                            type="button"
                            className="mt-1 font-mono text-[10px] font-bold text-blue-700 hover:underline"
                            onClick={() => {
                              void setMasterResume(resume.resume_id).then(() => {
                                localStorage.setItem('master_resume_id', resume.resume_id);
                                setCurrentResumeId(resume.resume_id);
                                setResumes((current) => current.map((item) => ({ ...item, is_master: item.resume_id === resume.resume_id })));
                              }).catch(() => setError('设置主简历失败，请重试。'));
                            }}
                          >
                            设为当前版本
                          </button>
                        )}
                      </div>
                    </article>
                );
              })}
                </div>
              </section>
              <section>
                <h2 className="border-b-2 border-black pb-2 font-serif text-2xl font-semibold">岗位简历 <span className="font-mono text-xs text-steel-grey">每个岗位只显示最新版本</span></h2>
                <div className="mt-5 grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-5 gap-y-7">
                  {tailoredGroups.map((group) => {
                    const representative = group.items[0];
                    const title = representative.title || representative.filename || '未命名定制简历';
                    const updatedAt = new Date(representative.updated_at || representative.created_at).toLocaleDateString('zh-CN');
                    return <article key={group.key} className="group min-w-0"><button type="button" className="w-full text-left" onClick={() => router.push(`/resumes/${representative.resume_id}`)} aria-label={`打开 ${title}`}><ResumeThumbnail title={title} isMaster={false} /></button><div className="mt-2"><h3 className="line-clamp-2 min-h-10 font-serif text-sm font-semibold leading-5">{representative.company || '未关联公司'}｜{representative.job_title || title}</h3><p className="mt-0.5 truncate font-mono text-[10px] text-steel-grey">更新于 {updatedAt}{group.items.length > 1 ? ` · ${group.items.length - 1} 个历史版本` : ''}</p></div></article>;
                  })}
                  {tailoredGroups.length === 0 && <p className="font-mono text-sm text-steel-grey">审核岗位后生成的简历会按岗位归在这里。</p>}
                </div>
              </section>
            </div>
          )}
        </section>
        <ResumeUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onUploadComplete={(resumeId) => {
            void setMasterResume(resumeId).then(() => {
              localStorage.setItem('master_resume_id', resumeId);
              setCurrentResumeId(resumeId);
              return fetchResumeList(true);
            }).then(setResumes).catch(() => setError('简历已上传，但设置为主简历失败。'));
          }}
        />
      </div>
    </main>
  );
}
