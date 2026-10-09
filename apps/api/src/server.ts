import { createApp } from './app.js';
const { app, config } = await createApp();
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
