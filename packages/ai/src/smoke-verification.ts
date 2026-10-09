import { createHash } from 'node:crypto';

export type TranscriptionCheckName =
  | 'koreanPresent'
  | 'learnerGrammarPreserved'
  | 'terminalHumanPresent';
export type TranscriptionCheckStatus = 'passed' | 'failed' | 'not_verified' | 'not_applicable';

/** Inspect the final lexical word, allowing trailing punctuation but not suffixes or compounds. */
export function hasTerminalHuman(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}_]+(?:[-'’][\p{L}\p{N}_]+)*/gu);
  return words?.at(-1)?.toLowerCase() === 'human';
}

/** The input must follow application commit order, never provider completion arrival order. */
export function inspectTranscription(committedTexts: readonly string[]) {
  const combinedText = committedTexts.join('\n');
  return {
    terminalHumanPresent: hasTerminalHuman(committedTexts.at(-1) ?? ''),
    koreanPresent: /[가-힣]/u.test(combinedText),
    learnerGrammarPreserved: /\bI go\b/i.test(combinedText),
  };
}

export interface TranscriptionEvidence {
  capability: string;
  status: 'passed' | 'failed';
  details?: unknown;
}

export function assessTranscriptionChecks(
  expectedText: string | null,
  results: readonly TranscriptionEvidence[],
): {
  status: TranscriptionCheckStatus;
  requiredChecks: TranscriptionCheckName[];
  passed: boolean;
  reason: string;
} {
  const transcription = results.filter(
    (result) =>
      result.capability === 'live-transcription' || result.capability === 'same-audio-correction',
  );
  const requiredChecks: TranscriptionCheckName[] = [];
  if (/[가-힣]/u.test(expectedText ?? '')) requiredChecks.push('koreanPresent');
  if (/\bI go\b/i.test(expectedText ?? '')) requiredChecks.push('learnerGrammarPreserved');
  if (hasTerminalHuman(expectedText ?? '')) requiredChecks.push('terminalHumanPresent');
  if (!transcription.length) {
    return {
      status: 'not_applicable',
      requiredChecks,
      passed: false,
      reason: 'No transcription capability was selected.',
    };
  }
  if (!expectedText?.trim() || !requiredChecks.length) {
    return {
      status: 'not_verified',
      requiredChecks,
      passed: false,
      reason:
        'Expected speech with supported verification markers is required; successful API access alone does not verify transcription.',
    };
  }
  const passed = transcription.every((result) => {
    if (result.status !== 'passed' || !result.details || typeof result.details !== 'object')
      return false;
    const details = result.details as Record<string, unknown>;
    return requiredChecks.every((name) => details[name] === true);
  });
  return {
    status: passed ? 'passed' : 'failed',
    requiredChecks,
    passed,
    reason: passed
      ? 'All selected transcription results preserve the specified markers.'
      : 'A selected transcription failed or did not preserve a specified marker.',
  };
}

/** Restricts the input to evidence fields; config/environment objects and credentials are excluded. */
export function smokeProvenance(input: {
  pcm: Uint8Array;
  wav: Uint8Array;
  turns: readonly Uint8Array[];
  livePrompt: string;
  correctionPrompt: string;
  runtimeSources: Readonly<Record<string, string>>;
  nodeVersion: string;
}) {
  const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  const sourceEntries = Object.entries(input.runtimeSources).sort(([a], [b]) => a.localeCompare(b));
  const sourceHashes = Object.fromEntries(
    sourceEntries.map(([path, source]) => [path, sha256(source)]),
  );
  return {
    hashAlgorithm: 'sha256' as const,
    audio: {
      pcmSha256: sha256(input.pcm),
      wavSha256: sha256(input.wav),
      turns: input.turns.map((turn, index) => ({
        index,
        byteLength: turn.byteLength,
        pcmSha256: sha256(turn),
      })),
    },
    prompts: {
      liveSha256: sha256(input.livePrompt),
      correctionSha256: sha256(input.correctionPrompt),
    },
    runtime: {
      sourceScope:
        'Only the explicitly listed AI source files; excludes unlisted repository files and installed dependencies.',
      nodeVersion: input.nodeVersion,
      sources: sourceHashes,
      sourceSetSha256: sha256(JSON.stringify(sourceHashes)),
    },
  };
}
