import { randomUUID, createHash } from 'node:crypto';
import type { Actor, ApplicationPorts } from '@devday/application-ports';
import {
  AudioClientMessageSchema,
  type AudioClientMessage,
  type AudioServerMessage,
  type TranscriptSegment,
  type SpeechGroup,
} from '@devday/contracts';
import type { AiProvider, ProviderEvent, RealtimeConnection } from './provider.js';
import { pcm16ToWav, AiProviderError } from './provider.js';
import { RealtimeSegmentMap } from './realtime-mapping.js';
import { publicAiError, withTimeout } from './jobs.js';
import { SpeechBoundary, MAX_GROUP_PCM_BYTES } from './speech-boundary.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}
interface PendingSegment {
  segment: TranscriptSegment;
  clientSegmentId: string;
  chunks: Uint8Array[];
  nextSeq: number;
  bytes: number;
  committed: boolean;
  rawReceived: boolean;
  failed: boolean;
  rawAttempt: number;
  partial: string;
  partialRevision: number;
  raw: ReturnType<typeof deferred<TranscriptSegment>>;
  done: Promise<void> | null;
  media: Promise<void> | null;
  group: PendingGroup | null;
  lastVoicedSample: number;
  hashes: string[];
}
interface PendingGroup {
  data: SpeechGroup;
  stream: InputStream;
  segments: PendingSegment[];
  boundary: SpeechBoundary;
  saves: Promise<void>;
  done: Promise<void> | null;
}
interface InputStream {
  id: string;
  clientStreamId: string;
  actor: Actor;
  topicId: string;
  studyId: string;
  context: string;
  previousContext: string;
  send: (message: AudioServerMessage) => void;
  provider: RealtimeConnection | null;
  segments: Map<string, PendingSegment>;
  byId: Map<string, PendingSegment>;
  mapping: RealtimeSegmentMap;
  active: PendingSegment | null;
  stopped: boolean;
  failedStream?: boolean;
  providerClosed: boolean;
  providerGeneration: number;
  providerStartedAt: number;
  closingId: string | null;
  flushed: ReturnType<typeof deferred<void>>;
  providerReady: ReturnType<typeof deferred<void>>;
  lastSegment: PendingSegment | null;
  eventChain: Promise<void>;
  group: PendingGroup | null;
  persistence: Promise<void>;
  work: Set<Promise<void>>;
  rotation?: ReturnType<typeof setTimeout>;
  rotating?: Promise<void>;
  disconnected?: ReturnType<typeof setTimeout>;
  connectionId: string;
  receipts: Map<string, { id: string; startOrder: number; nextSeq: number; hashes: string[] }>;
}

