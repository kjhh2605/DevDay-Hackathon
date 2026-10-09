import {
  API_BASE_PATH,
  endpointRegistry,
  ErrorEnvelopeSchema,
  EventSchema,
  EventServerMessageSchema,
  successEnvelopeSchema,
} from '@devday/contracts';
import type {
  ApiError as ApiErrorData,
  DomainEvent,
  EndpointInput,
  EndpointName,
  EndpointOutput,
  EndpointParams,
  EventClientMessage,
  StudySnapshot,
} from '@devday/contracts';

export class ApiError extends Error {
  readonly name = 'ApiError';
  constructor(
    readonly error: ApiErrorData,
    readonly requestId: string,
    readonly status: number,
  ) {
    super(error.message);
  }
  get code() {
    return this.error.code;
  }
  get details() {
    return this.error.details;
  }
}
export class ContractError extends Error {
  readonly name = 'ContractError';
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message);
  }
}
type RequestOptions<K extends EndpointName> = ({} extends EndpointParams<K>
  ? { params?: EndpointParams<K> }
  : { params: EndpointParams<K> }) &
  (EndpointInput<K> extends undefined ? { body?: undefined } : { body: EndpointInput<K> }) & {
    signal?: AbortSignal;
  };
type RequestArgs<K extends EndpointName> =
  {} extends EndpointParams<K>
    ? EndpointInput<K> extends undefined
      ? [request?: RequestOptions<K>]
      : [request: RequestOptions<K>]
    : [request: RequestOptions<K>];
export function createApiClient(
  options: { baseUrl?: string; fetch?: typeof globalThis.fetch } = {},
) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const baseUrl = (options.baseUrl ?? API_BASE_PATH).replace(/\/$/, '');
  return {
    async request<K extends EndpointName>(
      name: K,
      ...args: RequestArgs<K>
    ): Promise<EndpointOutput<K>> {
      const request: { params?: EndpointParams<K>; body?: EndpointInput<K>; signal?: AbortSignal } =
        args[0] ?? {};
      const endpoint = endpointRegistry[name];
      const params = endpoint.params.parse(request.params ?? {}) as Record<string, string>;
      const body = endpoint.input.parse(request.body);
      const path = endpoint.path.replace(/:([A-Za-z]+)/g, (_, key: string) =>
        encodeURIComponent(params[key] ?? ''),
      );
      const response = await fetcher(`${baseUrl}${path}`, {
        method: endpoint.method,
        credentials: 'include',
        headers:
          body === undefined
            ? { Accept: 'application/json' }
            : { Accept: 'application/json', 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        ...(request.signal ? { signal: request.signal } : {}),
      });
      let json: unknown;
      try {
        json = await response.json();
      } catch (cause) {
        throw new ContractError('Server returned an invalid JSON envelope', cause);
      }
      if (!response.ok) {
        const parsed = ErrorEnvelopeSchema.safeParse(json);
        if (!parsed.success)
          throw new ContractError('Server returned an invalid error envelope', parsed.error);
        throw new ApiError(parsed.data.error, parsed.data.requestId, response.status);
      }
      const parsed = successEnvelopeSchema(endpoint.output).safeParse(json);
      if (!parsed.success) throw new ContractError(`Invalid response for ${name}`, parsed.error);
      return parsed.data.data as EndpointOutput<K>;
    },
    mediaUrl(mediaId: string) {
      return `${baseUrl}/media/${encodeURIComponent(mediaId)}`;
    },
  };
}
export const createClient = createApiClient;
export type ApiClient = ReturnType<typeof createApiClient>;
export function parseEvent(value: unknown): DomainEvent {
  return EventSchema.parse(typeof value === 'string' ? JSON.parse(value) : value);
}

