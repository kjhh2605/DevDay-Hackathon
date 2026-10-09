import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import type { Actor } from '@devday/application-ports';
import {
  EventSchema,
  type DomainEvent,
  type Study,
  type StudyCommand,
  type Topic,
  type Utterance,
} from '@devday/contracts';
import { loadConfig } from '../src/config.js';
import { createDatabase, Database } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { DomainService } from '../src/domain/service.js';

const uuid = () => randomUUID();
const events: { owner: string; event: DomainEvent }[] = [];
let admin: Database, db: Database, service: DomainService;
const schema = `test_domain_${uuid().replaceAll('-', '')}`;
beforeAll(async () => {
  const config = loadConfig({ env: { ...process.env, AI_MODE: 'mock', NODE_ENV: 'test' } });
  admin = await createDatabase(config);
  await admin.pool.query(`CREATE SCHEMA ${schema}`);
  db = new Database(
    new Pool({
      ...admin.pool.options,
      password: config.database.password,
      options: `-c search_path=${schema}`,
    }),
  );
  await migrate(db);
  service = new DomainService(db, {
    toUser: async (owner, event) => {
      events.push({ owner, event: EventSchema.parse(event) });
    },
    toStudy: async (owner, event) => {
      events.push({ owner, event: EventSchema.parse(event) });
    },
  });
}, 30_000);
afterAll(async () => {
  await db?.close();
  if (admin) {
    await admin.pool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.close();
  }
}, 30_000);
async function user() {
  const result = await service.register({ displayName: 'Test', handle: `u${uuid()}` });
  return { actor: { userId: result.user.id }, ...result };
}
async function experience(actor: Actor) {
  const input = {
    originalText: '부산에서 친구와 바닷가를 걸었습니다.',
    answers: [],
    skipQuestions: true,
    commandId: uuid(),
  };
  const job = await service.prepareExperience(actor, input);
  const draft = (await service.experiences.saveDraft(job.id, {
    originalText: input.originalText,
    answers: [],
    questions: [],
    summary: input.originalText,
    interests: ['여행'],
    context: { place: '부산', people: ['친구'], event: '여행', actions: ['걷기'] },
  }))!;
  await service.jobs.succeedIfRunning(job.id, { draft });
  return service.saveExperience(actor, {
    originalText: draft.originalText,
    answers: draft.answers,
    summary: draft.summary!,
    interests: draft.interests,
    context: draft.context,
    draftId: draft.id,
    commandId: uuid(),
  });
}
async function pair() {
  const a = await user(),
    b = await user();
  const study = await service.createStudy(a.actor, {
    participantHandles: [b.user.handle],
    commandId: uuid(),
  });
  await service.joinStudy(b.actor, study.id, { commandId: uuid() });
  return { a, b, study };
}
async function command(
  actor: Actor,
  studyId: string,
  type: StudyCommand['type'],
  focusUserId: string | null = null,
) {
  const { study } = await service.snapshot(actor, studyId);
  const base = {
    commandId: uuid(),
    expectedTopicId: study.currentTopicId,
    expectedTransitionVersion: study.transitionVersion,
  };
  const cmd = {
    ...base,
    type,
    ...(['study.start', 'topic.advance'].includes(type) ? { focusUserId } : {}),
  } as StudyCommand;
  return service.execute(actor, { studyId, command: cmd });
}
async function generate(actor: Actor, studyId: string) {
  const snap = await service.snapshot(actor, studyId);
  const topic = snap.topic!;
  const context = await service.topicContext.read(topic.generationJobId);
  const content = {
    kind: 'sentence' as const,
    title: 'Travel',
    situationText: 'Discuss your trip.',
    conversationInstruction: 'Ask your partner what happened.',
    imageMediaId: null,
    sentence: 'Tell me about your day.',
    sourceExperienceIds: context.experiences.map((e) => e.id),
    learningExpressionIds: context.learningExpressions.map((e) => e.id),
    sharedExpressionIds: context.sharedExpressions.map((e) => e.id),
  };
  expect(await service.studies.applyGeneratedTopic(topic.generationJobId, content)).toBe(true);
  await service.jobs.succeedIfRunning(topic.generationJobId, { topicId: topic.id });
  return topic;
}
async function speech(actor: Actor, topic: Topic) {
  const segment = await service.speech.begin(actor, {
    topicId: topic.id,
    clientStreamId: uuid(),
    clientSegmentId: uuid(),
    startedAt: new Date().toISOString(),
  });
  const raw = await service.speech.completeRaw(segment.id, {
    text: 'I goed there yesterday.',
    endedAt: new Date().toISOString(),
  });
  const corrected = (await service.speech.applyCorrection(raw.id, {
    text: raw.rawText!,
    expectedRevision: raw.revision,
  }))!;
  return corrected;
}
async function review(
  actor: Actor,
  studyId: string,
  segments: Awaited<ReturnType<typeof speech>>[] = [],
) {
  const close = await command(actor, studyId, 'topic.close');
  const topic = (await service.snapshot(actor, studyId)).topic!;
  const utterances = await service.speech.finalizeSentences(
    topic.id,
    segments.map((s, index) => ({
      sentenceIndex: index,
      sourceRanges: [
        {
          segmentId: s.id,
          rawStart: 0,
          rawEnd: s.rawText!.length,
          correctedStart: 0,
          correctedEnd: s.correctedText!.length,
        },
      ],
      speakerUserId: s.speakerUserId,
      startOrder: s.startOrder,
      startedAt: s.startedAt,
      endedAt: s.endedAt!,
      rawText: s.rawText!,
      correctedText: s.correctedText!,
    })),
  );
  for (const utterance of utterances) await readyFeedback(utterance);
  expect(await service.studies.completeClose(close.jobId!)).toBe(true);
  await service.jobs.succeedIfRunning(close.jobId!, {
    topicId: topic.id,
    utteranceIds: utterances.map((u) => u.id),
  });
  return utterances;
}
async function readyFeedback(utterance: Utterance) {
  const job = await service.jobs.create({
    kind: 'utterance.feedback',
    scope: 'study',
    ownerUserId: null,
    studyId: utterance.studyId,
    targetId: utterance.id,
    input: {
      utteranceId: utterance.id,
      correctionRevision: utterance.correctionRevision,
      ownerUserId: utterance.speakerUserId,
    },
  });
  const item = {
    id: uuid(),
    category: 'grammar',
    summary: 'Past tense',
    explanation: 'Use went.',
    expression: 'I went there yesterday.',
    meaning: '어제 그곳에 갔어요.',
    example: 'I went to Busan yesterday.',
  };
  await service.feedback.applyIfCurrent(job.id, {
    utteranceId: utterance.id,
    inputCorrectionRevision: utterance.correctionRevision,
    items: [item],
    error: null,
  });
  await service.jobs.succeedIfRunning(job.id, {
    utteranceId: utterance.id,
    inputCorrectionRevision: utterance.correctionRevision,
  });
  return job;
}