/** One provider stream per authenticated input. Never combines speakers' audio. */
export interface SpeechServiceOptions {
  confidence?: number;
  timeoutMs?: number;
  onDiagnostic?: (event: Record<string, string | number | null>) => void;
}
export class SpeechService {
  private shuttingDown = false;
  private readonly streams = new Map<string, InputStream>();
  private readonly closingTopics = new Set<string>();
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly provider: AiProvider,
    private readonly options: SpeechServiceOptions = {},
  ) {}

  createConnection(actor: Actor, send: (message: AudioServerMessage) => void) {
    let stream: InputStream | null = null;
    let disconnected = false;
    const connectionId = randomUUID();
    return {
      receive: async (unknownMessage: unknown): Promise<void> => {
        const message = AudioClientMessageSchema.parse(unknownMessage);
        if (message.type === 'heartbeat.ping') {
          send({ type: 'heartbeat.pong' });
          return;
        }
        if (message.type === 'heartbeat.pong') return;
        if (message.type === 'audio.start') {
          if (stream) throw new Error('STREAM_ALREADY_STARTED');
          stream = await this.start(actor, message, send, connectionId);
          if (disconnected && stream.connectionId === connectionId) {
            await this.failStream(stream, new Error('Audio client disconnected while connecting'));
            throw new Error('INPUT_CLOSED');
          }
          return;
        }
        if (!stream || message.streamId !== stream.id) throw new Error('INVALID_STREAM');
        if (stream.connectionId !== connectionId) throw new Error('SUPERSEDED_CONNECTION');
        await this.receive(stream, message);
      },
      disconnect: () => {
        disconnected = true;
        if (
          !stream ||
          stream.connectionId !== connectionId ||
          stream.providerClosed ||
          stream.stopped
        )
          return;
        const current = stream;
        current.disconnected = setTimeout(
          () => void this.failStream(current, new Error('Audio reconnect window expired')),
          15_000,
        );
        current.disconnected.unref?.();
      },
    };
  }

  private async start(
    actor: Actor,
    message: Extract<AudioClientMessage, { type: 'audio.start' }>,
    send: InputStream['send'],
    connectionId: string,
  ): Promise<InputStream> {
    const existing = [...this.streams.values()].find(
      (s) =>
        s.clientStreamId === message.clientStreamId &&
        s.actor.userId === actor.userId &&
        s.topicId === message.topicId,
    );
    if (existing) {
      if (existing.stopped || (message.resumeStreamId && message.resumeStreamId !== existing.id))
        throw new Error('INPUT_CLOSED');
      clearTimeout(existing.disconnected);
      existing.connectionId = connectionId;
      existing.send = send;
      await existing.providerReady.promise;
      send({ type: 'audio.ready', streamId: existing.id, topicId: existing.topicId });
      return existing;
    }
    if (message.resumeStreamId) throw new Error('RESUME_STREAM_EXPIRED');
    const snapshot = await this.ports.studies.getForTopic(actor, message.topicId);
    if (
      snapshot.topic?.id !== message.topicId ||
      snapshot.topic.state !== 'talking' ||
      this.closingTopics.has(message.topicId)
    )
      throw new Error('TOPIC_NOT_TALKING');
    if (
      [...this.streams.values()].some(
        (s) => s.actor.userId === actor.userId && s.topicId === message.topicId && !s.stopped,
      )
    )
      throw new Error('INPUT_ALREADY_OPEN');
    const stream: InputStream = {
      id: randomUUID(),
      clientStreamId: message.clientStreamId,
      actor,
      topicId: message.topicId,
      studyId: snapshot.study.id,
      context: [snapshot.topic.content?.title, snapshot.topic.content?.situationText]
        .filter(Boolean)
        .join('\n'),
      previousContext: (snapshot.segments ?? [])
        .filter((s) => s.rawStatus === 'ready')
        .slice(-3)
        .map((s) => s.rawText ?? '')
        .join('\n')
        .slice(-1000),
      send,
      provider: null,
      segments: new Map(),
      byId: new Map(),
      mapping: new RealtimeSegmentMap(),
      active: null,
      stopped: false,
      providerClosed: false,
      providerGeneration: 0,
      providerStartedAt: 0,
      closingId: null,
      flushed: deferred<void>(),
      providerReady: deferred<void>(),
      lastSegment: null,
      eventChain: Promise.resolve(),
      persistence: Promise.resolve(),
      group: null,
      work: new Set(),
      connectionId,
      receipts: new Map(),
    };
    this.streams.set(stream.id, stream);
    try {
      await this.openProvider(stream);
      stream.providerReady.resolve();
      this.scheduleRotation(stream);
      // A close may have frozen this stream while the provider was opening. Let the browser flush its empty buffer.
      send({ type: 'audio.ready', streamId: stream.id, topicId: stream.topicId });
      return stream;
    } catch (error) {
      stream.providerReady.reject(error);
      stream.stopped = true;
      stream.flushed.reject(error);
      this.streams.delete(stream.id);
      throw error;
    }
  }

  private async openProvider(stream: InputStream): Promise<void> {
    const generation = ++stream.providerGeneration;
    stream.providerClosed = false;
    stream.providerStartedAt = Date.now();
    stream.mapping = new RealtimeSegmentMap();
    const provider = await this.provider.connectTranscription({
      onEvent: (event) => {
        if (stream.providerGeneration !== generation) return;
        // Resolve identity synchronously before another browser segment can start.
        if (
          !event.item_id ||
          ![
            'input_audio_buffer.committed',
            'conversation.item.input_audio_transcription.delta',
            'conversation.item.input_audio_transcription.completed',
            'conversation.item.input_audio_transcription.failed',
          ].includes(event.type)
        )
          return;
        try {
          const segmentId = stream.mapping.resolve(event.item_id);
          stream.eventChain = stream.eventChain
            .then(() => this.providerEvent(stream, segmentId, event))
            .catch((error: unknown) => this.failStream(stream, error));
        } catch (error) {
          void this.failStream(stream, error);
        }
      },
      onError: (error) => {
        if (stream.providerGeneration === generation) void this.failStream(stream, error);
      },
      onClose: () => {
        if (stream.providerGeneration === generation && !stream.providerClosed)
          void this.failStream(stream, new Error('Provider input closed unexpectedly'));
      },
    });
    if (this.shuttingDown || stream.stopped || stream.providerGeneration !== generation) {
      provider.close();
      return;
    }
    stream.provider = provider;
  }

  private async receive(
    stream: InputStream,
    message: Exclude<
      AudioClientMessage,
      { type: 'audio.start' | 'heartbeat.ping' | 'heartbeat.pong' }
    >,
  ): Promise<void> {
    if (message.type === 'audio.stop') {
      if (stream.active) throw new Error('UNCOMMITTED_AUDIO');
      stream.stopped = true;
      stream.group?.boundary.close('mic_off');
      await Promise.all([...stream.work]);
      this.closeProvider(stream);
      stream.flushed.resolve();
      this.streams.delete(stream.id);
      return;
    }
    if (message.type === 'audio.flush') {
      if (stream.closingId !== message.closeId) throw new Error('UNREQUESTED_FLUSH');
      if (stream.active) throw new Error('UNCOMMITTED_AUDIO');
      const last = stream.lastSegment;
      if (
        (last?.segment.id ?? null) !== message.lastSegmentId ||
        (last ? last.nextSeq - 1 : null) !== message.lastSeq
      )
        throw new Error('INCOMPLETE_AUDIO_FLUSH');
      stream.group?.boundary.close('topic_close');
      await Promise.all([...stream.work]);
      await stream.eventChain;
      stream.stopped = true;
      this.closeProvider(stream);
      stream.send({ type: 'audio.flushed', streamId: stream.id, closeId: message.closeId });
      stream.flushed.resolve();
      return;
    }
    if (stream.stopped || stream.providerClosed) throw new Error('INPUT_CLOSED');
    if (message.type === 'audio.segment_start') {
      const prior = stream.segments.get(message.clientSegmentId);
      const receipt = stream.receipts.get(message.clientSegmentId);
      if (prior || receipt) {
        stream.send({
          type: 'audio.segment_ready',
          clientSegmentId: message.clientSegmentId,
          segmentId: prior?.segment.id ?? receipt!.id,
          startOrder: prior?.segment.startOrder ?? receipt!.startOrder,
        });
        return;
      }
      if (stream.active || stream.segments.has(message.clientSegmentId))
        throw new Error('SEGMENT_ALREADY_ACTIVE');
      stream.group?.boundary.start();
      if (
        stream.group &&
        stream.group.segments.reduce((n, s) => n + s.bytes, 0) > MAX_GROUP_PCM_BYTES - 20 * 48_000
      )
        stream.group.boundary.close('size_limit');
      // Idle rotation and a new segment share the same provider readiness barrier.
      if (stream.rotating) await stream.rotating;
      else if (Date.now() - stream.providerStartedAt >= 55 * 60_000)
        await this.rotateProvider(stream);
      // A closing stream may send a final buffered segment after the close notification.
      if (
        message.startedAt &&
        (Date.parse(message.startedAt) > Date.now() + 30_000 ||
          Date.parse(message.startedAt) < Date.now() - 300_000)
      )
        throw new Error('INVALID_CAPTURE_TIMESTAMP');
      const segment = await this.ports.speech.begin(stream.actor, {
        topicId: stream.topicId,
        clientStreamId: stream.clientStreamId,
        clientSegmentId: message.clientSegmentId,
        startedAt: message.startedAt ?? new Date().toISOString(),
      });
      const pending: PendingSegment = {
        segment,
        clientSegmentId: message.clientSegmentId,
        chunks: [],
        nextSeq: 0,
        bytes: 0,
        committed: false,
        rawReceived: false,
        failed: false,
        rawAttempt: 0,
        partial: '',
        partialRevision: 0,
        raw: deferred<TranscriptSegment>(),
        done: null,
        media: null,
        group: null,
        lastVoicedSample: 0,
        hashes: [],
      };
      stream.segments.set(message.clientSegmentId, pending);
      stream.byId.set(segment.id, pending);
      stream.active = pending;
      stream.lastSegment = pending;
      stream.mapping.begin(segment.id);
      this.attachGroup(stream, pending);
      await pending.group!.saves;
      stream.send({
        type: 'audio.segment_ready',
        clientSegmentId: message.clientSegmentId,
        segmentId: segment.id,
        startOrder: segment.startOrder,
      });
      return;
    }
    const receipt = stream.receipts.get(message.clientSegmentId);
    if (receipt) {
      if (
        message.type === 'audio.chunk' &&
        (message.seq >= receipt.nextSeq ||
          createHash('sha256').update(Buffer.from(message.pcmBase64, 'base64')).digest('hex') !==
            receipt.hashes[message.seq])
      )
        throw new Error('REPLAY_MISMATCH');
      if (message.type === 'audio.segment_commit') {
        if (message.lastSeq !== receipt.nextSeq - 1) throw new Error('REPLAY_MISMATCH');
        stream.send({
          type: 'audio.segment_committed',
          clientSegmentId: message.clientSegmentId,
          segmentId: receipt.id,
          lastSeq: message.lastSeq,
        });
      }
      return;
    }
    const pending = stream.segments.get(message.clientSegmentId);
    if (pending && message.type === 'audio.chunk' && message.seq < pending.nextSeq) {
      if (
        createHash('sha256').update(Buffer.from(message.pcmBase64, 'base64')).digest('hex') !==
        pending.hashes[message.seq]
      )
        throw new Error('REPLAY_MISMATCH');
      return;
    }
    if (pending?.committed && message.type === 'audio.segment_commit') {
      if (message.lastSeq !== pending.nextSeq - 1) throw new Error('REPLAY_MISMATCH');
      await pending.media;
      stream.send({
        type: 'audio.segment_committed',
        clientSegmentId: pending.clientSegmentId,
        segmentId: pending.segment.id,
        lastSeq: message.lastSeq,
      });
      return;
    }
    if (!pending || stream.active !== pending || pending.committed)
      throw new Error('SEGMENT_NOT_ACTIVE');
    if (message.type === 'audio.chunk') {
      if (message.seq !== pending.nextSeq) throw new Error('AUDIO_SEQUENCE_GAP');
      const pcm = Buffer.from(message.pcmBase64, 'base64');
      if (
        !pcm.byteLength ||
        pcm.byteLength % 2 !== 0 ||
        pcm.byteLength > 48_000 ||
        pending.bytes + pcm.byteLength > 960_000
      )
        throw new Error('INVALID_PCM');
      pending.hashes.push(createHash('sha256').update(pcm).digest('hex'));
      pending.chunks.push(pcm);
      pending.bytes += pcm.byteLength;
      pending.nextSeq += 1;
      stream.provider!.append(pcm);
      return;
    }
    if (message.lastSeq !== pending.nextSeq - 1 || !pending.bytes)
      throw new Error('INCOMPLETE_SEGMENT');
    const lastVoicedSample = message.lastVoicedSample ?? pending.bytes / 2;
    if (lastVoicedSample > pending.bytes / 2 || pending.bytes / 2 - lastVoicedSample > 24_000)
      throw new Error('INVALID_ACTIVITY_OFFSET');
    this.options.onDiagnostic?.({
      stage: 'commit',
      streamId: stream.id,
      segmentId: pending.segment.id,
      trailingSilenceMs: (pending.bytes / 2 - lastVoicedSample) / 24,
      captureArrivalAgeMs: Date.now() - Date.parse(pending.segment.startedAt) - pending.bytes / 48,
    });
    pending.lastVoicedSample = lastVoicedSample;
    pending.committed = true;
    stream.active = null;
    stream.mapping.commit(pending.segment.id);
    stream.provider!.commit();
    pending.media = this.ports.media
      .put({
        kind: 'audio',
        studyId: stream.studyId,
        segmentId: pending.segment.id,
        bytes: pcm16ToWav(Buffer.concat(pending.chunks)),
        contentType: 'audio/wav',
      })
      .then(() => {
        pending.chunks = [];
        stream.send({
          type: 'audio.segment_committed',
          clientSegmentId: pending.clientSegmentId,
          segmentId: pending.segment.id,
          lastSeq: pending.nextSeq - 1,
        });
      });
    void pending.media.catch(() => undefined);
    pending.group!.boundary.end((pending.bytes / 2 - lastVoicedSample) / 24);
    pending.done = this.finishRaw(stream, pending);
    void pending.done.catch(() => undefined);
    if (pending.group!.segments.reduce((n, p) => n + p.bytes, 0) >= MAX_GROUP_PCM_BYTES)
      pending.group!.boundary.close('size_limit');
  }

  private async providerEvent(
    stream: InputStream,
    segmentId: string,
    event: ProviderEvent,
  ): Promise<void> {
    const pending = stream.byId.get(segmentId);
    if (!pending || pending.failed || pending.rawReceived || pending.rawAttempt > 0) return;
    if (event.type === 'conversation.item.input_audio_transcription.failed') {
      pending.raw.reject(
        new AiProviderError(
          event.error?.code ?? 'RAW_TRANSCRIPTION_FAILED',
          'Provider transcription failed',
        ),
      );
      return;
    }
    if (
      event.type === 'conversation.item.input_audio_transcription.delta' &&
      typeof event.delta === 'string'
    ) {
      pending.partial += event.delta;
      pending.partialRevision += 1;
      await this.ports.events.toStudy(stream.studyId, {
        version: 1,
        eventId: randomUUID(),
        type: 'transcript.partial',
        scope: 'study',
        studyId: stream.studyId,
        entityId: pending.segment.id,
        entityRevision: pending.partialRevision,
        occurredAt: new Date().toISOString(),
        payload: {
          segmentId: pending.segment.id,
          speakerUserId: stream.actor.userId,
          startOrder: pending.segment.startOrder,
          partialText: pending.partial,
          partialRevision: pending.partialRevision,
        },
      });
    }
    if (
      event.type === 'conversation.item.input_audio_transcription.completed' &&
      typeof event.transcript === 'string'
    ) {
      const endedAt = new Date(
        Date.parse(pending.segment.startedAt) + Math.round(pending.lastVoicedSample / 24),
      ).toISOString();
      const updated = await this.ports.speech.completeRaw(segmentId, {
        text: event.transcript,
        endedAt,
      });
      pending.rawReceived = true;
      pending.segment = updated;
      pending.raw.resolve(updated);
    }
  }

  private attachGroup(stream: InputStream, pending: PendingSegment) {
    let group = stream.group;
    if (!group) {
      const segment = pending.segment;
      group = {
        stream,
        data: {
          id: randomUUID(),
          revision: 0,
          studyId: stream.studyId,
          topicId: stream.topicId,
          speakerUserId: stream.actor.userId,
          startOrder: segment.startOrder,
          segmentIds: [segment.id],
          rawRevisions: [],
          rawText: '',
          correctedText: null,
          state: 'collecting',
          startedAt: segment.startedAt,
          endedAt: null,
          closeReason: null,
          attemptId: randomUUID(),
          error: null,
        },
        segments: [],
        saves: Promise.resolve(),
        done: null,
        boundary: null as unknown as SpeechBoundary,
      };
      const current = group;
      group.boundary = new SpeechBoundary({
        ...this.options,
        decide: async (text, silenceMs, signal) => {
          const began = performance.now();
          const result = await this.provider.decideSpeech(
            { text, context: stream.context, previousContext: stream.previousContext, silenceMs },
            signal,
          );
          this.options.onDiagnostic?.({
            stage: 'decision',
            streamId: stream.id,
            groupId: current.data.id,
            revision: current.data.revision,
            choice: result.choice,
            confidence: result.confidence,
            silenceMs,
            elapsedMs: Math.round(performance.now() - began),
          });
          return result;
        },
        onDeciding: () => {
          current.data.state = 'deciding';
          this.saveGroup(current);
        },
        freeze: (reason) => {
          if (stream.group === current) stream.group = null;
          this.options.onDiagnostic?.({
            stage: 'freeze',
            streamId: stream.id,
            groupId: current.data.id,
            revision: current.data.revision,
            reason,
          });
          current.data.closeReason = reason;
          current.data.state = 'correcting';
          this.saveGroup(current);
          current.done = this.finishGroup(stream, current);
          stream.work.add(current.done);
          void current.done
            .finally(() => {
              stream.work.delete(current.done!);
              if (stream.stopped && !stream.work.size) this.streams.delete(stream.id);
            })
            .catch(() => undefined);
        },
      });
      stream.group = group;
      this.saveGroup(group, true);
    } else {
      group.data.segmentIds.push(pending.segment.id);
      group.data.state = 'collecting';
      this.saveGroup(group);
    }
    group.segments.push(pending);
    pending.group = group;
    group.boundary.start();
  }
  private saveGroup(group: PendingGroup, create = false) {
    const expected = create ? null : group.data.revision++;
    const data = structuredClone(group.data);
    group.saves = group.stream.persistence.then(async () => {
      if (!(await this.ports.speech.saveGroup(data, expected)))
        throw new Error('SPEECH_GROUP_REVISION_EXPIRED');
    });
    group.stream.persistence = group.saves;
    void group.saves.catch(() => undefined);
  }
  private refreshRaw(group: PendingGroup) {
    const ordered = group.segments;
    group.data.rawText = ordered.map((p) => p.segment.rawText ?? '').join('\n');
    group.data.rawRevisions = ordered.map((p) => p.segment.rawRevision ?? p.segment.revision);
    group.data.endedAt = ordered.at(-1)?.segment.endedAt ?? null;
    this.saveGroup(group);
    if (ordered.every((p) => p.rawReceived && p.committed))
      group.boundary.text(group.data.rawText, group.data.revision);
  }
  private async finishRaw(stream: InputStream, pending: PendingSegment): Promise<void> {
    try {
      await withTimeout(pending.raw.promise, 60_000);
      await pending.media;
      this.refreshRaw(pending.group!);
    } catch (error) {
      if (this.shuttingDown) return;
      pending.failed = true;
      this.options.onDiagnostic?.({
        stage: 'raw_failed',
        streamId: stream.id,
        segmentId: pending.segment.id,
        providerCode: diagnosticErrorCode(error),
      });
      await this.ports.speech.fail(pending.segment.id, 'raw', publicAiError(error));
      pending.group!.boundary.close('silence_timeout');
      stream.send({
        type: 'audio.processing_error',
        groupId: pending.group!.data.id,
        segmentId: pending.segment.id,
        error: publicAiError(error),
      });
      throw error;
    }
  }
  private async pcm(pending: PendingSegment) {
    await pending.media;
    if (pending.chunks.length) return Buffer.concat(pending.chunks);
    const wav = Buffer.from(await this.ports.media.readSegmentAudio(pending.segment.id));
    if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.length < 44)
      throw new Error('INVALID_STORED_AUDIO');
    return wav.subarray(44);
  }
  private async finishGroup(stream: InputStream, group: PendingGroup) {
    try {
      await Promise.all(group.segments.map((p) => p.done));
      await group.saves;
      // Frozen membership is immutable even when raw transcription misses the silence deadline.
      group.data.rawText = group.segments.map((p) => p.segment.rawText ?? '').join('\n');
      group.data.rawRevisions = group.segments.map(
        (p) => p.segment.rawRevision ?? p.segment.revision,
      );
      group.data.endedAt = group.segments.at(-1)?.segment.endedAt ?? null;
      if (!group.data.rawText.trim()) {
        group.data.state = 'no_speech';
        group.data.correctedText = '';
      } else {
        const pcm = Buffer.concat(await Promise.all(group.segments.map((p) => this.pcm(p))));
        const corrected = await withTimeout(this.provider.transcribe(pcm, stream.context), 60_000);
        if (this.shuttingDown) return;
        group.data.correctedText = corrected;
        group.data.state = 'ready';
      }
      this.saveGroup(group);
      await group.saves;
      if (group.data.state === 'ready') stream.previousContext = group.data.rawText.slice(-1000);
    } catch (error) {
      if (this.shuttingDown) return;
      group.data.state = 'failed';
      group.data.error = {
        phase: group.segments.some((p) => !p.rawReceived) ? 'raw' : 'correction',
        ...publicAiError(error),
      };
      // Public error DTO has details; group errors deliberately contain only sanitized diagnostics.
      this.options.onDiagnostic?.({
        stage: 'group_failed',
        providerCode: diagnosticErrorCode(error),
        streamId: stream.id,
        groupId: group.data.id,
        revision: group.data.revision,
        code: group.data.error.code,
        phase: group.data.error.phase,
      });
      const { phase, code, message } = group.data.error;
      group.data.error = { phase, code, message };
      this.saveGroup(group);
      await group.saves;
      stream.send({
        type: 'audio.processing_error',
        groupId: group.data.id,
        segmentId: null,
        error: publicAiError(error),
      });
    } finally {
      for (const p of group.segments) {
        p.chunks = [];
        stream.receipts.set(p.clientSegmentId, {
          id: p.segment.id,
          startOrder: p.segment.startOrder,
          nextSeq: p.nextSeq,
          hashes: p.hashes,
        });
        if (stream.receipts.size > 64) stream.receipts.delete(stream.receipts.keys().next().value!);
        stream.segments.delete(p.clientSegmentId);
        stream.byId.delete(p.segment.id);
      }
      if (stream.stopped && !stream.work.size) this.streams.delete(stream.id);
    }
  }
  async retry(actor: Actor, topicId: string, groupId: string): Promise<SpeechGroup> {
    const snapshot = await this.ports.studies.getForTopic(actor, topicId);
    if (snapshot.topic?.id !== topicId || !['talking', 'closing'].includes(snapshot.topic.state))
      throw new Error('TOPIC_NOT_TALKING');
    const group = (await this.ports.speech.listGroups(topicId)).find(
      (g) => g.id === groupId && g.speakerUserId === actor.userId,
    );
    if (!group) throw new Error('SPEECH_GROUP_NOT_FOUND');
    if (group.state === 'failed')
      await this.retryGroup(group, snapshot.topic.content?.situationText ?? '');
    return (await this.ports.speech.listGroups(topicId)).find((g) => g.id === groupId)!;
  }
  private async retryGroup(group: SpeechGroup, context: string) {
    const segments = (await this.ports.speech.listSegments(group.topicId)).filter((s) =>
      group.segmentIds.includes(s.id),
    );
    const expected = group.revision;
    group = {
      ...group,
      revision: expected + 1,
      state: 'correcting',
      error: null,
      attemptId: randomUUID(),
    };
    if (!(await this.ports.speech.saveGroup(group, expected))) return;
    try {
      const pcm: Buffer[] = [];
      for (const segment of segments) {
        const wav = Buffer.from(await this.ports.media.readSegmentAudio(segment.id));
        const bytes = wav.subarray(44);
        pcm.push(bytes);
        if (segment.rawStatus !== 'ready') {
          const raw = deferred<string>();
          const connection = await this.provider.connectTranscription({
            onError: raw.reject,
            onEvent: (event) => {
              if (
                event.type === 'conversation.item.input_audio_transcription.completed' &&
                typeof event.transcript === 'string'
              )
                raw.resolve(event.transcript);
              if (event.type === 'conversation.item.input_audio_transcription.failed')
                raw.reject(new Error('RAW_TRANSCRIPTION_FAILED'));
            },
          });
          try {
            connection.append(bytes);
            connection.commit();
            Object.assign(
              segment,
              await this.ports.speech.completeRaw(segment.id, {
                text: await withTimeout(raw.promise, 60_000),
                endedAt:
                  segment.endedAt ??
                  new Date(Date.parse(segment.startedAt) + bytes.length / 48).toISOString(),
              }),
            );
          } finally {
            connection.close();
          }
        }
      }
      group.rawText = segments.map((s) => s.rawText ?? '').join('\n');
      group.rawRevisions = segments.map((s) => s.rawRevision ?? s.revision);
      group.endedAt = segments.at(-1)?.endedAt ?? null;
      group.correctedText = group.rawText.trim()
        ? await withTimeout(this.provider.transcribe(Buffer.concat(pcm), context), 60_000)
        : '';
      group.state = group.rawText.trim() ? 'ready' : 'no_speech';
    } catch (error) {
      group.state = 'failed';
      const { code, message } = publicAiError(error);
      group.error = {
        phase: segments.some((s) => s.rawStatus !== 'ready') ? 'raw' : 'correction',
        code,
        message,
      };
    }
    const revision = group.revision++;
    await this.ports.speech.saveGroup(group, revision);
  }
  private rotateProvider(stream: InputStream): Promise<void> {
    if (stream.rotating) return stream.rotating;
    stream.rotating = (async () => {
      await Promise.allSettled([...stream.byId.values()].map((p) => p.done));
      await stream.eventChain;
      if (stream.stopped || this.shuttingDown) return;
      this.closeProvider(stream);
      await this.openProvider(stream);
      this.scheduleRotation(stream);
    })().finally(() => {
      stream.rotating = undefined;
    });
    return stream.rotating;
  }
  private scheduleRotation(stream: InputStream, delay = 55 * 60_000) {
    clearTimeout(stream.rotation);
    stream.rotation = setTimeout(() => {
      if (stream.stopped) return;
      if (stream.active || [...stream.byId.values()].some((p) => !p.rawReceived)) {
        this.scheduleRotation(stream, 1_000);
        return;
      }
      void this.rotateProvider(stream).catch((e) => this.failStream(stream, e));
    }, delay);
    stream.rotation.unref?.();
  }

  private async failStream(stream: InputStream, error: unknown): Promise<void> {
    if (stream.failedStream || this.shuttingDown) return;
    stream.failedStream = true;
    stream.stopped = true;
    for (const pending of stream.segments.values())
      if (!pending.rawReceived) {
        pending.raw.reject(error);
        if (!pending.done) {
          pending.failed = true;
          if (pending.bytes) {
            pending.media = this.ports.media
              .put({
                kind: 'audio',
                studyId: stream.studyId,
                segmentId: pending.segment.id,
                bytes: pcm16ToWav(Buffer.concat(pending.chunks)),
                contentType: 'audio/wav',
              })
              .then(() => {
                pending.chunks = [];
              });
            await pending.media.catch(() => undefined);
          }
          pending.done = Promise.reject(error);
          void pending.done.catch(() => undefined);
          await this.ports.speech.fail(pending.segment.id, 'raw', publicAiError(error));
        }
      }
    stream.group?.boundary.close('mic_off');
    stream.flushed.reject(error);
    stream.send({
      type: 'audio.error',
      error: { ...publicAiError(error), code: 'AUDIO_FAILED' },
      requestId: randomUUID(),
    });
    this.closeProvider(stream);
    if (!stream.work.size) this.streams.delete(stream.id);
  }
  private closeProvider(stream: InputStream) {
    clearTimeout(stream.rotation);
    clearTimeout(stream.disconnected);
    stream.providerClosed = true;
    stream.provider?.close();
  }

  async flushTopic(topicId: string, closeId: string): Promise<void> {
    this.closingTopics.add(topicId);
    // Capture the open set before awaiting network or persistence; subsequent audio.start is rejected.
    const streams = [...this.streams.values()].filter((stream) => stream.topicId === topicId);
    await withTimeout(
      Promise.all(
        streams.map(async (stream) => {
          if (stream.stopped) {
            stream.group?.boundary.close('topic_close');
            await Promise.all([...stream.work]);
            return;
          }
          stream.closingId = closeId;
          stream.flushed = deferred<void>();
          await stream.providerReady.promise;
          await this.ports.events.toUser(stream.actor.userId, {
            version: 1,
            eventId: randomUUID(),
            type: 'audio.flush_requested',
            scope: 'user',
            studyId: stream.studyId,
            entityId: stream.id,
            entityRevision: 0,
            occurredAt: new Date().toISOString(),
            payload: { topicId, closeId },
          });
          await stream.flushed.promise;
        }),
      ),
      150_000,
    );
    for (const group of await this.ports.speech.listGroups(topicId)) {
      if (group.state === 'failed') await this.retryGroup(group, streams[0]?.context ?? '');
    }
    for (const stream of streams) this.streams.delete(stream.id);
    this.closingTopics.delete(topicId);
  }

  shutdown(): void {
    this.shuttingDown = true;
    for (const stream of this.streams.values()) {
      stream.group?.boundary.dispose();
      for (const p of stream.byId.values()) p.raw.reject(new Error('SERVICE_CLOSED'));
      this.closeProvider(stream);
    }
    this.streams.clear();
  }
}

function diagnosticErrorCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^[A-Za-z0-9_.-]{1,80}$/.test(code) ? code : 'UNKNOWN';
}
