import type { FastifyRequest } from 'fastify';
import type {} from '@fastify/cookie';
import type { User } from '@devday/contracts';
import type { ApiConfig } from '../config.js';
import { DomainError } from '../domain/errors.js';

export const SESSION_COOKIE = 'devday_session';
type SessionReader = { authenticate(token: string): Promise<User | null> };

/** Origin is checked before session lookup or any mutation, including registration. */
export function assertBrowserOrigin(
  request: FastifyRequest,
  config: Pick<ApiConfig, 'webOrigin' | 'appEnv'>,
): void {
  const origin = request.headers.origin;
  const fetchSite = request.headers['sec-fetch-site'];
  // request.host honors forwarded host only when Fastify's trusted-proxy policy allows it.
  const expectedOrigin = config.appEnv === 'aws' ? `https://${request.host}` : config.webOrigin;
  if ((origin !== undefined && origin !== expectedOrigin) || fetchSite === 'cross-site') {
    throw new DomainError('NOT_OWNER', '허용되지 않은 요청 출처입니다.', 403);
  }
  // Non-browser tools may omit Origin. Browsers that send fetch metadata may not.
  if (
    origin === undefined &&
    fetchSite !== undefined &&
    fetchSite !== 'same-origin' &&
    fetchSite !== 'none'
  ) {
    throw new DomainError('NOT_OWNER', '요청 출처를 확인할 수 없습니다.', 403);
  }
}

export async function authenticateRequest(
  request: FastifyRequest,
  service: SessionReader,
): Promise<User> {
  const token = request.cookies[SESSION_COOKIE];
  const user = token ? await service.authenticate(token) : null;
  if (!user) throw new DomainError('UNIDENTIFIED', '먼저 이름과 아이디로 가입해 주세요.', 401);
  return user;
}
