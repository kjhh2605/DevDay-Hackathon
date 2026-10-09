import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setupServer } from 'msw/node';
import {
  EventSchema,
  eventNames,
  endpointRegistry,
  JobSchema,
  StudySnapshotSchema,
  TranscriptSegmentSchema,
  UtteranceSchema,
  FeedbackSchema,
  TopicSchema,
  type EventServerMessage,
} from '@devday/contracts';
import * as fixtures from '../src/index.js';

describe('contract fixtures', () => {
  it('covers every event and every job result kind with schema-valid samples', () => {
    expect(new Set(fixtures.events.map((event) => event.type))).toEqual(new Set(eventNames));
    fixtures.events.forEach((event) => expect(EventSchema.safeParse(event).success).toBe(true));
    expect(new Set(fixtures.jobs.map((job) => job.kind))).toEqual(
      new Set([
        'topic.generate',
        'topic.close',
        'experience.prepare',
        'utterance.feedback',
        'chat.respond',
      ]),
    );
    fixtures.jobs.forEach((job) => expect(JobSchema.safeParse(job).success).toBe(true));
  });

  it('provides image/sentence, live/raw, stale/running/failed, and empty-result branches', () => {
    [
      fixtures.imageTopic,
      fixtures.sentenceTopic,
      fixtures.generatingTopic,
      fixtures.failedTopic,
      fixtures.reviewTopic,
    ].forEach((topic) => expect(TopicSchema.safeParse(topic).success).toBe(true));
    [fixtures.liveSegment, fixtures.rawSegment, ...fixtures.transcriptSegments].forEach((segment) =>
      expect(TranscriptSegmentSchema.safeParse(segment).success).toBe(true),
    );
    [
      fixtures.readyFeedback,
      fixtures.emptyFeedback,
      fixtures.staleFeedback,
      fixtures.runningFeedback,
      fixtures.failedFeedback,
    ].forEach((feedback) => expect(FeedbackSchema.safeParse(feedback).success).toBe(true));
    expect(fixtures.emptyFeedback.status).toBe('ready');
    expect(fixtures.emptyFeedback.items).toEqual([]);
    expect(fixtures.editedUtterance.correctionRevision).toBeGreaterThan(
      fixtures.staleFeedback.inputCorrectionRevision,
    );
    expect(UtteranceSchema.safeParse(fixtures.editedUtterance).success).toBe(true);
  });

  it('keeps source ranges faithful to raw and audio-corrected text', () => {
    for (const utterance of fixtures.utterances) {
      const slices = utterance.sourceRanges.map((range) => {
        if ('version' in range) throw new Error('Expected a legacy fixture');
        const segment = fixtures.transcriptSegments.find((item) => item.id === range.segmentId)!;
        expect(segment.speakerUserId).toBe(utterance.speakerUserId);
        return {
          raw: segment.rawText!.slice(range.rawStart, range.rawEnd),
          corrected: segment.correctedText!.slice(range.correctedStart, range.correctedEnd),
        };
      });
      expect(slices.map((slice) => slice.raw).join('\n')).toBe(utterance.rawText);
      expect(slices.map((slice) => slice.corrected).join('\n')).toBe(utterance.correctedText);
    }
  });

  it('does not put private DTOs or user jobs into a study snapshot', () => {
    const snapshot = fixtures.createFixtureStore().snapshot();
    expect(StudySnapshotSchema.safeParse(snapshot).success).toBe(true);
    expect(Object.keys(snapshot).sort()).toEqual([
      'feedback',
      'jobs',
      'segments',
      'sharedExpressions',
      'study',
      'topic',
      'utterances',
    ]);
    expect(snapshot.jobs.every((job) => job.scope === 'study')).toBe(true);
    expect(JSON.stringify(snapshot)).not.toContain(fixtures.experiences[0]!.originalText);
    expect(JSON.stringify(snapshot)).not.toContain(fixtures.chatMessages[0]!.text);
  });
});

