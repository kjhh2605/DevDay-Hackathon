import { randomUUID } from 'node:crypto';
import type { Actor, ApplicationPorts } from '@devday/application-ports';
import {
  AudioClientMessageSchema,
  type AudioClientMessage,
  type AudioServerMessage,
  type TranscriptSegment,
} from '@devday/contracts';
import type { AiProvider, ProviderEvent, RealtimeConnection } from './provider.js';
import { pcm16ToWav } from './provider.js';
import { RealtimeSegmentMap } from './realtime-mapping.js';
import { publicAiError, withTimeout } from './jobs.js';

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
}
interface InputStream {
  id: string;
  clientStreamId: string;
  actor: Actor;
  topicId: string;
  studyId: string;
  context: string;
  send: (message: AudioServerMessage) => void;
  provider: RealtimeConnection | null;
  segments: Map<string, PendingSegment>;
  byId: Map<string, PendingSegment>;
  mapping: RealtimeSegmentMap;
  active: PendingSegment | null;
  stopped: boolean;
  providerClosed: boolean;
  providerGeneration: number;
  providerStartedAt: number;
  closingId: string | null;
  flushed: ReturnType<typeof deferred<void>>;
  providerReady: ReturnType<typeof deferred<void>>;
  lastSegment: PendingSegment | null;
  eventChain: Promise<void>;
}

/** One provider stream per authenticated input. Never combines speakers' audio. */
export class SpeechService {
  private readonly streams = new Map<string, InputStream>();
  private readonly closingTopics = new Set<string>();
  constructor(
    private readonly ports: ApplicationPorts,
    private readonly provider: AiProvider,
  ) {}

