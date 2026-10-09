# Live product integration (explicit paid opt-in)

Run from the workspace root after starting local PostgreSQL:

```sh
pnpm exec tsx scripts/validation/live-flow.ts --run --audio=/absolute/path/mixed.wav
```

The WAV must contain at most 25 seconds of 24 kHz mono PCM16 audio. The command loads server settings from `.env.local` with environment overrides; it never changes that file or prints credentials. Every run creates a dedicated `devday_live_<timestamp>` PostgreSQL database and media directory, starts a separate real API process on port 4201 (override `LIVE_API_PORT`), and uses normal HTTP/cookie/WebSocket product entry points. It neither installs a fake provider nor writes fixture domain rows. A read-only database query checks the immutable topic generation input.

It checks experience draft/skip/save/edit; distinct users and invitation/snapshot events; actual image bytes; supplied audio through `/ws/audio`, real raw transcription, correction, close/flush, sentence feedback, cross-user editing; private word/expression saving and no/pending/yes sharing; natural-language next with speaker-attributed approval; last-topic review/approval; and retrieval after terminating and starting the API process. No failed provider operation is automatically retried. Paid calls occur only with `--run`.

The incremental result is `.local/validation/live-flow.json`, including source hashes for subsequent runs. Dedicated databases/media remain for inspection and are not deleted automatically. Child-process logs and session cookies are not copied to evidence. The separate ignored `live-inspection-session.json` is mode 0600 and provides test sessions for local visual inspection; do not publish it. The full synthetic source transcripts may appear in the ignored evidence, so use non-private sample audio.

This command is one-laptop file/synthetic integration evidence. It does **not** establish physical microphones, two physical laptops, visual acceptance, LAN TLS/certificate trust, subjective speech fidelity, or G2/G3 completion. Those remain separate manual acceptance requirements.

To inspect the saved image in the real web app without regenerating it, run these in separate terminals, then load the test session from the mode 0600 inspection file into a disposable browser context:

```sh
pnpm exec tsx scripts/validation/inspect-live.ts
PORT=4202 WEB_PORT=5180 LOCAL_WEB_ORIGIN=http://127.0.0.1:5180 pnpm --filter @devday/web dev
```

The inspection API reuses only the dedicated database, never interrupts running jobs, and makes no provider calls on startup. Merely viewing the completed study is read-only.

After a successful primary run, targeted extra paid branches can reuse its test users/database without repeating audio or the full flow:

```sh
pnpm exec tsx scripts/validation/live-branches.ts --run
```

This starts its own API on 4203 and records `.local/validation/live-branches.json`: detailed experience with no follow-up questions; named participant generation that excludes an existing experience owned by the other participant; new users without experiences receiving a shared-expression sentence topic; and the second natural-language next phrase. Provider request IDs are recorded without credentials or request bodies. Named topics remain available for read-only visual inspection.

For a focused rerun after a relevant fix, `--only-detailed` records only `.local/validation/live-detailed-experience.json`, and `--only-named` records only `.local/validation/live-named-participant.json`. Neither repeats the primary audio flow. `--skip-detailed` runs named/sentence branches and labels the result as that limited scope.
