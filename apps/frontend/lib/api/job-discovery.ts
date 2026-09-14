import { apiFetch, apiPatch, apiPost } from './client';
import type { ResumeRenderProfile } from './resume';

export type DiscoveryJobStatus = 'pending' | 'approved' | 'ignored' | 'generated';

export interface DiscoveryJob {
  job_id: string;
  title: string;
  company: string;
  location: string;
  source: string;
  original_url?: string | null;
  content: string;
  has_full_jd: boolean;
  status: DiscoveryJobStatus;
  tailored_resume_id?: string | null;
}

export interface SourceStatus {
  source: string;
  status: 'success' | 'degraded' | 'failed' | 'skipped' | string;
  count: number;
  error?: string | null;
}

export interface SearchDiscoveryResponse {
  data: DiscoveryJob[];
  source_status: SourceStatus[];
}

export type DiscoveryStreamEvent =
  | { type: 'phase'; phase: 'searching' | 'collecting'; message: string; total?: number }
  | { type: 'job'; index: number; data: DiscoveryJob }
  | { type: 'complete'; count: number; source_status: SourceStatus[] }
  | { type: 'error'; message: string };

export interface LinkImportResponse {
  data: DiscoveryJob;
  duplicate: boolean;
}

export interface BrowserJobCapturePayload {
  source: 'boss';
  page_url: string;
  title: string;
  company: string;
  location: string;
  jd: string;
  resume_id?: string | null;
}

export interface GenerationTask {
  task_id: string;
  resume_id: string;
  job_ids: string[];
  status: string;
  completed_job_ids: string[];
  generated_resume_ids: Record<string, string>;
  failed_jobs: Record<string, string>;
  current_stage?: 'queued' | 'analyzing' | 'planning' | 'rewriting' | 'auditing' | 'saving' | 'completed' | string | null;
  current_job_id?: string | null;
  stage_detail?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DetailCompletionResult {
  data: DiscoveryJob[];
  completed_job_ids: string[];
  failed_jobs: Record<string, string>;
}

export interface BrowserAuthorization {
  source: 'boss' | 'liepin' | 'zhilian' | '51job' | string;
  status: 'not_connected' | 'connected' | 'expired' | string;
  authorized_at: string | null;
  expires_at: string | null;
}

export interface BrowserSessionStatus {
  source: 'boss';
  status: 'not_running' | 'not_logged_in' | 'verification_required' | 'connected' | 'unavailable';
  page_url?: string | null;
  message?: string | null;
}

export interface DiscoverySourceCapability {
  id: 'boss' | 'link_import' | 'liepin' | 'zhilian' | '51job' | string;
  label: string;
  status: 'available' | 'needs_login' | 'unverified' | string;
  searchable: boolean;
  supports_detail: boolean;
  supports_original_link: boolean;
}

async function readOrThrow<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new Error(payload.detail?.message ?? payload.detail ?? `请求失败（${response.status}）`);
  return payload;
}

export async function searchDiscoveryJobs(
  query: string,
  resumeId?: string | null,
  allowBossBrowser = false
) {
  return readOrThrow<SearchDiscoveryResponse>(
    await apiPost('/jobs/discovery/search', {
      query,
      resume_id: resumeId,
      allow_boss_browser: allowBossBrowser,
    })
  );
}

export async function streamDiscoveryJobs(
  query: string,
  resumeId: string | null,
  onEvent: (event: DiscoveryStreamEvent) => void
): Promise<void> {
  const response = await apiFetch('/jobs/discovery/search-stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query,
      resume_id: resumeId,
      allow_boss_browser: true,
    }),
  });
  if (!response.ok) {
    await readOrThrow(response);
    return;
  }
  if (!response.body) throw new Error('搜索连接未返回实时数据');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  while (true) {
    const { value, done } = await reader.read();
    pending += decoder.decode(value, { stream: !done });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as DiscoveryStreamEvent);
    }
    if (done) break;
  }
  if (pending.trim()) onEvent(JSON.parse(pending) as DiscoveryStreamEvent);
}

export async function listDiscoveryJobs(resumeId?: string | null) {
  return readOrThrow<{ data: DiscoveryJob[] }>(
    await apiFetch(
      resumeId
        ? `/jobs/discovery/list?resume_id=${encodeURIComponent(resumeId)}`
        : '/jobs/discovery/list'
    )
  );
}

export async function importDiscoveryLink(url: string, resumeId?: string | null) {
  return readOrThrow<LinkImportResponse>(
    await apiPost('/jobs/discovery/import-link', { url, resume_id: resumeId })
  );
}

export async function captureBrowserJob(payload: BrowserJobCapturePayload) {
  return readOrThrow<LinkImportResponse>(
    await apiPost('/jobs/discovery/browser-capture', payload)
  );
}

export async function completeDiscoveryDetails(resumeId: string, jobIds: string[]) {
  return readOrThrow<DetailCompletionResult>(
    await apiPost('/jobs/discovery/complete-details', { resume_id: resumeId, job_ids: jobIds })
  );
}

export async function listBrowserAuthorizations() {
  return readOrThrow<{ data: BrowserAuthorization[] }>(
    await apiFetch('/jobs/browser-authorizations')
  );
}

export async function getBrowserSessionStatus() {
  return readOrThrow<{ data: BrowserSessionStatus }>(
    await apiFetch('/jobs/browser-session/status')
  );
}

export async function listDiscoverySources() {
  return readOrThrow<{ data: DiscoverySourceCapability[] }>(
    await apiFetch('/jobs/discovery/sources')
  );
}

export async function startBrowserSession() {
  return readOrThrow<{ data: BrowserSessionStatus }>(
    await apiPost('/jobs/browser-session/start', {})
  );
}

export async function setDiscoveryJobStatus(jobId: string, status: DiscoveryJobStatus) {
  return readOrThrow<DiscoveryJob>(
    await apiPatch(`/jobs/discovery/${encodeURIComponent(jobId)}/status`, { status })
  );
}

export async function createGenerationTask(
  resumeId: string,
  jobIds: string[],
  renderProfile?: ResumeRenderProfile
) {
  return readOrThrow<GenerationTask>(
    await apiPost('/jobs/generation-tasks', {
      resume_id: resumeId,
      job_ids: jobIds,
      render_profile: renderProfile,
    })
  );
}

export async function getGenerationTask(taskId: string) {
  return readOrThrow<GenerationTask>(
    await apiFetch(`/jobs/generation-tasks/${encodeURIComponent(taskId)}`)
  );
}

export async function listGenerationTasks(resumeId: string) {
  return readOrThrow<{ data: GenerationTask[] }>(
    await apiFetch(`/jobs/generation-tasks?resume_id=${encodeURIComponent(resumeId)}`)
  );
}
