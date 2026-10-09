export {};
if (!process.argv.includes('--run')) {
  console.info(
    'Run pnpm exec tsx scripts/validation/live-branches.ts --run after live-flow has produced its inspection session. This makes paid live OpenAI calls for named and sentence topic branches.',
  );
} else {
  const { runLiveBranches } = await import('../../tests/live/branches.js');
  await runLiveBranches();
}
