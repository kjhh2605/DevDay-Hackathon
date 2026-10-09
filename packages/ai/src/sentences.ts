/** Exact UTF-16 ranges, never a second paraphrase of the audio transcript. */
export interface SentenceSource {
  id: string;
  speakerUserId: string;
  startOrder: number;
  startedAt: string;
  endedAt: string | null;
  rawText: string | null;
  correctedText: string | null;
}
export interface SentenceSlice {
  segmentId: string;
  rawSlice: string;
  correctedSlice: string;
}
export interface SentencePlan {
  sentences: { slices: SentenceSlice[] }[];
}
export interface SentenceDraft {
  speakerUserId: string;
  startOrder: number;
  sentenceIndex: number;
  startedAt: string;
  endedAt: string;
  rawText: string;
  correctedText: string;
  sourceRanges: {
    segmentId: string;
    rawStart: number;
    rawEnd: number;
    correctedStart: number;
    correctedEnd: number;
  }[];
}

function locate(source: string, slice: string, cursor: number): [number, number] {
  const start = source.indexOf(slice, cursor);
  if (start < 0 || /\S/u.test(source.slice(cursor, start))) {
    throw new Error(
      'SENTENCE_SOURCE_MISMATCH: slices must exactly cover the original text in order',
    );
  }
  return [start, start + slice.length];
}

export function mapSentenceRanges(sources: SentenceSource[], plan: SentencePlan): SentenceDraft[] {
  const ordered = [...sources].sort((a, b) => a.startOrder - b.startOrder);
  const byId = new Map(
    ordered.map((source, index) => [
      source.id,
      { source, index, rawCursor: 0, correctedCursor: 0 },
    ]),
  );
  if (byId.size !== sources.length) throw new Error('DUPLICATE_SEGMENT');
  const indexes = new Map<number, number>();
  let previousPosition = -1;
  const drafts = plan.sentences.map(({ slices }) => {
    if (!slices.length) throw new Error('EMPTY_SENTENCE');
    const first = byId.get(slices[0]!.segmentId)?.source;
    if (!first) throw new Error('UNKNOWN_SEGMENT');
    const sentenceIndex = indexes.get(first.startOrder) ?? 0;
    indexes.set(first.startOrder, sentenceIndex + 1);
    let last = first;
    let lastSegmentId: string | null = null;
    let rawText = '';
    let correctedText = '';
    const sourceRanges = slices.map((slice) => {
      const entry = byId.get(slice.segmentId);
      if (!entry) throw new Error('UNKNOWN_SEGMENT');
      const { source, index } = entry;
      if (source.speakerUserId !== first.speakerUserId) throw new Error('MIXED_SPEAKERS');
      if (index < previousPosition) throw new Error('OUT_OF_ORDER_SEGMENT');
      if (
        lastSegmentId &&
        lastSegmentId !== source.id &&
        ordered[index - 1]?.id !== lastSegmentId
      ) {
        throw new Error('NONCONTIGUOUS_SENTENCE');
      }
      if (source.rawText === null || source.correctedText === null)
        throw new Error('INCOMPLETE_TRANSCRIPTION');
      const [rawStart, rawEnd] = locate(source.rawText, slice.rawSlice, entry.rawCursor);
      const [correctedStart, correctedEnd] = locate(
        source.correctedText,
        slice.correctedSlice,
        entry.correctedCursor,
      );
      entry.rawCursor = rawEnd;
      entry.correctedCursor = correctedEnd;
      const separator = lastSegmentId && lastSegmentId !== source.id ? '\n' : '';
      rawText += separator + source.rawText.slice(rawStart, rawEnd);
      correctedText += separator + source.correctedText.slice(correctedStart, correctedEnd);
      previousPosition = index;
      lastSegmentId = source.id;
      last = source;
      return { segmentId: source.id, rawStart, rawEnd, correctedStart, correctedEnd };
    });
    if (!/\S/u.test(rawText) && !/\S/u.test(correctedText)) throw new Error('EMPTY_SENTENCE');
    return {
      speakerUserId: first.speakerUserId,
      startOrder: first.startOrder,
      sentenceIndex,
      startedAt: first.startedAt,
      endedAt: last.endedAt ?? last.startedAt,
      rawText,
      correctedText,
      sourceRanges,
    };
  });
  for (const { source, rawCursor, correctedCursor } of byId.values()) {
    if (
      source.rawText === null ||
      source.correctedText === null ||
      /\S/u.test(source.rawText.slice(rawCursor)) ||
      /\S/u.test(source.correctedText.slice(correctedCursor))
    ) {
      throw new Error('UNCOVERED_TRANSCRIPT');
    }
  }
  return drafts;
}
