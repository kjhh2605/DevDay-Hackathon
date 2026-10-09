/** Explicit paid capability smoke; never imported by normal build/test or server startup. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { FeedbackItemSchema, strictToolDefinitions, toolSchemas } from '@devday/contracts';
import { z } from 'zod';
import { loadAiConfig } from './config.js';
import {
  AiProviderError,
  OpenAIProvider,
  pcm16ToWav,
  type ProviderAudit,
  type ProviderEvent,
  type ResponseInput,
} from './provider.js';
import { PROMPTS } from './prompts.js';
import {
  assessTranscriptionChecks,
  inspectTranscription,
  smokeProvenance,
} from './smoke-verification.js';

const runFile = promisify(execFile);
type SmokeResult = {
  capability: string;
  model: string;
  status: 'passed' | 'failed';
  durationMs: number;
  details?: unknown;
  error?: { code: string; status: number | null; requestId: string | null };
};

async function audioFixture(): Promise<{
  pcm: Uint8Array;
  turns: Uint8Array[];
  source: string;
  expectedText: string | null;
}> {
  const folder = await mkdtemp(join(tmpdir(), 'devday-openai-smoke-'));
  const normalize = async (source: string, target: string) => {
    await runFile('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-i',
      source,
      '-ac',
      '1',
      '-ar',
      '24000',
      '-acodec',
      'pcm_s16le',
      '-f',
      's16le',
      target,
    ]);
    return readFile(target);
  };
  try {
    if (process.env.OPENAI_SMOKE_AUDIO_PATH) {
      const pcm = await normalize(
        resolve(process.env.OPENAI_SMOKE_AUDIO_PATH),
        join(folder, 'recorded.pcm'),
      );
      return {
        pcm,
        turns: [pcm],
        source: 'provided-recording (microphone provenance must be confirmed manually)',
        expectedText: process.env.OPENAI_SMOKE_EXPECTED_TEXT || null,
      };
    }
    if (process.platform !== 'darwin')
      throw new Error(
        'Set OPENAI_SMOKE_AUDIO_PATH to a developer-made recording; automatic synthetic fixture requires macOS say and ffmpeg.',
      );
    const phrases = [
      { voice: 'Yuna', text: '어제 친구를 만났어요. Yesterday I go to a cafe with my friend.' },
      { voice: 'Yuna', text: 'The last word is human.' },
    ];
    const parts: Buffer[] = [];
    for (let index = 0; index < phrases.length; index++) {
      const phrase = phrases[index];
      const aiff = join(folder, `part-${index}.aiff`);
      await runFile('say', ['-v', phrase.voice, '-r', '155', '-o', aiff, phrase.text]);
      parts.push(await normalize(aiff, join(folder, `part-${index}.pcm`)));
    }
    const turns = parts;
    return {
      pcm: Buffer.concat(turns),
      turns,
      source:
        'synthetic macOS say single-voice Yuna fixture; NOT a real microphone acceptance test',
      expectedText: phrases.map((part) => part.text).join(' '),
    };
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

function safeError(error: unknown): {
  code: string;
  status: number | null;
  requestId: string | null;
} {
  const value = error as { code?: unknown; status?: unknown; name?: unknown; request_id?: unknown };
  // Never dump SDK errors, headers, request bodies, API keys or arbitrary provider messages.
  return {
    code:
      typeof value?.code === 'string'
        ? value.code
        : typeof value?.name === 'string'
          ? value.name
          : 'SMOKE_FAILED',
    status: typeof value?.status === 'number' ? value.status : null,
    requestId: typeof value?.request_id === 'string' ? value.request_id : null,
  };
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile('.env.local');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const config = loadAiConfig();
  const requestAudits: ProviderAudit[] = [];
  const provider = new OpenAIProvider(config, { onAudit: (audit) => requestAudits.push(audit) });
  const fixture = await audioFixture();
  const correctionContext = process.env.OPENAI_SMOKE_CONTEXT || '친구와 카페에서 나눈 대화';
  const wav = pcm16ToWav(fixture.pcm);
  const sourcePaths = [
    'smoke.ts',
    'smoke-verification.ts',
    'provider.ts',
    'config.ts',
    'prompts.ts',
  ];
  const runtimeSources = Object.fromEntries(
    await Promise.all(
      sourcePaths.map(async (path) => [
        `packages/ai/src/${path}`,
        await readFile(new URL(`./${path}`, import.meta.url), 'utf8'),
      ]),
    ),
  );
  const provenance = smokeProvenance({
    pcm: fixture.pcm,
    wav,
    turns: fixture.turns,
    livePrompt: PROMPTS.liveTranscriptionContext,
    correctionPrompt: `${PROMPTS.transcriptionContext}\n${correctionContext}`.trim(),
    runtimeSources,
    nodeVersion: process.version,
  });
  if (fixture.pcm.byteLength < 4_800 || fixture.pcm.byteLength % 2)
    throw new Error('Smoke audio must contain at least 100 ms of valid PCM16.');
  const reportPath = resolve(
    process.env.OPENAI_SMOKE_REPORT || '.local/validation/openai-smoke.json',
  );
  await mkdir(dirname(reportPath), { recursive: true });
  const audioPath = join(dirname(reportPath), 'openai-smoke-audio.wav');
  await writeFile(audioPath, wav);
  const availableCapabilities = [
    'live-transcription',
    'same-audio-correction',
    'responses-structured-and-tools',
    'image-generation',
  ];
  const selectedCapabilities =
    process.env.OPENAI_SMOKE_CAPABILITIES?.split(',') ?? availableCapabilities;
  if (
    !selectedCapabilities.length ||
    selectedCapabilities.some((name) => !availableCapabilities.includes(name))
  )
    throw new Error('Unknown OPENAI_SMOKE_CAPABILITIES.');
  console.log(
    'PAID OpenAI smoke: live transcription, same-audio file transcription, structured feedback + strict tool round-trip, image generation. Automatic retries: 0.',
  );
  console.log(`Selected capabilities: ${selectedCapabilities.join(', ')}`);
  console.log(`Audio source: ${fixture.source}`);

  const check = async (
    capability: string,
    model: string,
    execute: () => Promise<unknown>,
  ): Promise<SmokeResult | null> => {
    if (!selectedCapabilities.includes(capability)) return null;
    const started = performance.now();
    try {
      const details = await execute();
      const result: SmokeResult = {
        capability,
        model,
        status: 'passed',
        durationMs: Math.round(performance.now() - started),
        details,
      };
      console.log(`${capability}: passed (${result.durationMs} ms)`);
      return result;
    } catch (error) {
      const result: SmokeResult = {
        capability,
        model,
        status: 'failed',
        durationMs: Math.round(performance.now() - started),
        error: safeError(error),
      };
      console.log(`${capability}: failed (${result.error!.code}, ${result.durationMs} ms)`);
      return result;
    }
  };

  const results = await Promise.all([
    check('live-transcription', config.liveTranscribeModel, async () => {
      const started = performance.now();
      const events: Array<{ type: string; itemId: string | null; atMs: number }> = [];
      const transcripts = new Map<string, string>();
      const committed: string[] = [];
      let finish!: () => void;
      let fail!: (error: Error) => void;
      const done = new Promise<void>((resolveDone, rejectDone) => {
        finish = resolveDone;
        fail = rejectDone;
      });
      void done.catch(() => {});
      const timer = setTimeout(
        () =>
          fail(new AiProviderError('SMOKE_TRANSCRIPTION_TIMEOUT', 'No final transcript received.')),
        60_000 + fixture.pcm.byteLength / 48,
      );
      let connection: Awaited<ReturnType<OpenAIProvider['connectTranscription']>> | undefined;
      try {
        connection = await provider.connectTranscription({
          onEvent: (event: ProviderEvent) => {
            events.push({
              type: event.type,
              itemId: event.item_id || null,
              atMs: Math.round(performance.now() - started),
            });
            if (event.type === 'input_audio_buffer.committed' && event.item_id)
              committed.push(event.item_id);
            if (event.type === 'conversation.item.input_audio_transcription.failed')
              fail(new AiProviderError('TRANSCRIPTION_FAILED', 'Provider reported a failed item.'));
            if (
              event.type === 'conversation.item.input_audio_transcription.completed' &&
              event.item_id &&
              typeof event.transcript === 'string'
            ) {
              transcripts.set(event.item_id, event.transcript);
              if (transcripts.size === fixture.turns.length) finish();
            }
          },
          onError: fail,
        });
        const readyConnection = connection;
        await Promise.all([
          done,
          (async () => {
            for (const turn of fixture.turns) {
              for (let offset = 0; offset < turn.byteLength; offset += 4_800) {
                readyConnection.append(turn.subarray(offset, offset + 4_800));
                await delay(100);
              }
              readyConnection.commit();
            }
          })(),
        ]);
        if (
          committed.length !== fixture.turns.length ||
          committed.some((id) => !transcripts.get(id)?.trim())
        )
          throw new AiProviderError(
            'SMOKE_ITEM_MAPPING',
            'Commit and completion IDs did not match.',
          );
        const committedTranscripts = committed.map((itemId) => ({
          itemId,
          text: transcripts.get(itemId)!,
        }));
        const rawText = committedTranscripts.map(({ text }) => text).join('\n');
        return {
          rawText,
          committedTranscripts,
          events,
          commitCount: committed.length,
          firstDeltaMs: events.find((event) => event.type.endsWith('.delta'))?.atMs ?? null,
          ...inspectTranscription(committedTranscripts.map(({ text }) => text)),
        };
      } finally {
        clearTimeout(timer);
        connection?.close();
      }
    }),
    check('same-audio-correction', config.correctionModel, async () => {
      const correctedText = await provider.transcribe(fixture.pcm, correctionContext);
      return {
        correctedText,
        ...inspectTranscription([correctedText]),
      };
    }),
    check('responses-structured-and-tools', config.textModel, async () => {
      const schema = z.strictObject({ items: z.array(FeedbackItemSchema.omit({ id: true })) });
      const { $schema: _dialect, ...jsonSchema } = z.toJSONSchema(schema);
      const feedback = schema.parse(
        await provider.structured('sentence_feedback', jsonSchema, PROMPTS.feedback, {
          correctedText: 'Yesterday I go to a cafe.',
          correctionRevision: 0,
        }),
      );
      if (!feedback.items.length)
        throw new AiProviderError(
          'SMOKE_FEEDBACK_MISSING',
          'Expected feedback for the intentional past-tense error.',
        );
      const tools = strictToolDefinitions().filter((tool) => tool.name === 'get_study_context');
      const input: ResponseInput = [
        {
          role: 'system',
          content:
            'Call get_study_context once to retrieve the current study, then answer with its status. Do not invent the status or call the tool again once its result is available.',
        },
        { role: 'user', content: 'What is the current study status?' },
      ];
      const first = await provider.respond(input, tools);
      const calls = first.output.filter((item) => item.type === 'function_call');
      if (calls.length !== 1 || calls[0].name !== 'get_study_context')
        throw new AiProviderError(
          'SMOKE_TOOL_NOT_CALLED',
          'Expected a strict get_study_context tool call.',
        );
      toolSchemas.get_study_context.parse(JSON.parse(calls[0].arguments));
      // The SDK output union also includes computer-tool results, although this request only offers functions.
      input.push(...(first.output as ResponseInput), {
        type: 'function_call_output',
        call_id: calls[0].call_id,
        output: JSON.stringify({
          status: 'waiting',
          studyId: 'smoke-only-no-application-mutation',
        }),
      });
      const second = await provider.respond(input, tools);
      if (!second.outputText.trim() || second.output.some((item) => item.type === 'function_call'))
        throw new AiProviderError('SMOKE_TOOL_ROUNDTRIP', 'No final answer after the tool result.');
      return {
        feedbackItems: feedback.items.length,
        feedback,
        tool: calls[0].name,
        reasoningItemsPreserved: first.output.filter((item) => item.type === 'reasoning').length,
        reply: second.outputText,
      };
    }),
    check('image-generation', config.imageModel, async () => {
      const image = await provider.image(
        'An original everyday cafe scene for an adult English conversation practice: two adult friends at a small table talking over cups of coffee, natural daylight, clear spatial details, no text or logos.',
      );
      const imagePath = join(dirname(reportPath), 'openai-smoke-image.png');
      await writeFile(imagePath, image.bytes);
      return {
        contentType: image.contentType,
        byteLength: image.bytes.byteLength,
        sha256: createHash('sha256').update(image.bytes).digest('hex'),
        imagePath,
      };
    }),
  ]);

  const completedResults = results.filter((result): result is SmokeResult => result !== null);
  const transcriptionChecks = assessTranscriptionChecks(fixture.expectedText, completedResults);
  const report = {
    recordedAt: new Date().toISOString(),
    paidCalls: true,
    source: fixture.source,
    audioPath,
    expectedText: fixture.expectedText,
    audioDurationMs: Math.round(fixture.pcm.byteLength / 48),
    provenance,
    settings: {
      languages: ['ko', 'en'],
      delay: 'low',
      turnDetection: null,
      sampleRate: 24000,
      channels: 1,
      bitDepth: 16,
      maxRetries: 0,
      correctionChunkingStrategy: config.correctionChunkingStrategy,
      textTimeoutMs: config.textTimeoutMs,
      imageTimeoutMs: config.imageTimeoutMs,
    },
    realMicrophoneAcceptanceVerified: false,
    selectedCapabilities,
    allCapabilitiesIncluded: availableCapabilities.every((name) =>
      selectedCapabilities.includes(name),
    ),
    requiredQualityChecks: transcriptionChecks.requiredChecks,
    transcriptionCheckStatus: transcriptionChecks.status,
    transcriptionChecksPassed: transcriptionChecks.passed,
    transcriptionCheckReason: transcriptionChecks.reason,
    transcriptionCheckScope:
      'Only expected Korean presence, learner-grammar preservation and exact final word human in the last committed segment (or file transcript) are checked. Missing expected speech or supported markers is not_verified. This is not an exact-transcript accuracy score or real-microphone acceptance.',
    results: completedResults,
    requestAudits,
    passed:
      completedResults.every((result) => result.status === 'passed') &&
      (transcriptionChecks.status === 'passed' || transcriptionChecks.status === 'not_applicable'),
  };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Smoke report: ${reportPath}`);
  console.log(
    'Real microphones, accents, background noise, two physical laptops and LAN HTTPS still require the G3 acceptance run.',
  );
  if (!report.passed) process.exitCode = 1;
}

await main().catch((error: unknown) => {
  console.error(
    `OpenAI smoke could not start: ${JSON.stringify(safeError(error))}. Check local key, ffmpeg and the provided recording or macOS say.`,
  );
  process.exitCode = 1;
});
