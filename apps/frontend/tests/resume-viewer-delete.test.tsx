import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ResumeViewerPage from '@/app/(default)/resumes/[id]/page';
import { fetchResume, deleteResume } from '@/lib/api/resume';

const push = vi.fn();
const decrementResumes = vi.fn();
const setHasMasterResume = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push }),
  useParams: () => ({ id: 'resume-123' }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/lib/i18n', () => {
  const translate = (key: string) => key;
  return { useTranslations: () => ({ t: translate }) };
});
vi.mock('@/lib/context/status-cache', () => ({
  useStatusCache: () => ({ decrementResumes, setHasMasterResume }),
}));
vi.mock('@/lib/context/language-context', () => ({
  useLanguage: () => ({ uiLanguage: 'en' }),
}));
vi.mock('@/components/enrichment/enrichment-modal', () => ({ EnrichmentModal: () => null }));
vi.mock('@/components/dashboard/resume-component', () => ({ default: () => null }));
vi.mock('@/components/resume/ai-resume-chat', () => ({ AiResumeChat: () => null }));
vi.mock('@/lib/api/resume', () => ({
  fetchResume: vi.fn(),
  fetchResumeQuality: vi.fn().mockResolvedValue(null),
  fetchJobDescription: vi.fn().mockResolvedValue({
    title: 'AI 产品经理',
    company: '示例公司',
    location: '上海',
    source: '企业官网',
    content: '负责 AI 产品规划。',
  }),
  deleteResume: vi.fn(),
  retryProcessing: vi.fn(),
  renameResume: vi.fn(),
  downloadResumePdf: vi.fn(),
  getResumePdfUrl: vi.fn(),
  getResumePdfPreviewUrl: vi.fn().mockReturnValue('/preview.pdf'),
}));

const mockedFetchResume = vi.mocked(fetchResume);
const mockedDeleteResume = vi.mocked(deleteResume);

describe('ResumeViewerPage — delete from the processing-failed error state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchResume.mockReset();
    localStorage.clear();
  });

  it('opens the confirm dialog and deletes the resume when processing has failed', async () => {
    // A resume whose processing failed: no processed_resume, status "failed".
    mockedFetchResume.mockResolvedValue({
      title: 'Broken Resume',
      raw_resume: { processing_status: 'failed' },
    } as Awaited<ReturnType<typeof fetchResume>>);
    mockedDeleteResume.mockResolvedValue(undefined);

    render(<ResumeViewerPage />);

    // The error card for a failed resume renders with the recovery actions.
    expect(await screen.findByText('resumeViewer.errors.processingFailed')).toBeInTheDocument();

    // Click "Delete & Start Over".
    fireEvent.click(screen.getByRole('button', { name: '删除这份简历' }));

    // The confirmation dialog must actually mount in the error state (regression).
    const confirmButton = await screen.findByRole('button', {
      name: '确认删除',
    });
    fireEvent.click(confirmButton);

    // The DELETE request is dispatched to the backend and the cache is updated.
    await waitFor(() => {
      expect(mockedDeleteResume).toHaveBeenCalledWith('resume-123');
      expect(decrementResumes).toHaveBeenCalledTimes(1);
    });

    // The success dialog appears and routes back to the dashboard. Scope to the
    // dialog because the error card also carries a "return to dashboard" button.
    await screen.findByText('resumeViewer.deletedTitle');
    const dialog = screen.getByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '返回简历库' }));
    expect(push).toHaveBeenCalledWith('/resumes');
  });
});

describe('ResumeViewerPage — saved tailoring changes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetchResume.mockReset();
    localStorage.clear();
  });

  it('shows the original-to-tailored differences inline without navigating away', async () => {
    const baseResume = {
      personalInfo: { name: '林舟' },
      summary: '负责企业产品规划。',
      workExperience: [],
      education: [],
      personalProjects: [],
      additional: {
        technicalSkills: ['需求分析'],
        languages: [],
        certificationsTraining: [],
        awards: [],
      },
    };
    const tailoredResume = {
      ...baseResume,
      summary: '负责 AI 产品规划与落地。',
    };

    mockedFetchResume
      .mockResolvedValueOnce({
        title: '示例公司｜AI 产品经理',
        parent_id: 'master-1',
        raw_resume: { processing_status: 'ready' },
        processed_resume: tailoredResume,
        render_profile: { engine: 'rendercv', template: 'rendercv-engineering' },
      } as unknown as Awaited<ReturnType<typeof fetchResume>>)
      .mockResolvedValueOnce({
        title: '主简历',
        parent_id: null,
        raw_resume: { processing_status: 'ready' },
        processed_resume: baseResume,
        render_profile: { engine: 'rendercv', template: 'rendercv-engineering' },
      } as unknown as Awaited<ReturnType<typeof fetchResume>>);

    render(<ResumeViewerPage />);

    fireEvent.click(await screen.findByRole('button', { name: '查看改动' }));

    expect(await screen.findByText('这份简历相对主简历改了什么')).toBeInTheDocument();
    expect(screen.getByText('负责企业产品规划。')).toBeInTheDocument();
    expect(screen.getByText('负责 AI 产品规划与落地。')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