describe('stateful mock store', () => {
  it('reloads only the current owner sharing decisions after navigation', () => {
    const a = fixtures.createFixtureStore({ userId: fixtures.fixtureIds.userA });
    expect(a.execute('shareProposals', { studyId: fixtures.fixtureIds.study }, undefined)).toEqual(
      [],
    );
    const b = fixtures.createFixtureStore({ userId: fixtures.fixtureIds.userB });
    expect(
      b.execute('shareProposals', { studyId: fixtures.fixtureIds.study }, undefined)[0]?.status,
    ).toBe('pending');
    b.execute(
      'decideShareProposal',
      { id: fixtures.pendingProposal.id },
      { accepted: false, commandId: fixtures.fixtureId(399) },
    );
    expect(
      b.execute('shareProposals', { studyId: fixtures.fixtureIds.study }, undefined)[0]?.status,
    ).toBe('declined');
    const invited = fixtures.createFixtureStore({
      scenario: 'waiting',
      userId: fixtures.fixtureIds.userB,
    });
    expect(() =>
      invited.execute('shareProposals', { studyId: fixtures.fixtureIds.study }, undefined),
    ).toThrow(fixtures.FixtureError);
  });

  it('isolates personal lists and requires joining before common reads', () => {
    const store = fixtures.createFixtureStore({
      scenario: 'waiting',
      userId: fixtures.fixtureIds.userB,
    });
    expect(store.execute('invitations', {}, undefined)).toHaveLength(1);
    expect(() =>
      store.execute('studySnapshot', { studyId: fixtures.fixtureIds.study }, undefined),
    ).toThrow(fixtures.FixtureError);
    store.execute(
      'joinStudy',
      { studyId: fixtures.fixtureIds.study },
      { commandId: fixtures.fixtureId(300) },
    );
    expect(store.execute('invitations', {}, undefined)).toHaveLength(0);
    expect(
      store
        .execute('learningItems', {}, undefined)
        .every((item) => item.ownerUserId === fixtures.fixtureIds.userB),
    ).toBe(true);
    expect(
      store
        .execute('experiences', {}, undefined)
        .every((item) => item.ownerUserId === fixtures.fixtureIds.userB),
    ).toBe(true);
    expect(() => store.execute('job', { id: fixtures.experienceJob.id }, undefined)).toThrow(
      '본인의 작업',
    );
  });

  it('retains raw text during edits and rejects outdated feedback requests', () => {
    const store = fixtures.createFixtureStore({ userId: fixtures.fixtureIds.userB });
    const result = store.execute(
      'updateCorrection',
      { id: fixtures.fixtureIds.utteranceA },
      {
        text: 'I tried riding a bicycle.',
        commandId: fixtures.fixtureId(301),
      },
    );
    expect(result.utterance.rawText).toBe(fixtures.utterances[0]!.rawText);
    expect(result.utterance.speakerUserId).toBe(fixtures.fixtureIds.userA);
    expect(result.utterance.correctionRevision).toBe(2);
    expect(result.feedback.status).toBe('stale');
    expect(() =>
      store.execute(
        'requestFeedback',
        { id: fixtures.fixtureIds.utteranceA },
        {
          correctionRevision: 1,
          commandId: fixtures.fixtureId(302),
        },
      ),
    ).toThrow('수정된 문장');
    const job = store.execute(
      'requestFeedback',
      { id: fixtures.fixtureIds.utteranceA },
      {
        correctionRevision: 2,
        commandId: fixtures.fixtureId(303),
      },
    );
    expect(job.status).toBe('running');
    expect(store.state.snapshot.feedback[0]?.inputCorrectionRevision).toBe(2);
  });

  it('replays commands without double mutations and refuses changed command payloads', () => {
    const store = fixtures.createFixtureStore();
    const input = { text: 'I rode a bicycle.', commandId: fixtures.fixtureId(304) };
    const first = store.execute('updateCorrection', { id: fixtures.fixtureIds.utteranceA }, input);
    const replay = store.execute('updateCorrection', { id: fixtures.fixtureIds.utteranceA }, input);
    expect(replay).toEqual(first);
    expect(store.state.snapshot.utterances[0]?.correctionRevision).toBe(2);
    expect(() =>
      store.execute(
        'updateCorrection',
        { id: fixtures.fixtureIds.utteranceA },
        { ...input, text: 'Changed' },
      ),
    ).toThrow('같은 명령 ID');
  });

  it('keeps a proposal private until owner consent and prevents duplicate sharing', () => {
    const store = fixtures.createFixtureStore();
    expect(store.snapshot().sharedExpressions).toEqual([]);
    expect(() =>
      store.execute(
        'decideShareProposal',
        { id: fixtures.fixtureIds.proposal },
        {
          accepted: true,
          commandId: fixtures.fixtureId(305),
        },
      ),
    ).toThrow('본인의 공유 제안');
    store.setCurrentUser(fixtures.fixtureIds.userB);
    const first = store.execute(
      'decideShareProposal',
      { id: fixtures.fixtureIds.proposal },
      {
        accepted: true,
        commandId: fixtures.fixtureId(306),
      },
    );
    const second = store.execute(
      'decideShareProposal',
      { id: fixtures.fixtureIds.proposal },
      {
        accepted: true,
        commandId: fixtures.fixtureId(307),
      },
    );
    expect(second).toEqual(first);
    expect(store.snapshot().sharedExpressions).toHaveLength(1);
  });

  it('preserves private learning when sharing is declined', () => {
    const store = fixtures.createFixtureStore({ userId: fixtures.fixtureIds.userB });
    const result = store.execute(
      'decideShareProposal',
      { id: fixtures.fixtureIds.proposal },
      {
        accepted: false,
        commandId: fixtures.fixtureId(308),
      },
    );
    expect(result.proposal.status).toBe('declined');
    expect(result.sharedExpression).toBeNull();
    expect(store.execute('learningItems', {}, undefined)).toHaveLength(1);
  });

  it('does not share mutable state across stories or expose references through responses', () => {
    const a = fixtures.createFixtureStore();
    const b = fixtures.createFixtureStore();
    const response = a.execute('experiences', {}, undefined);
    response[0]!.summary = 'Edited response';
    a.state.experiences[0]!.summary = 'Edited store';
    expect(b.state.experiences[0]!.summary).toBe(fixtures.experiences[0]!.summary);
    expect(fixtures.experiences[0]!.summary).not.toBe('Edited store');
  });

  it('requires authentication even when private collections are empty', () => {
    const store = fixtures.createFixtureStore({ scenario: 'empty', userId: null });
    expect(() => store.execute('experiences', {}, undefined)).toThrow('먼저 이름');
    expect(() => store.execute('learningItems', {}, undefined)).toThrow('먼저 이름');
  });

  it('approves review into the speaker’s records when another participant finishes', () => {
    const store = fixtures.createFixtureStore({ userId: fixtures.fixtureIds.userB });
    store.state.learningItems = [];
    store.execute(
      'studyCommand',
      { studyId: fixtures.fixtureIds.study },
      {
        commandId: fixtures.fixtureId(310),
        type: 'study.finish',
        expectedTopicId: fixtures.fixtureIds.imageTopic,
        expectedTransitionVersion: fixtures.activeStudy.transitionVersion,
      },
    );
    expect(store.state.snapshot.study.status).toBe('ended');
    expect(store.state.snapshot.topic?.state).toBe('approved');
    expect(store.state.learningItems).toHaveLength(1);
    expect(store.state.learningItems[0]?.ownerUserId).toBe(fixtures.fixtureIds.userA);
    expect(store.execute('learningItems', {}, undefined)).toHaveLength(0);
  });

  it('does not approve or advance when the next topic has no context', () => {
    const store = fixtures.createFixtureStore();
    store.state.experiences = [];
    store.state.snapshot.feedback.forEach((item) => {
      item.items = [];
    });
    const before = store.snapshot();
    expect(() =>
      store.execute(
        'studyCommand',
        { studyId: fixtures.fixtureIds.study },
        {
          commandId: fixtures.fixtureId(311),
          type: 'topic.advance',
          expectedTopicId: fixtures.fixtureIds.imageTopic,
          expectedTransitionVersion: fixtures.activeStudy.transitionVersion,
          focusUserId: null,
        },
      ),
    ).toThrow('먼저 경험');
    expect(store.snapshot()).toEqual(before);
  });
});

