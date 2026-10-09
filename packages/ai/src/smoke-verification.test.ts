import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import {
  assessTranscriptionChecks,
  hasTerminalHuman,
  inspectTranscription,
  smokeProvenance,
} from './smoke-verification.js';

const expected = '어제 친구를 만났어요. Yesterday I go to a cafe. The last word is human.';
const first = '어제 친구를 만났어요. Yesterday I go to a cafe.';
const result = (turns: string[]) => ({
  capability: 'live-transcription',
  status: 'passed' as const,
  details: inspectTranscription(turns),
});

describe('terminal speech verification', () => {
  it.each(['human', 'The last word is human.', 'But word is HUMAN!”', 'human…'])(
    'accepts the exact terminal word: %s',
    (text) => {
      expect(hasTerminalHuman(text)).toBe(true);
    },
  );
  it.each([
    'humanity',
    'inhuman',
    'human2',
    'human_error',
    "human's",
    'super-human',
    'human is missing at the end.',
    '',
    '휴먼',
  ])('rejects substring, compound or nonterminal match: %s', (text) => {
    expect(hasTerminalHuman(text)).toBe(false);
  });
  it('requires the last committed item rather than an earlier occurrence or completion arrival order', () => {
    const received = new Map([
      ['last', 'tail was lost.'],
      ['first', `${first} human.`],
    ]);
    const committed = ['first', 'last'];
    const details = inspectTranscription(committed.map((id) => received.get(id)!));
    expect(details.terminalHumanPresent).toBe(false);
    expect(inspectTranscription([`${first} human.`, '']).terminalHumanPresent).toBe(false);
    expect(inspectTranscription([first, 'But word is human.']).terminalHumanPresent).toBe(true);
  });
  it('preserves both archived outcomes without claiming exact transcript accuracy', () => {
    expect(
      assessTranscriptionChecks(expected, [result([first, 'But toward 이제 휴먼'])]).status,
    ).toBe('failed');
    expect(assessTranscriptionChecks(expected, [result([first, 'But word is human'])]).status).toBe(
      'passed',
    );
  });
});

describe('explicit transcription verification states', () => {
  it.each([null, '', '   ', 'Hello world.', 'human occurred earlier, then goodbye.'])(
    'does not pass without a supported reference: %s',
    (reference) => {
      const assessment = assessTranscriptionChecks(reference, [result([first, 'human.'])]);
      expect(assessment.status).toBe('not_verified');
      expect(assessment.passed).toBe(false);
    },
  );
  it('checks every selected audio capability and rejects provider failure', () => {
    const results = [
      result([first, 'human.']),
      {
        capability: 'same-audio-correction',
        status: 'passed' as const,
        details: inspectTranscription([`${first} humanity.`]),
      },
    ];
    expect(assessTranscriptionChecks(expected, results).status).toBe('failed');
    expect(
      assessTranscriptionChecks(expected, [{ capability: 'live-transcription', status: 'failed' }])
        .status,
    ).toBe('failed');
  });
  it('records that a text/image-only run did not verify transcription', () => {
    expect(
      assessTranscriptionChecks(null, [{ capability: 'image-generation', status: 'passed' }]),
    ).toMatchObject({ status: 'not_applicable', passed: false });
  });
});

describe('smoke evidence provenance', () => {
  const input = {
    pcm: new Uint8Array([1, 2, 3, 4]),
    wav: new Uint8Array([5, 6, 7, 8]),
    turns: [new Uint8Array([1, 2]), new Uint8Array([3, 4])],
    livePrompt: 'English conversation context.',
    correctionPrompt: '한국어와 영어 대화.\n카페',
    runtimeSources: {
      'packages/ai/src/provider.ts': 'provider code',
      'packages/ai/src/prompts.ts': 'prompt code',
    },
    nodeVersion: 'v24.test',
  };
  const digest = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
  it('records independent exact prompt, audio, per-turn and runtime-source hashes', () => {
    const evidence = smokeProvenance(input);
    expect(evidence.audio.pcmSha256).toBe(digest(input.pcm));
    expect(evidence.audio.wavSha256).toBe(digest(input.wav));
    expect(evidence.audio.turns).toEqual(
      input.turns.map((turn, index) => ({
        index,
        byteLength: turn.byteLength,
        pcmSha256: digest(turn),
      })),
    );
    expect(evidence.prompts).toEqual({
      liveSha256: digest(input.livePrompt),
      correctionSha256: digest(input.correctionPrompt),
    });
    expect(evidence.runtime.sources['packages/ai/src/provider.ts']).toBe(digest('provider code'));
    expect(evidence.runtime.nodeVersion).toBe(input.nodeVersion);
    expect(JSON.stringify(evidence)).not.toContain(input.livePrompt);
    expect(JSON.stringify(evidence)).not.toContain(input.correctionPrompt);
  });
  it('detects source and prompt changes without depending on map insertion order', () => {
    const before = smokeProvenance(input);
    const reversed = smokeProvenance({
      ...input,
      runtimeSources: Object.fromEntries(Object.entries(input.runtimeSources).reverse()),
    });
    expect(reversed.runtime.sourceSetSha256).toBe(before.runtime.sourceSetSha256);
    const changed = smokeProvenance({
      ...input,
      livePrompt: 'Changed live prompt',
      runtimeSources: {
        ...input.runtimeSources,
        'packages/ai/src/provider.ts': 'changed provider',
      },
    });
    expect(changed.runtime.sourceSetSha256).not.toBe(before.runtime.sourceSetSha256);
    expect(changed.prompts.liveSha256).not.toBe(before.prompts.liveSha256);
    expect(changed.prompts.correctionSha256).toBe(before.prompts.correctionSha256);
  });
});
