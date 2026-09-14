'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Check from 'lucide-react/dist/esm/icons/check';
import CheckCheck from 'lucide-react/dist/esm/icons/check-check';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Link2 from 'lucide-react/dist/esm/icons/link-2';
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle';
import Search from 'lucide-react/dist/esm/icons/search';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Upload from 'lucide-react/dist/esm/icons/upload';
import X from 'lucide-react/dist/esm/icons/x';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';
import { fetchResumeList, setMasterResume } from '@/lib/api/resume';
import {
  type DiscoveryJob,
  completeDiscoveryDetails,
  createGenerationTask,
  getBrowserSessionStatus,
  getGenerationTask,
  importDiscoveryLink,
  listDiscoveryJobs,
  listGenerationTasks,
  setDiscoveryJobStatus,
  startBrowserSession,
  streamDiscoveryJobs,
} from '@/lib/api/job-discovery';

type JobStatus = 'pending' | 'approved' | 'ignored' | 'generated';

type Job = {
  id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  status: JobStatus;
  jd: string;
  hasFullJd: boolean;
  originalUrl?: string;
  tailoredResumeId?: string;
};

function toJob(item: DiscoveryJob): Job {
  return {
    id: item.job_id,
    title: item.title,
    company: item.company,
    location: item.location,
    source: item.source,
    status: item.status,
    jd: item.content,
    hasFullJd: item.has_full_jd,
    originalUrl: item.original_url ?? undefined,
    tailoredResumeId: item.tailored_resume_id ?? undefined,
  };
}

const STATUS_LABELS: Record<JobStatus, string> = {
  pending: '待选择',
  approved: '待生成',
  ignored: '已忽略',
  generated: '已完成',
};

