"""Task-local progress reporting for the resume-tailoring pipeline."""

from collections.abc import Awaitable, Callable
from contextvars import ContextVar, Token

ProgressReporter = Callable[[str, str], Awaitable[None]]
_reporter: ContextVar[ProgressReporter | None] = ContextVar("tailoring_progress", default=None)


def set_progress_reporter(reporter: ProgressReporter) -> Token:
    return _reporter.set(reporter)


def reset_progress_reporter(token: Token) -> None:
    _reporter.reset(token)


async def report_tailoring_progress(stage: str, detail: str) -> None:
    reporter = _reporter.get()
    if reporter is not None:
        await reporter(stage, detail)
