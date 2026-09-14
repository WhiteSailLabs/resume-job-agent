import type {
  ImprovedResult,
  InterviewPrepData,
} from '@/components/common/resume_previewer_context';
import type { ResumeData } from '@/components/dashboard/resume-component';
import { type TemplateSettings } from '@/lib/types/template-settings';
import { type Locale } from '@/i18n/config';
import { API_BASE, DEFAULT_TIMEOUT_MS, apiPost, apiPatch, apiDelete, apiFetch } from './client';

// Matches backend schemas/models.py ResumeData
interface ProcessedResume {
  personalInfo?: {
    name?: string;
    title?: string;
    email?: string;
    phone?: string;
    location?: string;
    website?: string | null;
    linkedin?: string | null;
    github?: string | null;
  };
  summary?: string;
  workExperience?: Array<{
    id: number;
    title?: string;
    company?: string;
    location?: string | null;
    years?: string;
    description?: string[];
    descriptionStyles?: ('bullet' | 'plain')[];
  }>;
  education?: Array<{
    id: number;
    institution?: string;
    degree?: string;
    years?: string;
    description?: string | null;
  }>;
  personalProjects?: Array<{
    id: number;
    name?: string;
    role?: string;
    years?: string;
    github?: string | null;
    website?: string | null;
    description?: string[];
    descriptionStyles?: ('bullet' | 'plain')[];
  }>;
  additional?: {
    technicalSkills?: string[];
    languages?: string[];
    certificationsTraining?: string[];
    awards?: string[];
  };
}

export type ResumeRenderTemplate =
  | 'swiss-single'
  | 'swiss-two-column'
  | 'modern'
  | 'modern-two-column'
  | 'latex'
  | 'clean'
  | 'vivid'
  | 'rendercv-engineering'
  | 'rendercv-classic'
  | 'rendercv-modern'
  | 'rendercv-asu';

export interface ResumeRenderProfile {
  engine: 'react' | 'rendercv';
  template: ResumeRenderTemplate;
}

export interface ResumeQualityReport {
  score: number;
  status: 'ready' | 'review';
  checks: {
    unsupported_metrics: string[];
    unsupported_strong_claims: string[];
    vague_bullets: string[];
    action_bullet_ratio: number;
    evidence_bullet_ratio: number;
    keyword_coverage: number | null;
    matched_keywords: string[];
    substantive_entry_count: number;
    skill_count: number;
  };
  recommendations: string[];
  source: string;
}

interface ResumeResponse {
  request_id: string;
  data: {
    resume_id: string;
    raw_resume: {
      id: number | null;
      content: string;
      content_type: string;
      created_at: string;
      processing_status: 'pending' | 'processing' | 'ready' | 'failed';
    };
    processed_resume: ProcessedResume | null;
    cover_letter?: string | null;
    outreach_message?: string | null;
    interview_prep?: InterviewPrepData | null;
    parent_id?: string | null; // For determining if resume is tailored
    title?: string | null;
    render_profile: ResumeRenderProfile;
  };
}

/** Response from resume upload endpoint */
export interface ResumeUploadResponse {
  message: string;
  request_id: string;
  resume_id: string;
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  processing_error?: 'llm_not_configured' | 'model_not_enabled' | 'model_rate_limited' | 'parse_failed' | null;
  is_master: boolean;
}

interface ImproveResumeConfirmRequest {
  resume_id: string;
  job_id: string;
  improved_data: ResumeData;
  improvements: Array<{
    suggestion: string;
    lineNumber?: number | null;
  }>;
  tailoring_plan?: Record<string, unknown> | null;
  quality_audit?: Record<string, unknown> | null;
}

function normalizeResumeId(resumeId: string): string {
  const normalized = resumeId.trim();
  if (!normalized) {
    throw new Error('Resume ID is required.');
  }
  return normalized;
}

export interface ResumeListItem {
  resume_id: string;
  filename: string | null;
  is_master: boolean;
  parent_id: string | null;
  processing_status: 'pending' | 'processing' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
  title?: string | null;
  render_profile: ResumeRenderProfile;
  job_id?: string | null;
  company?: string | null;
  job_title?: string | null;
  // Optional lightweight snippet of associated job description (populated client-side)
  jobSnippet?: string;
}

async function postImprove(
  endpoint: string,
  payload: Record<string, unknown>
): Promise<ImprovedResult> {
  let response: Response;
  try {
    // Use the configurable request timeout so NEXT_PUBLIC_REQUEST_TIMEOUT_MS
    // actually applies to the long-running improve/preview/confirm calls (#776).
    response = await apiPost(endpoint, payload, DEFAULT_TIMEOUT_MS);
  } catch (networkError) {
    console.error(`Network error during ${endpoint}:`, networkError);
    throw networkError;
  }

  const text = await response.text();
  if (!response.ok) {
    console.error('Improve failed response body:', text);
    throw new Error(`Improve failed with status ${response.status}: ${text}`);
  }

  try {
    return JSON.parse(text) as ImprovedResult;
  } catch (parseError) {
    console.error('Failed to parse improve response:', parseError, 'Raw response:', text);
    throw parseError;
  }
}