describe('PostgreSQL domain invariants', () => {
  it('normalizes unique handles under concurrency and persists hashed sessions', async () => {
    const handle = `dupe${uuid()}`;
    const results = await Promise.allSettled([
      service.register({ displayName: 'A', handle: ` ${handle.toUpperCase()} ` }),
      service.register({ displayName: 'B', handle }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('HANDLE_TAKEN');
    const success = (
      results.find((r) => r.status === 'fulfilled') as PromiseFulfilledResult<
        Awaited<ReturnType<typeof service.register>>
      >
    ).value;
    expect(await service.authenticate(success.token)).toEqual(success.user);
    const row = (
      await db.pool.query('SELECT token_hash FROM user_sessions WHERE user_id=$1', [
        success.user.id,
      ])
    ).rows[0]!;
    expect(row.token_hash).not.toBe(success.token);
    expect(row.token_hash).toHaveLength(64);
  });
  it('requires context without advancing waiting study and rejects receipt reuse with different payload', async () => {
    const { a, b, study } = await pair();
    await expect(command(b.actor, study.id, 'study.start')).rejects.toMatchObject({
      code: 'CONTEXT_REQUIRED',
    });
    expect((await service.snapshot(a.actor, study.id)).study.status).toBe('waiting');
    const input = { participantHandles: [], commandId: uuid() };
    const created = await service.createStudy(a.actor, input);
    expect(await service.createStudy(a.actor, input)).toEqual(created);
    await expect(
      service.createStudy(a.actor, { ...input, participantHandles: [b.user.handle] }),
    ).rejects.toMatchObject({ code: 'COMMAND_CONFLICT' });
    const outsider = await user();
    await expect(service.snapshot(outsider.actor, study.id)).rejects.toMatchObject({
      code: 'NOT_MEMBER',
    });
  });
  it('serializes distinct actors next; edits save to original speaker and stale feedback cannot overwrite', async () => {
    const { a, b, study } = await pair();
    await experience(a.actor);
    await command(b.actor, study.id, 'study.start');
    const topic = await generate(a.actor, study.id);
    const segment = await speech(a.actor, topic);
    const [utterance] = await review(b.actor, study.id, [segment]);
    const edit = await service.editCorrection(b.actor, utterance!.id, {
      text: 'I goed to Busan yesterday.',
      commandId: uuid(),
    });
    expect(edit.utterance.rawText).toBe(segment.rawText);
    const oldJob = await service.startFeedback(b.actor, utterance!.id, {
      correctionRevision: edit.utterance.correctionRevision,
      commandId: uuid(),
    });
    const newer = await service.editCorrection(a.actor, utterance!.id, {
      text: 'I goed to Busan with my friend.',
      commandId: uuid(),
    });
    expect(
      await service.feedback.applyIfCurrent(oldJob.id, {
        utteranceId: utterance!.id,
        inputCorrectionRevision: edit.utterance.correctionRevision,
        items: [],
        error: null,
      }),
    ).toBeNull();
    await expect(command(a.actor, study.id, 'topic.advance')).rejects.toMatchObject({
      code: 'FEEDBACK_STALE',
    });
    await readyFeedback(newer.utterance);
    const snap = await service.snapshot(a.actor, study.id);
    const base = {
      type: 'topic.advance' as const,
      expectedTopicId: topic.id,
      expectedTransitionVersion: snap.study.transitionVersion,
      focusUserId: null,
    };
    const results = await Promise.allSettled([
      service.execute(a.actor, { studyId: study.id, command: { ...base, commandId: uuid() } }),
      service.execute(b.actor, { studyId: study.id, command: { ...base, commandId: uuid() } }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(
      (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code,
    ).toBe('STALE_TOPIC');
    expect(
      (await db.pool.query('SELECT id FROM topics WHERE study_id=$1 AND ordinal=2', [study.id]))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await db.pool.query(
          "SELECT id FROM jobs WHERE data->>'studyId'=$1 AND kind='topic.generate' AND status='running'",
          [study.id],
        )
      ).rowCount,
    ).toBe(1);
    expect(await service.listLearning(a.actor)).toHaveLength(1);
    expect(await service.listLearning(b.actor)).toHaveLength(0);
    const current = (await service.snapshot(a.actor, study.id)).topic!;
    expect(
      (await service.topicContext.read(current.generationJobId)).learningExpressions,
    ).toHaveLength(1);
  });
  it('keeps declined and pending private, accepts once and freezes only accepted sharing into context', async () => {
    const { a, b, study } = await pair();
    await experience(a.actor);
    const make = async (expression: string) => {
      const chat = await service.beginChat(a.actor, study.id, {
        text: expression,
        clientMessageId: uuid(),
      });
      const ctx = await service.chat.readForJob(chat.job.id);
      const item = await service.learning.saveFromChat(a.actor, {
        studyId: study.id,
        messageId: ctx.messageId,
        toolOrdinal: 0,
        kind: 'expression',
        expression,
        meaning: 'meaning',
        example: 'example',
      });
      const proposal = await service.sharing.createProposal(a.actor, {
        studyId: study.id,
        learningItemId: item.id,
      });
      return { chat, item, proposal };
    };
    const no = await make('private declined'),
      pending = await make('private pending'),
      yes = await make('shared accepted');
    await service.decideShare(a.actor, no.proposal.id, { accepted: false, commandId: uuid() });
    await expect(
      service.decideShare(b.actor, yes.proposal.id, { accepted: true, commandId: uuid() }),
    ).rejects.toMatchObject({ code: 'NOT_OWNER' });
    const results = await Promise.all([
      service.decideShare(a.actor, yes.proposal.id, { accepted: true, commandId: uuid() }),
      service.decideShare(a.actor, yes.proposal.id, { accepted: true, commandId: uuid() }),
    ]);
    expect(results[0].sharedExpression!.id).toBe(results[1].sharedExpression!.id);
    const snap = await service.snapshot(b.actor, study.id);
    expect(snap.sharedExpressions).toHaveLength(1);
    expect(JSON.stringify(snap)).not.toContain('private ');
    expect(await service.listChat(b.actor, study.id)).toHaveLength(0);
    expect(await service.listLearning(b.actor)).toHaveLength(0);
    await expect(service.getJob(b.actor, pending.chat.job.id)).rejects.toMatchObject({
      code: 'NOT_OWNER',
    });
    await command(a.actor, study.id, 'study.start');
    const topic = (await service.snapshot(a.actor, study.id)).topic!;
    const context = await service.topicContext.read(topic.generationJobId);
    expect(context.sharedExpressions.map((e) => e.expression)).toEqual(['shared accepted']);
    expect(context.learningExpressions).toEqual([]);
    expect(JSON.stringify(events.filter((e) => e.owner === study.id))).not.toContain('private ');
  });
  it('retries failed generation at same ordinal and finish requires review before final saved records', async () => {
    const { a, b, study } = await pair();
    await experience(a.actor);
    const first = await command(a.actor, study.id, 'study.start');
    await service.failJob(first.jobId!, { code: 'AI_FAILED', message: 'injected', details: null });
    const failed = (await service.snapshot(a.actor, study.id)).topic!;
    expect(failed.state).toBe('failed');
    const retry = await command(b.actor, study.id, 'topic.advance');
    const current = (await service.snapshot(a.actor, study.id)).topic!;
    expect(current.id).toBe(failed.id);
    expect(current.ordinal).toBe(1);
    expect(retry.jobId).not.toBe(first.jobId);
    await generate(a.actor, study.id);
    const segment = await speech(a.actor, current);
    const closing = await command(b.actor, study.id, 'study.finish');
    expect((await service.snapshot(a.actor, study.id)).study.status).toBe('active');
    const utterances = await service.speech.finalizeSentences(current.id, [
      {
        sentenceIndex: 0,
        sourceRanges: [
          {
            segmentId: segment.id,
            rawStart: 0,
            rawEnd: segment.rawText!.length,
            correctedStart: 0,
            correctedEnd: segment.correctedText!.length,
          },
        ],
        speakerUserId: a.actor.userId,
        startOrder: segment.startOrder,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt!,
        rawText: segment.rawText!,
        correctedText: segment.correctedText!,
      },
    ]);
    await readyFeedback(utterances[0]!);
    await service.studies.completeClose(closing.jobId!);
    await service.jobs.succeedIfRunning(closing.jobId!, {
      topicId: current.id,
      utteranceIds: utterances.map((u) => u.id),
    });
    await command(a.actor, study.id, 'study.finish');
    expect((await service.snapshot(b.actor, study.id)).study.status).toBe('ended');
    const restarted = new DomainService(db, service.events);
    expect(await restarted.listLearning(a.actor)).toHaveLength(1);
    expect(await restarted.authenticate(a.token)).toEqual(a.user);
    await expect(
      service.editCorrection(a.actor, utterances[0]!.id, { text: 'late', commandId: uuid() }),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_READY' });
  });
  it('does not let an expired close worker change a newer close attempt', async () => {
    const { a, study } = await pair();
    await experience(a.actor);
    await command(a.actor, study.id, 'study.start');
    const topic = await generate(a.actor, study.id);
    const segment = await speech(a.actor, topic);
    const oldClose = await command(a.actor, study.id, 'topic.close');
    await service.failJob(oldClose.jobId!, {
      code: 'TIMEOUT',
      message: 'injected timeout',
      details: null,
    });
    const retry = await command(a.actor, study.id, 'topic.close');
    const sentences = [
      {
        sentenceIndex: 0,
        sourceRanges: [
          {
            segmentId: segment.id,
            rawStart: 0,
            rawEnd: segment.rawText!.length,
            correctedStart: 0,
            correctedEnd: segment.correctedText!.length,
          },
        ],
        speakerUserId: a.actor.userId,
        startOrder: segment.startOrder,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt!,
        rawText: segment.rawText!,
        correctedText: segment.correctedText!,
      },
    ];
    await expect(
      service.speech.finalizeSentences(topic.id, sentences, oldClose.jobId!),
    ).rejects.toMatchObject({ code: 'ACTION_NOT_READY' });
    await service.speech.finalizeSentences(topic.id, sentences, retry.jobId!);
    await service.speech.fail(
      segment.id,
      'sentences',
      { code: 'AI_FAILED', message: 'expired', details: null },
      oldClose.jobId!,
    );
    expect((await service.speech.listSegments(topic.id))[0]!.sentenceStatus).toBe('ready');
  });
  it('marks interrupted jobs failed without rerunning and ignores late writes', async () => {
    const { a, study } = await pair();
    await experience(a.actor);
    const first = await command(a.actor, study.id, 'study.start');
    const chat = await service.beginChat(a.actor, study.id, {
      text: 'pending',
      clientMessageId: uuid(),
    });
    const restarted = new DomainService(db, service.events);
    await restarted.interruptJobs();
    expect((await service.getJob(a.actor, first.jobId!)).error?.code).toBe('PROCESS_INTERRUPTED');
    expect((await service.snapshot(a.actor, study.id)).topic!.state).toBe('failed');
    const context = await service.chat.readForJob(chat.job.id);
    expect(
      await service.chat.complete(context.messageId, {
        text: 'late',
        commandResults: [],
        learningItemIds: [],
        shareProposalId: null,
      }),
    ).toBeNull();
    expect(
      (await service.listChat(a.actor, study.id)).find((m) => m.id === context.messageId)?.status,
    ).toBe('failed');
  });
});
