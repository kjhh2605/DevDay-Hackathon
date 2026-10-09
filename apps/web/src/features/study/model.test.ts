import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@devday/contracts';
import {
  studySnapshot,
  failedJob,
  failedTopic,
  editedUtterance,
  readyFeedback,
  sharedExpression,
} from '../../../../../packages/fixtures/src/data';
import { applyStudyEvent, mergeSnapshot } from './model';
const envelope = {
  version: 1 as const,
  eventId: '00000000-0000-4000-8000-000000000999',
  studyId: studySnapshot.study.id,
  entityId: studySnapshot.study.id,
  entityRevision: 5,
  occurredAt: '2026-10-09T00:00:00.000Z',
  scope: 'study' as const,
};
describe('study snapshot event reconciliation', () => {
  it('preserves terminal failure details when study.changed contains only active jobs', () => {
    const snapshot = { ...studySnapshot, topic: failedTopic, jobs: [failedJob] };
    const event: DomainEvent = {
      ...envelope,
      type: 'study.changed',
      payload: { study: { ...snapshot.study, revision: 5 }, topic: failedTopic, jobs: [] },
    };
    expect(applyStudyEvent(snapshot, event).jobs).toEqual([failedJob]);
  });
  it('does not let a stale snapshot erase a newly accepted shared expression', () => {
    const current = { ...studySnapshot, sharedExpressions: [sharedExpression] };
    expect(mergeSnapshot(current, studySnapshot).sharedExpressions).toEqual([sharedExpression]);
  });
  it('rejects feedback for a correction revision older than the edited sentence', () => {
    const snapshot = { ...studySnapshot, utterances: [editedUtterance], feedback: [] };
    const event: DomainEvent = {
      ...envelope,
      type: 'feedback.updated',
      payload: { ...readyFeedback, revision: 9 },
    };
    expect(applyStudyEvent(snapshot, event).feedback).toEqual([]);
  });
  it('preserves edited raw/correction and new topic state across a delayed GET', () => {
    const current = {
      ...studySnapshot,
      utterances: [editedUtterance, ...studySnapshot.utterances.slice(1)],
      topic: { ...studySnapshot.topic!, revision: 8 },
    };
    const result = mergeSnapshot(current, studySnapshot);
    expect(result.utterances[0]?.correctionRevision).toBe(2);
    expect(result.utterances[0]?.rawText).toBe(studySnapshot.utterances[0]?.rawText);
    expect(result.topic?.revision).toBe(8);
  });
  it('keeps a private job out of the shared snapshot even when it refers to the same study', () => {
    const event: DomainEvent = {
      ...envelope,
      type: 'job.updated',
      scope: 'user',
      payload: { ...failedJob, scope: 'user', ownerUserId: studySnapshot.study.members[0]!.userId },
    };
    expect(applyStudyEvent(studySnapshot, event)).toBe(studySnapshot);
  });
});
