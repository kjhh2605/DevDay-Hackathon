import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadEnvironment } from '../../apps/api/src/config.js';
import { createDatabase } from '../../apps/api/src/db/client.js';
import { migrate } from '../../apps/api/src/db/migrate.js';
import {
  AudioServerMessageSchema,
  EventServerMessageSchema,
  endpointRegistry,
  type AudioServerMessage,
  type EventServerMessage,
  type EndpointName,
  type EndpointInput,
  type EndpointOutput,
  type StudyCommand,
  type StudySnapshot,
  type User,
  type Job,
} from '../../packages/contracts/src/index.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = () => randomUUID();
const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
interface Socket extends EventEmitter {
  readyState: number;
  send(value: string): void;
  close(): void;
  terminate(): void;
}
const { WebSocket } = createRequire(resolve(root, 'apps/api/package.json'))('ws') as {
  WebSocket: new (url: string, options: { headers: Record<string, string> }) => Socket;
};
type EvidenceStep = {
  name: string;
  startedAt: string;
  durationMs?: number;
  status: 'running' | 'passed' | 'failed';
  details?: unknown;
  error?: string;
};

/** Real HTTP/WebSocket clients: cookies remain in memory and never enter evidence. */
export class ActorClient {
  cookie = '';
  user!: User;
  events: EventServerMessage[] = [];
  eventSocket: Socket | undefined;
  eventHooks = new Set<(message: EventServerMessage) => void>();
  constructor(
    readonly base: string,
    readonly origin: string,
  ) {}
  async call<K extends EndpointName>(
    name: K,
    input: EndpointInput<K>,
    params: Record<string, string> = {},
  ): Promise<EndpointOutput<K>> {
    const route = endpointRegistry[name];
    const path = route.path.replace(/:([a-zA-Z]+)/g, (_match, key: string) =>
      encodeURIComponent(params[key] ?? ''),
    );
    const response = await fetch(`${this.base}/api/v1${path}`, {
      method: route.method,
      headers: {
        origin: this.origin,
        cookie: this.cookie,
        ...(input === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(15_000),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0]!;
    const body = (await response.json()) as { data?: unknown; error?: { code?: string } };
    if (!response.ok)
      throw new Error(`${name}: HTTP ${response.status} ${body.error?.code ?? 'UNKNOWN'}`);
    return route.output.parse(body.data) as EndpointOutput<K>;
  }
  async openSocket(path: string): Promise<Socket> {
    const socket = new WebSocket(this.base.replace(/^http/, 'ws') + path, {
      headers: { cookie: this.cookie, origin: this.origin },
    });
    await new Promise<void>((done, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`WebSocket ${path} connection timed out`));
      }, 15_000);
      socket.once('open', () => {
        clearTimeout(timeout);
        done();
      });
      socket.once('error', () => {
        clearTimeout(timeout);
        reject(new Error(`WebSocket ${path} connection failed`));
      });
    });
    return socket;
  }
  async connectEvents() {
    this.eventSocket = await this.openSocket('/ws/events');
    this.eventSocket.on('message', (raw: Buffer) => {
      const message = EventServerMessageSchema.parse(JSON.parse(raw.toString()));
      if (message.type === 'heartbeat.ping')
        this.eventSocket?.send(JSON.stringify({ type: 'heartbeat.pong' }));
      else {
        this.events.push(message);
        for (const hook of this.eventHooks) hook(message);
      }
    });
  }
  async event(
    predicate: (event: EventServerMessage) => boolean,
    description: string,
    timeoutMs = 30_000,
  ) {
    return waitUntil(() => this.events.find(predicate), description, timeoutMs);
  }
  async subscribe(studyId: string) {
    this.eventSocket!.send(JSON.stringify({ type: 'study.subscribe', studyId }));
    return this.event(
      (event) => event.type === 'study.snapshot' && event.studyId === studyId,
      'study snapshot',
    );
  }
  snapshot(studyId: string) {
    return this.call('studySnapshot', undefined, { studyId });
  }
  async job(jobId: string, timeoutMs = 300_000): Promise<Job> {
    return waitUntil(
      async () => {
        const job = await this.call('job', undefined, { id: jobId });
        if (job.status === 'failed') throw new Error(`${job.kind} failed: ${job.error?.code}`);
        return job.status === 'succeeded' ? job : undefined;
      },
      `job ${jobId}`,
      timeoutMs,
      500,
    );
  }
  async command(studyId: string, type: StudyCommand['type'], focusUserId: string | null = null) {
    const { study } = await this.snapshot(studyId);
    const command = {
      type,
      commandId: id(),
      expectedTopicId: study.currentTopicId,
      expectedTransitionVersion: study.transitionVersion,
      ...(['study.start', 'topic.advance'].includes(type) ? { focusUserId } : {}),
    } as StudyCommand;
    return this.call('studyCommand', command, { studyId });
  }
  async chat(studyId: string, text: string) {
    const started = await this.call(
      'sendChatMessage',
      { text, clientMessageId: id() },
      { studyId },
    );
    const job = await this.job(started.job.id);
    assert.equal(job.kind, 'chat.respond');
    assert(job.kind === 'chat.respond' && job.result);
    const message = (await this.call('chatMessages', undefined, { studyId })).find(
      (item) => item.id === job.result!.messageId,
    );
    assert(message && message.status === 'succeeded');
    return message;
  }
}
async function waitUntil<T>(
  observe: () => T | undefined | Promise<T | undefined>,
  description: string,
  timeoutMs = 30_000,
  interval = 100,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = await observe();
    if (value !== undefined) return value;
    await pause(interval);
  }
  throw new Error(`Timed out observing ${description}`);
}
function pcmFromWav(wav: Buffer): Buffer {
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  let pcm: Buffer | undefined;
  let validFormat = false;
  for (let offset = 12; offset + 8 <= wav.length; ) {
    const kind = wav.toString('ascii', offset, offset + 4),
      size = wav.readUInt32LE(offset + 4),
      start = offset + 8;
    assert(start + size <= wav.length, 'Truncated WAV chunk');
    if (kind === 'fmt ')
      validFormat =
        wav.readUInt16LE(start) === 1 &&
        wav.readUInt16LE(start + 2) === 1 &&
        wav.readUInt32LE(start + 4) === 24_000 &&
        wav.readUInt16LE(start + 14) === 16;
    if (kind === 'data') pcm = wav.subarray(start, start + size);
    offset = start + size + (size % 2);
  }
  assert(
    validFormat && pcm?.length && pcm.length <= 1_200_000,
    'Use a <=25 second 24 kHz mono PCM16 WAV',
  );
  return pcm;
}