/** Uploads job descriptions and returns a job_id */
export async function uploadJobDescriptions(
  descriptions: string[],
  resumeId: string
): Promise<string> {
  const res = await apiPost('/jobs/upload', {
    job_descriptions: descriptions,
    resume_id: resumeId,
  });
  if (!res.ok) throw new Error(`Upload failed with status ${res.status}`);
  const data = await res.json();
  return data.job_id[0];
}

/** Improves the resume and returns the full preview object */
export async function improveResume(
  resumeId: string,
  jobId: string,
  promptId?: string
): Promise<ImprovedResult> {
  return postImprove('/resumes/improve', {
    resume_id: resumeId,
    job_id: jobId,
    prompt_id: promptId ?? null,
  });
}

/** Previews the resume improvement without saving */
export async function previewImproveResume(
  resumeId: string,
  jobId: string,
  promptId?: string
): Promise<ImprovedResult> {
  return postImprove('/resumes/improve/preview', {
    resume_id: resumeId,
    job_id: jobId,
    prompt_id: promptId ?? null,
  });
}

/** Confirms and saves a tailored resume */
export async function confirmImproveResume(
  payload: ImproveResumeConfirmRequest
): Promise<ImprovedResult> {
  return postImprove('/resumes/improve/confirm', payload as unknown as Record<string, unknown>);
}

/** Fetches a raw resume record for previewing the original upload */
export async function fetchResume(resumeId: string): Promise<ResumeResponse['data']> {
  const res = await apiFetch(`/resumes?resume_id=${encodeURIComponent(resumeId)}`);
  if (!res.ok) {
    throw new Error(`Failed to load resume (status ${res.status}).`);
  }
  const payload = (await res.json()) as ResumeResponse;
  // Support both raw_resume content (initial) and processed_resume (if available)
  // The viewer/builder logic should prioritize processed data if present
  return payload.data;
}

export async function fetchResumeList(includeMaster = false): Promise<ResumeListItem[]> {
  const res = await apiFetch(`/resumes/list?include_master=${includeMaster ? 'true' : 'false'}`);
  if (!res.ok) {
    throw new Error(`Failed to load resumes list (status ${res.status}).`);
  }
  const payload = (await res.json()) as { data: ResumeListItem[] };
  return payload.data;
}

export async function setMasterResume(resumeId: string): Promise<void> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/set-master`, {});
  if (!res.ok) {
    throw new Error(`设置主简历失败（${res.status}）。`);
  }
}

export async function updateResume(
  resumeId: string,
  resumeData: ProcessedResume
): Promise<ResumeResponse['data']> {
  const res = await apiPatch(`/resumes/${encodeURIComponent(resumeId)}`, resumeData);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update resume (status ${res.status}): ${text}`);
  }
  const payload = (await res.json()) as ResumeResponse;
  return payload.data;
}

export function getResumePdfUrl(
  resumeId: string,
  settings?: TemplateSettings,
  locale?: Locale
): string {
  const normalizedId = normalizeResumeId(resumeId);
  const params = new URLSearchParams();

  if (settings) {
    params.set('template', settings.template);
    params.set('pageSize', settings.pageSize);
    params.set('marginTop', String(settings.margins.top));
    params.set('marginBottom', String(settings.margins.bottom));
    params.set('marginLeft', String(settings.margins.left));
    params.set('marginRight', String(settings.margins.right));
    params.set('sectionSpacing', String(settings.spacing.section));
    params.set('itemSpacing', String(settings.spacing.item));
    params.set('lineHeight', String(settings.spacing.lineHeight));
    params.set('fontSize', String(settings.fontSize.base));
    params.set('headerScale', String(settings.fontSize.headerScale));
    params.set('headerFont', settings.fontSize.headerFont);
    params.set('bodyFont', settings.fontSize.bodyFont);
    params.set('compactMode', String(settings.compactMode));
    params.set('showContactIcons', String(settings.showContactIcons));
    params.set('accentColor', settings.accentColor);
  } else {
    params.set('pageSize', 'A4');
  }
  if (locale) {
    params.set('lang', locale);
  }

  return `${API_BASE}/resumes/${encodeURIComponent(normalizedId)}/pdf?${params.toString()}`;
}

export function getResumePdfPreviewUrl(resumeId: string, locale?: Locale): string {
  const url = getResumePdfUrl(resumeId, undefined, locale);
  return `${url}${url.includes('?') ? '&' : '?'}inline=true`;
}

export async function updateResumeRenderProfile(
  resumeId: string,
  profile: ResumeRenderProfile
): Promise<ResumeRenderProfile> {
  const res = await apiPatch(`/resumes/${encodeURIComponent(resumeId)}/render-profile`, profile);
  if (!res.ok) throw new Error(`Failed to update template (status ${res.status}).`);
  const payload = (await res.json()) as { render_profile: ResumeRenderProfile };
  return payload.render_profile;
}