export default function JobsPage() {
  const router = useRouter();
  const [query, setQuery] = useState(
    '帮我找上海和杭州的大厂 AI 产品经理岗位，3–5 年经验，优先官网'
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeStatus, setActiveStatus] = useState<JobStatus>('pending');
  const [visibleLimit, setVisibleLimit] = useState(12);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isSearching, setIsSearching] = useState(false);
  const [searchProgress, setSearchProgress] = useState<{ phase: string; count: number; total?: number } | null>(null);
  const [generationProgress, setGenerationProgress] = useState<{
    current: number;
    total: number;
    phase: 'details' | 'generation';
  } | null>(null);
  const [lastGenerationResult, setLastGenerationResult] = useState<{
    generated: number;
    failed: number;
  } | null>(null);
  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [hasMasterResume, setHasMasterResume] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [useBossBrowser, setUseBossBrowser] = useState(false);
  const [bossStatus, setBossStatus] = useState<'not_running' | 'not_logged_in' | 'verification_required' | 'connected' | 'unavailable'>('not_running');
  const [isStartingBrowser, setIsStartingBrowser] = useState(false);
  const openBossSession = async () => {
    setIsStartingBrowser(true);
    try {
      await startBrowserSession();
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
      const payload = await getBrowserSessionStatus();
      setBossStatus(payload.data.status);
      setUseBossBrowser(payload.data.status === 'connected');
      setNotice(
        payload.data.status === 'connected'
          ? 'BOSS 专用 Chrome 已连接，可以开始寻找岗位。'
          : payload.data.status === 'verification_required'
            ? '请在弹出的 BOSS 专用 Chrome 中完成安全验证。'
            : '已打开 BOSS 专用 Chrome。请登录一次，登录状态会保存在本机。'
      );
    } catch (error) {
      setNotice(error instanceof Error ? `无法打开 BOSS 专用 Chrome：${error.message}` : '无法打开 BOSS 专用 Chrome。');
    } finally {
      setIsStartingBrowser(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const hydrateWorkspace = async () => {
      const resumes = await fetchResumeList(true);
      let masterResumeId = localStorage.getItem('master_resume_id');
      if (!masterResumeId || !resumes.some((resume) => resume.resume_id === masterResumeId && resume.is_master)) {
        masterResumeId = resumes.find((resume) => resume.is_master)?.resume_id ?? null;
        if (masterResumeId) localStorage.setItem('master_resume_id', masterResumeId);
      }
      if (cancelled) return;
      setHasMasterResume(Boolean(masterResumeId));
      if (!masterResumeId) return;
      const [jobPayload, taskPayload] = await Promise.all([
        listDiscoveryJobs(masterResumeId),
        listGenerationTasks(masterResumeId),
      ]);
      if (cancelled) return;
        const validResumeIds = new Set(resumes.map((resume) => resume.resume_id));
        const finishedIds = taskPayload.data.reduce<Record<string, string>>((current, task) => {
          Object.entries(task.generated_resume_ids).forEach(([jobId, generatedResumeId]) => {
            if (validResumeIds.has(generatedResumeId)) current[jobId] = generatedResumeId;
          });
          return current;
        }, {});
        setJobs(
          jobPayload.data.map((job) => {
            const mapped = toJob(job);
            return finishedIds[mapped.id]
              ? { ...mapped, tailoredResumeId: finishedIds[mapped.id], status: 'generated' }
              : mapped;
          })
        );
        const activeTask = taskPayload.data.find((task) => task.status === 'queued' || task.status === 'running');
        if (activeTask) void monitorGenerationTask(activeTask.task_id, activeTask.job_ids.length);
    };
    void hydrateWorkspace().catch((error) =>
        setNotice(
          error instanceof Error ? `无法读取已保存岗位：${error.message}` : '无法读取已保存岗位。'
        )
      );
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refreshCapturedJobs = async () => {
      try {
        const masterResumeId = localStorage.getItem('master_resume_id');
        const [payload, taskPayload, resumes] = await Promise.all([
          listDiscoveryJobs(masterResumeId),
          masterResumeId ? listGenerationTasks(masterResumeId) : Promise.resolve({ data: [] }),
          fetchResumeList(true),
        ]);
        if (cancelled) return;
        const validResumeIds = new Set(resumes.map((resume) => resume.resume_id));
        const finishedIds = taskPayload.data.reduce<Record<string, string>>((current, task) => {
          Object.entries(task.generated_resume_ids).forEach(([jobId, generatedResumeId]) => {
            if (validResumeIds.has(generatedResumeId)) current[jobId] = generatedResumeId;
          });
          return current;
        }, {});
        setJobs(
          payload.data.map((job) => {
            const mapped = toJob(job);
            return finishedIds[mapped.id]
              ? { ...mapped, tailoredResumeId: finishedIds[mapped.id], status: 'generated' }
              : mapped;
          })
        );
      } catch {
        // Keep the current queue visible during a transient local restart.
      }
    };
    void refreshCapturedJobs();
    const interval = window.setInterval(() => void refreshCapturedJobs(), isSearching ? 800 : 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [isSearching]);

  useEffect(() => {
    let cancelled = false;
    const refreshBrowserSession = async () => {
      try {
        const payload = await getBrowserSessionStatus();
        if (cancelled) return;
        const connected = payload.data.status === 'connected';
        setBossStatus(payload.data.status);
        setUseBossBrowser(connected);
      } catch {
        if (!cancelled) {
          setBossStatus('unavailable');
          setUseBossBrowser(false);
        }
      }
    };
    void refreshBrowserSession();
    // Login state is informative, not a reason to constantly attach to the
    // external BOSS page. A slower probe avoids competing with an active search.
    const interval = window.setInterval(() => void refreshBrowserSession(), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const statusJobs = useMemo(
    () => jobs.filter((job) => job.status === activeStatus),
    [activeStatus, jobs]
  );
  const visibleJobs = useMemo(() => statusJobs.slice(0, visibleLimit), [statusJobs, visibleLimit]);

  const selectedVisibleIds = visibleJobs.filter((job) => selected.has(job.id)).map((job) => job.id);

  const updateStatuses = async (ids: string[], status: JobStatus) => {
    if (!ids.length) return;
    try {
      await Promise.all(ids.map((id) => setDiscoveryJobStatus(id, status)));
      setJobs((current) => current.map((job) => (ids.includes(job.id) ? { ...job, status } : job)));
      setSelected(new Set());
    } catch (error) {
      setNotice(
        error instanceof Error ? `未能更新岗位状态：${error.message}` : '未能更新岗位状态。'
      );
    }
  };

  async function performSearch(): Promise<void> {
    if (!query.trim()) return;
    const masterResumeId = localStorage.getItem('master_resume_id');
    if (!useBossBrowser) {
      setSearchProgress(null);
      setNotice(
        bossStatus === 'verification_required'
          ? '请先在 BOSS 专用 Chrome 中完成安全验证，然后再试。'
          : '请先点击“打开专用 Chrome”，登录 BOSS 后再开始寻找。'
      );
      return;
    }
    setIsSearching(true);
    setSearchProgress({ phase: '正在解析你的要求', count: 0 });
    setNotice('Agent 正在通过专用 Chrome 读取 BOSS 岗位…');
    setActiveStatus('pending');
    setSelected(new Set());
    try {
      await streamDiscoveryJobs(query.trim(), masterResumeId, (event) => {
        if (event.type === 'phase') {
          setSearchProgress((current) => ({
            phase: event.message,
            count: current?.count ?? 0,
            total: event.total,
          }));
        } else if (event.type === 'job') {
          const incoming = toJob(event.data);
          setJobs((current) => [incoming, ...current.filter((job) => job.id !== incoming.id)]);
          setSearchProgress((current) => ({
            phase: '岗位正在进入列表',
            count: event.index,
            total: current?.total,
          }));
        } else if (event.type === 'complete') {
          setSearchProgress({ phase: '搜索完成', count: event.count, total: event.count });
          const failed = event.source_status.find((source) => source.status === 'failed');
          setNotice(
            event.count
              ? `搜索完成，共收集 ${event.count} 条真实岗位。`
              : failed?.error
                ? `本次没有收集到岗位：${failed.error}`
                : '搜索完成，但当前条件下没有找到岗位。'
          );
        } else if (event.type === 'error') {
          throw new Error(event.message);
        }
      });
    } catch (error) {
      setSearchProgress(null);
      setNotice(error instanceof Error ? `搜索失败：${error.message}` : '搜索失败。');
    } finally {
      setIsSearching(false);
    }
  }

  const handleSearch = () => {
    if (!query.trim() || isSearching) return;
    void performSearch();
  };

  const handleLinkImport = async () => {
    const url = window.prompt('粘贴职位详情页链接');
    const masterResumeId = localStorage.getItem('master_resume_id');
    if (!url?.trim()) return;
    setIsSearching(true);
    try {
      const payload = await importDiscoveryLink(url.trim(), masterResumeId);
      const imported = toJob(payload.data);
      setJobs((current) => (payload.duplicate ? current : [imported, ...current]));
      setActiveStatus(imported.status);
      setNotice(
        payload.duplicate
          ? '该职位链接已在当前原简历的岗位列表中。'
          : '已读取完整 JD，并加入待审核列表。'
      );
    } catch (error) {
      setNotice(error instanceof Error ? `导入失败：${error.message}` : '导入失败。');
    } finally {
      setIsSearching(false);
    }
  };

  const toggleSelected = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAllVisible = () => {
    if (selectedVisibleIds.length === visibleJobs.length && visibleJobs.length > 0) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(visibleJobs.map((job) => job.id)));
  };

  const monitorGenerationTask = async (taskId: string, total: number): Promise<void> => {
    const latest = await getGenerationTask(taskId);
    const completed = latest.completed_job_ids.length;
    setGenerationProgress({ current: completed, total, phase: 'generation' });
    if (latest.stage_detail) {
      const position = Math.min(completed + 1, total);
      setNotice(`${latest.stage_detail}（${position}/${total}）…`);
    }
    if (latest.status === 'queued' || latest.status === 'running') {
      window.setTimeout(() => void monitorGenerationTask(taskId, total), 1200);
      return;
    }
    setGenerationProgress(null);
    const ids = latest.generated_resume_ids;
    const failedCount = Object.keys(latest.failed_jobs).length;
    setJobs((current) =>
      current.map((job) =>
        ids[job.id] ? { ...job, status: 'generated', tailoredResumeId: ids[job.id] } : job
      )
    );
    setSelected(new Set());
    setLastGenerationResult({ generated: Object.keys(ids).length, failed: failedCount });
    setActiveStatus('generated');
    setNotice(
      `已生成 ${Object.keys(ids).length} 份简历${failedCount ? `；${failedCount} 个岗位失败，可稍后重试。` : '。请在列表中逐份查看。'}`
    );
  };

  const generateResumes = async (jobsToTailor: Job[]) => {
    const masterResumeId = localStorage.getItem('master_resume_id');
    if (!masterResumeId) {
      setNotice('请先在仪表板上传并设为主简历，再开始定制。');
      return;
    }

    try {
      setLastGenerationResult(null);
      let jobsWithFullJd = jobsToTailor.filter((job) => job.hasFullJd);
      const jobsMissingDetails = jobsToTailor.filter((job) => !job.hasFullJd);

      if (jobsMissingDetails.length) {
        setGenerationProgress({ current: 0, total: jobsToTailor.length, phase: 'details' });
        setNotice(`正在补全 ${jobsMissingDetails.length} 个岗位的职位详情，再开始定制…`);
        const completed = new Map<string, Job>();
        const detailFailures: Record<string, string> = {};

        // Read one approved detail page at a time. A single long request made
        // Chrome look as if it were refreshing forever and gave the user no
        // useful progress. Each BOSS page now gets one bounded attempt; login
        // or verification failures stop the remaining reads immediately.
        for (let index = 0; index < jobsMissingDetails.length; index += 1) {
          const job = jobsMissingDetails[index];
          setGenerationProgress({
            current: index,
            total: jobsMissingDetails.length,
            phase: 'details',
          });
          setNotice(`正在读取 ${job.company}｜${job.title} 的完整 JD（${index + 1}/${jobsMissingDetails.length}）…`);
          const completion = await completeDiscoveryDetails(masterResumeId, [job.id]);
          completion.data.forEach((item) => completed.set(item.job_id, toJob(item)));
          Object.assign(detailFailures, completion.failed_jobs);
          setJobs((current) => current.map((item) => completed.get(item.id) ?? item));
          setGenerationProgress({
            current: index + 1,
            total: jobsMissingDetails.length,
            phase: 'details',
          });

          const reason = completion.failed_jobs[job.id] ?? '';
          if (/登录|验证|连接|安全校验/.test(reason)) break;
        }

        setJobs((current) =>
          current.map((job) => completed.get(job.id) ?? job)
        );
        jobsWithFullJd = jobsToTailor
          .map((job) => completed.get(job.id) ?? job)
          .filter((job) => job.hasFullJd);

        const failedCount = Object.keys(detailFailures).length;
        if (!jobsWithFullJd.length) {
          const firstReason = Object.values(detailFailures)[0];
          setGenerationProgress(null);
          setNotice(
            `未能读取所选岗位的完整 JD，未开始生成。${firstReason ?? '请打开职位详情页后，用“粘贴岗位链接”导入。'}`
          );
          return;
        }
        if (failedCount) {
          setNotice(`已补全 ${jobsWithFullJd.length} 个岗位；${failedCount} 个未能读取详情，本次仅为可用岗位生成。`);
        }
      }

      const task = await createGenerationTask(
        masterResumeId,
        jobsWithFullJd.map((job) => job.id)
      );
      setGenerationProgress({ current: 0, total: jobsWithFullJd.length, phase: 'generation' });
      setNotice(`正在后台生成 ${jobsWithFullJd.length} 份简历…可留在本页查看进度。`);
      const taskId = task.task_id as string;
      void monitorGenerationTask(taskId, jobsWithFullJd.length);
    } catch (error) {
      setGenerationProgress(null);
      setNotice(
        error instanceof Error ? `未能创建定制任务：${error.message}` : '未能创建定制任务。'
      );
    }
  };

  const openStyleChoice = (jobsToTailor: Job[]) => {
    void generateResumes(jobsToTailor);
  };

  return (
    <main className="min-h-[100dvh] bg-background px-4 py-6 md:px-8">
      <div className="mx-auto w-full max-w-[104rem]">
        <div className="border border-black bg-background shadow-sw-lg">
          <header className="border-b border-black p-5 md:p-6">
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-blue-700">岗位发现</p>
              <h1 className="mt-1 font-serif text-3xl font-semibold tracking-tight">寻找并选择岗位</h1>
            </div>

            <div className="mt-5 flex flex-col gap-2 md:flex-row">
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') handleSearch();
                }}
                className="h-11 border-2 border-black bg-white font-mono text-sm"
                aria-label="用一句话描述想找的岗位"
              />
              <Button
                onClick={handleSearch}
                disabled={isSearching}
                className="h-11 px-5"
              >
                {isSearching ? <LoaderCircle className="animate-spin" /> : <Search />}
                {isSearching ? '正在收集' : '开始寻找'}
              </Button>
              <Button
                variant="outline"
                className="h-11 px-4"
                onClick={() => void handleLinkImport()}
              >
                <Link2 /> 粘贴岗位链接
              </Button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 font-mono text-xs text-steel-grey">
              <span className={`h-2 w-2 rounded-full ${useBossBrowser ? 'bg-green-600' : 'bg-amber-500'}`} />
              <span>BOSS {useBossBrowser ? '已连接' : bossStatus === 'verification_required' ? '需要验证' : bossStatus === 'not_logged_in' ? '等待登录' : '未连接'}</span>
              <button type="button" onClick={() => void openBossSession()} disabled={isStartingBrowser} className="underline underline-offset-4 hover:text-blue-700 disabled:opacity-50">
                {isStartingBrowser ? '正在打开' : useBossBrowser ? '打开专用 Chrome' : bossStatus === 'not_logged_in' ? '查看登录窗口' : '连接 BOSS'}
              </button>
              <span className="text-black/20">|</span>
              {hasMasterResume ? (
                <span>主简历已就绪</span>
              ) : (
                <button type="button" onClick={() => setIsUploadDialogOpen(true)} className="inline-flex items-center gap-1 font-bold text-blue-700 underline underline-offset-4">
                  <Upload className="h-3.5 w-3.5" /> 添加主简历
                </button>
              )}
            </div>

            {(notice || searchProgress) && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border border-blue-700 bg-blue-50 px-3 py-2 font-mono text-xs text-blue-950" role="status" aria-label="任务状态">
                <span className="inline-flex items-center gap-2 font-bold">
                  {isSearching && <LoaderCircle className="h-4 w-4 animate-spin" />}
                  {searchProgress?.phase ?? notice}
                </span>
                {searchProgress && <span className="font-bold">已收集 {searchProgress.count} 条</span>}
              </div>
            )}
            {generationProgress && (
              <div className="mt-4 border-2 border-blue-700 bg-blue-50 p-4" role="status" aria-label="简历生成进度">
                <div className="flex items-center justify-between gap-4 font-mono text-xs font-bold text-blue-950">
                  <span>{generationProgress.phase === 'details' ? '正在读取完整 JD' : '正在生成定制简历'}</span>
                  <span>{generationProgress.current}/{generationProgress.total}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden border border-blue-900 bg-white">
                  <div className="h-full bg-blue-700 transition-all" style={{ width: `${generationProgress.total ? Math.round((generationProgress.current / generationProgress.total) * 100) : 0}%` }} />
                </div>
                <p className="mt-2 font-mono text-[11px] text-blue-900">可以留在本页等待；刷新后任务会继续恢复。</p>
              </div>
            )}
            {lastGenerationResult && (
              <div className="mt-4 flex items-center justify-between gap-4 border-2 border-green-800 bg-green-50 p-4" role="status">
                <div>
                  <p className="font-mono text-sm font-bold text-green-950">批量生成完成</p>
                  <p className="mt-1 font-mono text-xs text-green-900">
                    已生成 {lastGenerationResult.generated} 份{lastGenerationResult.failed ? `，失败 ${lastGenerationResult.failed} 份` : ''}。在“已生成”列表中逐份查看。
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => setActiveStatus('generated')}>查看结果</Button>
              </div>
            )}
          </header>

          <section className="p-4 md:p-6">
            <div className="flex flex-col justify-between gap-4 border-b border-black pb-4 md:flex-row md:items-center">
              <div className="flex flex-wrap gap-2">
                {(Object.keys(STATUS_LABELS) as JobStatus[]).map((status) => (
                  <button
                    key={status}
                    type="button"
                    onClick={() => {
                      setActiveStatus(status);
                      setSelected(new Set());
                      setVisibleLimit(12);
                    }}
                    className={`border border-black px-3 py-2 font-mono text-xs font-bold uppercase transition-colors ${
                      activeStatus === status
                        ? 'bg-black text-white'
                        : 'bg-white hover:bg-secondary'
                    }`}
                  >
                    {STATUS_LABELS[status]} ({jobs.filter((job) => job.status === status).length})
                  </button>
                ))}
              </div>

              {selectedVisibleIds.length > 0 && (
                <div className="fixed inset-x-4 bottom-5 z-30 mx-auto flex w-fit max-w-[calc(100vw-2rem)] flex-wrap items-center justify-center gap-2 border-2 border-black bg-white px-3 py-3 font-mono text-xs shadow-sw-lg md:inset-x-0">
                  <span>已选 {selectedVisibleIds.length} 个岗位</span>
                  {activeStatus === 'pending' && (
                    <>
                      <Button
                        size="sm"
                        variant="success"
                        onClick={() => updateStatuses(selectedVisibleIds, 'approved')}
                      >
                        <CheckCheck /> 加入待生成
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => updateStatuses(selectedVisibleIds, 'ignored')}
                      >
                        <X /> 忽略
                      </Button>
                    </>
                  )}
                  {activeStatus === 'approved' && (
                    <Button
                      size="sm"
                      disabled={generationProgress !== null}
                      onClick={() =>
                        openStyleChoice(
                          visibleJobs.filter((job) => selectedVisibleIds.includes(job.id))
                        )
                      }
                    >
                      {generationProgress ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Sparkles />
                      )}
                      {generationProgress
                        ? generationProgress.phase === 'details'
                          ? `补全 JD ${generationProgress.current}/${generationProgress.total}`
                          : `正在生成 ${generationProgress.current}/${generationProgress.total}`
                        : `批量定制 ${selectedVisibleIds.length} 份简历`}
                    </Button>
                  )}
                </div>
              )}
            </div>

            {activeStatus === 'approved' &&
              selectedVisibleIds.length === 0 &&
              visibleJobs.length > 0 && (
                <p className="border-b border-black bg-blue-50 px-3 py-3 font-mono text-xs text-blue-900">
                  勾选后直接批量生成，无需再填写职位描述；仅已保存完整 JD 的岗位可以定制。
                </p>
              )}

            {visibleJobs.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center border-b border-black font-mono text-sm text-steel-grey">
                {isSearching ? <LoaderCircle className="mb-3 h-8 w-8 animate-spin text-blue-700" /> : <FileText className="mb-3 h-8 w-8" />}
                {isSearching ? '正在寻找，第一条岗位出现后会立即加入这里…' : '岗位会显示在这里。输入一句话开始寻找。'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] border-collapse font-mono text-sm">
                  <thead>
                    <tr className="border-b-2 border-black bg-secondary text-left text-xs uppercase">
                      <th className="w-12 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={
                            visibleJobs.length > 0 &&
                            selectedVisibleIds.length === visibleJobs.length
                          }
                          onChange={toggleAllVisible}
                          aria-label="选择当前列表所有岗位"
                        />
                      </th>
                      <th className="px-3 py-3">职位 / 公司</th>
                      <th className="px-3 py-3">地点</th>
                      <th className="px-3 py-3">来源</th>
                      <th className="px-3 py-3">JD</th>
                      <th className="px-3 py-3 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleJobs.map((job) => (
                      <tr
                        key={job.id}
                        className="border-b border-black last:border-b-0 hover:bg-blue-50/40"
                      >
                        <td className="px-3 py-3 align-top">
                          <input
                            type="checkbox"
                            checked={selected.has(job.id)}
                            onChange={() => toggleSelected(job.id)}
                            aria-label={`选择 ${job.company} ${job.title}`}
                          />
                        </td>
                        <td className="px-3 py-3 align-top">
                          <button
                            type="button"
                            onClick={() => setDetailJob(job)}
                            className="text-left hover:text-blue-700"
                          >
                            <p className="font-bold">{job.title}</p>
                            <p className="mt-1 text-xs text-steel-grey">{job.company}</p>
                          </button>
                        </td>
                        <td className="px-3 py-3 align-top text-xs">{job.location}</td>
                        <td className="px-3 py-3 align-top text-xs">
                          {job.originalUrl ? (
                            <a
                              href={job.originalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-blue-700"
                              aria-label={`打开 ${job.company} ${job.title} 的原岗位页面`}
                            >
                              {job.source} <Link2 className="h-3 w-3" />
                            </a>
                          ) : (
                            <span title="该来源没有保存原始岗位链接">{job.source} · 无原链接</span>
                          )}
                        </td>
                        <td className="px-3 py-3 align-top text-xs">
                          <button
                            type="button"
                            onClick={() => setDetailJob(job)}
                            className={`underline underline-offset-4 hover:text-blue-700 ${job.hasFullJd ? 'text-green-700' : 'text-amber-700'}`}
                            aria-label={`查看 ${job.company} ${job.title} 的职位描述`}
                          >
                            {job.hasFullJd ? '查看 JD' : '需补充详情'}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-right align-top">
                          <div className="flex justify-end gap-2">
                            {job.status === 'pending' && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => updateStatuses([job.id], 'approved')}
                              >
                                <Check /> 加入待生成
                              </Button>
                            )}
                            {job.status === 'approved' && (
                              <Button
                                size="sm"
                                disabled={!job.hasFullJd || generationProgress !== null}
                                onClick={() => openStyleChoice([job])}
                              >
                                <Sparkles /> 直接定制
                              </Button>
                            )}
                            {job.status === 'generated' && job.tailoredResumeId && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => router.push(`/resumes/${job.tailoredResumeId}`)}
                              >
                                <FileText /> 打开简历
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {statusJobs.length > visibleJobs.length && (
                  <div className="flex justify-center border-t border-black p-4">
                    <Button variant="outline" onClick={() => setVisibleLimit((current) => current + 12)}>
                      显示更多（还有 {statusJobs.length - visibleJobs.length} 个）
                    </Button>
                  </div>
                )}
              </div>
            )}
          </section>
        </div>

        {detailJob && (
          <div
            className="fixed inset-0 z-40 flex justify-end bg-black/20"
            role="dialog"
            aria-modal="true"
            aria-label="岗位详情"
          >
            <button
              type="button"
              className="flex-1 cursor-default"
              aria-label="关闭岗位详情"
              onClick={() => setDetailJob(null)}
            />
            <aside className="flex h-full w-full max-w-xl flex-col border-l-2 border-black bg-background shadow-sw-lg">
              <div className="flex items-start justify-between border-b-2 border-black p-6">
                <div>
                  <p className="font-mono text-xs font-bold uppercase text-blue-700">岗位详情</p>
                  <h2 className="mt-2 font-serif text-3xl font-semibold">{detailJob.title}</h2>
                  <p className="mt-1 font-mono text-sm text-steel-grey">
                    {detailJob.company} · {detailJob.location} · {detailJob.source}
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="关闭"
                  onClick={() => setDetailJob(null)}
                >
                  <X />
                </Button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                <div
                  className={`inline-flex border border-black px-2 py-1 font-mono text-xs font-bold ${detailJob.hasFullJd ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}
                >
                  {detailJob.hasFullJd ? '已保存完整 JD' : '仅有列表摘要，尚不能生成'}
                </div>
                <h3 className="mt-6 font-mono text-xs font-bold uppercase">职位描述</h3>
                <p className="mt-3 whitespace-pre-wrap font-mono text-sm leading-7 text-ink-soft">
                  {detailJob.jd}
                </p>
                {!detailJob.hasFullJd && (
                  <p className="mt-5 border border-amber-700 bg-amber-50 p-3 font-mono text-xs leading-5 text-amber-950">
                    当前仅保存了列表摘要。请在来源页确认职位详情后，使用上方“粘贴岗位链接”导入完整
                    JD。
                  </p>
                )}
              </div>
              <div className="flex gap-3 border-t-2 border-black p-5">
                {detailJob.originalUrl && (
                  <a
                    className="inline-flex flex-1 items-center justify-center gap-2 border border-black bg-white px-3 py-2 text-sm font-medium hover:bg-secondary"
                    href={detailJob.originalUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Link2 className="h-4 w-4" /> 打开来源页
                  </a>
                )}
                {detailJob.status === 'pending' && (
                  <Button
                    className="flex-1"
                    onClick={() => {
                      updateStatuses([detailJob.id], 'approved');
                      setDetailJob(null);
                    }}
                  >
                    <Check /> 加入待生成
                  </Button>
                )}
                {detailJob.status === 'approved' && (
                  <Button
                    className="flex-1"
                    disabled={!detailJob.hasFullJd || generationProgress !== null}
                    onClick={() => openStyleChoice([detailJob])}
                  >
                    <Sparkles /> 直接定制简历
                  </Button>
                )}
                {detailJob.status === 'generated' && detailJob.tailoredResumeId && (
                  <Button
                    className="flex-1"
                    onClick={() => router.push(`/resumes/${detailJob.tailoredResumeId}`)}
                  >
                    <FileText /> 打开已生成简历
                  </Button>
                )}
              </div>
            </aside>
          </div>
        )}
        <ResumeUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onUploadComplete={(resumeId) => {
            void setMasterResume(resumeId).then(() => {
              localStorage.setItem('master_resume_id', resumeId);
              setHasMasterResume(true);
              setNotice('主简历已添加。现在可以描述你想找的岗位。');
            }).catch(() => setNotice('简历已上传，但设置主简历失败，请在简历库中重试。'));
          }}
        />
      </div>
    </main>
  );
}