/** Tracks committed entities separately from ephemeral partial transcripts. */
export class EventRevisionTracker {
  private seen = new Set<string>();
  private revisions = new Map<string, number>();
  private readySegments = new Set<string>();
  private correctionRevisions = new Map<string, number>();
  seed(snapshot: StudySnapshot): void {
    const entries: [string, number][] = [[`study:${snapshot.study.id}`, snapshot.study.revision]];
    for (const item of snapshot.segments) {
      entries.push([`segment:${item.id}`, item.revision]);
      if (item.rawStatus === 'ready') this.readySegments.add(item.id);
    }
    for (const item of snapshot.utterances) {
      entries.push([`utterance:${item.id}`, item.revision]);
      this.correctionRevisions.set(item.id, item.correctionRevision);
    }
    for (const item of snapshot.feedback)
      entries.push([`feedback:${item.utteranceId}`, item.revision]);
    for (const item of snapshot.jobs) entries.push([`job:${item.id}`, item.revision]);
    for (const [key, revision] of entries)
      this.revisions.set(key, Math.max(revision, this.revisions.get(key) ?? -1));
  }
  accept(event: DomainEvent): boolean {
    if (this.seen.has(event.eventId)) return false;
    this.seen.add(event.eventId);
    // These are invalidations/control requests, not revisions of a stored entity.
    // A new request for the same owner or stream must still reach its listener.
    if (event.type === 'learning-items.changed' || event.type === 'audio.flush_requested')
      return true;
    if (
      event.type === 'feedback.updated' &&
      event.payload.status === 'ready' &&
      this.correctionRevisions.has(event.payload.utteranceId) &&
      event.payload.inputCorrectionRevision !==
        this.correctionRevisions.get(event.payload.utteranceId)
    )
      return false;
    if (event.type === 'transcript.partial' && this.readySegments.has(event.payload.segmentId))
      return false;
    const family =
      event.type === 'transcript.segment.updated'
        ? 'segment'
        : event.type === 'transcript.partial'
          ? 'partial'
          : event.type.split('.')[0];
    const key = `${family}:${event.entityId}`;
    const revision =
      event.type === 'transcript.partial' ? event.payload.partialRevision : event.entityRevision;
    if (revision <= (this.revisions.get(key) ?? -1)) return false;
    this.revisions.set(key, revision);
    if (event.type === 'utterance.updated')
      this.correctionRevisions.set(event.payload.id, event.payload.correctionRevision);
    if (event.type === 'transcript.segment.updated' && event.payload.rawStatus === 'ready')
      this.readySegments.add(event.payload.id);
    return true;
  }
}
export type EventConnectionStatus = 'connecting' | 'connected' | 'closed' | 'failed';
export interface EventSocket {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'open', listener: () => void): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error' | 'close', listener: () => void): void;
}
export function connectEvents(options: {
  url?: string;
  onEvent: (event: DomainEvent) => void;
  onSnapshot?: (snapshot: StudySnapshot) => void;
  onStatus?: (status: EventConnectionStatus) => void;
  onError?: (error: Error) => void;
  socketFactory?: (url: string) => EventSocket;
}) {
  const defaultUrl =
    typeof location === 'undefined'
      ? 'ws://localhost:3001/ws/events'
      : `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/events`;
  const socket: EventSocket = (options.socketFactory ?? ((url) => new WebSocket(url)))(
    options.url ?? defaultUrl,
  );
  const tracker = new EventRevisionTracker();
  let studyId: string | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const send = (message: EventClientMessage) => socket.send(JSON.stringify(message));
  options.onStatus?.('connecting');
  socket.addEventListener('open', () => {
    options.onStatus?.('connected');
    if (studyId) send({ type: 'study.subscribe', studyId });
    heartbeat = setInterval(() => {
      if (socket.readyState === 1) send({ type: 'heartbeat.ping' });
    }, 20_000);
  });
  socket.addEventListener('message', (event) => {
    try {
      const message = EventServerMessageSchema.parse(
        typeof event.data === 'string' ? JSON.parse(event.data) : event.data,
      );
      if (message.type === 'heartbeat.ping') send({ type: 'heartbeat.pong' });
      else if (message.type === 'study.snapshot') {
        tracker.seed(message.snapshot);
        options.onSnapshot?.(message.snapshot);
      } else if (message.type === 'error')
        options.onError?.(new ApiError(message.error, message.requestId, 0));
      else if (message.type !== 'heartbeat.pong' && tracker.accept(message))
        options.onEvent(message);
    } catch (cause) {
      options.onError?.(new ContractError('Invalid event received', cause));
    }
  });
  socket.addEventListener('error', () => {
    options.onStatus?.('failed');
    options.onError?.(new Error('실시간 연결에 실패했습니다.'));
  });
  socket.addEventListener('close', () => {
    if (heartbeat) clearInterval(heartbeat);
    options.onStatus?.('closed');
  });
  return {
    subscribe(id: string) {
      studyId = id;
      if (socket.readyState === 1) send({ type: 'study.subscribe', studyId });
    },
    close() {
      if (heartbeat) clearInterval(heartbeat);
      socket.close();
    },
  };
}
