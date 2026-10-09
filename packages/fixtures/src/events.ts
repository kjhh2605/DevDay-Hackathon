import {
  EventSchema,
  EventServerMessageSchema,
  EventClientMessageSchema,
  type DomainEvent,
  type EventServerMessage,
} from '@devday/contracts';
import { createFixtureStore, FixtureError, type FixtureStore } from './store.js';
import * as seed from './data.js';

const eventBase = {
  version: 1,
  occurredAt: seed.fixtureTime,
  studyId: seed.fixtureIds.study,
  entityRevision: 1,
};
/** Every public event variant has a contract-validated example. */
export const events = [
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(299),
    type: 'speech.group.updated',
    scope: 'study',
    entityId: seed.fixtureId(298),
    entityRevision: 0,
    payload: {
      id: seed.fixtureId(298),
      revision: 0,
      studyId: seed.fixtureIds.study,
      topicId: seed.transcriptSegments[0]!.topicId,
      speakerUserId: seed.fixtureIds.userA,
      startOrder: seed.transcriptSegments[0]!.startOrder,
      segmentIds: [seed.fixtureIds.segmentA],
      rawRevisions: [seed.transcriptSegments[0]!.revision],
      rawText: seed.transcriptSegments[0]!.rawText,
      correctedText: seed.transcriptSegments[0]!.correctedText,
      state: 'ready',
      startedAt: seed.fixtureTime,
      endedAt: seed.fixtureTime,
      closeReason: 'decision_complete',
      attemptId: seed.fixtureId(297),
      error: null,
    },
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(200),
    type: 'invitation.created',
    scope: 'user',
    entityId: seed.fixtureIds.study,
    payload: seed.invitations[0],
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(201),
    type: 'study.changed',
    scope: 'study',
    entityId: seed.fixtureIds.study,
    entityRevision: seed.activeStudy.revision,
    payload: { study: seed.activeStudy, topic: seed.reviewTopic, jobs: [] },
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(202),
    type: 'transcript.partial',
    scope: 'study',
    entityId: seed.fixtureIds.segmentA,
    payload: {
      segmentId: seed.fixtureIds.segmentA,
      speakerUserId: seed.fixtureIds.userA,
      startOrder: 1,
      partialText: 'I try bicycle',
      partialRevision: 1,
    },
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(203),
    type: 'transcript.segment.updated',
    scope: 'study',
    entityId: seed.fixtureIds.segmentA,
    entityRevision: seed.transcriptSegments[0]!.revision,
    payload: seed.transcriptSegments[0],
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(204),
    type: 'utterance.updated',
    scope: 'study',
    entityId: seed.fixtureIds.utteranceA,
    payload: seed.utterances[0],
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(205),
    type: 'feedback.updated',
    scope: 'study',
    entityId: seed.fixtureIds.utteranceA,
    payload: seed.readyFeedback,
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(206),
    type: 'audio.flush_requested',
    scope: 'user',
    entityId: seed.fixtureIds.imageTopic,
    payload: { topicId: seed.fixtureIds.imageTopic, closeId: seed.fixtureId(210) },
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(207),
    type: 'job.updated',
    scope: 'study',
    entityId: seed.fixtureIds.generationJob,
    entityRevision: seed.succeededJob.revision,
    payload: seed.succeededJob,
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(208),
    type: 'shared-expression.added',
    scope: 'study',
    entityId: seed.fixtureIds.sharedExpression,
    payload: seed.sharedExpression,
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(209),
    type: 'chat.message.updated',
    scope: 'user',
    entityId: seed.fixtureIds.chatB,
    payload: seed.chatMessages[1],
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(211),
    type: 'share-proposal.updated',
    scope: 'user',
    entityId: seed.fixtureIds.proposal,
    payload: seed.pendingProposal,
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(212),
    type: 'learning-items.changed',
    scope: 'user',
    entityId: seed.fixtureIds.userB,
    payload: { itemIds: [seed.fixtureIds.learningB] },
  }),
  EventSchema.parse({
    ...eventBase,
    eventId: seed.fixtureId(213),
    type: 'experience-draft.ready',
    scope: 'user',
    studyId: null,
    entityId: seed.fixtureIds.draft,
    payload: seed.experienceDraft,
  }),
];

type Listener = (message: EventServerMessage) => void;
interface Connection {
  userId: string;
  studyIds: Set<string>;
  listeners: Set<Listener>;
}

