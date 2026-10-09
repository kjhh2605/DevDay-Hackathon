// Explicitly opt in: this command makes paid calls through the real product API.
export {};
if (!process.argv.includes('--run')) {
  console.info(
    'Run pnpm exec tsx scripts/validation/live-flow.ts --run --audio=/absolute/path/mixed.wav',
  );
  console.info(
    'Requires local PostgreSQL, server-only OpenAI credentials, and a 24 kHz mono PCM16 WAV. This is synthetic/file integration evidence, not physical-microphone acceptance.',
  );
} else {
  const { runLiveFlow } = await import('../../tests/live/flow.js');
  await runLiveFlow();
}
