import { ErrorCodeSchema, type ApiError } from '@devday/contracts';
import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { DomainError } from '../domain/errors.js';
import { MediaNotFoundError } from '../storage/media.js';

export function safeError(error: unknown): { statusCode: number; error: ApiError } {
  if (error instanceof MediaNotFoundError)
    return {
      statusCode: 404,
      error: { code: 'NOT_FOUND', message: '이미지를 찾을 수 없습니다.', details: null },
    };
  if (error instanceof DomainError && ErrorCodeSchema.safeParse(error.code).success) {
    return {
      statusCode: error.statusCode,
      error: {
        code: ErrorCodeSchema.parse(error.code),
        message: error.message,
        details: error.details as ApiError['details'],
      },
    };
  }
  if (
    error instanceof ZodError ||
    (error instanceof Error && 'statusCode' in error && error.statusCode === 400)
  ) {
    return {
      statusCode: 400,
      error: { code: 'INVALID_INPUT', message: '요청 형식을 확인해 주세요.', details: null },
    };
  }
  return {
    statusCode: 500,
    error: { code: 'INTERNAL_ERROR', message: '요청을 처리하지 못했습니다.', details: null },
  };
}

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    const safe = safeError(error);
    if (safe.statusCode >= 500)
      request.log.error({ err: error, requestId: request.id }, 'Request failed');
    reply
      .code(safe.statusCode)
      .header('cache-control', 'no-store')
      .send({ error: safe.error, requestId: request.id });
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: { code: 'NOT_FOUND', message: '요청한 경로를 찾을 수 없습니다.', details: null },
      requestId: request.id,
    }),
  );
}