/** An in-memory transport with the same user/study visibility boundary as the wire. */
export function createMockEventHub(store: FixtureStore = createFixtureStore()) {
  const connections = new Set<Connection>();
  const emit = (connection: Connection, value: EventServerMessage) => {
    const message = EventServerMessageSchema.parse(value);
    for (const listener of connection.listeners) listener(structuredClone(message));
  };
  const isMember = (userId: string, studyId: string) =>
    store.state.snapshot.study.id === studyId &&
    store.state.snapshot.study.members.some(
      (member) => member.userId === userId && member.state === 'joined',
    );
  return {
    connect(userId: string) {
      if (!store.state.users.some((user) => user.id === userId))
        throw new FixtureError(401, 'UNIDENTIFIED', '등록한 사용자가 필요해요.');
      const connection: Connection = { userId, studyIds: new Set(), listeners: new Set() };
      connections.add(connection);
      let closed = false;
      const assertOpen = () => {
        if (closed) throw new Error('Mock event transport is disconnected.');
      };
      return {
        subscribe(listener: Listener) {
          assertOpen();
          connection.listeners.add(listener);
          return () => {
            connection.listeners.delete(listener);
          };
        },
        subscribeStudy(studyId: string) {
          assertOpen();
          if (!isMember(userId, studyId))
            throw new FixtureError(403, 'NOT_MEMBER', '입장한 참여자만 구독할 수 있어요.');
          connection.studyIds.add(studyId);
          emit(connection, { type: 'study.snapshot', studyId, snapshot: store.snapshot() });
        },
        disconnect() {
          closed = true;
          connection.listeners.clear();
          connections.delete(connection);
        },
      };
    },
    publishToUser(userId: string, input: DomainEvent) {
      const event = EventSchema.parse(input);
      if (event.scope !== 'user')
        throw new Error('Only user events may be published to a private channel.');
      if ('ownerUserId' in event.payload && event.payload.ownerUserId !== userId)
        throw new Error('Private event owner does not match recipient.');
      for (const connection of connections)
        if (connection.userId === userId) emit(connection, event);
    },
    publishToStudy(studyId: string, input: DomainEvent) {
      const event = EventSchema.parse(input);
      if (event.scope !== 'study' || event.studyId !== studyId)
        throw new Error('Study event scope does not match its channel.');
      for (const connection of connections) {
        if (connection.studyIds.has(studyId) && isMember(connection.userId, studyId))
          emit(connection, event);
      }
    },
  };
}

type MockHub = ReturnType<typeof createMockEventHub>;
type MessageListener = (event: { data: unknown }) => void;
type StatusListener = () => void;

/** Structurally implements @devday/client's EventSocket without a runtime dependency. */
export class MockEventSocket {
  readyState = 0;
  private listeners = {
    open: new Set<StatusListener>(),
    close: new Set<StatusListener>(),
    error: new Set<StatusListener>(),
    message: new Set<MessageListener>(),
  };
  private connection: ReturnType<MockHub['connect']>;
  constructor(hub: MockHub, userId: string) {
    this.connection = hub.connect(userId);
    this.connection.subscribe((message) => this.emitMessage(message));
    queueMicrotask(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      for (const listener of this.listeners.open) listener();
    });
  }
  private emitMessage(message: EventServerMessage) {
    for (const listener of this.listeners.message) listener({ data: JSON.stringify(message) });
  }
  addEventListener(type: 'open' | 'close' | 'error', listener: StatusListener): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  addEventListener(
    type: 'open' | 'close' | 'error' | 'message',
    listener: StatusListener | MessageListener,
  ): void {
    if (type === 'message') this.listeners.message.add(listener as MessageListener);
    else this.listeners[type].add(listener as StatusListener);
  }
  send(data: string) {
    if (this.readyState !== 1) throw new Error('Mock event socket is not open.');
    const message = EventClientMessageSchema.parse(JSON.parse(data));
    if (message.type === 'study.subscribe') {
      try {
        this.connection.subscribeStudy(message.studyId);
      } catch (error) {
        if (!(error instanceof FixtureError)) throw error;
        this.emitMessage({
          type: 'error',
          error: { code: error.code, message: error.message, details: null },
          requestId: seed.fixtureId(999),
        });
      }
    } else if (message.type === 'heartbeat.ping') this.emitMessage({ type: 'heartbeat.pong' });
  }
  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.connection.disconnect();
    for (const listener of this.listeners.close) listener();
    Object.values(this.listeners).forEach((listeners) => listeners.clear());
  }
}

export function createMockSocketFactory(hub: MockHub, userId: string) {
  return (_url: string) => new MockEventSocket(hub, userId);
}
