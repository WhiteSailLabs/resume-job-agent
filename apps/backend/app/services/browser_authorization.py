"""Ephemeral, privacy-preserving browser authorization state for source adapters."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Literal

BrowserSource = Literal["boss", "liepin", "zhilian", "51job"]
_AUTH_TTL = timedelta(hours=8)


class BrowserAuthorizationRegistry:
    """Track only a user-confirmed source permission, never browser credentials.

    State intentionally stays in memory: restarting the local service requires
    a new visible browser authorization, rather than persisting login-adjacent
    state on disk.
    """

    def __init__(self) -> None:
        self._authorized_at: dict[str, datetime] = {}

    def mark_authorized(self, source: BrowserSource) -> dict[str, str | bool | None]:
        self._authorized_at[source] = datetime.now(timezone.utc)
        return self.get(source)

    def mark_not_connected(self, source: BrowserSource) -> dict[str, str | bool | None]:
        """Remove a prior authorization when visible controls show logout."""
        self._authorized_at.pop(source, None)
        return self.get(source)

    def get(self, source: str) -> dict[str, str | bool | None]:
        authorized_at = self._authorized_at.get(source)
        if authorized_at is None:
            return {"source": source, "status": "not_connected", "authorized_at": None, "expires_at": None}
        expires_at = authorized_at + _AUTH_TTL
        if datetime.now(timezone.utc) >= expires_at:
            self._authorized_at.pop(source, None)
            return {"source": source, "status": "expired", "authorized_at": None, "expires_at": None}
        return {
            "source": source,
            "status": "connected",
            "authorized_at": authorized_at.isoformat(),
            "expires_at": expires_at.isoformat(),
        }

    def list(self) -> list[dict[str, str | bool | None]]:
        return [self.get(source) for source in ("boss", "liepin", "zhilian", "51job")]

    def is_authorized(self, source: BrowserSource) -> bool:
        return self.get(source)["status"] == "connected"


browser_authorizations = BrowserAuthorizationRegistry()
