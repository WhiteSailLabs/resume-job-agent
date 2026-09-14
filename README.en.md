# Resume Job Agent

> **Discover jobs → review JDs → create one grounded resume per role.** A local-first, human-in-the-loop AI workflow for job seekers in China.

[简体中文](README.md) · [Setup](SETUP.md) · [Contributing](.github/CONTRIBUTING.md) · [Security](.github/SECURITY.md)

Resume Job Agent connects the work that most resume tools leave fragmented: discovering real roles, reviewing full job descriptions, approving opportunities, tailoring a master resume without inventing facts, inspecting every change, and managing the resulting resumes.

If you want a job-search agent that **does not auto-apply, fabricate experience, or silently upload your data**, consider leaving a ⭐. It helps contributors discover the project.

## The problem

| Real-world friction | Typical workflow | Resume Job Agent |
| --- | --- | --- |
| Roles are scattered across job sites | Search and copy them one by one | Describe your goal once and review a unified queue |
| Every JD must be pasted into a chatbot | Process one role per chat | Store complete JDs and approve roles in batches |
| Resume “optimization” may invent claims | Optimize for keywords alone | Treat the master resume as the factual boundary |
| Generated files become unmanageable | Accumulate `resume-final-v3.pdf` files | Organize resumes by company, role, and version |
| AI changes are hard to audit | Replace the original text | Review red/blue diffs before accepting changes |
| Resumes and keys are highly sensitive | Store them on an unknown service | Keep data local and encrypt provider keys at rest |

## Workflow

```text
Master resume (source of truth)
        ↓
Describe a target role / paste a job URL
        ↓
Live job list → inspect full JD → batch approval
        ↓
Analyze JD → plan edits → factual consistency checks
        ↓
Generate one tailored resume per approved role
        ↓
Diff review → chat refinement → PDF export → resume library
```

## Implemented features

- Manage multiple source resumes and select one master resume.
- Discover roles from a natural-language request or import a job-detail URL.
- Review source, location, and full JD before batch approval.
- Run recoverable batch tailoring with visible progress and retries.
- Keep AI edits grounded in facts from the master resume.
- Inspect the tailoring plan, quality checks, and red/blue differences.
- Refine a generated resume through chat and export it as PDF.
- Manage tailored resumes and their versions in one library.
- Configure OpenAI-compatible LLM providers with encrypted local key storage.

## Source status

| Source | Status | Notes |
| --- | --- | --- |
| Job-detail URL import | ✅ Stable | The most reliable path; imports an explicit user-provided URL |
| BOSS Zhipin discovery | 🧪 Experimental | Uses a visible, user-authorized Chrome session; login or verification may be required |
| Liepin, Zhaopin, 51job | 🗓️ Planned | Adapter boundaries are reserved; the UI does not fabricate results |

The project does not bypass CAPTCHAs, security checks, login, or rate limits. It does not auto-apply or message recruiters.

## Quick start

Install Node.js 22+, [`uv`](https://docs.astral.sh/uv/), [`pnpm`](https://pnpm.io/installation), and Git. PDF export requires Chrome/Chromium. When the system Python is older, `uv` provisions Python 3.13 automatically.

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

Open <http://127.0.0.1:3000> and configure an LLM under **Settings**. See [SETUP.md](SETUP.md) for manual setup, Docker, ARK Agent Plan, and BOSS instructions.

## Product principles

1. **Humans stay in control.** Results are reviewed, edits are confirmed, and applications are never sent automatically.
2. **The master resume is the source of truth.** Rewriting is allowed; fabricated experience is not.
3. **Failures must be visible.** Login, verification, provider, and source failures are shown honestly.
4. **Local first.** Sensitive data should leave the device only when necessary for a user-requested model call.
5. **Build on mature open source.** Preserve proven editing, preview, and export capabilities instead of rebuilding them as a demo shell.

## Privacy and boundaries

- Resumes, JDs, generated files, and provider keys stay in the local data directory by default.
- Resume and JD content is sent only to the LLM provider selected by the user, and only for requested AI operations.
- BOSS integration reads visible pages from an explicitly authorized Chrome session; it does not export passwords or cookies.
- Authentication and multi-user isolation are not included yet. Do not expose the app directly to the public internet.
- Follow each job site's terms and applicable law.

## Open-source foundation

The product is built on [Resume Matcher](https://github.com/srbhr/Resume-Matcher), retaining its mature resume structure, editing, preview, and PDF capabilities. China job discovery is integrated through a thin adapter around [jobfindsme](https://github.com/russeell/jobfindsme). See [NOTICE](NOTICE) for attribution and modification details.

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

## Roadmap

- [ ] Improve BOSS connection stability and recovery after verification.
- [ ] Add more China job sources with honest per-source health states.
- [ ] Improve streaming search feedback, deduplication, and saved roles.
- [ ] Add a complete first-run experience and sample data.
- [ ] Enable public CI (a template is available at `docs/ci-workflow.example.yml`).

## Contributing

Code is only one way to help. Source adapters, resume-quality evaluation, product design, documentation, and testing are all valuable contributions.

- Found a bug? Open an [Issue](https://github.com/WhiteSailLabs/resume-job-agent/issues).
- Want to build something? Read the [contribution guide](.github/CONTRIBUTING.md).
- Like the direction? Leave a **Star** so more job seekers and contributors can find it.

Apache-2.0 License · Made for real-world job seekers, with humans in control.