describe('mock events', () => {
  it('sends snapshots before live events and keeps private events on their owner channel', () => {
    const hub = fixtures.createMockEventHub();
    const a = hub.connect(fixtures.fixtureIds.userA);
    const b = hub.connect(fixtures.fixtureIds.userB);
    const messagesA: EventServerMessage[] = [];
    const messagesB: EventServerMessage[] = [];
    a.subscribe((message) => messagesA.push(message));
    b.subscribe((message) => messagesB.push(message));
    a.subscribeStudy(fixtures.fixtureIds.study);
    b.subscribeStudy(fixtures.fixtureIds.study);
    hub.publishToStudy(
      fixtures.fixtureIds.study,
      fixtures.events.find((event) => event.type === 'feedback.updated')!,
    );
    hub.publishToUser(
      fixtures.fixtureIds.userB,
      fixtures.events.find((event) => event.type === 'chat.message.updated')!,
    );
    expect(messagesA.map((message) => message.type)).toEqual([
      'study.snapshot',
      'feedback.updated',
    ]);
    expect(messagesB.map((message) => message.type)).toEqual([
      'study.snapshot',
      'feedback.updated',
      'chat.message.updated',
    ]);
    expect(() =>
      hub.publishToStudy(
        fixtures.fixtureIds.study,
        fixtures.events.find((event) => event.type === 'chat.message.updated')!,
      ),
    ).toThrow('scope');
    a.disconnect();
    b.disconnect();
  });

  it('implements the client socket protocol, heartbeat, and terminal close', async () => {
    const socket = fixtures.createMockSocketFactory(
      fixtures.createMockEventHub(),
      fixtures.fixtureIds.userA,
    )('ws://fixture');
    const messages: EventServerMessage[] = [];
    socket.addEventListener('message', (event) =>
      messages.push(JSON.parse(String(event.data)) as EventServerMessage),
    );
    await new Promise<void>((resolve) => socket.addEventListener('open', resolve));
    socket.send(JSON.stringify({ type: 'study.subscribe', studyId: fixtures.fixtureIds.study }));
    socket.send(JSON.stringify({ type: 'heartbeat.ping' }));
    expect(messages.map((message) => message.type)).toEqual(['study.snapshot', 'heartbeat.pong']);
    socket.close();
    expect(socket.readyState).toBe(3);
    expect(() => socket.send(JSON.stringify({ type: 'heartbeat.ping' }))).toThrow('not open');
  });
});

describe('registry-driven MSW handlers', () => {
  const store = fixtures.createFixtureStore({ userId: null });
  const server = setupServer(...fixtures.createHandlers(store, 'http://fixtures.local'));
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterEach(() => server.resetHandlers());
  afterAll(() => server.close());

  it('covers the complete endpoint registry and validates request/response envelopes', async () => {
    expect(fixtures.createHandlers(store)).toHaveLength(Object.keys(endpointRegistry).length);
    const unidentified = await fetch('http://fixtures.local/api/v1/me');
    expect(unidentified.status).toBe(401);
    const invalid = await fetch('http://fixtures.local/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: 'new-person' }),
    });
    expect(invalid.status).toBe(400);
    const response = await fetch('http://fixtures.local/api/v1/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle: ' NEW Person ', displayName: '새 사용자' }),
    });
    const body = (await response.json()) as { data: unknown; requestId: string };
    const user = endpointRegistry.register.output.parse(body.data);
    expect(user.handle).toBe('newperson');
    expect(body.requestId).toBeTruthy();
    const me = await fetch('http://fixtures.local/api/v1/me');
    expect(((await me.json()) as { data: unknown }).data).toEqual(user);
  });
});
