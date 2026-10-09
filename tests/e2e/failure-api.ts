import { AiProviderError, MockAiProvider } from '../../packages/ai/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { authenticateRequest } from '../../apps/api/src/http/security.js';

// This entrypoint is selected only by the isolated Playwright runner. Production
// server.ts has no failure switch, mutation endpoint, or dependency on this file.
if (
  process.env.NODE_ENV !== 'test' ||
  process.env.AI_MODE !== 'mock' ||
  process.env.E2E_FAILURE_MODE !== 'true' ||
  !process.env.DB_NAME?.endsWith('_failure_e2e') ||
  process.env.API_HOST !== '127.0.0.1'
)
  throw new Error('Failure fixtures require the isolated local mock E2E environment.');

const calls = { image: 0, feedback: 0 };
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

class FailureFixtureProvider extends MockAiProvider {
  override async image(prompt: string) {
    const call = ++calls.image;
    if (call === 2) {
      await delay(5_000);
      throw new AiProviderError('E2E_IMAGE_FAILED', 'Deliberate test-only image failure.');
    }
    if (call === 3) await delay(1_500);
    return super.image(prompt);
  }

  override async structured<T>(
    name: string,
    schema: Record<string, unknown>,
    system: string,
    input: unknown,
  ): Promise<T> {
    if (name === 'sentence_feedback') {
      const call = ++calls.feedback;
      await delay(call === 1 ? 5_000 : 1_500);
      if (call === 1)
        throw new AiProviderError('E2E_FEEDBACK_FAILED', 'Deliberate test-only feedback failure.');
    }
    return super.structured<T>(name, schema, system, input);
  }
}

const { app, config, db, service } = await createApp({ provider: new FailureFixtureProvider() });
// Read-only fixture telemetry complements the real HTTP snapshot. Authentication
// and study membership are checked before exposing persisted topic history.
app.get<{ Params: { studyId: string } }>('/api/__e2e/failure-state/:studyId', async (request) => {
  const actor = await authenticateRequest(request, service);
  await service.snapshot({ userId: actor.id }, request.params.studyId);
  const topics = await db.pool.query('SELECT data FROM topics WHERE study_id=$1 ORDER BY ordinal', [
    request.params.studyId,
  ]);
  return { calls: { ...calls }, topics: topics.rows.map((row) => row.data) };
});

try {
  await app.listen({ port: config.port, host: config.host });
} catch (error) {
  app.log.error(error);
  await app.close();
  process.exitCode = 1;
}
let closing = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (closing) return;
    closing = true;
    void app.close().catch((error) => {
      app.log.error(error);
      process.exitCode = 1;
    });
  });