async function audioSegment(
  actor: ActorClient,
  studyId: string,
  pcm: Buffer,
  sockets: Set<Socket>,
) {
  const snapshot = await actor.snapshot(studyId);
  assert(snapshot.topic?.state === 'talking');
  const topicId = snapshot.topic.id,
    socket = await actor.openSocket('/ws/audio');
  sockets.add(socket);
  const messages: AudioServerMessage[] = [];
  socket.on('message', (raw: Buffer) => {
    const message = AudioServerMessageSchema.parse(JSON.parse(raw.toString()));
    if (message.type === 'heartbeat.ping') socket.send(JSON.stringify({ type: 'heartbeat.pong' }));
    else messages.push(message);
  });
  const audioMessage = <T extends AudioServerMessage['type']>(type: T) =>
    waitUntil(
      () => {
        const failure = messages.find((message) => message.type === 'audio.error');
        if (failure?.type === 'audio.error') throw new Error(`Audio failed: ${failure.error.code}`);
        return messages.find((message) => message.type === type) as
          | Extract<AudioServerMessage, { type: T }>
          | undefined;
      },
      type,
      90_000,
    );
  socket.send(
    JSON.stringify({
      type: 'audio.start',
      topicId,
      clientStreamId: id(),
      format: 'pcm16',
      sampleRate: 24_000,
      channels: 1,
    }),
  );
  const { streamId } = await audioMessage('audio.ready');
  const clientSegmentId = id();
  socket.send(JSON.stringify({ type: 'audio.segment_start', streamId, clientSegmentId }));
  const { segmentId } = await audioMessage('audio.segment_ready');
  let lastSeq = -1;
  for (let offset = 0; offset < pcm.length; offset += 24_000) {
    socket.send(
      JSON.stringify({
        type: 'audio.chunk',
        streamId,
        clientSegmentId,
        seq: ++lastSeq,
        pcmBase64: pcm.subarray(offset, offset + 24_000).toString('base64'),
      }),
    );
  }
  socket.send(JSON.stringify({ type: 'audio.segment_commit', streamId, clientSegmentId, lastSeq }));
  const flush = (event: EventServerMessage) => {
    if (event.type === 'audio.flush_requested' && event.entityId === streamId) {
      socket.send(
        JSON.stringify({
          type: 'audio.flush',
          streamId,
          closeId: event.payload.closeId,
          lastSegmentId: segmentId,
          lastSeq,
        }),
      );
    }
  };
  actor.eventHooks.add(flush);
  const segment = await waitUntil(
    async () => {
      const state = (await actor.snapshot(studyId)).segments.find((item) => item.id === segmentId);
      if (state?.rawStatus === 'failed' || state?.correctionStatus === 'failed')
        throw new Error('Stored audio transcript failed');
      return state?.rawStatus === 'ready' && state.correctionStatus === 'ready' ? state : undefined;
    },
    'live raw and correction',
    120_000,
    500,
  );
  assert.equal(segment.speakerUserId, actor.user.id);
  assert(segment.rawText && segment.correctedText);
  return {
    segment,
    flush: async () => {
      await audioMessage('audio.flushed');
      actor.eventHooks.delete(flush);
      socket.close();
      sockets.delete(socket);
    },
  };
}

