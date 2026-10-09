# Browser microphone capture

`createCaptureController` is the UI boundary. Call `startCapture(topicId)` from a user microphone action, `flush(closeId)` for that topic's `audio.flush_requested` event, and `stopCapture()` for explicit microphone release or leaving the study. Observe `onState` and catch promise rejections; `CaptureError.code` distinguishes permission, missing/busy devices, connection, protocol and provider failures.

```ts
import { createCaptureController } from '@devday/audio-client';

const capture = createCaptureController({ onState: (state) => renderMicrophoneState(state) });
await capture.startCapture(topic.id);
await capture.flush(closeId);
// After the next topic enters talking, reuse the already permitted microphone.
await capture.startCapture(nextTopic.id);
await capture.stopCapture();
```

The AudioWorklet reads the actual hardware rate and applies a band-limited resampler to 24 kHz mono PCM16. Frames are 100 ms, with 200 ms pre-roll, energy RMS threshold 0.015, 700 ms trailing silence, and a 20-second processing segment boundary. These are signal-processing settings, not a conversation duration limit. Outputs are silent and also pass through a zero-gain node; microphone sound is never played back or sent to another participant as a call.

Frames are held until `audio.segment_ready`, including the first word and pre-roll. A close first drains the worklet's partial final frame, commits the active segment, then sends `audio.flush` with the server segment ID and final sequence. Its promise resolves only after `audio.flushed`. Review stops collection and resets resampling/VAD state before the next topic. The controller retains the device after flush, while explicit stop ends its tracks. Failed connections are surfaced without reconnecting or replaying audio.

Every browser `audio.segment_start` includes `startedAt`: microphone capture-start time plus the VAD's sample offset, including pre-roll. Delayed frame delivery or server readiness does not shift the recorded capture time.

Validation:

- `pnpm exec vitest run --project unit packages/audio-client/src` covers signals, actual standalone worklet source, transmission ordering, final-word drain, review isolation, lifecycle and failures.
- `pnpm --filter @devday/audio-client typecheck` checks the package against shared contracts.
- `pnpm --filter @devday/audio-client test:browser` builds a minified production bundle and runs Chromium with a generated fake microphone. It verifies two topic streams, nonzero audio, review silence, permission reuse and track release. It uses the workspace's Vite and Playwright installations and requires Playwright Chromium.

The browser test mocks only the server protocol and uses generated sound. Physical microphones, room noise sensitivity, browser permissions on two laptops and OpenAI transcription quality still require the live G3 acceptance run.
