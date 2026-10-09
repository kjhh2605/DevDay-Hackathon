import { describe, expect, it } from 'vitest';
import {
  AudioClientMessageSchema,
  EventSchema,
  JobSchema,
  StudyCommandSchema,
  StudySnapshotSchema,
  TopicContentSchema,
  assertStrictToolSchema,
  endpointRegistry,
  strictToolDefinitions,
  toolSchemas,
} from './index.js';
import {
  activeStudy,
  fixtureId,
  fixtureIds,
  imageTopic,
  jobs,
  studySnapshot,
  userA,
} from '../../fixtures/src/data.js';

describe('contract invariants', () => {
  it('keeps tool authority server-side and every tool property required nullable', () => {
    const definitions = strictToolDefinitions();
    expect(definitions).toHaveLength(9);
    for (const tool of definitions) {
      assertStrictToolSchema(tool.parameters);
      expect(tool.strict).toBe(true);
      expect(Object.keys(tool.parameters.properties ?? {})).not.toContain('actorUserId');
    }
    expect(toolSchemas.advance_topic.safeParse({}).success).toBe(false);
    expect(toolSchemas.advance_topic.safeParse({ focusUserId: null }).success).toBe(true);
    expect(toolSchemas.close_topic.safeParse({ actorUserId: userA.id }).success).toBe(false);
    expect(() =>
      assertStrictToolSchema({
        type: 'object',
        properties: { value: { type: 'string' } },
        required: [],
        additionalProperties: false,
      }),
    ).toThrow('required');
    expect(() =>
      assertStrictToolSchema({
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: true,
      }),
    ).toThrow('additionalProperties');
  });
  it('requires grounding for an image and a conversation instruction for both kinds', () => {
    expect(
      TopicContentSchema.safeParse({ ...imageTopic.content, sourceExperienceIds: [] }).success,
    ).toBe(false);
    expect(
      TopicContentSchema.safeParse({ ...imageTopic.content, conversationInstruction: '' }).success,
    ).toBe(false);
    expect(
      TopicContentSchema.safeParse({ ...imageTopic.content, imageMediaId: null }).success,
    ).toBe(false);
  });
  it('rejects actor spoofing and irrelevant command fields', () => {
    const command = {
      type: 'topic.close',
      commandId: fixtureId(900),
      expectedTopicId: fixtureIds.imageTopic,
      expectedTransitionVersion: 1,
    };
    expect(StudyCommandSchema.safeParse(command).success).toBe(true);
    expect(StudyCommandSchema.safeParse({ ...command, focusUserId: null }).success).toBe(false);
    expect(StudyCommandSchema.safeParse({ ...command, actorUserId: userA.id }).success).toBe(false);
    expect(
      StudyCommandSchema.safeParse({ ...command, type: 'study.start', focusUserId: null }).success,
    ).toBe(false);
  });
  it('normalizes handles without inventing login-by-handle', () => {
    expect(
      endpointRegistry.register.input.parse({ displayName: 'Test', handle: ' A B C ' }).handle,
    ).toBe('abc');
    expect(
      Object.values(endpointRegistry).some((endpoint) => endpoint.path.includes('login')),
    ).toBe(false);
  });
  it('does not allow personal jobs or data in a study snapshot/event', () => {
    const privateJob = jobs.find((job) => job.kind === 'experience.prepare')!;
    expect(StudySnapshotSchema.safeParse({ ...studySnapshot, jobs: [privateJob] }).success).toBe(
      false,
    );
    expect(StudySnapshotSchema.safeParse({ ...studySnapshot, experiences: [] }).success).toBe(
      false,
    );
    expect(StudySnapshotSchema.safeParse({ ...studySnapshot, topic: null }).success).toBe(false);
    expect(
      EventSchema.safeParse({
        version: 1,
        eventId: fixtureId(901),
        type: 'study.changed',
        scope: 'study',
        studyId: activeStudy.id,
        entityId: activeStudy.id,
        entityRevision: activeStudy.revision,
        occurredAt: activeStudy.createdAt,
        payload: { study: activeStudy, topic: imageTopic, jobs: [privateJob] },
      }).success,
    ).toBe(false);
  });
  it('binds study event revisions to the actual payload entity', () => {
    const valid = {
      version: 1,
      eventId: fixtureId(905),
      type: 'study.changed',
      scope: 'study',
      studyId: activeStudy.id,
      entityId: activeStudy.id,
      entityRevision: activeStudy.revision,
      occurredAt: activeStudy.createdAt,
      payload: { study: activeStudy, topic: imageTopic, jobs: [] },
    };
    expect(EventSchema.safeParse(valid).success).toBe(true);
    expect(
      EventSchema.safeParse({ ...valid, entityRevision: activeStudy.revision + 1 }).success,
    ).toBe(false);
    expect(EventSchema.safeParse({ ...valid, entityId: fixtureId(906) }).success).toBe(false);
    expect(
      EventSchema.safeParse({ ...valid, payload: { ...valid.payload, topic: null } }).success,
    ).toBe(false);
  });
  it('validates job state and result together', () => {
    const running = jobs.find((job) => job.status === 'running')!;
    expect(JobSchema.safeParse({ ...running, status: 'succeeded' }).success).toBe(false);
    expect(JobSchema.safeParse({ ...running, status: 'failed', error: null }).success).toBe(false);
    expect(JobSchema.safeParse({ ...running, kind: 'chat.respond', scope: 'study' }).success).toBe(
      false,
    );
  });
  it('requires correct PCM format and coherent flush sequence', () => {
    expect(
      AudioClientMessageSchema.safeParse({
        type: 'audio.start',
        topicId: fixtureIds.imageTopic,
        clientStreamId: fixtureId(903),
        format: 'pcm16',
        sampleRate: 48000,
        channels: 1,
      }).success,
    ).toBe(false);
    const start = {
      type: 'audio.segment_start',
      streamId: fixtureId(903),
      clientSegmentId: fixtureId(907),
      startedAt: '2026-10-09T00:00:00.000Z',
    };
    expect(AudioClientMessageSchema.safeParse(start).success).toBe(true);
    expect(
      AudioClientMessageSchema.safeParse({ ...start, startedAt: 'not-an-iso-timestamp' }).success,
    ).toBe(false);
    const flush = {
      type: 'audio.flush',
      streamId: fixtureId(903),
      closeId: fixtureId(904),
      lastSegmentId: null,
      lastSeq: null,
    };
    expect(AudioClientMessageSchema.safeParse(flush).success).toBe(true);
    expect(AudioClientMessageSchema.safeParse({ ...flush, lastSeq: 0 }).success).toBe(false);
  });
});
