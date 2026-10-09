import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { OpenAIProvider, loadAiConfig, type AiProvider } from '@devday/ai';
import { loadConfig, type ApiConfig } from './config.js';
import { createDatabase, type Database } from './db/client.js';
import { DomainService } from './domain/service.js';
import { EventHub } from './realtime/event-hub.js';
import { registerEventRoutes } from './realtime/routes.js';
import { registerHttpRoutes } from './http/routes.js';
import { assertBrowserOrigin, authenticateRequest } from './http/security.js';
import { createMediaStore } from './storage/media.js';
import { createAiFeature } from './features/ai/index.js';
export interface AppOptions {
  config?: ApiConfig;
  db?: Database;
  provider?: AiProvider;
  interruptJobs?: boolean;
  logger?: boolean;
}
export async function createApp(options: AppOptions = {}) {
  const config = options.config ?? loadConfig();
  const db = options.db ?? (await createDatabase(config));
  const app = Fastify({
    logger: options.logger ?? config.nodeEnv !== 'test',
    trustProxy: config.appEnv === 'aws',
    bodyLimit: 1_048_576,
    genReqId: () => crypto.randomUUID(),
  });
  await app.register(cookie);
  await app.register(websocket, { options: { maxPayload: 256_000 } });
  const hub = new EventHub();
  const service = new DomainService(db, hub);
  const media = createMediaStore(config.media, service.mediaRepository);
  const ports = service.ports(media);
  let provider = options.provider;
  if (!provider && config.aiMode === 'mock') {
    const { MockAiProvider } = await import('@devday/ai');
    provider = new MockAiProvider();
  }
  if (!provider)
    provider = new OpenAIProvider(
      loadAiConfig({
        OPENAI_API_KEY: config.openai.apiKey,
        OPENAI_TEXT_MODEL: config.openai.textModel,
        OPENAI_LIVE_TRANSCRIBE_MODEL: config.openai.liveTranscribeModel,
        OPENAI_CORRECTION_MODEL: config.openai.correctionModel,
        OPENAI_IMAGE_MODEL: config.openai.imageModel,
      }),
    );
  const ai = createAiFeature({ ports, provider });
  service.aiJobs = ai.jobs;
  app.get('/healthz', async () => ({ status: 'ok' }));
  app.get('/readyz', async (_request, reply) => {
    const ready = await db.ready();
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'not_ready' });
  });
  registerHttpRoutes(app, { service, aiJobs: ai.jobs, config });
  registerEventRoutes(app, { service, hub, config });
  ai.registerAudio(app, async (request) => {
    assertBrowserOrigin(request, config);
    return { userId: (await authenticateRequest(request, service)).id };
  });
  if (options.interruptJobs !== false && (await db.ready())) await service.interruptJobs();
  app.addHook('onClose', async () => {
    if (!options.db) await db.close();
  });
  return { app, service, db, config };
}
