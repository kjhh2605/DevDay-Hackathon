import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { TranscriptSegment } from '@devday/contracts';
import type { SentenceDraft } from '@devday/application-ports';
import { validateSentences } from '../src/domain/speech.js';
const speaker = randomUUID(),
  topic = randomUUID(),
  study = randomUUID();
function segment(rawText: string, startOrder = 0, speakerUserId = speaker): TranscriptSegment {
  return {
    id: randomUUID(),
    revision: 2,
    studyId: study,
    topicId: topic,
    speakerUserId,
    startOrder,
    startedAt: '2026-10-09T00:00:00.000Z',
    endedAt: '2026-10-09T00:00:01.000Z',
    rawText,
    rawStatus: 'ready',
    correctedText: rawText,
    correctionStatus: 'ready',
    sentenceStatus: 'pending',
  };
}
function sentence(
  s: TranscriptSegment,
  start = 0,
  end = s.rawText!.length,
  sentenceIndex = 0,
): SentenceDraft {
  return {
    sentenceIndex,
    sourceRanges: [
      { segmentId: s.id, rawStart: start, rawEnd: end, correctedStart: start, correctedEnd: end },
    ],
    speakerUserId: s.speakerUserId,
    startOrder: s.startOrder,
    startedAt: s.startedAt,
    endedAt: s.endedAt!,
    rawText: s.rawText!.slice(start, end),
    correctedText: s.correctedText!.slice(start, end),
  };
}
describe('persisted sentence provenance', () => {
  it('accepts two sentences from one segment and exact UTF-16 slices', () => {
    const s = segment('안녕 👋. Hello human.');
    const boundary = s.rawText!.indexOf('Hello');
    expect(() =>
      validateSentences(
        [s],
        [sentence(s, 0, boundary, 0), sentence(s, boundary, s.rawText!.length, 1)],
      ),
    ).not.toThrow();
  });
  it('accepts a sentence split over two processing segments with one fixed newline', () => {
    const a = segment('I was'),
      b = segment(' 줄 서 있었는데.', 1);
    const joined = sentence(a);
    joined.sourceRanges.push(...sentence(b).sourceRanges);
    joined.rawText += '\n' + b.rawText;
    joined.correctedText += '\n' + b.correctedText;
    expect(() => validateSentences([a, b], [joined])).not.toThrow();
  });
  it('rejects omissions, duplicated characters, invented words and mixed speakers', () => {
    const s = segment('Hello human.');
    expect(() => validateSentences([s], [sentence(s, 0, 5)])).toThrow('누락');
    expect(() => validateSentences([s], [sentence(s), sentence(s, 0, 5, 1)])).toThrow('중복');
    expect(() =>
      validateSentences([s], [{ ...sentence(s), correctedText: 'Hello world.' }]),
    ).toThrow('일치');
    const other = segment('Hello.', 1, randomUUID());
    const mixed = sentence(s);
    mixed.sourceRanges.push(...sentence(other).sourceRanges);
    expect(() => validateSentences([s, other], [mixed])).toThrow('발화자');
  });
});
