import { describe, expect, it, vi } from 'vitest';
import { ApiError, ContractError, EventRevisionTracker, createApiClient } from './index.js';
import { EventSchema } from '@devday/contracts';
import {
  editedUtterance,
  fixtureId,
  fixtureTime,
  readyFeedback,
  studySnapshot,
  transcriptSegments,
  userA,
} from '../../fixtures/src/data.js';

describe('typed client trust boundary', () => {
  it('sends credentials and validates response DTOs', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ data: userA, requestId: 'r-1' })));
    const client = createApiClient({ fetch: fetcher });
    expect(await client.request('me')).toEqual(userA);
    expect(fetcher).toHaveBeenCalledWith(
      '/api/v1/me',
      expect.objectContaining({ credentials: 'include' }),
    );
    fetcher.mockResolvedValue(
      new Response(JSON.stringify({ data: { handle: 'missing-id' }, requestId: 'r-2' })),
    );
    await expect(client.request('me')).rejects.toBeInstanceOf(ContractError);
  });
  it('rejects invalid request before fetch and exposes structured errors without retry', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: 'HANDLE_TAKEN', message: '이미 사용하는 아이디입니다.', details: null },
          requestId: 'r-3',
        }),
        { status: 409 },
      ),
    );
    const client = createApiClient({ fetch: fetcher });
    await expect(
      client.request('register', { body: { displayName: '', handle: 'test' } }),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(
      client.request('register', { body: { displayName: 'Test', handle: 'test' } }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

describe('event revision handling', () => {
  it('delivers every learning invalidation for an owner while ignoring repeated event IDs', () => {
    const tracker = new EventRevisionTracker();
    const notification = (eventId: number, itemId: number) =>
      EventSchema.parse({
        version: 1,
        eventId: fixtureId(eventId),
        type: 'learning-items.changed',
        scope: 'user',
        studyId: null,
        entityId: userA.id,
        entityRevision: 0,
        occurredAt: fixtureTime,
        payload: { itemIds: [fixtureId(itemId)] },
      });
    const firstSave = notification(510, 610);
    const nextSave = notification(511, 611);

    expect(tracker.accept(firstSave)).toBe(true);
    expect(tracker.accept(nextSave)).toBe(true);
    expect(tracker.accept(firstSave)).toBe(false);
    expect(tracker.accept(nextSave)).toBe(false);
  });
  it('delivers explicit close retries for the same stream at revision zero', () => {
    const tracker = new EventRevisionTracker();
    const notification = (eventId: number, closeId: number) =>
      EventSchema.parse({
        version: 1,
        eventId: fixtureId(eventId),
        type: 'audio.flush_requested',
        scope: 'user',
        studyId: studySnapshot.study.id,
        entityId: fixtureId(620),
        entityRevision: 0,
        occurredAt: fixtureTime,
        payload: { topicId: studySnapshot.topic!.id, closeId: fixtureId(closeId) },
      });
    const firstClose = notification(512, 621);
    const retryClose = notification(513, 622);

    expect(tracker.accept(firstClose)).toBe(true);
    expect(tracker.accept(retryClose)).toBe(true);
    expect(tracker.accept(firstClose)).toBe(false);
    expect(tracker.accept(retryClose)).toBe(false);
    // Repeating a control request under a new event ID is handled by the audio controller.
    expect(tracker.accept(notification(514, 622))).toBe(true);
  });
  const event = (
    type: 'utterance.updated' | 'feedback.updated' | 'transcript.partial',
    payload: unknown,
    entityId: string,
    revision: number,
    id: number,
  ) =>
    EventSchema.parse({
      version: 1,
      eventId: fixtureId(id),
      type,
      scope: 'study',
      studyId: studySnapshot.study.id,
      entityId,
      entityRevision: revision,
      occurredAt: fixtureTime,
      payload,
    });
  it('ignores duplicate and older entities seeded by the subscription snapshot', () => {
    const tracker = new EventRevisionTracker();
    tracker.seed(studySnapshot);
    const updated = event(
      'utterance.updated',
      editedUtterance,
      editedUtterance.id,
      editedUtterance.revision,
      501,
    );
    expect(tracker.accept(updated)).toBe(true);
    expect(tracker.accept(updated)).toBe(false);
    expect(
      tracker.accept(
        event('utterance.updated', studySnapshot.utterances[0], editedUtterance.id, 1, 502),
      ),
    ).toBe(false);
  });
  it('ignores partials after final raw and late feedback after a human correction', () => {
    const tracker = new EventRevisionTracker();
    tracker.seed(studySnapshot);
    const segment = transcriptSegments[0]!;
    expect(
      tracker.accept(
        event(
          'transcript.partial',
          {
            segmentId: segment.id,
            speakerUserId: segment.speakerUserId,
            startOrder: segment.startOrder,
            partialText: 'late',
            partialRevision: 99,
          },
          segment.id,
          99,
          503,
        ),
      ),
    ).toBe(false);
    tracker.accept(
      event(
        'utterance.updated',
        editedUtterance,
        editedUtterance.id,
        editedUtterance.revision,
        504,
      ),
    );
    expect(
      tracker.accept(
        event(
          'feedback.updated',
          { ...readyFeedback, revision: 5 },
          readyFeedback.utteranceId,
          5,
          505,
        ),
      ),
    ).toBe(false);
    expect(
      tracker.accept(
        event(
          'feedback.updated',
          {
            ...readyFeedback,
            revision: 6,
            inputCorrectionRevision: editedUtterance.correctionRevision,
          },
          readyFeedback.utteranceId,
          6,
          506,
        ),
      ),
    ).toBe(true);
  });
});
