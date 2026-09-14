# Job discovery upstream map

## Ownership boundary

- Primary application: Resume Matcher. It continues to own resume upload and
  versions, the job review queue, persistence, tailoring, editing, and export.
- Secondary capability: `russeell/jobfindsme` (MIT), pinned at
  `b775df3a70ce492b2bb7643a3051f00ecc2c2582`. It owns the isolated Chrome
  profile, CDP transport, China source adapters, and source degradation rules.

## Reused without replacement

- Resume Matcher's resume database, master-resume selection, generation task,
  editor, PDF renderer, and resume library remain the primary flow.
- jobfindsme's `~/.jobfindsme/chrome-profile`, CDP session, BOSS city codes,
  and same-origin BOSS list request are reused through a thin adapter.

## Integration seams

- `app/services/boss_browser.py` translates a user-authorized visible Chrome
  session into normalized BOSS list cards and full detail-page JD records.
- `app/services/job_discovery.py` combines those rows with jobfindsme's public
  sources and hands normalized rows to Resume Matcher's existing job database.
- `app/routers/jobs.py` gates BOSS work on live browser state, keeps a
  low-frequency search limit, and reads detail pages only for user-selected
  jobs immediately before tailoring.

## Dedicated Chrome recovery contract

- The BOSS profile is always `~/.jobfindsme/chrome-profile`; it must never be
  replaced with or copied from the user's everyday Chrome profile.
- A process left behind with `--no-startup-window` is not proof that a user can
  see the login page. When the CDP port is already running, the adapter requests
  a `--new-window` in that same isolated profile before reporting the window as
  opened.
- Restarting the dedicated Chrome invalidates the old CDP websocket. The
  adapter probes a cached connection before reuse and reconnects automatically
  instead of surfacing `socket is already closed` until the backend restarts.

## Explicit exclusions

- No automatic application, employer chat, mouse/keyboard simulation,
  credential or cookie extraction, CAPTCHA bypass, or background mass scrape.
- Browser Bridge remains only as legacy optional code and is not referenced by
  the active Job discovery UI or required by the backend flow.
