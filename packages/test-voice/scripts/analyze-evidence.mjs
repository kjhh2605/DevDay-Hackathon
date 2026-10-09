// Read-only analysis of completed live evidence; does not invoke APIs or rerun audio.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const path = process.argv[2];
assert(path, 'Usage: node scripts/analyze-evidence.mjs <blackhole-run.json>');
const evidence = JSON.parse(await readFile(path, 'utf8'));
const anchors = {
  'mixed-missing-word': ['예약', '품절'],
  'mixed-missing-expression': ['눈치가', '보여서', '말을', '못', '했어요', '미뤘어요'],
};
const samples = evidence.samples.map((sample) => {
  const segments = (evidence.segments ?? []).filter((segment) =>
    sample.newSegments.includes(segment.id),
  );
  const transcript = segments.map((segment) => segment.rawText ?? '').join(' ');
  return {
    id: sample.id,
    expectedText: sample.expectedText,
    transcript,
    segments: segments.length,
    ready: segments.filter((segment) => segment.rawStatus === 'ready').length,
    expectedKorean: anchors[sample.id] ?? [],
    missingKorean: (anchors[sample.id] ?? []).filter(
      (word) => !transcript.replace(/\s/gu, '').includes(word),
    ),
  };
});
const checks = {
  actualBlackHole:
    evidence.fakeMedia === false &&
    evidence.captureDevices?.some((device) => device.label.includes('BlackHole')),
  pcm24kMono:
    evidence.wireFormat?.format === 'pcm16' &&
    evidence.wireFormat?.sampleRate === 24000 &&
    evidence.wireFormat?.channels === 1,
  transmitted: evidence.sent?.['audio.chunk'] > 0,
  acknowledged: evidence.received?.['audio.segment_committed'] === evidence.segments?.length,
  transcribed:
    samples.length > 0 &&
    samples.every(
      (sample) => sample.ready > 0 && sample.ready === sample.segments && sample.transcript.trim(),
    ),
  noAudioErrors: evidence.errors?.length === 0,
  restored:
    evidence.originalDevices.defaultInput === evidence.restoredDevices?.defaultInput &&
    evidence.originalDevices.defaultOutput === evidence.restoredDevices?.defaultOutput,
};
const summary = {
  sourceEvidence: path,
  analyzedAt: new Date().toISOString(),
  harnessStatus: evidence.status,
  harnessFailure: evidence.failure ?? null,
  transportStatus: Object.values(checks).every(Boolean) ? 'passed' : 'failed',
  checks,
  recognitionStatus: samples.some((sample) => sample.missingKorean.length)
    ? 'needs-review'
    : 'anchors-present',
  chunks: evidence.sent?.['audio.chunk'],
  committed: evidence.received?.['audio.segment_committed'],
  samples,
};
console.log(JSON.stringify(summary, null, 2));
if (summary.transportStatus === 'failed') process.exitCode = 1;
