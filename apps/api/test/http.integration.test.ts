import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  StudySnapshotSchema,
  UserSchema,
  type Experience,
  type Job,
  type LearningItem,
  type User,
} from '@devday/contracts';
import type { AiJobs } from '@devday/application-ports';
import { loadConfig, type ApiConfig } from '../src/config.js';
import { createDatabase, type Database } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { DomainService } from '../src/domain/service.js';
import { registerHttpRoutes } from '../src/http/routes.js';
import { EventHub } from '../src/realtime/event-hub.js';
import { registerEventRoutes } from '../src/realtime/routes.js';
import { LocalFilesystemMediaStore } from '../src/storage/media.js';

// These are real PostgreSQL tests. Missing/unreachable DB configuration is a failure, not a skip.
describe('HTTP with PostgreSQL sessions and authorization', () => {
  let config: ApiConfig;
  let db: Database;
  let app: FastifyInstance;
  let service: DomainService;
  let media: LocalFilesystemMediaStore;
  let mediaRoot: string;
  const users: string[] = [];
  const studies: string[] = [];
  const suffix = randomUUID().replaceAll('-', '');
  const aiJobs: AiJobs = {
    generateTopic: async () => undefined,
    closeTopic: async () => undefined,
    feedback: async () => undefined,
    prepareExperience: async () => undefined,
    chat: async () => undefined,
  };
  type Session = { user: User; cookie: string };
  let alice: Session;
  let bob: Session;
  let stranger: Session;
  let studyId: string;
  async function server() {
    const instance = Fastify();
    await instance.register(cookie);
    await instance.register(websocket);
    const hub = new EventHub();
    const domain = new DomainService(db, hub);
    const filesystem = new LocalFilesystemMediaStore(mediaRoot, domain.mediaRepository);
    domain.ports(filesystem);
    domain.aiJobs = aiJobs;
    registerHttpRoutes(instance, { service: domain, aiJobs, config });
    registerEventRoutes(instance, { service: domain, hub, config });
    await instance.ready();
    return { instance, domain, filesystem };
  }
  async function register(handle: string): Promise<Session> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      headers: { origin: config.webOrigin },
      payload: { displayName: '테스트 참여자', handle },
    });
    expect(response.statusCode).toBe(201);
    const user = UserSchema.parse(response.json().data);
    users.push(user.id);
    const header = response.headers['set-cookie'];
    const serialized = Array.isArray(header) ? header[0] : header!;
    expect(serialized).toContain('HttpOnly');
    expect(serialized).toContain('SameSite=Lax');
    expect(serialized).toContain('Path=/');
    return { user, cookie: serialized.split(';')[0] };
  }
  function headers(session: Session) {
    return { cookie: session.cookie, origin: config.webOrigin };
  }
  beforeAll(async () => {
    config = loadConfig({ env: { ...process.env, AI_MODE: 'mock' } });
    db = await createDatabase(config);
    await migrate(db);
    mediaRoot = await mkdtemp(join(tmpdir(), 'devday-http-'));
    ({ instance: app, domain: service, filesystem: media } = await server());
    alice = await register(`http_alice_${suffix}`);
    bob = await register(`http_bob_${suffix}`);
    stranger = await register(`http_other_${suffix}`);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/studies',
      headers: headers(alice),
      payload: { participantHandles: [bob.user.handle], commandId: randomUUID() },
    });
    expect(created.statusCode).toBe(201);
    studyId = created.json().data.id;
    studies.push(studyId);
  });
  afterAll(async () => {
    if (app) await app.close();
    if (db) {
      try {
        // Remove only records created by this suite; other sessions' DB contents remain intact.
        await db.transaction(async (tx) => {
          await tx.query('DELETE FROM media WHERE study_id=ANY($1::uuid[])', [studies]);
          await tx.query('DELETE FROM chat_messages WHERE owner_user_id=ANY($1::uuid[])', [users]);
          await tx.query('DELETE FROM study_members WHERE study_id=ANY($1::uuid[])', [studies]);
          await tx.query('DELETE FROM studies WHERE id=ANY($1::uuid[])', [studies]);
          await tx.query('DELETE FROM experiences WHERE owner_user_id=ANY($1::uuid[])', [users]);
          await tx.query('DELETE FROM learning_items WHERE owner_user_id=ANY($1::uuid[])', [users]);
          await tx.query("DELETE FROM jobs WHERE data->>'ownerUserId'=ANY($1::text[])", [users]);
          await tx.query('DELETE FROM command_receipts WHERE actor_user_id=ANY($1::uuid[])', [
            users,
          ]);
          await tx.query('DELETE FROM user_sessions WHERE user_id=ANY($1::uuid[])', [users]);
          await tx.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [users]);
        });
      } finally {
        await db.close();
      }
    }
    if (mediaRoot) await rm(mediaRoot, { recursive: true, force: true });
  });

  it('keeps opaque sessions in PostgreSQL and authenticates through a second app instance', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/me' });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json()).toMatchObject({
      error: { code: 'UNIDENTIFIED' },
      requestId: expect.any(String),
    });
    const token = alice.cookie.split('=')[1];
    const row = (
      await db.pool.query('SELECT token_hash FROM user_sessions WHERE user_id=$1', [alice.user.id])
    ).rows[0];
    expect(row.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(row.token_hash).not.toEqual(token);
    const second = await server();
    try {
      const me = await second.instance.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: headers(alice),
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ data: alice.user, requestId: expect.any(String) });
    } finally {
      await second.instance.close();
    }
  });

  it('enforces normalized handle uniqueness during simultaneous registration', async () => {
    const handle = `http_race_${suffix}`;
    const replies = await Promise.all(
      [handle, ` ${handle.toUpperCase()} `].map((value) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          headers: { origin: config.webOrigin },
          payload: { displayName: '동시 가입', handle: value },
        }),
      ),
    );
    expect(replies.map((response) => response.statusCode).sort()).toEqual([201, 409]);
    const succeeded = replies.find((response) => response.statusCode === 201)!;
    users.push(succeeded.json().data.id);
    expect(succeeded.json().data.handle).toEqual(handle);
    expect(replies.find((response) => response.statusCode === 409)!.json().error.code).toBe(
      'HANDLE_TAKEN',
    );
  });

  it('shows invitations only to the target and requires joining before study access', async () => {
    const invited = await app.inject({
      method: 'GET',
      url: '/api/v1/me/invitations',
      headers: headers(bob),
    });
    expect(invited.json().data).toEqual([
      { studyId, inviter: alice.user, createdAt: expect.any(String) },
    ]);
    const others = await app.inject({
      method: 'GET',
      url: '/api/v1/me/invitations',
      headers: headers(stranger),
    });
    expect(others.json().data).toEqual([]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/studies/${studyId}`,
          headers: headers(bob),
        })
      ).statusCode,
    ).toBe(403);
    const joined = await app.inject({
      method: 'POST',
      url: `/api/v1/studies/${studyId}/join`,
      headers: headers(bob),
      payload: { commandId: randomUUID() },
    });
    expect(joined.statusCode).toBe(200);
    const snapshot = StudySnapshotSchema.parse(joined.json().data);
    expect(snapshot.study.members.find((member) => member.userId === bob.user.id)?.state).toBe(
      'joined',
    );
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/v1/me/invitations', headers: headers(bob) })
      ).json().data,
    ).toEqual([]);
    const denied = await app.inject({
      method: 'POST',
      url: `/api/v1/studies/${studyId}/join`,
      headers: headers(stranger),
      payload: { commandId: randomUUID() },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe('NOT_MEMBER');
  });

  it('rejects body actor injection, malformed IDs, and cross-origin mutations before execution', async () => {
    const forged = await app.inject({
      method: 'POST',
      url: '/api/v1/studies',
      headers: headers(stranger),
      payload: { participantHandles: [], commandId: randomUUID(), actorUserId: alice.user.id },
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json().error.code).toBe('INVALID_INPUT');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/studies/not-a-uuid',
          headers: headers(alice),
        })
      ).statusCode,
    ).toBe(400);
    const foreign = await app.inject({
      method: 'POST',
      url: '/api/v1/users/resolve',
      headers: { ...headers(alice), origin: 'https://untrusted.example' },
      payload: { handles: [bob.user.handle] },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('keeps personal learning, experiences, and jobs scoped to the cookie owner', async () => {
    const at = new Date().toISOString();
    const experience: Experience = {
      id: randomUUID(),
      revision: 0,
      ownerUserId: alice.user.id,
      originalText: 'Private travel detail',
      answers: [],
      summary: 'Private summary',
      interests: ['travel'],
      context: { place: null, people: [], event: null, actions: [] },
      updatedAt: at,
    };
    const item: LearningItem = {
      id: randomUUID(),
      ownerUserId: alice.user.id,
      kind: 'expression',
      expression: 'Private phrase',
      meaning: '개인 표현',
      example: 'Example sentence.',
      source: 'chat',
      sourceKey: `http:${suffix}`,
      sourceStudyId: studyId,
      sourceUtteranceId: null,
      createdAt: at,
    };
    const job: Job = {
      id: randomUUID(),
      revision: 0,
      kind: 'experience.prepare',
      scope: 'user',
      ownerUserId: alice.user.id,
      studyId: null,
      targetId: randomUUID(),
      status: 'running',
      result: null,
      error: null,
      createdAt: at,
      finishedAt: null,
    };
    await db.pool.query('INSERT INTO experiences(id,owner_user_id,data) VALUES($1,$2,$3)', [
      experience.id,
      alice.user.id,
      JSON.stringify(experience),
    ]);
    await db.pool.query(
      'INSERT INTO learning_items(id,owner_user_id,source_key,data) VALUES($1,$2,$3,$4)',
      [item.id, alice.user.id, item.sourceKey, JSON.stringify(item)],
    );
    await db.pool.query('INSERT INTO jobs(id,kind,target_id,status,data) VALUES($1,$2,$3,$4,$5)', [
      job.id,
      job.kind,
      job.targetId,
      job.status,
      JSON.stringify(job),
    ]);
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/v1/me/experiences', headers: headers(alice) })
      ).json().data,
    ).toEqual([experience]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/me/learning-items',
          headers: headers(alice),
        })
      ).json().data,
    ).toEqual([item]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/me/learning-items?ownerUserId=${alice.user.id}`,
          headers: headers(bob),
        })
      ).json().data,
    ).toEqual([]);
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/v1/me/experiences', headers: headers(bob) })
      ).json().data,
    ).toEqual([]);
    const {
      id: _id,
      revision: _revision,
      ownerUserId: _owner,
      updatedAt: _updated,
      ...fields
    } = experience;
    const deniedEdit = await app.inject({
      method: 'PATCH',
      url: `/api/v1/me/experiences/${experience.id}`,
      headers: headers(bob),
      payload: { ...fields, summary: 'Unauthorized overwrite', commandId: randomUUID() },
    });
    expect(deniedEdit.statusCode).toBe(403);
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/jobs/${job.id}`, headers: headers(bob) }))
        .statusCode,
    ).toBe(403);
    const publicSnapshot = await app.inject({
      method: 'GET',
      url: `/api/v1/studies/${studyId}`,
      headers: headers(bob),
    });
    StudySnapshotSchema.parse(publicSnapshot.json().data);
    expect(publicSnapshot.body).not.toContain('Private');
    expect(publicSnapshot.body).not.toContain(job.id);
  });

  it('serves persisted image bytes after reassembly and denies unrelated users', async () => {
    const bytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aUv0AAAAASUVORK5CYII=',
      'base64',
    );
    const { mediaId } = await media.put({
      kind: 'image',
      studyId,
      bytes,
      contentType: 'image/png',
    });
    const second = await server();
    try {
      const image = await second.instance.inject({
        method: 'GET',
        url: `/api/v1/media/${mediaId}`,
        headers: headers(alice),
      });
      expect(image.statusCode).toBe(200);
      expect(image.rawPayload).toEqual(bytes);
      expect(image.headers['cache-control']).toBe('no-store');
      expect(image.headers['content-type']).toBe('image/png');
      const denied = await second.instance.inject({
        method: 'GET',
        url: `/api/v1/media/${mediaId}`,
        headers: headers(stranger),
      });
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error.code).toBe('NOT_MEMBER');
    } finally {
      await second.instance.close();
    }
  });
});