/** Save a second, presentation-only version of a tailored resume. */
export async function createResumeVisualVersion(
  resumeId: string,
  profile: ResumeRenderProfile
): Promise<{ resume_id: string; render_profile: ResumeRenderProfile; job_id: string }> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/visual-versions`, profile);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to create visual version (status ${res.status}): ${text}`);
  }
  return (await res.json()) as { resume_id: string; render_profile: ResumeRenderProfile; job_id: string };
}

export async function fetchResumeQuality(resumeId: string): Promise<ResumeQualityReport> {
  const res = await apiFetch(`/resumes/${encodeURIComponent(resumeId)}/quality`);
  if (!res.ok) throw new Error(`Failed to load quality report (status ${res.status}).`);
  const payload = (await res.json()) as { data: ResumeQualityReport };
  return payload.data;
}

export async function downloadResumePdf(
  resumeId: string,
  settings?: TemplateSettings,
  locale?: Locale
): Promise<Blob> {
  const url = getResumePdfUrl(resumeId, settings, locale);
  const res = await apiFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to download resume (status ${res.status}): ${text}`);
  }
  return await res.blob();
}

/** Deletes a resume by ID */
export async function deleteResume(resumeId: string): Promise<void> {
  const res = await apiDelete(`/resumes/${encodeURIComponent(resumeId)}`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to delete resume (status ${res.status}): ${text}`);
  }
}

/** Updates the cover letter for a resume */
export async function updateCoverLetter(resumeId: string, content: string): Promise<void> {
  const res = await apiPatch(`/resumes/${encodeURIComponent(resumeId)}/cover-letter`, { content });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update cover letter (status ${res.status}): ${text}`);
  }
}

/** Updates the outreach message for a resume */
export async function updateOutreachMessage(resumeId: string, content: string): Promise<void> {
  const res = await apiPatch(`/resumes/${encodeURIComponent(resumeId)}/outreach-message`, {
    content,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to update outreach message (status ${res.status}): ${text}`);
  }
}

/** Renames a resume by updating its title */
export async function renameResume(resumeId: string, title: string): Promise<void> {
  const res = await apiPatch(`/resumes/${encodeURIComponent(resumeId)}/title`, { title });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to rename resume (status ${res.status}): ${text}`);
  }
}

/** Downloads cover letter as PDF */
export function getCoverLetterPdfUrl(
  resumeId: string,
  pageSize: 'A4' | 'LETTER' = 'A4',
  locale?: Locale
): string {
  const normalizedId = normalizeResumeId(resumeId);
  const params = new URLSearchParams({ pageSize });
  if (locale) {
    params.set('lang', locale);
  }
  return `${API_BASE}/resumes/${encodeURIComponent(normalizedId)}/cover-letter/pdf?${params.toString()}`;
}

export async function downloadCoverLetterPdf(
  resumeId: string,
  pageSize: 'A4' | 'LETTER' = 'A4',
  locale?: Locale
): Promise<Blob> {
  const url = getCoverLetterPdfUrl(resumeId, pageSize, locale);
  const res = await apiFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to download cover letter (status ${res.status}): ${text}`);
  }
  return await res.blob();
}

/** Generates a cover letter on-demand for a tailored resume */
export async function generateCoverLetter(resumeId: string): Promise<string> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/generate-cover-letter`, {});
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to generate cover letter (status ${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.content;
}

/** Generates an outreach message on-demand for a tailored resume */
export async function generateOutreachMessage(resumeId: string): Promise<string> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/generate-outreach`, {});
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to generate outreach message (status ${res.status}): ${text}`);
  }
  const data = await res.json();
  return data.content;
}

/** Generates interview preparation on-demand for a tailored resume */
export async function generateInterviewPrep(resumeId: string): Promise<InterviewPrepData> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/generate-interview-prep`, {});
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to generate interview preparation (status ${res.status}): ${text}`);
  }
  const data = (await res.json()) as { interview_prep: InterviewPrepData };
  return data.interview_prep;
}

/** Retries AI processing for a failed resume */
export async function retryProcessing(resumeId: string): Promise<ResumeUploadResponse> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/retry-processing`, {});
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to retry processing (status ${res.status}): ${text}`);
  }
  return res.json();
}

/** Fetches the job description used to tailor a resume */
export async function fetchJobDescription(
  resumeId: string
): Promise<{
  job_id: string;
  content: string;
  title: string;
  company: string;
  location: string;
  source: string;
  original_url?: string | null;
}> {
  const res = await apiFetch(`/resumes/${encodeURIComponent(resumeId)}/job-description`);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Failed to fetch job description (status ${res.status}): ${text}`);
  }
  return res.json();
}

export async function previewAiResumeAdjustment(
  resumeId: string,
  instruction: string
): Promise<{ reply: string; changed_paths: string[]; proposed_resume: ResumeData }> {
  const res = await apiPost(`/resumes/${encodeURIComponent(resumeId)}/ai-adjust/preview`, {
    instruction,
  }, DEFAULT_TIMEOUT_MS);
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.detail || `AI 调整失败（${res.status}）`);
  }
  return res.json();
}
