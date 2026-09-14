'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useRouter, useParams, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import Resume, { ResumeData } from '@/components/dashboard/resume-component';
import {
  fetchResume,
  downloadResumePdf,
  fetchResumeQuality,
  getResumePdfUrl,
  getResumePdfPreviewUrl,
  deleteResume,
  retryProcessing,
  renameResume,
  fetchJobDescription,
  type ResumeQualityReport,
  type ResumeRenderProfile,
} from '@/lib/api/resume';
import { useStatusCache } from '@/lib/context/status-cache';
import {
  ArrowLeft,
  Edit,
  Download,
  Loader2,
  AlertCircle,
  Sparkles,
  Pencil,
  MessagesSquare,
  Columns2,
  ExternalLink,
  MoreHorizontal,
  Trash2,
} from 'lucide-react';
import { EnrichmentModal } from '@/components/enrichment/enrichment-modal';
import { AiResumeChat } from '@/components/resume/ai-resume-chat';
import { AiResumeChangePreview } from '@/components/resume/ai-resume-change-preview';
import { useTranslations } from '@/lib/i18n';
import { withLocalizedDefaultSections } from '@/lib/utils/section-helpers';
import { useLanguage } from '@/lib/context/language-context';
import { downloadBlobAsFile, openUrlInNewTab, sanitizeFilename } from '@/lib/utils/download';

type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed';

const DEFAULT_RENDER_PROFILE: ResumeRenderProfile = {
  engine: 'rendercv',
  template: 'rendercv-engineering',
};

type JobContext = Awaited<ReturnType<typeof fetchJobDescription>>;

