import { describe, it, expect } from 'vitest';
import { mapSentenceRanges, type SentenceSource } from './sentences.js';
const source = (id: string, text: string, order = 0, speaker = 'a'): SentenceSource => ({
  id,
  rawText: text,
  correctedText: text,
  startOrder: order,
  speakerUserId: speaker,
  startedAt: '2026-10-09T00:00:00.000Z',
  endedAt: '2026-10-09T00:00:01.000Z',
});
const slice = (segmentId: string, rawSlice: string, correctedSlice = rawSlice) => ({
  segmentId,
  rawSlice,
  correctedSlice,
});
describe('exact sentence provenance', () => {
  it('splits one segment and joins a sentence across segments without changing its text', () => {
    const result = mapSentenceRanges(
      [source('s1', '안녕 😀. I was'), source('s2', '줄 서 있었는데. Human.', 1)],
      {
        sentences: [
          { slices: [slice('s1', '안녕 😀.')] },
          { slices: [slice('s1', ' I was'), slice('s2', '줄 서 있었는데.')] },
          { slices: [slice('s2', ' Human.')] },
        ],
      },
    );
    expect(result.map((r) => r.rawText)).toEqual([
      '안녕 😀.',
      ' I was\n줄 서 있었는데.',
      ' Human.',
    ]);
    expect(result[0]?.sourceRanges[0]?.rawEnd).toBe(6); // JS UTF-16, emoji takes two code units.
    expect(result.map((r) => [r.startOrder, r.sentenceIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });
  it('rejects rewritten, dropped, duplicated, reordered, and cross-speaker text', () => {
    expect(() =>
      mapSentenceRanges([source('x', 'I goed.')], {
        sentences: [{ slices: [slice('x', 'I went.')] }],
      }),
    ).toThrow();
    expect(() =>
      mapSentenceRanges([source('x', 'One. Two.')], {
        sentences: [{ slices: [slice('x', 'One.')] }],
      }),
    ).toThrow('UNCOVERED');
    expect(() =>
      mapSentenceRanges([source('x', 'One.')], {
        sentences: [{ slices: [slice('x', 'One.')] }, { slices: [slice('x', 'One.')] }],
      }),
    ).toThrow();
    expect(() =>
      mapSentenceRanges([source('x', 'One.'), source('y', 'Two.', 1, 'b')], {
        sentences: [{ slices: [slice('x', 'One.'), slice('y', 'Two.')] }],
      }),
    ).toThrow('MIXED_SPEAKERS');
    expect(() =>
      mapSentenceRanges([source('x', 'One.'), source('y', 'Two.', 1)], {
        sentences: [{ slices: [slice('y', 'Two.')] }, { slices: [slice('x', 'One.')] }],
      }),
    ).toThrow();
  });
  it('keeps different raw and corrected spellings with independent ranges', () => {
    const result = mapSentenceRanges(
      [{ ...source('x', '핵톤. 흠.'), correctedText: '해커톤. human.' }],
      {
        sentences: [
          { slices: [slice('x', '핵톤.', '해커톤.')] },
          { slices: [slice('x', ' 흠.', ' human.')] },
        ],
      },
    );
    expect(result[1]?.sourceRanges[0]).toMatchObject({
      rawStart: 3,
      correctedStart: 4,
      rawEnd: 6,
      correctedEnd: 11,
    });
  });
});
