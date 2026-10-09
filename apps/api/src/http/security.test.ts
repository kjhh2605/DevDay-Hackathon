import cookie from '@fastify/cookie';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { User } from '@devday/contracts';
import type { ApiConfig } from '../config.js';
import { registerErrorHandler } from './errors.js';
import { assertBrowserOrigin, authenticateRequest, SESSION_COOKIE } from './security.js';

const applications: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

function originApplication(config: Pick<ApiConfig, 'webOrigin' | 'appEnv'>) {
  const app = Fastify();
  applications.push(app);
  registerErrorHandler(app);
  app.addHook('onRequest', async (request) => {
    assertBrowserOrigin(request, config);
  });
  app.post('/mutation', async () => ({ accepted: true }));
  return app;
}

describe('browser origin protection', () => {
  const local = { appEnv: 'local' as const, webOrigin: 'https://192.168.0.5:5173' };

  it.each([
    { origin: 'https://untrusted.example' },
    { origin: 'https://192.168.0.5:5174' },
    { origin: local.webOrigin, 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'cross-site' },
    { 'sec-fetch-site': 'same-site' },
  ])('rejects requests from an unapproved or unverifiable browser origin: %j', async (headers) => {
    const response = await originApplication(local).inject({
      method: 'POST',
      url: '/mutation',
      headers,
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe('NOT_OWNER');
  });

  it.each([
    { origin: local.webOrigin, 'sec-fetch-site': 'same-origin' },
    { origin: local.webOrigin },
    {},
    { 'sec-fetch-site': 'none' },
    { 'sec-fetch-site': 'same-origin' },
  ])('allows the configured origin and supported requests without Origin: %j', async (headers) => {
    const response = await originApplication(local).inject({
      method: 'POST',
      url: '/mutation',
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true });
  });

  it('uses the HTTPS request host in AWS instead of the local development origin', async () => {
    const app = originApplication({ appEnv: 'aws', webOrigin: local.webOrigin });
    const headers = { host: 'study.cloudfront.net', origin: 'https://study.cloudfront.net' };
    expect((await app.inject({ method: 'POST', url: '/mutation', headers })).statusCode).toBe(200);
    for (const origin of [
      'http://study.cloudfront.net',
      'https://other.cloudfront.net',
      local.webOrigin,
    ]) {
      expect(
        (await app.inject({ method: 'POST', url: '/mutation', headers: { ...headers, origin } }))
          .statusCode,
      ).toBe(403);
    }
  });

  it('does not let an untrusted forwarded host bypass AWS origin validation', async () => {
    const app = originApplication({ appEnv: 'aws', webOrigin: local.webOrigin });
    const response = await app.inject({
      method: 'POST',
      url: '/mutation',
      headers: {
        host: 'study.cloudfront.net',
        'x-forwarded-host': 'untrusted.example',
        origin: 'https://untrusted.example',
      },
    });
    expect(response.statusCode).toBe(403);
  });
});

describe('cookie session authentication', () => {
  const user: User = {
    id: 'd4eadf82-4ef5-4e69-bef8-7f6bfe7c9d65',
    handle: 'learner',
    displayName: '학습자',
  };

  function sessionApplication(result: User | null) {
    const app = Fastify();
    applications.push(app);
    registerErrorHandler(app);
    app.register(cookie);
    const authenticate = vi.fn(async (_token: string) => result);
    app.get('/me', (request) => authenticateRequest(request, { authenticate }));
    return { app, authenticate };
  }

  it.each([undefined, `${SESSION_COOKIE}=`])(
    'rejects a missing or empty session without querying storage: %s',
    async (session) => {
      const { app, authenticate } = sessionApplication(user);
      const response = await app.inject({
        method: 'GET',
        url: '/me',
        headers: session === undefined ? {} : { cookie: session },
      });
      expect(response.statusCode).toBe(401);
      expect(response.json().error.code).toBe('UNIDENTIFIED');
      expect(authenticate).not.toHaveBeenCalled();
    },
  );

  it('passes the session cookie to storage and returns the authenticated user', async () => {
    const { app, authenticate } = sessionApplication(user);
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: `${SESSION_COOKIE}=opaque-session-token` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(user);
    expect(authenticate).toHaveBeenCalledExactlyOnceWith('opaque-session-token');
  });

  it('rejects expired or unknown sessions', async () => {
    const { app, authenticate } = sessionApplication(null);
    const response = await app.inject({
      method: 'GET',
      url: '/me',
      headers: { cookie: `${SESSION_COOKIE}=expired-token` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNIDENTIFIED');
    expect(authenticate).toHaveBeenCalledExactlyOnceWith('expired-token');
  });
});
