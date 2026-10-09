import Fastify, { type FastifyInstance } from 'fastify';
import { ErrorEnvelopeSchema } from '@devday/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { DomainError } from '../domain/errors.js';
import { registerErrorHandler, safeError } from './errors.js';

describe('safe API errors', () => {
  it('preserves the documented domain error and its safe details', () => {
    const error = new DomainError('STALE_TOPIC', '현재 주제가 변경되었습니다.', 409, {
      transitionVersion: 2,
    });
    expect(safeError(error)).toEqual({
      statusCode: 409,
      error: { code: 'STALE_TOPIC', message: error.message, details: { transitionVersion: 2 } },
    });
  });

  it.each([
    new Error('Provider request failed: Authorization: Bearer private-provider-token'),
    new DomainError('PROVIDER_INTERNAL_CODE', 'private provider response', 502, {
      request: 'private payload',
    }),
    { message: 'private non-Error rejection', code: 'AI_FAILED', statusCode: 502 },
    'private rejection text',
    null,
  ])('redacts unexpected provider and internal errors: %j', (error) => {
    expect(safeError(error)).toEqual({
      statusCode: 500,
      error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.', details: null },
    });
  });

  it('does not expose schema validation input or diagnostic messages', () => {
    const result = z.object({ handle: z.string().min(1) }).safeParse({ handle: '' });
    if (result.success) throw new Error('Expected invalid test input');
    expect(safeError(result.error)).toEqual({
      statusCode: 400,
      error: { code: 'INVALID_INPUT', message: '요청 형식을 확인해 주세요.', details: null },
    });
  });

  it('normalizes framework request parsing errors without exposing raw request content', () => {
    const error = Object.assign(new Error('Invalid JSON: private request content'), {
      statusCode: 400,
    });
    expect(safeError(error)).toEqual({
      statusCode: 400,
      error: { code: 'INVALID_INPUT', message: '요청 형식을 확인해 주세요.', details: null },
    });
  });
});

describe('HTTP error envelopes', () => {
  const applications: FastifyInstance[] = [];
  afterEach(async () => {
    await Promise.all(applications.splice(0).map((app) => app.close()));
  });

  function application() {
    const app = Fastify({ genReqId: () => 'test-request-id' });
    applications.push(app);
    registerErrorHandler(app);
    return app;
  }

  it('returns a non-cacheable contract-valid envelope with a request ID for provider failures', async () => {
    const app = application();
    app.get('/provider', async () => {
      throw new Error('private upstream payload');
    });
    const response = await app.inject('/provider');
    expect(response.statusCode).toBe(500);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(ErrorEnvelopeSchema.parse(response.json())).toEqual({
      error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.', details: null },
      requestId: 'test-request-id',
    });
    expect(response.body).not.toContain('private upstream payload');
  });

  it('retains domain status and safe details in the HTTP response', async () => {
    const app = application();
    app.get('/domain', async () => {
      throw new DomainError('NOT_MEMBER', '스터디 참여자가 아닙니다.', 403);
    });
    const response = await app.inject('/domain');
    expect(response.statusCode).toBe(403);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(ErrorEnvelopeSchema.parse(response.json())).toEqual({
      error: { code: 'NOT_MEMBER', message: '스터디 참여자가 아닙니다.', details: null },
      requestId: 'test-request-id',
    });
  });

  it('converts malformed JSON to INVALID_INPUT before the route executes', async () => {
    const app = application();
    app.post('/input', async () => ({ accepted: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/input',
      headers: { 'content-type': 'application/json' },
      payload: '{"private-input":',
    });
    expect(response.statusCode).toBe(400);
    expect(ErrorEnvelopeSchema.parse(response.json()).error.code).toBe('INVALID_INPUT');
    expect(response.body).not.toContain('private-input');
  });

  it('returns NOT_FOUND in the shared envelope for unknown routes', async () => {
    const response = await application().inject('/missing');
    expect(response.statusCode).toBe(404);
    expect(ErrorEnvelopeSchema.parse(response.json())).toEqual({
      error: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.', details: null },
      requestId: 'test-request-id',
    });
  });
});