export default function ResumeViewerPage() {
  const { t } = useTranslations();
  const { uiLanguage } = useLanguage();
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const { decrementResumes, setHasMasterResume } = useStatusCache();
  const [resumeData, setResumeData] = useState<ResumeData | null>(null);
  const [aiProposal, setAiProposal] = useState<ResumeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [isMasterResume, setIsMasterResume] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showDeleteSuccessDialog, setShowDeleteSuccessDialog] = useState(false);
  const [showDownloadSuccessDialog, setShowDownloadSuccessDialog] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [showEnrichmentModal, setShowEnrichmentModal] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [resumeTitle, setResumeTitle] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editingTitleValue, setEditingTitleValue] = useState('');
  const [isTailoredResume, setIsTailoredResume] = useState(false);
  const [parentResumeId, setParentResumeId] = useState<string | null>(null);
  const [renderProfile, setRenderProfile] = useState<ResumeRenderProfile>({
    engine: 'rendercv',
    template: 'rendercv-engineering',
  });
  const [qualityReport, setQualityReport] = useState<ResumeQualityReport | null>(null);
  const [qualityStatus, setQualityStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [previewRevision, setPreviewRevision] = useState(0);
  const [jobContext, setJobContext] = useState<JobContext | null>(null);
  const [jobContextError, setJobContextError] = useState(false);
  const [showSavedChanges, setShowSavedChanges] = useState(false);
  const [baseResumeData, setBaseResumeData] = useState<ResumeData | null>(null);
  const [savedChangesLoading, setSavedChangesLoading] = useState(false);
  const [savedChangesError, setSavedChangesError] = useState<string | null>(null);

  const resumeId = params?.id as string;
  const requestedChangesView = searchParams.get('view') === 'changes';

  const localizedResumeData = useMemo(() => {
    if (!resumeData) return null;
    return withLocalizedDefaultSections(resumeData, t);
  }, [resumeData, t]);

  useEffect(() => {
    if (!resumeId) return;

    const loadResume = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await fetchResume(resumeId);

        // Get processing status
        const status = (data.raw_resume?.processing_status || 'pending') as ProcessingStatus;
        setProcessingStatus(status);

        // Capture title for editable display (always set to clear stale state)
        setResumeTitle(data.title ?? null);
        setIsTailoredResume(Boolean(data.parent_id));
        setParentResumeId(data.parent_id ?? null);
        setRenderProfile(data.render_profile ?? DEFAULT_RENDER_PROFILE);

        if (data.parent_id) {
          fetchJobDescription(resumeId)
            .then((job) => {
              setJobContext(job);
              setJobContextError(false);
            })
            .catch(() => {
              setJobContext(null);
              setJobContextError(true);
            });
        } else {
          setJobContext(null);
          setJobContextError(false);
        }

        setQualityStatus('loading');
        fetchResumeQuality(resumeId)
          .then((report) => {
            setQualityReport(report);
            setQualityStatus('ready');
          })
          .catch(() => {
            setQualityReport(null);
            setQualityStatus('error');
          });

        // Prioritize processed_resume if available (structured JSON)
        if (data.processed_resume) {
          setResumeData(data.processed_resume as ResumeData);
          setError(null);
        } else if (status === 'failed') {
          setError(t('resumeViewer.errors.processingFailed'));
        } else if (status === 'processing') {
          setError(t('resumeViewer.errors.stillProcessing'));
        } else if (data.raw_resume?.content) {
          // Try to parse raw_resume content as JSON (for tailored resumes stored as JSON)
          try {
            const parsed = JSON.parse(data.raw_resume.content);
            setResumeData(parsed as ResumeData);
          } catch {
            setError(t('resumeViewer.errors.notProcessedYet'));
          }
        } else {
          setError(t('resumeViewer.errors.noDataAvailable'));
        }
      } catch (err) {
        console.error('Failed to load resume:', err);
        setError(t('resumeViewer.errors.failedToLoad'));
      } finally {
        setLoading(false);
      }
    };

    loadResume();
    setIsMasterResume(localStorage.getItem('master_resume_id') === resumeId);
  }, [resumeId, t]);

  useEffect(() => {
    if (!requestedChangesView || !isTailoredResume || !parentResumeId || baseResumeData) return;
    setShowSavedChanges(true);
    setSavedChangesLoading(true);
    setSavedChangesError(null);
    fetchResume(parentResumeId)
      .then((data) => {
        if (!data.processed_resume) throw new Error('Base resume is not ready');
        setBaseResumeData(data.processed_resume as ResumeData);
      })
      .catch(() => setSavedChangesError('原始简历暂时无法读取，请稍后重试。'))
      .finally(() => setSavedChangesLoading(false));
  }, [baseResumeData, isTailoredResume, parentResumeId, requestedChangesView]);

  const handleRetryProcessing = async () => {
    if (!resumeId) return;
    setIsRetrying(true);
    try {
      const result = await retryProcessing(resumeId);
      if (result.processing_status === 'ready') {
        // Reload the page to show the processed resume
        window.location.reload();
      } else {
        setError(t('resumeViewer.errors.processingFailed'));
      }
    } catch (err) {
      console.error('Retry processing failed:', err);
      setError(t('resumeViewer.errors.processingFailed'));
    } finally {
      setIsRetrying(false);
    }
  };

  const handleEdit = () => {
    router.push(`/builder?id=${resumeId}`);
  };

  const handleInterviewPrep = () => {
    router.push(`/builder?id=${resumeId}&tab=interview-prep`);
  };

  const handleToggleSavedChanges = async () => {
    if (showSavedChanges) {
      setShowSavedChanges(false);
      return;
    }
    setShowSavedChanges(true);
    if (baseResumeData || !parentResumeId) return;
    setSavedChangesLoading(true);
    setSavedChangesError(null);
    try {
      const data = await fetchResume(parentResumeId);
      if (!data.processed_resume) throw new Error('Base resume is not ready');
      setBaseResumeData(data.processed_resume as ResumeData);
    } catch {
      setSavedChangesError('原始简历暂时无法读取，请稍后重试。');
    } finally {
      setSavedChangesLoading(false);
    }
  };

  const handleTitleSave = async () => {
    const trimmed = editingTitleValue.trim();
    if (!trimmed || trimmed === resumeTitle) {
      setIsEditingTitle(false);
      return;
    }
    try {
      await renameResume(resumeId, trimmed);
      setResumeTitle(trimmed);
    } catch (err) {
      console.error('Failed to rename resume:', err);
    }
    setIsEditingTitle(false);
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setIsEditingTitle(false);
    }
  };

  // Reload resume data after enrichment
  const reloadResumeData = async () => {
    try {
      const data = await fetchResume(resumeId);
      if (data.processed_resume) {
        setResumeData(data.processed_resume as ResumeData);
        setError(null);
      }
    } catch (err) {
      console.error('Failed to reload resume:', err);
    }
  };

  const handleEnrichmentComplete = () => {
    setShowEnrichmentModal(false);
    reloadResumeData();
  };

  const handleDownload = async () => {
    setIsDownloading(true);
    try {
      const blob = await downloadResumePdf(resumeId, undefined, uiLanguage);
      const filename = sanitizeFilename(resumeTitle, resumeId, 'resume');
      downloadBlobAsFile(blob, filename);
      setShowDownloadSuccessDialog(true);
    } catch (err) {
      console.error('Failed to download resume:', err);
      if (err instanceof TypeError && err.message.includes('Failed to fetch')) {
        const fallbackUrl = getResumePdfUrl(resumeId, undefined, uiLanguage);
        const didOpen = openUrlInNewTab(fallbackUrl);
        if (!didOpen) {
          alert(t('common.popupBlocked', { url: fallbackUrl }));
        }
        return;
      }
      alert(t('builder.alerts.downloadFailed'));
    } finally {
      setIsDownloading(false);
    }
  };

  const handleDeleteResume = async () => {
    try {
      setDeleteError(null);
      await deleteResume(resumeId);
      // Update cached counters
      decrementResumes();
      if (isMasterResume) {
        localStorage.removeItem('master_resume_id');
        setHasMasterResume(false);
      }
      setShowDeleteDialog(false);
      setShowDeleteSuccessDialog(true);
    } catch (err) {
      console.error('Failed to delete resume:', err);
      setDeleteError(t('resumeViewer.errors.failedToDelete'));
      setShowDeleteDialog(false);
    }
  };

  const handleDeleteSuccessConfirm = () => {
    setShowDeleteSuccessDialog(false);
    router.push('/resumes');
  };

  const handleDownloadSuccessConfirm = () => {
    setShowDownloadSuccessDialog(false);
  };

  // Delete-related dialogs, shared by the failed-processing error branch and the
  // main viewer branch so the "Delete & Start Over" recovery action works in the
  // error state. Previously these lived only in the main branch, so on the error
  // path the confirm dialog never mounted and the delete request was never sent.
  // (The loading branch omits them — it has no delete affordance.)
  const deleteDialogs = (
    <>
      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title={
          isMasterResume ? t('confirmations.deleteMasterResumeTitle') : t('dashboard.deleteResume')
        }
        description={
          isMasterResume
            ? t('confirmations.deleteMasterResumeDescription')
            : t('confirmations.deleteResumeFromSystemDescription')
        }
        confirmLabel="确认删除"
        cancelLabel="保留简历"
        onConfirm={handleDeleteResume}
        variant="danger"
      />

      <ConfirmDialog
        open={showDeleteSuccessDialog}
        onOpenChange={setShowDeleteSuccessDialog}
        title={t('resumeViewer.deletedTitle')}
        description={
          isMasterResume
            ? t('resumeViewer.deletedDescriptionMaster')
            : t('resumeViewer.deletedDescriptionRegular')
        }
        confirmLabel="返回简历库"
        onConfirm={handleDeleteSuccessConfirm}
        variant="success"
        showCancelButton={false}
      />

      {deleteError && (
        <ConfirmDialog
          open={!!deleteError}
          onOpenChange={() => setDeleteError(null)}
          title={t('resumeViewer.deleteFailedTitle')}
          description={deleteError}
          confirmLabel="知道了"
          onConfirm={() => setDeleteError(null)}
          variant="danger"
          showCancelButton={false}
        />
      )}
    </>
  );

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background">
        <Loader2 className="w-10 h-10 animate-spin text-blue-700 mb-4" />
        <p className="font-mono text-sm font-bold uppercase text-blue-700">正在加载简历…</p>
      </div>
    );
  }

  if (error || !resumeData) {
    const isProcessing = processingStatus === 'processing';
    const isFailed = processingStatus === 'failed';

    return (
      <>
        <div className="min-h-screen flex flex-col items-center justify-center bg-background p-4">
          <div
            className={`border p-6 text-center max-w-md shadow-sw-default ${
              isProcessing
                ? 'bg-blue-50 border-blue-200'
                : isFailed
                  ? 'bg-orange-50 border-orange-200'
                  : 'bg-red-50 border-red-200'
            }`}
          >
            <div className="flex justify-center mb-4">
              {isProcessing ? (
                <Loader2 className="w-8 h-8 animate-spin text-blue-700" />
              ) : isFailed ? (
                <AlertCircle className="w-8 h-8 text-orange-600" />
              ) : (
                <AlertCircle className="w-8 h-8 text-red-600" />
              )}
            </div>
            <p
              className={`font-bold mb-4 ${
                isProcessing ? 'text-blue-700' : isFailed ? 'text-orange-700' : 'text-red-700'
              }`}
            >
              {error || t('resumeViewer.resumeNotFound')}
            </p>
            <div className="flex flex-col gap-2">
              {isFailed && (
                <>
                  <Button onClick={handleRetryProcessing} disabled={isRetrying}>
                    {isRetrying ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        正在重试…
                      </>
                    ) : (
                      '重新解析'
                    )}
                  </Button>
                  <Button variant="destructive" onClick={() => setShowDeleteDialog(true)}>
                    删除这份简历
                  </Button>
                </>
              )}
              <Button variant="outline" onClick={() => router.push('/resumes')}>
                返回简历库
              </Button>
            </div>
          </div>
        </div>
        {deleteDialogs}
      </>
    );
  }

  return (
    <div className="min-h-screen bg-background py-8 px-4 md:px-6 overflow-y-auto">
      <div className="mx-auto max-w-[108rem]">
        {/* Header Actions */}
        <div className="mb-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 no-print">
          <Button
            variant="outline"
            onClick={() => router.push(isTailoredResume ? '/jobs' : '/resumes')}
          >
            <ArrowLeft className="w-4 h-4" />
            {isTailoredResume ? '返回岗位列表' : '返回简历库'}
          </Button>

          <div className="flex w-full flex-wrap gap-2 md:w-auto md:justify-end">
            {isMasterResume && (
              <Button onClick={() => setShowEnrichmentModal(true)} className="gap-2">
                <Sparkles className="w-4 h-4" />
                AI 完善主简历
              </Button>
            )}
            <Button variant="outline" onClick={handleEdit}>
              <Edit className="w-4 h-4" />
              编辑内容
            </Button>
            {isTailoredResume && parentResumeId && (
              <Button variant="outline" onClick={handleToggleSavedChanges}>
                <Columns2 className="h-4 w-4" />
                {showSavedChanges ? '收起改动' : '查看改动'}
              </Button>
            )}
            <Button variant="success" onClick={handleDownload} disabled={isDownloading}>
              <Download className="w-4 h-4" />
              {isDownloading ? '正在生成…' : '下载 PDF'}
            </Button>
            <details className="relative">
              <summary className="flex h-10 cursor-pointer list-none items-center gap-2 border-2 border-black bg-white px-4 font-mono text-sm font-bold shadow-sw-default hover:bg-blue-50">
                <MoreHorizontal className="h-4 w-4" />
                更多
              </summary>
              <div className="absolute right-0 z-30 mt-2 w-56 border-2 border-black bg-white p-2 shadow-sw-lg">
                {isTailoredResume && (
                  <button
                    type="button"
                    onClick={handleInterviewPrep}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-blue-50"
                  >
                    <MessagesSquare className="h-4 w-4" />
                    面试准备
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setShowDeleteDialog(true)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" />
                  删除简历
                </button>
              </div>
            </details>
          </div>
        </div>

        {/* Editable Title (tailored resumes only) */}
        {!isMasterResume && (
          <div className="mb-6 no-print">
            {isEditingTitle ? (
              <input
                type="text"
                value={editingTitleValue}
                onChange={(e) => setEditingTitleValue(e.target.value)}
                onBlur={handleTitleSave}
                onKeyDown={handleTitleKeyDown}
                autoFocus
                maxLength={80}
                placeholder={t('resumeViewer.titlePlaceholder')}
                className="font-serif text-2xl font-bold border-b-2 border-black bg-transparent outline-none w-full max-w-xl px-0 py-1"
              />
            ) : (
              <button
                onClick={() => {
                  setEditingTitleValue(resumeTitle || '');
                  setIsEditingTitle(true);
                }}
                className="group flex items-center gap-2 cursor-pointer bg-transparent border-none p-0"
              >
                <h2
                  className={`font-serif text-2xl font-bold border-b-2 border-transparent group-hover:border-black transition-colors ${!resumeTitle ? 'text-steel-grey' : ''}`}
                >
                  {resumeTitle || t('resumeViewer.titlePlaceholder')}
                </h2>
                <Pencil
                  className={`w-4 h-4 transition-opacity ${resumeTitle ? 'opacity-0 group-hover:opacity-60' : 'opacity-40 group-hover:opacity-60'}`}
                />
              </button>
            )}
          </div>
        )}

        {qualityStatus === 'ready' && qualityReport && (
          <div className="mb-4 flex flex-wrap items-center gap-2 font-mono text-xs text-steel-grey no-print">
            <span className="font-bold text-ink">内容检查 {qualityReport.score}/100</span>
            <span>·</span>
            <span>{qualityReport.recommendations[0] ?? '未发现明显的夸大或空泛表达。'}</span>
          </div>
        )}

        {showSavedChanges && isTailoredResume && (
          <section
            className="no-print mb-4 border-2 border-black bg-white shadow-sw-default"
            aria-label="生成时的简历改动"
          >
            <header className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-black p-4">
              <div>
                <p className="font-mono text-xs font-bold uppercase text-blue-700">生成记录</p>
                <h3 className="mt-1 font-serif text-xl font-semibold">
                  这份简历相对主简历改了什么
                </h3>
                <p className="mt-1 text-sm text-steel-grey">
                  直接在当前页面核对，确认后继续微调或下载。
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => setShowSavedChanges(false)}>
                收起
              </Button>
            </header>
            {savedChangesLoading ? (
              <p className="p-4 font-mono text-sm text-steel-grey">正在读取原始简历…</p>
            ) : savedChangesError ? (
              <p className="p-4 text-sm text-red-700">{savedChangesError}</p>
            ) : baseResumeData && resumeData ? (
              <AiResumeChangePreview original={baseResumeData} proposal={resumeData} />
            ) : null}
          </section>
        )}

        {/* JD, resume, and conversational editing stay in one working surface. */}
        <div
          className={`grid items-start gap-4 pb-4 ${
            isTailoredResume
              ? 'lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(32rem,1fr)_21rem]'
              : ''
          }`}
        >
          {isTailoredResume && (
            <aside className="no-print overflow-hidden border-2 border-black bg-white shadow-sw-default xl:sticky xl:top-4">
              <header className="border-b-2 border-black p-4">
                <p className="font-mono text-xs font-bold text-blue-700">岗位 JD</p>
                <h3 className="mt-2 font-serif text-xl font-semibold">
                  {jobContext?.title || '关联岗位'}
                </h3>
                <p className="mt-1 text-xs leading-5 text-steel-grey">
                  {[jobContext?.company, jobContext?.location, jobContext?.source]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {jobContext?.original_url && (
                  <a
                    href={jobContext.original_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-blue-700 underline"
                  >
                    查看原岗位 <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </header>
              <div className="max-h-[68vh] overflow-y-auto p-4">
                {jobContext ? (
                  <p className="whitespace-pre-wrap text-sm leading-7 text-ink-soft">
                    {jobContext.content}
                  </p>
                ) : jobContextError ? (
                  <p className="text-sm leading-6 text-red-800">
                    岗位 JD 暂时无法读取，请返回岗位列表重试。
                  </p>
                ) : (
                  <p className="text-sm text-steel-grey">正在加载岗位 JD…</p>
                )}
              </div>
            </aside>
          )}

          <div className="resume-print relative w-full overflow-hidden border-2 border-black bg-white shadow-sw-lg">
            {aiProposal && (
              <div className="no-print sticky top-0 z-20 flex items-center justify-between border-b-2 border-blue-700 bg-blue-50 px-4 py-3 text-sm text-blue-950">
                <span className="font-mono font-bold">AI 修改预览 · 尚未保存</span>
                <span className="text-xs">请在右侧选择“应用修改”或“放弃这次”</span>
              </div>
            )}
            {aiProposal && resumeData && (
              <AiResumeChangePreview original={resumeData} proposal={aiProposal} />
            )}
            {aiProposal ? (
              <Resume
                resumeData={aiProposal}
                additionalSectionLabels={{
                  technicalSkills: t('resume.additionalLabels.technicalSkills'),
                  languages: t('resume.additionalLabels.languages'),
                  certifications: t('resume.additionalLabels.certifications'),
                  awards: t('resume.additionalLabels.awards'),
                }}
                sectionHeadings={{
                  summary: t('resume.sections.summary'),
                  experience: t('resume.sections.experience'),
                  education: t('resume.sections.education'),
                  projects: t('resume.sections.projects'),
                  certifications: t('resume.sections.certifications'),
                  skills: t('resume.sections.skillsOnly'),
                  languages: t('resume.sections.languages'),
                  awards: t('resume.sections.awards'),
                  links: t('resume.sections.links'),
                }}
                fallbackLabels={{ name: t('resume.defaults.name') }}
              />
            ) : renderProfile.engine === 'rendercv' ? (
              <iframe
                key={`${renderProfile.template}-${previewRevision}`}
                title="专业简历 PDF 预览"
                src={`${getResumePdfPreviewUrl(resumeId, uiLanguage)}&revision=${previewRevision}`}
                className="h-[80vh] min-h-[720px] w-full bg-white"
              />
            ) : (
              <Resume
                resumeData={localizedResumeData || resumeData}
                additionalSectionLabels={{
                  technicalSkills: t('resume.additionalLabels.technicalSkills'),
                  languages: t('resume.additionalLabels.languages'),
                  certifications: t('resume.additionalLabels.certifications'),
                  awards: t('resume.additionalLabels.awards'),
                }}
                sectionHeadings={{
                  summary: t('resume.sections.summary'),
                  experience: t('resume.sections.experience'),
                  education: t('resume.sections.education'),
                  projects: t('resume.sections.projects'),
                  certifications: t('resume.sections.certifications'),
                  skills: t('resume.sections.skillsOnly'),
                  languages: t('resume.sections.languages'),
                  awards: t('resume.sections.awards'),
                  links: t('resume.sections.links'),
                }}
                fallbackLabels={{ name: t('resume.defaults.name') }}
              />
            )}
          </div>

          {isTailoredResume && (
            <div className="no-print xl:sticky xl:top-4">
              <AiResumeChat
                resumeId={resumeId}
                onProposalChange={setAiProposal}
                onApplied={(updatedResume) => {
                  setResumeData(updatedResume);
                  setPreviewRevision((current) => current + 1);
                  fetchResumeQuality(resumeId)
                    .then((report) => {
                      setQualityReport(report);
                      setQualityStatus('ready');
                    })
                    .catch(() => setQualityStatus('error'));
                }}
              />
            </div>
          )}
        </div>
      </div>

      {deleteDialogs}

      <ConfirmDialog
        open={showDownloadSuccessDialog}
        onOpenChange={setShowDownloadSuccessDialog}
        title="下载成功"
        description="PDF 简历已保存到下载目录。"
        confirmLabel="知道了"
        onConfirm={handleDownloadSuccessConfirm}
        variant="success"
        showCancelButton={false}
      />

      {/* Enrichment Modal - Only for master resume */}
      {isMasterResume && (
        <EnrichmentModal
          resumeId={resumeId}
          isOpen={showEnrichmentModal}
          onClose={() => setShowEnrichmentModal(false)}
          onComplete={handleEnrichmentComplete}
        />
      )}
    </div>
  );
}
