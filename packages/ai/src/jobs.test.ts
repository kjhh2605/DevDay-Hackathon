import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ApplicationPorts } from '@devday/application-ports';
import type { ApiError, Job, Utterance } from '@devday/contracts';
import { createAiJobs } from './jobs.js';
import { MockAiProvider } from './mock-provider.js';

function harness(kind: Job['kind'] = 'utterance.feedback') {
  const id = randomUUID(),
    targetId = randomUUID();
  let running = true;
  const utterance: Utterance = {
    id: targetId,
    revision: 1,
    correctionRevision: 0,
    correctedText: 'I goed.',
    rawText: 'I goed.',
    studyId: randomUUID(),
    topicId: randomUUID(),
    speakerUserId: randomUUID(),
    startOrder: 0,
    sentenceIndex: 0,
    sourceRanges: [],
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    correctionStatus: 'ready',
    correctedBy: 'ai',
  };
  const writes: (
    | 'feedback-ready'
    | 'feedback-failed'
    | 'chat-failed'
    | 'job-failed'
    | 'job-succeeded'
  )[] = [];
  const ports = {
    jobs: {
      read: async () => ({ id, kind, targetId, status: running ? 'running' : 'failed' }),
      readInput: async () => ({ utteranceId: targetId, correctionRevision: 0 }),
      isRunning: async () => running,
      succeedIfRunning: vi.fn(async () => {
        if (!running) return false;
        running = false;
        writes.push('job-succeeded');
        return true;
      }),
      failIfRunning: vi.fn(async () => {
        if (!running) return false;
        running = false;
        writes.push('job-failed');
        return true;
      }),
    },
    feedback: {
      readForJob: async () => ({ ...utterance }),
      applyIfCurrent: vi.fn(
        async (
          _jobId: string,
          input: { inputCorrectionRevision: number; error: ApiError | null },
        ) => {
          if (!running || input.inputCorrectionRevision !== utterance.correctionRevision)
            return null;
          writes.push(input.error ? 'feedback-failed' : 'feedback-ready');
          return {};
        },
      ),
    },
    chat: {
      fail: vi.fn(async () => {
        if (running) writes.push('chat-failed');
      }),
      readForJob: () => new Promise(() => undefined),
    },
    studies: { applyGeneratedTopic: vi.fn() },
    media: { put: vi.fn() },
    topicContext: {
      read: async () => ({
        topicId: utterance.topicId,
        studyId: utterance.studyId,
        ordinal: 1,
        focusUserId: null,
        experiences: [
          {
            id: randomUUID(),
            ownerUserId: randomUUID(),
            summary: 'Busan',
            interests: [],
            context: { place: 'Busan', people: [], event: null, actions: [] },
          },
        ],
        learningExpressions: [],
        sharedExpressions: [],
      }),
    },
  };
  const provider = new MockAiProvider();
  const jobs = createAiJobs(ports as unknown as ApplicationPorts, provider, {
    flushTopic: async () => undefined,
  });
  return { jobs, ports, provider, id, writes, utterance };
}

afterEach(() => vi.useRealTimers());
describe('AI job outcomes and late-result barriers', () => {
  it('records timeout on feedback before closing job and ignores a later provider success', async () => {
    vi.useFakeTimers();
    const h = harness();
    let release!: (value: unknown) => void;
    vi.spyOn(h.provider, 'structured').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const running = h.jobs.feedback(h.id);
    await vi.advanceTimersByTimeAsync(60_001);
    await running;
    expect(h.writes).toEqual(['feedback-failed', 'job-failed']);
    release({ items: [] });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.writes).toEqual(['feedback-failed', 'job-failed']);
  });
  it('does not overwrite an edited sentence when an older feedback finishes', async () => {
    const h = harness();
    let release!: (value: unknown) => void;
    vi.spyOn(h.provider, 'structured').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const task = h.jobs.feedback(h.id);
    await vi.waitFor(() => expect(release).toBeDefined());
    h.utterance.correctionRevision = 1;
    release({ items: [] });
    await task;
    expect(h.writes).toEqual(['job-failed']);
  });
  it('deduplicates in-process launch without hidden retries', async () => {
    const h = harness();
    const structured = vi.spyOn(h.provider, 'structured');
    await Promise.all([h.jobs.feedback(h.id), h.jobs.feedback(h.id)]);
    expect(structured).toHaveBeenCalledTimes(1);
    expect(h.writes).toEqual(['feedback-ready', 'job-succeeded']);
  });
  it('does not replace an image failure with a successful sentence or media reference', async () => {
    const h = harness('topic.generate');
    const image = vi
      .spyOn(h.provider, 'image')
      .mockRejectedValue(new Error('provider image failure'));
    await h.jobs.generateTopic(h.id);
    expect(image).toHaveBeenCalledTimes(1);
    expect(h.ports.media.put).not.toHaveBeenCalled();
    expect(h.ports.studies.applyGeneratedTopic).not.toHaveBeenCalled();
    expect(h.writes).toEqual(['job-failed']);
  });
  it('records timeout on the visible chat before closing its job', async () => {
    vi.useFakeTimers();
    const h = harness('chat.respond');
    const task = h.jobs.chat(h.id);
    await vi.advanceTimersByTimeAsync(180_001);
    await task;
    expect(h.writes).toEqual(['chat-failed', 'job-failed']);
  });
});

describe('expired close isolation', () => {
  it('cannot mark successfully retried sentences failed when its old planner response arrives', async () => {
    const jobId = randomUUID(),
      topicId = randomUUID(),
      segmentId = randomUUID();
    let running = true;
    let release!: (value: unknown) => void;
    const source = {
      id: segmentId,
      speakerUserId: randomUUID(),
      startOrder: 0,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      rawStatus: 'ready',
      correctionStatus: 'ready',
      rawText: 'human.',
      correctedText: 'human.',
      sentenceStatus: 'pending',
    };
    const fail = vi.fn(async () => {
      source.sentenceStatus = 'failed';
    });
    const finalize = vi.fn();
    const ports = {
      jobs: {
        read: async () => ({ id: jobId, kind: 'topic.close', status: 'running' }),
        readInput: async () => ({ topicId, closeId: randomUUID() }),
        isRunning: async () => running,
        failIfRunning: vi.fn(async () => false),
        succeedIfRunning: vi.fn(async () => false),
      },
      speech: { listSegments: async () => [source], fail, finalizeSentences: finalize },
    } as unknown as ApplicationPorts;
    const provider = new MockAiProvider();
    vi.spyOn(provider, 'structured').mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const jobs = createAiJobs(ports, provider, { flushTopic: async () => undefined });
    const original = jobs.closeTopic(jobId);
    await vi.waitFor(() => expect(release).toBeDefined());
    running = false;
    source.sentenceStatus = 'ready'; // Timed-out original, later explicit close has already finalized.
    release({
      sentences: [{ slices: [{ segmentId, rawSlice: 'human.', correctedSlice: 'human.' }] }],
    });
    await original;
    expect(source.sentenceStatus).toBe('ready');
    expect(fail).not.toHaveBeenCalled();
    expect(finalize).not.toHaveBeenCalled();
  });
});
