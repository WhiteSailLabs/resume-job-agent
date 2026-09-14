import Link from 'next/link';
import { ResumePreviewProvider } from '@/components/common/resume_previewer_context';
import { StatusCacheProvider } from '@/lib/context/status-cache';
import { LanguageProvider } from '@/lib/context/language-context';
import { LocalizedErrorBoundary } from '@/components/common/error-boundary';

export default function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <StatusCacheProvider>
      <LanguageProvider>
        <ResumePreviewProvider>
          <LocalizedErrorBoundary>
            <main className="min-h-screen flex flex-col">
              <header className="border-b-2 border-black bg-background px-4 py-3 md:px-8">
                <div className="mx-auto flex w-full max-w-[104rem] flex-wrap items-center justify-between gap-3">
                  <Link
                    href="/jobs"
                    className="font-serif text-lg font-semibold uppercase tracking-tight hover:text-blue-700"
                  >
                    Resume Job Agent
                  </Link>
                  <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs font-bold uppercase">
                    <Link href="/resumes" className="hover:text-blue-700">
                      简历库
                    </Link>
                    <Link href="/jobs" className="hover:text-blue-700">
                      岗位发现
                    </Link>
                    <Link href="/settings" className="hover:text-blue-700">
                      设置
                    </Link>
                  </nav>
                </div>
              </header>
              {children}
            </main>
          </LocalizedErrorBoundary>
        </ResumePreviewProvider>
      </LanguageProvider>
    </StatusCacheProvider>
  );
}
