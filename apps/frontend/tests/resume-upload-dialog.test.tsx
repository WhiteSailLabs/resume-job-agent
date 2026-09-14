import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/use-file-upload', () => ({
  formatBytes: () => '431 KB',
  useFileUpload: () => [
    {
      files: [],
      isDragging: false,
      errors: [],
      isUploadingGlobal: false,
    },
    {
      getInputProps: () => ({ ref: vi.fn(), type: 'file' }),
      openFileDialog: vi.fn(),
      removeFile: vi.fn(),
      handleDragEnter: vi.fn(),
      handleDragLeave: vi.fn(),
      handleDragOver: vi.fn(),
      handleDrop: vi.fn(),
    },
  ],
}));

describe('ResumeUploadDialog', () => {
  it('keeps dialog actions inside a responsive grid instead of a single unwrappable row', () => {
    render(<ResumeUploadDialog open onOpenChange={vi.fn()} />);

    const actionArea = screen.getByLabelText('dashboard.uploadDialog.actionsLabel');
    expect(actionArea).toHaveClass('grid');
    expect(actionArea).not.toHaveClass('flex');

    const cancel = screen.getByRole('button', { name: 'common.cancel' });
    expect(cancel).toHaveClass('w-full');
  });
});
