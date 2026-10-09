# Local browser integration

Run from the workspace root after `pnpm install`, `pnpm setup:local`, and `pnpm dev:services`:

```sh
pnpm exec playwright install chromium
pnpm test:e2e
```

The root script uses `tests/e2e/playwright.config.ts`. Its server runner creates a dedicated `${DB_NAME}_e2e` PostgreSQL database if absent (or `E2E_DB_NAME`, required to end in `_e2e`) and applies the checked-in migration and starts a separate API and Vite process with `AI_MODE=mock`. Default API/web ports are 4101/5174; override with `E2E_API_PORT`/`E2E_WEB_PORT`. It reads local PostgreSQL credentials from `.env.local` without printing them. Test image files use `.local/e2e-media`. Existing dev servers are never reused. The local PostgreSQL user needs CREATE DATABASE permission; the compose service provides it. The app startup sweep of interrupted jobs therefore cannot modify development or integration-test jobs.

Each test registers new UUID-suffixed accounts and uses independent browser contexts and cookies. It uses the real HTTP API, PostgreSQL, event WebSocket, and file media endpoint. No request interception, mock database, database truncation, or deletion of existing records is performed. Test records remain in the dedicated E2E database for failure diagnosis.

Covered browser behavior:

- Registration, duplicate handles, invitation received on the learning page, joined shared state, and context-required start.
- Optional experience questions skipped with entered answers preserved, sufficient-input direct review, reviewed text saved, original/summary/context edited, reload persistence, and owner isolation.
- Shared image topic and progress, both participants' controls, private word/expression storage and event scope, no/pending/yes decisions persisted across navigation, duplicate yes, accepted expression in the next topic, final finish, and persisted personal learning.
- Synthetic PCM sent through the actual audio WebSocket, two speaker-owned transcript/review rows, peer correction, current-revision feedback, concurrent next requests, speaker-owned approval saving, final review before finish, and learning source filters.

The audio scenario sends a generated 200 ms tone directly to `/ws/audio`; its transcript and feedback are labelled mock fixtures. It tests transport, persistence, scope, and review behavior. It does not use `getUserMedia` or assess the capture/VAD/resampling path.

These automated tests do **not** prove real OpenAI quality, real microphone capture, two physical laptops, LAN certificate trust, app/container restart persistence, or AWS behavior. Their passing result is evidence for the listed browser integration scenarios only; it cannot close G1/G2/G3 by itself. See `docs/implementation/acceptance.md` for the physical/live checks.

On failure Playwright writes a screenshot and trace under `test-results/e2e`. The HTML report is at `test-results/e2e-report`.

Passing route-state captures are written to `.local/validation/screenshots` for visual inspection; they contain only generated test accounts and fixture data.
