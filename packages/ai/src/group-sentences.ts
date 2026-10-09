import type { SpeechGroup, TranscriptSegment } from '@devday/contracts';
import type { SentenceDraft } from '@devday/application-ports';
import { mapSentenceRanges, type SentencePlan, type SentenceSource } from './sentences.js';

export function sentenceSources(
  segments: TranscriptSegment[],
  groups: SpeechGroup[],
): SentenceSource[] {
  return [
    ...segments.filter((s) => !s.groupId && !s.noSpeech),
    ...groups.filter((g) => g.state !== 'no_speech'),
  ];
}
/** Group text uses exactly one newline between original segment texts. */
export function mapGroupSentenceRanges(
  segments: TranscriptSegment[],
  groups: SpeechGroup[],
  plan: SentencePlan,
): SentenceDraft[] {
  return mapSentenceRanges(sentenceSources(segments, groups), plan)
    .map((draft) => ({
      ...draft,
      sourceRanges: draft.sourceRanges.map((range) => {
        const group = groups.find((g) => g.id === range.segmentId);
        if (!group) return range;
        let offset = 0;
        const rawSources: { segmentId: string; start: number; end: number }[] = [];
        for (const id of group.segmentIds) {
          const segment = segments.find((s) => s.id === id);
          if (!segment || segment.rawText === null || segment.speakerUserId !== group.speakerUserId)
            throw new Error('INVALID_GROUP_SOURCE');
          const start = Math.max(0, range.rawStart - offset);
          const end = Math.min(segment.rawText.length, range.rawEnd - offset);
          if (end > start) rawSources.push({ segmentId: id, start, end });
          offset += segment.rawText.length + 1;
        }
        if (!rawSources.length)
          rawSources.push({ segmentId: group.segmentIds[0]!, start: 0, end: 0 });
        return {
          version: 2 as const,
          groupId: group.id,
          rawSources,
          correctedStart: range.correctedStart,
          correctedEnd: range.correctedEnd,
          audioSegmentIds: [...group.segmentIds],
        };
      }),
    }))
    .map((draft) => ({
      ...draft,
      rawText: draft.sourceRanges
        .map((range) =>
          'version' in range
            ? range.rawSources
                .map((source) =>
                  segments
                    .find((s) => s.id === source.segmentId)!
                    .rawText!.slice(source.start, source.end),
                )
                .join('\n')
            : segments
                .find((s) => s.id === range.segmentId)!
                .rawText!.slice(range.rawStart, range.rawEnd),
        )
        .join('\n'),
    }));
}
