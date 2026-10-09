import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { DomainEvent, StudySnapshot } from '@devday/contracts';
import { EventHub, type EventSocket } from './event-hub.js';

const userId = randomUUID();
const otherUserId = randomUUID();
const studyId = randomUUID();
const time = new Date().toISOString();
function socket() {
  const messages: unknown[] = [];
  const transport: EventSocket = {
    readyState: 1,
    send: (value) => messages.push(JSON.parse(value)),
    close: () => undefined,
  };
  return { messages, transport };
}
function snapshot(): StudySnapshot {
  return {
    study: {
      id: studyId,
      revision: 0,
      status: 'waiting',
      currentTopicId: null,
      transitionVersion: 0,
      members: [{ userId, handle: 'alice', displayName: 'Alice', state: 'joined' }],
      createdAt: time,
      endedAt: null,
    },
    topic: null,
    segments: [],
    utterances: [],
    feedback: [],
    jobs: [],
    sharedExpressions: [],
  };
}
function studyEvent(): DomainEvent {
  return {
    version: 1,
    eventId: randomUUID(),
    type: 'study.changed',
    scope: 'study',
    studyId,
    entityId: studyId,
    entityRevision: 1,
    occurredAt: time,
    payload: { study: { ...snapshot().study, revision: 1 }, topic: null, jobs: [] },
  };
}
function userEvent(): DomainEvent {
  return {
    version: 1,
    eventId: randomUUID(),
    type: 'learning-items.changed',
    scope: 'user',
    studyId,
    entityId: userId,
    entityRevision: 1,
    occurredAt: time,
    payload: { itemIds: [randomUUID()] },
  };
}

describe('EventHub scope and snapshot ordering', () => {
  it('sends a consistent snapshot before events that arrived during the DB read', async () => {
    const hub = new EventHub();
    const peer = socket();
    const connection = hub.connect(userId, peer.transport);
    const subscription = hub.beginStudySubscription(connection, studyId);
    const beforeSnapshot = studyEvent();
    await hub.toStudy(studyId, beforeSnapshot);
    expect(peer.messages).toEqual([]);
    subscription.complete(snapshot());
    const afterSnapshot = studyEvent();
    await hub.toStudy(studyId, afterSnapshot);
    expect(peer.messages).toEqual([
      { type: 'study.snapshot', studyId, snapshot: snapshot() },
      beforeSnapshot,
      afterSnapshot,
    ]);
  });

  it('never publishes personal events to another study participant or unsubscribed peers', async () => {
    const hub = new EventHub();
    const first = socket();
    const second = socket();
    const stranger = socket();
    for (const [id, peer] of [
      [userId, first],
      [otherUserId, second],
    ] as const) {
      const connection = hub.connect(id, peer.transport);
      hub.beginStudySubscription(connection, studyId).complete(snapshot());
      peer.messages.length = 0;
    }
    hub.connect(randomUUID(), stranger.transport);
    const privateEvent = userEvent();
    await hub.toUser(userId, privateEvent);
    expect(first.messages).toEqual([privateEvent]);
    expect(second.messages).toEqual([]);
    const sharedEvent = studyEvent();
    await hub.toStudy(studyId, sharedEvent);
    expect(second.messages).toEqual([sharedEvent]);
    expect(stranger.messages).toEqual([]);
    await expect(hub.toStudy(studyId, privateEvent)).rejects.toThrow('scope');
    await expect(hub.toUser(userId, sharedEvent)).rejects.toThrow('user channel');
  });

  it('rejects user jobs hidden inside study.changed and private payload owner mismatches', async () => {
    const hub = new EventHub();
    const job = {
      id: randomUUID(),
      revision: 0,
      kind: 'experience.prepare' as const,
      scope: 'user' as const,
      ownerUserId: userId,
      studyId: null,
      targetId: randomUUID(),
      status: 'running' as const,
      result: null,
      error: null,
      createdAt: time,
      finishedAt: null,
    };
    const event = studyEvent();
    if (event.type !== 'study.changed') throw new Error('Invalid test event');
    event.payload.jobs.push(job);
    await expect(hub.toStudy(studyId, event)).rejects.toThrow(/private/);
    await expect(
      hub.toUser(otherUserId, {
        version: 1,
        eventId: randomUUID(),
        type: 'job.updated',
        scope: 'user',
        studyId: null,
        entityId: job.id,
        entityRevision: 0,
        occurredAt: time,
        payload: job,
      }),
    ).rejects.toThrow('owner');
  });

  it('discards a canceled snapshot buffer and stops sending after disconnect', async () => {
    const hub = new EventHub();
    const peer = socket();
    const connection = hub.connect(userId, peer.transport);
    const subscription = hub.beginStudySubscription(connection, studyId);
    await hub.toStudy(studyId, studyEvent());
    subscription.cancel();
    subscription.complete(snapshot());
    await hub.toStudy(studyId, studyEvent());
    expect(peer.messages).toEqual([]);
    hub.disconnect(connection);
    await hub.toUser(userId, userEvent());
    expect(peer.messages).toEqual([]);
  });
});
