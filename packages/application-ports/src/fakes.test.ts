import { describe, expect, it } from 'vitest';
import type { ApiError, Job } from '@devday/contracts';
import { JobSchema } from '@devday/contracts';
import type { StudyEvent, UserEvent } from './index.js';
import { FakeEventPublisher, FakeJobsStore, FakeMediaStore, FakeStudyCommands } from './fakes.js';

const owner = '00000000-0000-4000-8000-000000000011';
const other = '00000000-0000-4000-8000-000000000012';
const study = '00000000-0000-4000-8000-000000000021';
const otherStudy = '00000000-0000-4000-8000-000000000022';
const topic = '00000000-0000-4000-8000-000000000031';
const now = '2026-10-09T00:00:00.000Z';
const error: ApiError = { code: 'AI_FAILED', message: 'Generation failed', details: null };
const topicInput = {
  kind: 'topic.generate' as const,
  scope: 'study' as const,
  ownerUserId: null,
  studyId: study,
  targetId: topic,
  input: { topicId: topic },
};

function eventFor(job: Job): Extract<UserEvent, { type: 'job.updated' }> {
  return {
    version: 1,
    eventId: '00000000-0000-4000-8000-000000000041',
    type: 'job.updated',
    scope: job.scope,
    studyId: job.studyId,
    entityId: job.id,
    entityRevision: job.revision,
    occurredAt: now,
    payload: job,
  };
}