export async function runLiveFlow() {
  const audioArgument = process.argv
    .find((arg) => arg.startsWith('--audio='))
    ?.slice('--audio='.length);
  assert(
    audioArgument,
    '--audio=/absolute/path/to/24k-mono-pcm16.wav is required; file/synthetic evidence never proves physical microphone acceptance.',
  );
  const wav = await readFile(resolve(audioArgument)),
    pcm = pcmFromWav(wav);
  const { env: loaded } = loadEnvironment();
  const databaseName = `devday_live_${Date.now()}`;
  const port = Number(process.env.LIVE_API_PORT ?? 4201),
    origin = `http://127.0.0.1:${port}`;
  const mediaDirectory = resolve(root, '.local/validation/live-media', databaseName);
  const evidencePath = resolve(root, '.local/validation/live-flow.json');
  const env: NodeJS.ProcessEnv = {
    ...loaded,
    AI_MODE: 'live',
    APP_ENV: 'local',
    NODE_ENV: 'test',
    DB_NAME: databaseName,
    PORT: String(port),
    API_HOST: '127.0.0.1',
    WEB_PORT: String(port),
    LOCAL_WEB_ORIGIN: origin,
    LOCAL_TLS_CERT: '',
    LOCAL_TLS_KEY: '',
    SESSION_COOKIE_SECURE: 'false',
    MEDIA_DRIVER: 'filesystem',
    MEDIA_LOCAL_DIR: mediaDirectory,
  };
  const config = loadConfig({ env });
  assert(config.openai.apiKey, 'OPENAI_API_KEY is required');
  const sourceFiles = [
    'apps/api/src/app.ts',
    'apps/api/src/features/ai/index.ts',
    'apps/api/src/domain/commands.ts',
    'apps/api/src/domain/speech.ts',
    'apps/api/src/domain/private.ts',
    'packages/ai/src/provider.ts',
    'packages/ai/src/speech.ts',
    'packages/ai/src/jobs.ts',
    'packages/ai/src/chat.ts',
    'packages/ai/src/prompts.ts',
    'tests/live/flow.ts',
  ];
  const sourceSha256 = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (path) => [
        path,
        createHash('sha256')
          .update(await readFile(resolve(root, path)))
          .digest('hex'),
      ]),
    ),
  );
  const steps: EvidenceStep[] = [];
  const evidence = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    result: 'running',
    environment: {
      databaseName,
      apiOrigin: origin,
      mediaDirectory,
      aiMode: 'live',
      models: {
        text: config.openai.textModel,
        raw: config.openai.liveTranscribeModel,
        correction: config.openai.correctionModel,
        image: config.openai.imageModel,
      },
    },
    sourceSha256,
    limitations: [
      'One physical laptop; two HTTP cookie clients and WebSocket clients.',
      'Audio source is a supplied file/synthetic sample, not either physical microphone.',
      'Language-presence assertions are not a subjective transcript-fidelity approval.',
      'No UI, LAN HTTPS/WSS, physical two-laptop or G2/G3 gate pass is claimed.',
    ],
    audio: {
      path: resolve(audioArgument),
      sha256: createHash('sha256').update(wav).digest('hex'),
      durationSeconds: pcm.length / 48_000,
    },
    steps,
  };
  await mkdir(resolve(root, '.local/validation'), { recursive: true });
  const save = () => writeFile(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  async function step<T>(name: string, execute: () => Promise<T>): Promise<T> {
    const start = Date.now(),
      item: EvidenceStep = { name, startedAt: new Date().toISOString(), status: 'running' };
    steps.push(item);
    await save();
    console.info(`LIVE start: ${name}`);
    try {
      const result = await execute();
      item.status = 'passed';
      item.details = result;
      return result;
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Unknown failure';
      throw error;
    } finally {
      item.durationMs = Date.now() - start;
      await save();
      console.info(`LIVE ${item.status}: ${name} (${item.durationMs}ms)`);
    }
  }
  let server: ChildProcess | undefined;
  const actors: ActorClient[] = [],
    sockets = new Set<Socket>();
  async function stopServer() {
    for (const actor of actors) {
      actor.eventSocket?.close();
      actor.eventSocket = undefined;
    }
    for (const socket of sockets) socket.close();
    sockets.clear();
    if (!server || server.exitCode !== null) return;
    const child = server;
    const ended = new Promise<void>((done) => child.once('exit', () => done()));
    child.kill('SIGTERM');
    const timeout = setTimeout(() => child.kill('SIGKILL'), 10_000);
    await ended;
    clearTimeout(timeout);
    server = undefined;
  }
  async function startServer() {
    server = spawn(process.execPath, ['--import', 'tsx', 'tests/live/server.ts'], {
      cwd: root,
      env,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    // Do not stream child stderr: provider transport diagnostics might include private request context.
    await new Promise<void>((done, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Live API child did not become ready')),
        30_000,
      );
      server!.once('message', () => {
        clearTimeout(timeout);
        done();
      });
      server!.once('exit', (code) => {
        clearTimeout(timeout);
        reject(new Error(`Live API child exited: ${code}`));
      });
      server!.once('error', () => {
        clearTimeout(timeout);
        reject(new Error('Live API child could not start'));
      });
    });
    const response = await fetch(`${origin}/readyz`);
    assert(response.ok);
  }
  const admin = await createDatabase(
    loadConfig({ env: { ...env, DB_NAME: loaded.DB_NAME ?? 'devday_study' } }),
  );
  let db: Awaited<ReturnType<typeof createDatabase>> | undefined;
  try {
    await step('isolated PostgreSQL migration and real API process', async () => {
      await admin.pool.query(`CREATE DATABASE "${databaseName}"`);
      db = await createDatabase(config);
      await migrate(db);
      await startServer();
      return { databaseName, processId: server!.pid, ready: true };
    });
    const a = new ActorClient(origin, origin),
      b = new ActorClient(origin, origin);
    actors.push(a, b);
    const suffix = Date.now().toString(36);
    await step('A01 distinct identities, duplicate rejection, private event sockets', async () => {
      a.user = await a.call('register', { displayName: '라이브 A', handle: `live_a_${suffix}` });
      b.user = await b.call('register', { displayName: '라이브 B', handle: `live_b_${suffix}` });
      assert.notEqual(a.user.id, b.user.id);
      assert.notEqual(a.cookie, b.cookie);
      await assert.rejects(
        new ActorClient(origin, origin).call('register', {
          displayName: '중복',
          handle: a.user.handle.toUpperCase(),
        }),
        /HANDLE_TAKEN/,
      );
      await Promise.all([a.connectEvents(), b.connectEvents()]);
      return { a: a.user.id, b: b.user.id, duplicateRejected: true };
    });
    const experience = await step(
      'A15/A16 live experience optional questions, skip, save, edit and reread',
      async () => {
        const originalText =
          '어제 친구와 부산 해변 근처 카페에 갔어요. 커피를 마시며 여행에 대해 이야기했어요.';
        const prepared = await a.call('prepareExperience', {
          originalText,
          answers: [],
          skipQuestions: false,
          commandId: id(),
        });
        const first = await a.job(prepared.id);
        assert(first.kind === 'experience.prepare' && first.result);
        const skipped = await a.call('prepareExperience', {
          originalText,
          answers: [],
          skipQuestions: true,
          commandId: id(),
        });
        const ready = await a.job(skipped.id);
        assert(ready.kind === 'experience.prepare' && ready.result);
        const draft = ready.result.draft;
        assert.equal(draft.questions.length, 0);
        assert(draft.summary);
        const fields = {
          originalText: draft.originalText,
          answers: draft.answers,
          summary: draft.summary,
          interests: draft.interests,
          context: draft.context,
        };
        const saved = await a.call('createExperience', {
          ...fields,
          draftId: draft.id,
          commandId: id(),
        });
        const edited = await a.call(
          'updateExperience',
          { ...fields, summary: originalText, commandId: id() },
          { id: saved.id },
        );
        assert.equal(edited.revision, saved.revision + 1);
        assert.deepEqual(await a.call('experiences', undefined), [edited]);
        assert.deepEqual(await b.call('experiences', undefined), []);
        return {
          experienceId: saved.id,
          ownerUserId: saved.ownerUserId,
          firstQuestionCount: first.result.draft.questions.length,
          skippedQuestionCount: draft.questions.length,
          revision: edited.revision,
        };
      },
    );
    const study = await step(
      'A02/A04 actual invitation delivery, join and shared snapshots',
      async () => {
        const created = await a.call('createStudy', {
          participantHandles: [b.user.handle],
          commandId: id(),
        });
        await b.event(
          (event) => event.type === 'invitation.created' && event.payload.studyId === created.id,
          'private invitation',
        );
        const joined = await b.call('joinStudy', { commandId: id() }, { studyId: created.id });
        assert.equal(joined.study.members.filter((member) => member.state === 'joined').length, 2);
        await Promise.all([a.subscribe(created.id), b.subscribe(created.id)]);
        assert.deepEqual(await a.snapshot(created.id), await b.snapshot(created.id));
        return { studyId: created.id };
      },
    );
    const studyId = study.studyId;
    // Inspection-only session material stays ignored and readable only by this OS user.
    await writeFile(
      resolve(root, '.local/validation/live-inspection-session.json'),
      JSON.stringify({
        databaseName,
        mediaDirectory,
        studyId,
        a: { user: a.user, cookie: a.cookie },
        b: { user: b.user, cookie: b.cookie },
      }),
      { mode: 0o600 },
    );
    const firstTopic = await step(
      'A17/A19/A25 first live experience image and authenticated bytes',
      async () => {
        const started = await b.command(studyId, 'study.start');
        assert(started.jobId);
        await a.job(started.jobId);
        const snapshot = await a.snapshot(studyId),
          topic = snapshot.topic;
        assert(topic?.content?.kind === 'image');
        assert(topic.content.sourceExperienceIds.includes(experience.experienceId));
        assert(topic.content.conversationInstruction);
        const response = await fetch(`${origin}/api/v1/media/${topic.content.imageMediaId}`, {
          headers: { cookie: b.cookie },
        });
        assert(response.ok);
        assert(response.headers.get('content-type')?.startsWith('image/'));
        const bytes = Buffer.from(await response.arrayBuffer());
        assert(bytes.length > 1024);
        await b.event(
          (event) =>
            event.type === 'study.changed' &&
            event.payload.topic?.id === topic.id &&
            event.payload.topic.state === 'talking',
          'topic ready on B',
        );
        assert.deepEqual(await a.snapshot(studyId), await b.snapshot(studyId));
        return {
          topicId: topic.id,
          mediaId: topic.content.imageMediaId,
          imageByteLength: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          content: topic.content,
        };
      },
    );
    const activeAudio: Awaited<ReturnType<typeof audioSegment>>[] = [];
    await step(
      'A06/A07/A08 FILE ONLY: two authenticated audio streams through real transcription and correction',
      async () => {
        activeAudio.push(await audioSegment(a, studyId, pcm, sockets));
        activeAudio.push(await audioSegment(b, studyId, pcm, sockets));
        const segments = activeAudio.map((item) => item.segment);
        for (const segment of segments) {
          if (/[가-힣]/u.test(segment.rawText ?? '') && /[a-z]{2,}/iu.test(segment.rawText ?? '')) {
            assert(
              /[가-힣]/u.test(segment.correctedText ?? '') &&
                /[a-z]{2,}/iu.test(segment.correctedText ?? ''),
              'MIXED_LANGUAGE_OMISSION: correction lost Korean or English that exists in the raw transcript; transport success is insufficient',
            );
          }
        }
        await b.event(
          (event) =>
            event.type === 'transcript.segment.updated' &&
            event.payload.id === segments[0]!.id &&
            event.payload.correctionStatus === 'ready',
          'A corrected segment on B',
        );
        assert.deepEqual(
          new Set(segments.map((segment) => segment.speakerUserId)),
          new Set([a.user.id, b.user.id]),
        );
        return {
          source: 'same supplied WAV replayed for both users; NOT physical microphones',
          segments,
        };
      },
    );
    let review!: StudySnapshot;
    await step('A10 live close flush, sentence segmentation and feedback', async () => {
      const close = await b.command(studyId, 'topic.close');
      assert(close.jobId);
      await b.job(close.jobId);
      await Promise.all(activeAudio.map((item) => item.flush()));
      review = await a.snapshot(studyId);
      assert.equal(review.topic?.state, 'review');
      assert(review.utterances.length >= 2);
      assert.equal(review.feedback.length, review.utterances.length);
      assert(review.feedback.every((feedback) => feedback.status === 'ready'));
      assert(review.utterances.every((utterance) => utterance.sourceRanges.length > 0));
      return {
        topicId: firstTopic.topicId,
        utteranceCount: review.utterances.length,
        feedbackCount: review.feedback.length,
        sources: review.utterances.map((utterance) => ({
          id: utterance.id,
          speakerUserId: utterance.speakerUserId,
          sourceRanges: utterance.sourceRanges,
        })),
      };
    });
    const editedUtterance = await step(
      'A11/A12 B edits A correction, stale feedback and live rerequest',
      async () => {
        const utterance =
          review.utterances.find(
            (item) =>
              item.speakerUserId === a.user.id && /Yesterday|cafe/i.test(item.correctedText),
          ) ?? review.utterances.find((item) => item.speakerUserId === a.user.id);
        assert(utterance);
        const edit = await b.call(
          'updateCorrection',
          { text: 'Yesterday I go to a cafe with my friend.', commandId: id() },
          { id: utterance.id },
        );
        assert.equal(edit.utterance.rawText, utterance.rawText);
        assert.equal(edit.utterance.speakerUserId, a.user.id);
        assert.equal(edit.feedback.status, 'stale');
        await a.event(
          (event) =>
            event.type === 'utterance.updated' &&
            event.payload.id === utterance.id &&
            event.payload.correctionRevision === edit.utterance.correctionRevision,
          'B edit received by A',
        );
        const feedback = await b.call(
          'requestFeedback',
          { correctionRevision: edit.utterance.correctionRevision, commandId: id() },
          { id: utterance.id },
        );
        await b.job(feedback.id);
        const latest = (await a.snapshot(studyId)).feedback.find(
          (item) => item.utteranceId === utterance.id,
        );
        assert(
          latest?.status === 'ready' &&
            latest.inputCorrectionRevision === edit.utterance.correctionRevision,
        );
        assert(latest.items.length > 0);
        return {
          utteranceId: utterance.id,
          speakerUserId: a.user.id,
          editorUserId: b.user.id,
          correctionRevision: edit.utterance.correctionRevision,
          feedbackItems: latest.items.length,
        };
      },
    );
    const sharing = await step(
      'A05/A21/A22/A23 real chat word/expression saving, no/pending/yes and privacy',
      async () => {
        const word = await a.chat(
          studyId,
          'serendipity 단어의 뜻을 설명하고 내 단어 기록에 저장해줘.',
        );
        assert(word.learningItemIds.length > 0);
        const no = await a.chat(
          studyId,
          '"양자컴퓨터의 오류율을 측정했어요"를 자연스러운 영어 표현으로 배우고 싶어. 표현 기록에 저장해줘.',
        );
        assert(no.shareProposalId);
        const declined = await a.call(
          'decideShareProposal',
          { accepted: false, commandId: id() },
          { id: no.shareProposalId },
        );
        assert.equal(declined.proposal.status, 'declined');
        const pending = await a.chat(
          studyId,
          '"오로라의 방출 스펙트럼을 분석했어요"를 영어로 어떻게 말해? 표현 기록에 저장해줘.',
        );
        assert(pending.shareProposalId);
        const yes = await a.chat(
          studyId,
          '"친구와 커피를 마시며 이야기를 나눴어요"를 자연스러운 영어 표현으로 배우고 싶어. 표현 기록에 저장해줘.',
        );
        assert(yes.shareProposalId);
        const accepted = await a.call(
          'decideShareProposal',
          { accepted: true, commandId: id() },
          { id: yes.shareProposalId },
        );
        assert(accepted.sharedExpression);
        const duplicate = await a.call(
          'decideShareProposal',
          { accepted: true, commandId: id() },
          { id: yes.shareProposalId },
        );
        assert.equal(duplicate.sharedExpression?.id, accepted.sharedExpression.id);
        assert.deepEqual(await b.call('chatMessages', undefined, { studyId }), []);
        assert.deepEqual(await b.call('learningItems', undefined), []);
        const shared = (await b.snapshot(studyId)).sharedExpressions;
        assert.deepEqual(
          shared.map((item) => item.id),
          [accepted.sharedExpression.id],
        );
        const personalMessageIds = (await a.call('chatMessages', undefined, { studyId })).map(
          (item) => item.id,
        );
        const bChatIds = b.events.flatMap((event) =>
          event.type === 'chat.message.updated' ? [event.payload.id] : [],
        );
        assert(!personalMessageIds.some((messageId) => bChatIds.includes(messageId)));
        assert(
          !b.events.some(
            (event) =>
              event.type === 'share-proposal.updated' &&
              [no.shareProposalId, pending.shareProposalId, yes.shareProposalId].includes(
                event.payload.id,
              ),
          ),
        );
        return {
          wordLearningItemIds: word.learningItemIds,
          declinedProposalId: no.shareProposalId,
          pendingProposalId: pending.shareProposalId,
          acceptedProposalId: yes.shareProposalId,
          sharedExpressionId: accepted.sharedExpression.id,
          privateMessagesExposedToB: 0,
        };
      },
    );
    const nextTopic = await step(
      'A13/A17/A20 natural-language next approves speaker learning and live next topic',
      async () => {
        const reply = await a.chat(studyId, '다음 주제로 넘어갈게');
        const next = reply.commandResults.find((result) => result.topicId !== firstTopic.topicId);
        assert(next?.jobId, 'Chat must execute advance_topic');
        await a.job(next.jobId);
        const snapshot = await b.snapshot(studyId);
        assert.equal(snapshot.topic?.ordinal, 2);
        assert(snapshot.topic?.content?.conversationInstruction);
        const aLearning = await a.call('learningItems', undefined),
          bLearning = await b.call('learningItems', undefined);
        assert(aLearning.some((item) => item.sourceUtteranceId === editedUtterance.utteranceId));
        assert(!bLearning.some((item) => item.sourceUtteranceId === editedUtterance.utteranceId));
        const row = (
          await db!.pool.query('SELECT generation_input FROM topics WHERE id=$1', [
            snapshot.topic.id,
          ])
        ).rows[0] as {
          generation_input: {
            sharedExpressions: { id: string }[];
            learningExpressions: { id: string; source: string }[];
          };
        };
        assert.deepEqual(
          row.generation_input.sharedExpressions.map((item) => item.id),
          [sharing.sharedExpressionId],
        );
        assert(
          row.generation_input.learningExpressions.length > 0 &&
            row.generation_input.learningExpressions.every(
              (item) => item.source === 'approved_feedback',
            ),
        );
        return {
          topicId: snapshot.topic.id,
          ordinal: snapshot.topic.ordinal,
          kind: snapshot.topic.content.kind,
          approvedSpeakerItemIds: aLearning
            .filter((item) => item.sourceUtteranceId === editedUtterance.utteranceId)
            .map((item) => item.id),
          sharedInputIds: row.generation_input.sharedExpressions.map((item) => item.id),
          feedbackInputCount: row.generation_input.learningExpressions.length,
        };
      },
    );
    await step(
      'A14/E08 final topic audio, first finish only reviews, second finish approves',
      async () => {
        const audio = await audioSegment(b, studyId, pcm, sockets);
        const close = await a.command(studyId, 'study.finish');
        assert(close.jobId);
        await b.job(close.jobId);
        await audio.flush();
        const reviewing = await a.snapshot(studyId);
        assert.equal(reviewing.study.status, 'active');
        assert.equal(reviewing.topic?.state, 'review');
        assert(
          reviewing.utterances.length > 0 &&
            reviewing.feedback.every((item) => item.status === 'ready'),
        );
        const finished = await b.command(studyId, 'study.finish');
        assert.equal(finished.jobId, null);
        const ended = await a.snapshot(studyId);
        assert.equal(ended.study.status, 'ended');
        const learning = await b.call('learningItems', undefined);
        const finalIds = new Set(reviewing.utterances.map((item) => item.id));
        assert(
          learning.some((item) => item.sourceUtteranceId && finalIds.has(item.sourceUtteranceId)),
        );
        return {
          topicId: nextTopic.topicId,
          status: ended.study.status,
          finalUtteranceCount: reviewing.utterances.length,
          finalLearningCount: learning.filter(
            (item) => item.sourceUtteranceId && finalIds.has(item.sourceUtteranceId),
          ).length,
        };
      },
    );
    await step(
      'A16/A24/E08 actual API process restart preserves sessions, experiences, learning and image bytes',
      async () => {
        const beforeA = await a.call('learningItems', undefined),
          beforeB = await b.call('learningItems', undefined),
          beforeExperiences = await a.call('experiences', undefined);
        const previousPid = server!.pid;
        await stopServer();
        await startServer();
        assert.notEqual(server!.pid, previousPid);
        assert.deepEqual(await a.call('me', undefined), a.user);
        assert.deepEqual(await b.call('me', undefined), b.user);
        assert.deepEqual(await a.call('learningItems', undefined), beforeA);
        assert.deepEqual(await b.call('learningItems', undefined), beforeB);
        assert.deepEqual(await a.call('experiences', undefined), beforeExperiences);
        assert.equal((await a.snapshot(studyId)).study.status, 'ended');
        const image = await fetch(`${origin}/api/v1/media/${firstTopic.mediaId}`, {
          headers: { cookie: a.cookie },
        });
        assert(image.ok);
        assert.equal(
          createHash('sha256')
            .update(Buffer.from(await image.arrayBuffer()))
            .digest('hex'),
          firstTopic.sha256,
        );
        const newStudy = await a.call('createStudy', { participantHandles: [], commandId: id() });
        assert.notEqual(newStudy.id, studyId);
        await a.command(newStudy.id, 'study.finish');
        return {
          previousPid,
          restartedPid: server!.pid,
          aLearningCount: beforeA.length,
          bLearningCount: beforeB.length,
          experienceCount: beforeExperiences.length,
          persistedImageSha256: firstTopic.sha256,
          newStudyId: newStudy.id,
        };
      },
    );
    evidence.result = 'passed_synthetic_product_integration_only';
  } catch (error) {
    evidence.result = 'failed';
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : 'Live product validation failed');
  } finally {
    await stopServer();
    await db?.close();
    await admin.close();
    evidence.finishedAt = new Date().toISOString();
    await save();
    console.info(`Live evidence: ${evidencePath}`);
  }
}
