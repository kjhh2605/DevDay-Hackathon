import type { DomainEvent, StudySnapshot } from '@devday/contracts';

export function upsertRevision<T extends { revision: number }>(
  items: T[],
  item: T,
  key: (item: T) => string,
) {
  const previous = items.find((value) => key(value) === key(item));
  if (previous && previous.revision >= item.revision) return items;
  return previous
    ? items.map((value) => (key(value) === key(item) ? item : value))
    : [...items, item];
}
/** Event data is already schema-validated by the shared client. No private DTO enters this snapshot. */
export function applyStudyEvent(snapshot: StudySnapshot, event: DomainEvent): StudySnapshot {
  if (event.studyId !== snapshot.study.id) return snapshot;
  switch (event.type) {
    case 'study.changed': {
      if (event.payload.study.revision < snapshot.study.revision) return snapshot;
      const changedTopic = event.payload.topic?.id !== snapshot.topic?.id;
      return {
        ...snapshot,
        ...event.payload,
        jobs: event.payload.jobs.reduce(
          (items, item) => upsertRevision(items, item, (value) => value.id),
          snapshot.jobs,
        ),
        topic:
          !changedTopic &&
          snapshot.topic &&
          event.payload.topic &&
          snapshot.topic.revision > event.payload.topic.revision
            ? snapshot.topic
            : event.payload.topic,
        ...(changedTopic ? { segments: [], speechGroups: [], utterances: [], feedback: [] } : {}),
      };
    }
    case 'transcript.segment.updated':
      if (event.payload.topicId !== snapshot.topic?.id) return snapshot;
      return {
        ...snapshot,
        segments: upsertRevision(snapshot.segments, event.payload, (item) => item.id),
      };
    case 'speech.group.updated':
      if (event.payload.topicId !== snapshot.topic?.id) return snapshot;
      return {
        ...snapshot,
        speechGroups: upsertRevision(snapshot.speechGroups ?? [], event.payload, (item) => item.id),
      };
    case 'utterance.updated':
      if (event.payload.topicId !== snapshot.topic?.id) return snapshot;
      return {
        ...snapshot,
        utterances: upsertRevision(snapshot.utterances, event.payload, (item) => item.id),
      };
    case 'feedback.updated': {
      const utterance = snapshot.utterances.find((value) => value.id === event.payload.utteranceId);
      if (!utterance || event.payload.inputCorrectionRevision !== utterance.correctionRevision)
        return snapshot;
      return {
        ...snapshot,
        feedback: upsertRevision(snapshot.feedback, event.payload, (item) => item.utteranceId),
      };
    }
    case 'job.updated':
      if (event.payload.scope !== 'study') return snapshot;
      return { ...snapshot, jobs: upsertRevision(snapshot.jobs, event.payload, (item) => item.id) };
    case 'shared-expression.added':
      if (snapshot.sharedExpressions.some((item) => item.id === event.payload.id)) return snapshot;
      return { ...snapshot, sharedExpressions: [...snapshot.sharedExpressions, event.payload] };
    default:
      return snapshot;
  }
}
export const topicLabels: Record<NonNullable<StudySnapshot['topic']>['state'], string> = {
  generating: '주제를 준비하고 있어요',
  talking: '대화 중',
  closing: '마지막 이야기까지 정리 중',
  review: '함께 검토해요',
  approved: '검토 완료',
  failed: '주제를 만들지 못했어요',
};

/** Merge GET/subscription snapshots without erasing newer events already received on the open socket. */
export function mergeSnapshot(
  current: StudySnapshot | undefined,
  incoming: StudySnapshot,
): StudySnapshot {
  if (!current || current.study.id !== incoming.study.id) return incoming;
  const newerStudy = current.study.revision > incoming.study.revision ? current : incoming;
  const sharedExpressions = [
    ...new Map(
      [...incoming.sharedExpressions, ...current.sharedExpressions].map((item) => [item.id, item]),
    ).values(),
  ];
  const jobs = current.jobs.reduce(
    (items, item) => upsertRevision(items, item, (value) => value.id),
    incoming.jobs,
  );
  if (current.topic?.id !== incoming.topic?.id) return { ...newerStudy, sharedExpressions, jobs };
  return {
    ...newerStudy,
    topic:
      current.topic && incoming.topic && current.topic.revision > incoming.topic.revision
        ? current.topic
        : incoming.topic,
    sharedExpressions,
    jobs,
    speechGroups: (current.speechGroups ?? []).reduce(
      (items, item) => upsertRevision(items, item, (value) => value.id),
      incoming.speechGroups ?? [],
    ),
    segments: current.segments.reduce(
      (items, item) => upsertRevision(items, item, (value) => value.id),
      incoming.segments,
    ),
    utterances: current.utterances.reduce(
      (items, item) => upsertRevision(items, item, (value) => value.id),
      incoming.utterances,
    ),
    feedback: current.feedback.reduce(
      (items, item) => upsertRevision(items, item, (value) => value.utteranceId),
      incoming.feedback,
    ),
  };
}
