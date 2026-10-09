import { createApp } from '../../apps/api/src/app.js';

const { app, config } = await createApp({ logger: false });
await app.listen({ host: config.host, port: config.port });
process.send?.({ type: 'ready' });
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  process.exit(0);
}
process.on('SIGTERM', () => {
  void close();
});
process.on('SIGINT', () => {
  void close();
});
