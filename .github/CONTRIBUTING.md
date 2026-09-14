# Contributing

Thank you for helping improve Resume Job Agent.

## Before opening a pull request

1. Open an issue for substantial product or architecture changes.
2. Keep Resume Matcher as the primary data/editor/rendering foundation.
3. Keep job sources behind the existing discovery adapter boundary; do not create a parallel resume database or editor.
4. Never commit real resumes, JDs, browser profiles, cookies, API keys, databases, or generated PDFs.
5. Do not bypass CAPTCHA, login, verification, or source-site rate limits.

## Local checks

```bash
cd apps/backend
uv sync --extra dev
uv run pytest

cd ../frontend
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm build
```

For user-visible changes, describe the complete journey you tested and include redacted screenshots when useful. Clearly distinguish a deterministic mock from a live source/LLM test.

By contributing, you agree that your contribution is licensed under Apache-2.0.
