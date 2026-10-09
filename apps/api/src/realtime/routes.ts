import { EventClientMessageSchema, type User } from '@devday/contracts';
import type {} from '@fastify/websocket';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ApiConfig } from '../config.js';
import type { DomainService } from '../domain/service.js';
import { safeError } from '../http/errors.js';
import { assertBrowserOrigin, authenticateRequest } from '../http/security.js';
import type { EventHub } from './event-hub.js';

export function registerEventRoutes(
  app: FastifyInstance,
  {
    service,
    hub,
    config,
  }: {
    service: DomainService;
    hub: EventHub;
    config: ApiConfig;
  },
): void {
  const authenticated = new WeakMap<FastifyRequest, User>();
  app.get(
    '/ws/events',
    {
      websocket: true,
      preValidation: async (request) => {
        assertBrowserOrigin(request, config);
        authenticated.set(request, await authenticateRequest(request, service));
      },
    },
    (socket, request) => {
      const user = authenticated.get(request);
      if (!user) {
        socket.close(1008, 'Authentication required');
        return;
      }
      const actor = { userId: user.id };
      const connection = hub.connect(user.id, socket);
      let alive = true;
      let pending = Promise.resolve();
      const heartbeat = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        if (socket.readyState === 1) socket.ping();
      }, 20_000);
      heartbeat.unref();
      socket.on('pong', () => {
        alive = true;
      });
      socket.on('close', () => {
        clearInterval(heartbeat);
        hub.disconnect(connection);
      });
      socket.on('error', (error) => {
        request.log.warn({ err: error, requestId: request.id }, 'Event socket failed');
        clearInterval(heartbeat);
        hub.disconnect(connection);
      });
      // Install listeners synchronously. Authorization occurs in preValidation before upgrade.
      socket.on('message', (raw, binary) => {
        pending = pending
          .then(async () => {
            if (connection.closed) return;
            try {
              const bytes = Array.isArray(raw)
                ? Buffer.concat(raw)
                : Buffer.isBuffer(raw)
                  ? raw
                  : Buffer.from(raw);
              if (binary || bytes.byteLength > 16_384)
                throw new SyntaxError('Invalid event message');
              const parsed = EventClientMessageSchema.parse(JSON.parse(bytes.toString()));
              if (parsed.type === 'heartbeat.pong') {
                alive = true;
                return;
              }
              if (parsed.type === 'heartbeat.ping') {
                socket.send(JSON.stringify({ type: 'heartbeat.pong' }));
                return;
              }
              await service.assertMember(actor, parsed.studyId);
              const subscription = hub.beginStudySubscription(connection, parsed.studyId);
              try {
                subscription.complete(await service.snapshot(actor, parsed.studyId));
              } catch (error) {
                subscription.cancel();
                throw error;
              }
            } catch (error) {
              const safe =
                error instanceof SyntaxError
                  ? {
                      error: {
                        code: 'INVALID_INPUT',
                        message: '이벤트 메시지 형식을 확인해 주세요.',
                        details: null,
                      },
                    }
                  : safeError(error);
              if (socket.readyState === 1)
                socket.send(
                  JSON.stringify({ type: 'error', error: safe.error, requestId: request.id }),
                );
              if (safe.error.code === 'INTERNAL_ERROR')
                request.log.error(
                  { err: error, requestId: request.id },
                  'Event subscription failed',
                );
            }
          })
          .catch((error) => request.log.error({ err: error }, 'Event socket handler failed'));
      });
    },
  );
  app.addHook('onClose', async () => {
    hub.close();
  });
}
