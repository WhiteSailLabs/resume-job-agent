# Setup

## Local one-command setup

Install Node.js 22+, [`uv`](https://docs.astral.sh/uv/), [`pnpm`](https://pnpm.io/installation), and Git. `uv` will provide Python 3.13 when needed. Then run:

```bash
git clone https://github.com/WhiteSailLabs/resume-job-agent.git
cd resume-job-agent
./scripts/start-local.sh
```

The first run installs dependencies and Playwright Chromium. Open <http://127.0.0.1:3000> and configure an LLM in **Settings**.

## Manual setup

Terminal 1:

```bash
cd apps/backend
uv sync --extra dev
uv run playwright install chromium
uv run uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Terminal 2:

```bash
cd apps/frontend
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1
```

## LLM configuration

The Settings page supports the upstream providers and OpenAI-compatible endpoints. For Volcengine ARK Agent Plan use:

- Provider: `OpenAI Compatible`
- Base URL: `https://ark.cn-beijing.volces.com/api/plan/v3`
- Model: `doubao-seed-evolving`
- API key: your own Agent Plan key

Never commit a key. Keys entered in Settings are encrypted under `apps/backend/data/`, which is ignored by Git.

## BOSS discovery (experimental)

The recommended reliable path is **Paste job link**. Automatic BOSS discovery is optional and may require login or security verification.

1. Open **Job discovery**.
2. Select **Connect BOSS**.
3. Sign in in the dedicated visible Chrome window if requested.
4. Return to the app after it reports **Connected**.
5. Start a search and keep the Chrome window visible while jobs stream into the list.

The adapter does not read passwords or export cookies, bypass CAPTCHA, auto-apply, or auto-message recruiters. If BOSS changes its page or blocks the session, use link import and open an issue with a redacted error description.

An unpacked alternative bridge is included in `apps/browser-bridge`; see its README. It is intended for contributors and defaults to the local ports above.

## Docker

```bash
docker compose up --build
```

Open <http://127.0.0.1:3000>. Docker supports the resume workflow and PDF export. The visible BOSS Chrome integration is a host-desktop feature and is not guaranteed inside Docker; use job-link import there.

To inject a provider key without putting it in the compose file:

```bash
LLM_PROVIDER=openai_compatible \
LLM_MODEL=doubao-seed-evolving \
LLM_API_BASE=https://ark.cn-beijing.volces.com/api/plan/v3 \
LLM_API_KEY_FILE=/absolute/path/to/a/read-only-secret \
docker compose up --build
```

## Data and reset

Local data lives under `apps/backend/data/`; Docker uses the `resume-data` volume. Back up that directory or volume before upgrading. Never attach it to a bug report because it may contain resumes, JDs, and encrypted provider credentials.

## Tests

```bash
cd apps/backend && uv sync --extra dev && uv run pytest
cd ../frontend && pnpm install --frozen-lockfile && pnpm test && pnpm typecheck && pnpm build
```