  createConnection(actor: Actor, send: (message: AudioServerMessage) => void) {
    let stream: InputStream | null = null;
    let disconnected = false;
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
          stream = await this.start(actor, message, send);
          if (disconnected) {
            await this.failStream(stream, new Error('Audio client disconnected while connecting'));
            throw new Error('INPUT_CLOSED');
          }
          return;
        }
        if (!stream || message.streamId !== stream.id) throw new Error('INVALID_STREAM');
        await this.receive(stream, message);
      },
      disconnect: () => {
        disconnected = true;
        if (!stream || stream.providerClosed || stream.stopped) return;
        void this.failStream(stream, new Error('Audio connection closed before flush'));
      },
    };
  }

  private async start(
    actor: Actor,
    message: Extract<AudioClientMessage, { type: 'audio.start' }>,
    send: InputStream['send'],
  ): Promise<InputStream> {
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
    };
    this.streams.set(stream.id, stream);
    try {
      await this.openProvider(stream);
      stream.providerReady.resolve();
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
    stream.provider = await this.provider.connectTranscription({
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
      await Promise.all([...stream.segments.values()].map((segment) => segment.done));
      this.closeProvider(stream);
      stream.flushed.resolve();
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
      await Promise.all([...stream.segments.values()].map((segment) => segment.done));
      await stream.eventChain;
      stream.stopped = true;
      this.closeProvider(stream);
      stream.send({ type: 'audio.flushed', streamId: stream.id, closeId: message.closeId });
      stream.flushed.resolve();
      return;
    }
    if (stream.stopped || stream.providerClosed) throw new Error('INPUT_CLOSED');
    if (message.type === 'audio.segment_start') {
      if (stream.active || stream.segments.has(message.clientSegmentId))
        throw new Error('SEGMENT_ALREADY_ACTIVE');
      // Realtime sessions have a 60-minute provider lifetime. Rotate healthy connections between segments.
      if (Date.now() - stream.providerStartedAt >= 55 * 60_000) {
        await Promise.all([...stream.segments.values()].map((segment) => segment.done));
        this.closeProvider(stream);
        await this.openProvider(stream);
      }
      // A closing stream may send a final buffered segment after the close notification.
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
      };
      stream.segments.set(message.clientSegmentId, pending);
      stream.byId.set(segment.id, pending);
      stream.active = pending;
      stream.lastSegment = pending;
      stream.mapping.begin(segment.id);
      stream.send({
        type: 'audio.segment_ready',
        clientSegmentId: message.clientSegmentId,
        segmentId: segment.id,
        startOrder: segment.startOrder,
      });
      return;
    }
    const pending = stream.segments.get(message.clientSegmentId);
    if (!pending || stream.active !== pending || pending.committed)
      throw new Error('SEGMENT_NOT_ACTIVE');
    if (message.type === 'audio.chunk') {
      if (message.seq !== pending.nextSeq) throw new Error('AUDIO_SEQUENCE_GAP');
      const pcm = Buffer.from(message.pcmBase64, 'base64');
      if (
        !pcm.byteLength ||
        pcm.byteLength % 2 !== 0 ||
        pcm.byteLength > 48_000 ||
        pending.bytes + pcm.byteLength > 1_200_000
      )
        throw new Error('INVALID_PCM');
      pending.chunks.push(pcm);
      pending.bytes += pcm.byteLength;
      pending.nextSeq += 1;
      stream.provider!.append(pcm);
      return;
    }
    if (message.lastSeq !== pending.nextSeq - 1 || !pending.bytes)
      throw new Error('INCOMPLETE_SEGMENT');
    pending.committed = true;
    stream.active = null;
    stream.mapping.commit(pending.segment.id);
    stream.provider!.commit();
    pending.done = this.finishSegment(stream, pending);
    void pending.done.catch(() => undefined);
  }

  private async providerEvent(
    stream: InputStream,
    segmentId: string,
    event: ProviderEvent,
  ): Promise<void> {
    const pending = stream.byId.get(segmentId);
    if (!pending || pending.failed || pending.rawReceived || pending.rawAttempt > 0) return;
    if (event.type === 'conversation.item.input_audio_transcription.failed') {
      pending.raw.reject(new Error('Provider transcription failed'));
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
        Date.parse(pending.segment.startedAt) + Math.round(pending.bytes / 48),
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

  private async finishSegment(stream: InputStream, pending: PendingSegment): Promise<void> {
    try {
      const raw = await withTimeout(pending.raw.promise, 60_000);
      const pcm = Buffer.concat(pending.chunks);
      await this.ports.media.put({
        kind: 'audio',
        studyId: stream.studyId,
        segmentId: raw.id,
        bytes: pcm16ToWav(pcm),
        contentType: 'audio/wav',
      });
      const corrected = await withTimeout(this.provider.transcribe(pcm, stream.context), 60_000);
      if (pending.failed) return;
      assertCorrectionCoverage(raw.rawText ?? '', corrected);
      const applied = await this.ports.speech.applyCorrection(raw.id, {
        text: corrected,
        expectedRevision: raw.revision,
      });
      if (!applied) throw new Error('TRANSCRIPTION_REVISION_EXPIRED');
      pending.segment = applied;
    } catch (error) {
      pending.failed = true;
      await this.ports.speech.fail(
        pending.segment.id,
        pending.rawReceived ? 'correction' : 'raw',
        publicAiError(error),
      );
      stream.send({
        type: 'audio.error',
        error: { ...publicAiError(error), code: 'AUDIO_FAILED' },
        requestId: randomUUID(),
      });
      throw error;
    }
  }

  private async retryRaw(stream: InputStream, pending: PendingSegment): Promise<void> {
    pending.failed = false;
    pending.rawAttempt += 1;
    const attempt = pending.rawAttempt;
    pending.raw = deferred<TranscriptSegment>();
    let connection: RealtimeConnection | null = null;
    try {
      connection = await this.provider.connectTranscription({
        onError: (error) => pending.raw.reject(error),
        onEvent: (event) => {
          if (pending.failed || pending.rawAttempt !== attempt || pending.rawReceived) return;
          if (event.type === 'conversation.item.input_audio_transcription.failed')
            pending.raw.reject(new Error('Provider transcription failed'));
          if (
            event.type === 'conversation.item.input_audio_transcription.completed' &&
            typeof event.transcript === 'string'
          ) {
            // This replacement provider receives only the retained, already committed PCM for this one segment.
            const endedAt = new Date(
              Date.parse(pending.segment.startedAt) + Math.round(pending.bytes / 48),
            ).toISOString();
            void this.ports.speech
              .completeRaw(pending.segment.id, { text: event.transcript, endedAt })
              .then((updated) => {
                if (pending.rawAttempt !== attempt || pending.failed) return;
                pending.rawReceived = true;
                pending.segment = updated;
                pending.raw.resolve(updated);
              })
              .catch(pending.raw.reject);
          }
        },
      });
      connection.append(Buffer.concat(pending.chunks));
      connection.commit();
      await this.finishSegment(stream, pending);
    } catch (error) {
      if (!pending.failed) {
        pending.failed = true;
        await this.ports.speech.fail(pending.segment.id, 'raw', publicAiError(error));
      }
      throw error;
    } finally {
      connection?.close();
    }
  }

  private async failStream(stream: InputStream, error: unknown): Promise<void> {
    stream.stopped = true;
    for (const pending of stream.segments.values())
      if (!pending.rawReceived) {
        pending.raw.reject(error);
        if (!pending.done) {
          pending.failed = true;
          await this.ports.speech.fail(pending.segment.id, 'raw', publicAiError(error));
        }
      }
    stream.flushed.reject(error);
    stream.send({
      type: 'audio.error',
      error: { ...publicAiError(error), code: 'AUDIO_FAILED' },
      requestId: randomUUID(),
    });
    this.closeProvider(stream);
  }
  private closeProvider(stream: InputStream) {
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
          // Explicit user close retry may retry a failed correction from retained PCM, without client retransmission.
          const currentSegments = await this.ports.speech.listSegments(topicId);
          for (const pending of stream.segments.values())
            if (pending.failed && pending.committed) {
              const current = currentSegments.find((segment) => segment.id === pending.segment.id);
              if (!current) throw new Error('RAW_TRANSCRIPTION_UNAVAILABLE');
              // Persisted status wins if a raw completion raced a timeout/failure update.
              if (current.rawStatus !== 'ready') {
                pending.rawReceived = false;
                pending.done = this.retryRaw(stream, pending);
                void pending.done.catch(() => undefined);
                continue;
              }
              pending.rawReceived = true;
              pending.segment = current;
              pending.raw = deferred<TranscriptSegment>();
              pending.raw.resolve(current);
              pending.failed = false;
              pending.done = this.finishSegment(stream, pending);
              void pending.done.catch(() => undefined);
            }
          if (stream.stopped) {
            await Promise.all([...stream.segments.values()].map((segment) => segment.done));
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
  }

  shutdown(): void {
    for (const stream of this.streams.values()) this.closeProvider(stream);
  }
}

/** A conservative omission guard; it never replaces audio transcription with guessed text. */
export function assertCorrectionCoverage(raw: string, corrected: string): void {
  const hangul = (text: string) => (text.match(/[가-힣]/gu) ?? []).length;
  const english = (text: string) => (text.match(/\b[A-Za-z]{2,}\b/gu) ?? []).length;
  const rawKorean = hangul(raw),
    rawEnglish = english(raw);
  if (rawKorean >= 2 && rawEnglish >= 2 && (hangul(corrected) === 0 || english(corrected) === 0)) {
    throw new Error(
      'CORRECTION_LANGUAGE_OMISSION: mixed-language speech needs explicit retranscription',
    );
  }
  if (/\S/u.test(raw) && !/\S/u.test(corrected)) throw new Error('EMPTY_CORRECTION');
}