describe('FakeJobsStore', () => {
  it('keeps the first terminal result when stale completions and failures arrive', async () => {
    const jobs = new FakeJobsStore({ now: () => now });
    const job = await jobs.create(topicInput);
    expect(await jobs.succeedIfRunning(job.id, { topicId: topic })).toBe(true);
    const completed = await jobs.read(job.id);
    expect(JobSchema.parse(completed)).toMatchObject({
      status: 'succeeded',
      revision: 1,
      finishedAt: now,
    });
    expect(await jobs.succeedIfRunning(job.id, { topicId: otherStudy })).toBe(false);
    expect(await jobs.failIfRunning(job.id, error)).toBe(false);
    expect(await jobs.read(job.id)).toEqual(completed);
    expect(await jobs.isRunning(job.id)).toBe(false);
  });

  it('does not revive failed jobs and rejects mismatched results before completing', async () => {
    const jobs = new FakeJobsStore({ now: () => now });
    const job = await jobs.create(topicInput);
    await expect(jobs.succeedIfRunning(job.id, { messageId: topic })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(await jobs.isRunning(job.id)).toBe(true);
    expect(await jobs.failIfRunning(job.id, error)).toBe(true);
    expect(await jobs.succeedIfRunning(job.id, { topicId: topic })).toBe(false);
    expect(await jobs.failIfRunning(job.id, error)).toBe(false);
    expect(JobSchema.parse(await jobs.read(job.id))).toMatchObject({
      status: 'failed',
      revision: 1,
      error,
    });
  });

  it('isolates private jobs from study members and study jobs from outsiders', async () => {
    const jobs = new FakeJobsStore({
      studyMembers: { [study]: [owner, other], [otherStudy]: [other] },
    });
    const privateJob = await jobs.create({ ...topicInput, scope: 'user', ownerUserId: owner });
    expect(await jobs.get({ userId: owner }, privateJob.id)).toEqual(privateJob);
    await expect(jobs.get({ userId: other }, privateJob.id)).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
    const studyJob = await jobs.create({ ...topicInput, studyId: otherStudy, ownerUserId: owner });
    await expect(jobs.get({ userId: owner }, studyJob.id)).rejects.toMatchObject({
      code: 'NOT_MEMBER',
    });
    jobs.grantStudyAccess(otherStudy, owner);
    expect(await jobs.get({ userId: owner }, studyJob.id)).toEqual(studyJob);
    jobs.setStudyMembers(otherStudy, []);
    await expect(jobs.get({ userId: owner }, studyJob.id)).rejects.toMatchObject({
      code: 'NOT_MEMBER',
    });
  });

  it('returns detached job and input snapshots and validates input kind', async () => {
    const jobs = new FakeJobsStore();
    const input = structuredClone(topicInput);
    const job = await jobs.create(input);
    input.input.topicId = otherStudy;
    job.revision = 99;
    const savedInput = await jobs.readInput(job.id, 'topic.generate');
    expect(savedInput).toEqual({ topicId: topic });
    savedInput.topicId = otherStudy;
    expect(await jobs.readInput(job.id, 'topic.generate')).toEqual({ topicId: topic });
    expect((await jobs.read(job.id)).revision).toBe(0);
    await expect(jobs.readInput(job.id, 'chat.respond')).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
  });
});

describe('FakeEventPublisher', () => {
  it('rejects private job broadcasts and delivery to another user', async () => {
    const jobs = new FakeJobsStore();
    const job = await jobs.create({ ...topicInput, scope: 'user', ownerUserId: owner });
    const event = eventFor(job);
    const events = new FakeEventPublisher();
    await expect(events.toStudy(study, event)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(events.toUser(other, event)).rejects.toMatchObject({ code: 'NOT_OWNER' });
    await expect(events.toStudy(study, { ...event, scope: 'study' })).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    expect(events.publications).toEqual([]);
    await events.toUser(owner, event);
    event.payload.revision = 100;
    expect(events.publications).toMatchObject([
      { scope: 'user', userId: owner, event: { payload: { revision: 0 } } },
    ]);
  });

  it('rejects foreign study routing and job scopes', async () => {
    const job = await new FakeJobsStore().create(topicInput);
    const events = new FakeEventPublisher();
    const event = eventFor(job);
    await expect(events.toUser(owner, event)).rejects.toMatchObject({ code: 'INVALID_INPUT' });
    await expect(events.toStudy(otherStudy, event)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    const wrongPayload: StudyEvent = { ...event, payload: { ...job, studyId: otherStudy } };
    await expect(events.toStudy(study, wrongPayload)).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    });
    await events.toStudy(study, event);
    const recorded = events.publications;
    recorded.length = 0;
    expect(events.publications).toHaveLength(1);
  });
});

describe('FakeMediaStore', () => {
  it('preserves image bytes and metadata without sharing mutable buffers', async () => {
    const media = new FakeMediaStore();
    const bytes = new Uint8Array([1, 2, 3]);
    const { mediaId } = await media.put({
      kind: 'image',
      studyId: study,
      bytes,
      contentType: 'image/png',
    });
    bytes[0] = 99;
    const image = await media.resolveImage(mediaId);
    expect(image).toEqual({
      kind: 'bytes',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    if (image.kind === 'bytes') image.bytes[0] = 44;
    expect(await media.resolveImage(mediaId)).toEqual({
      kind: 'bytes',
      bytes: new Uint8Array([1, 2, 3]),
      contentType: 'image/png',
    });
    expect(media.writes[0]?.input.studyId).toBe(study);
    const audio = await media.put({
      kind: 'audio',
      studyId: study,
      segmentId: topic,
      bytes,
      contentType: 'audio/pcm',
    });
    await expect(media.resolveImage(audio.mediaId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(media.resolveImage('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('FakeStudyCommands', () => {
  it('records calls and returns the injected handler result without sharing mutable data', async () => {
    const commands = new FakeStudyCommands((actor, input) => {
      expect(actor.userId).toBe(owner);
      input.command.expectedTransitionVersion = 100;
      return {
        commandId: input.command.commandId,
        studyId: input.studyId,
        outcome: 'already_applied',
        topicId: topic,
        jobId: null,
        transitionVersion: 2,
      };
    });
    const input = {
      studyId: study,
      command: {
        type: 'topic.close' as const,
        commandId: topic,
        expectedTopicId: topic,
        expectedTransitionVersion: 1,
      },
    };
    expect(await commands.execute({ userId: owner }, input)).toMatchObject({
      outcome: 'already_applied',
      transitionVersion: 2,
    });
    input.command.expectedTransitionVersion = 99;
    expect(commands.executions[0]?.input.command.expectedTransitionVersion).toBe(1);
  });
});
