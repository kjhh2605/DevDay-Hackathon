import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { StudySnapshot } from '@devday/contracts';
import type { ApiConfig } from '../config.js';
import type { DomainService } from '../domain/service.js';
import { DomainError } from '../domain/errors.js';
import { registerErrorHandler } from '../http/errors.js';
import { EventHub } from './event-hub.js';
import { registerEventRoutes } from './routes.js';

const user = { id: randomUUID(), displayName: 'Alice', handle: 'alice' };
const studyId = randomUUID();
const origin = 'http://localhost:5173';
function snapshot(): StudySnapshot {
  return {
    study: {
      id: studyId,
      revision: 0,
      transitionVersion: 0,
      status: 'waiting',
      currentTopicId: null,
      members: [
        { userId: user.id, displayName: user.displayName, handle: user.handle, state: 'joined' },
      ],
      createdAt: new Date().toISOString(),
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
async function fixture() {
  const app = Fastify();
  await app.register(cookie);
  await app.register(websocket);
  const service = {
    authenticate: vi.fn(async (token) => (token === 'valid' ? user : null)),
    assertMember: vi.fn(async () => undefined),
    snapshot: vi.fn(async () => snapshot()),
  };
  const hub = new EventHub();
  registerErrorHandler(app);
  registerEventRoutes(app, {
    service: service as unknown as DomainService,
    hub,
    config: { appEnv: 'local', webOrigin: origin } as ApiConfig,
  });
  await app.ready();
  return { app, service, hub };
}
describe('event websocket boundary', () => {
  it('rejects unauthenticated or cross-origin connections before upgrade', async () => {
    const { app, service } = await fixture();
    try {
      await expect(app.injectWS('/ws/events', { headers: { origin } })).rejects.toThrow('401');
      await expect(
        app.injectWS('/ws/events', {
          headers: { origin: 'https://untrusted.example', cookie: 'devday_session=valid' },
        }),
      ).rejects.toThrow('403');
      expect(service.assertMember).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('authorizes the cookie actor and sends snapshot before changes received during its read', async () => {
    const { app, service, hub } = await fixture();
    const initial = snapshot();
    service.snapshot.mockImplementationOnce(async () => {
      await hub.toStudy(studyId, {
        version: 1,
        eventId: randomUUID(),
        type: 'study.changed',
        scope: 'study',
        studyId,
        entityId: studyId,
        entityRevision: 1,
        occurredAt: new Date().toISOString(),
        payload: { study: { ...initial.study, revision: 1 }, topic: null, jobs: [] },
      });
      return initial;
    });
    const socket = await app.injectWS('/ws/events', {
      headers: { origin, cookie: 'devday_session=valid' },
    });
    try {
      const messages: unknown[] = [];
      const received = new Promise<void>((resolve) =>
        socket.on('message', (raw) => {
          messages.push(JSON.parse(raw.toString()));
          if (messages.length === 2) resolve();
        }),
      );
      socket.send(JSON.stringify({ type: 'study.subscribe', studyId }));
      await received;
      expect(service.assertMember).toHaveBeenCalledWith({ userId: user.id }, studyId);
      expect(messages[0]).toEqual({ type: 'study.snapshot', studyId, snapshot: initial });
      expect(messages[1]).toMatchObject({ type: 'study.changed', entityRevision: 1 });
    } finally {
      socket.terminate();
      await app.close();
    }
  });

  it('denies foreign study subscriptions and does not expose their snapshot', async () => {
    const { app, service } = await fixture();
    service.assertMember.mockRejectedValueOnce(
      new DomainError('NOT_MEMBER', '참여자가 아닙니다.', 403),
    );
    const socket = await app.injectWS('/ws/events', {
      headers: { origin, cookie: 'devday_session=valid' },
    });
    try {
      const response = once(socket, 'message');
      socket.send(JSON.stringify({ type: 'study.subscribe', studyId }));
      const [raw] = await response;
      expect(JSON.parse(raw.toString())).toMatchObject({
        type: 'error',
        error: { code: 'NOT_MEMBER' },
      });
      expect(service.snapshot).not.toHaveBeenCalled();
    } finally {
      socket.terminate();
      await app.close();
    }
  });
});
