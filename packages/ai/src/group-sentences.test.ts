import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { SpeechGroup, TranscriptSegment } from '@devday/contracts';
import { mapGroupSentenceRanges } from './group-sentences.js';
import { validateSentences } from '../../../apps/api/src/domain/speech.js';

function fixture(parts: string[], corrected: string) {
  const id = randomUUID(),
    speakerUserId = randomUUID(),
    studyId = randomUUID(),
    topicId = randomUUID(),
    time = new Date().toISOString();
  const segments: TranscriptSegment[] = parts.map((rawText, startOrder) => ({
    id: randomUUID(),
    revision: 1,
    studyId,
    topicId,
    speakerUserId,
    startOrder,
    startedAt: time,
    endedAt: time,
    rawText,
    rawStatus: 'ready',
    correctedText: null,
    correctionStatus: 'ready',
    sentenceStatus: 'pending',
    groupId: id,
  }));
  const group: SpeechGroup = {
    id,
    revision: 1,
    studyId,
    topicId,
    speakerUserId,
    startOrder: 0,
    segmentIds: segments.map((s) => s.id),
    rawRevisions: parts.map(() => 1),
    rawText: parts.join('\n'),
    correctedText: corrected,
    state: 'ready',
    startedAt: time,
    endedAt: time,
    closeReason: 'mic_off',
    attemptId: randomUUID(),
    error: null,
  };
  return { segments, group };
}
describe('group sentence provenance', () => {
  it('uses raw segment ranges and a single group correction range, including UTF-16 offsets', () => {
    const { segments, group } = fixture(
      ['🙂 I participated', 'in a hackathon.'],
      '🙂 I participated in a hackathon.',
    );
    const drafts = mapGroupSentenceRanges(segments, [group], {
      sentences: [
        {
          slices: [
            { segmentId: group.id, rawSlice: group.rawText, correctedSlice: group.correctedText! },
          ],
        },
      ],
    });
    expect(drafts[0]!.sourceRanges[0]).toMatchObject({
      version: 2,
      groupId: group.id,
      rawSources: [
        { segmentId: segments[0]!.id, start: 0, end: 17 },
        { segmentId: segments[1]!.id, start: 0, end: 15 },
      ],
      audioSegmentIds: segments.map((s) => s.id),
    });
    expect(() => validateSentences(segments, drafts, [group])).not.toThrow();
    expect(() =>
      validateSentences(segments, [drafts[0]!, { ...drafts[0]!, sentenceIndex: 1 }], [group]),
    ).toThrow();
  });
  it('canonicalizes virtual separator whitespace without dropping any source character', () => {
    const { segments, group } = fixture(['Yes.', 'No.'], 'Yes. No.');
    const drafts = mapGroupSentenceRanges(segments, [group], {
      sentences: [
        { slices: [{ segmentId: group.id, rawSlice: 'Yes.\n', correctedSlice: 'Yes. ' }] },
        { slices: [{ segmentId: group.id, rawSlice: 'No.', correctedSlice: 'No.' }] },
      ],
    });
    expect(drafts.map((d) => d.rawText)).toEqual(['Yes.', 'No.']);
    expect(() => validateSentences(segments, drafts, [group])).not.toThrow();
    const bad = structuredClone(drafts);
    bad[0]!.sourceRanges[0]!.correctedEnd = 3;
    expect(() => validateSentences(segments, bad, [group])).toThrow();
  });
});
