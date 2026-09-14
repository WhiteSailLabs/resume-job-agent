# Resume Job Agent

[简体中文](README.zh-CN.md) · [Setup](SETUP.md) · [Security](.github/SECURITY.md)

Resume Job Agent is a local-first workflow for discovering jobs, reviewing their job descriptions, tailoring a master resume with an LLM, and managing the generated resumes in one place.

It is built on [Resume Matcher](https://github.com/srbhr/Resume-Matcher). China job discovery is isolated behind a thin adapter powered by [jobfindsme](https://github.com/russeell/jobfindsme), so the mature resume editor, storage, preview, and PDF export remain the product foundation.

## What it does

1. Upload and manage multiple source resumes; choose one as the master resume.
2. Describe the job you want in one sentence, or paste a job-detail URL.
3. Review discovered jobs and their full JD before approving them.
4. Generate one tailored resume per approved job in a recoverable batch.
5. Inspect the AI plan and quality checks, then refine the resume in chat.
6. Preview changes in red/blue, confirm them, and export a PDF.

## Current source support

| Source | Status | Notes |
| --- | --- | --- |
| Job-detail URL import | Stable | Recommended path; imports one explicit link. |
| BOSS Zhipin discovery | Experimental | Uses a visible, user-authorized Chrome session. Login or verification may be required. |
| Liepin, Zhaopin, 51job | Planned | No fake results are returned; unavailable sources are shown honestly. |

The project does not bypass CAPTCHA, security verification, login, or rate limits. It does not auto-apply or auto-message recruiters.

## Quick start

Requirements: Python 3.13+, Node.js 22+, `uv`, `pnpm`, and Chrome/Chromium for PDF export.

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

Open <http://127.0.0.1:3000>. Configure an LLM from **Settings**; API keys are encrypted in the local data directory and are never committed.

For manual installation, Docker, ARK Agent Plan, and BOSS setup, see [SETUP.md](SETUP.md).

## Privacy

- Resumes, JDs, generated files, and provider keys stay in the local data directory.
- Resume/JD content is sent only to the LLM provider selected by the user.
- BOSS integration reads visible pages from a dedicated or explicitly authorized Chrome session; it never exports passwords or cookies.
- Do not expose this application directly to the public internet: authentication and multi-user isolation are not included yet.

## Development

```bash
# backend
cd apps/backend
uv sync --extra dev
uv run pytest

# frontend
cd apps/frontend
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

## Upstream and license

Resume Job Agent is an Apache-2.0 derivative of Resume Matcher. Job discovery uses the MIT-licensed jobfindsme package through a pinned dependency and adapter boundary. See [NOTICE](NOTICE) for attribution and revision details.

Contributions are welcome. Please read [CONTRIBUTING.md](.github/CONTRIBUTING.md) and report security issues according to [SECURITY.md](.github/SECURITY.md).
