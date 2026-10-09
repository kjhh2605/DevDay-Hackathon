import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../../apps/api/src/app.js';
import { loadEnvironment, parseConfig } from '../../apps/api/src/config.js';
import { OpenAIProvider, loadAiConfig } from '../../packages/ai/src/index.js';
import type { User } from '../../packages/contracts/src/index.js';
import { ActorClient } from './flow.js';

const id = () => randomUUID();
type Step = {
  name: string;
  status: 'running' | 'passed' | 'failed';
  startedAt: string;
  durationMs?: number;
  details?: unknown;
  error?: string;
};
export async function runLiveBranches() {
  const { env, workspaceRoot } = loadEnvironment();
  const session = JSON.parse(
    await readFile(
      resolve(workspaceRoot, '.local/validation/live-inspection-session.json'),
      'utf8',
    ),
  ) as {
    databaseName: string;
    mediaDirectory: string;
    a: { user: User; cookie: string };
    b: { user: User; cookie: string };
  };
  assert(/^devday_live_\d+$/.test(session.databaseName));
  const port = Number(process.env.LIVE_BRANCH_API_PORT ?? 4203),
    origin = `http://127.0.0.1:${port}`;
  const config = parseConfig(
    {
      ...env,
      AI_MODE: 'live',
      APP_ENV: 'local',
      NODE_ENV: 'test',
      DB_NAME: session.databaseName,
      API_HOST: '127.0.0.1',
      PORT: String(port),
      WEB_PORT: String(port),
      LOCAL_WEB_ORIGIN: origin,
      LOCAL_TLS_CERT: '',
      LOCAL_TLS_KEY: '',
      SESSION_COOKIE_SECURE: 'false',
      MEDIA_DRIVER: 'filesystem',
      MEDIA_LOCAL_DIR: session.mediaDirectory,
    },
    { workspaceRoot },
  );
  const steps: Step[] = [];
  const providerRequests: { capability: string; model: string; requestId: string | null }[] = [];
  const evidence = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    result: 'running',
    databaseName: session.databaseName,
    aiMode: 'live',
    limitations: [
      'One laptop API/WebSocket branch verification; not physical microphones, visual acceptance, or G3 pass.',
    ],
    providerRequests,
    steps,
  };
  const onlyNamed = process.argv.includes('--only-named');
  const onlyDetailed = process.argv.includes('--only-detailed');
  const evidenceName = onlyNamed
    ? 'live-named-participant.json'
    : onlyDetailed
      ? 'live-detailed-experience.json'
      : 'live-branches.json';
  const path = resolve(workspaceRoot, '.local/validation', evidenceName);
  const save = () => writeFile(path, JSON.stringify(evidence, null, 2) + '\n');
  async function step<T>(name: string, execute: () => Promise<T>) {
    const start = Date.now(),
      item: Step = { name, status: 'running', startedAt: new Date().toISOString() };
    steps.push(item);
    await save();
    console.info(`LIVE branch start: ${name}`);
    try {
      const value = await execute();
      item.status = 'passed';
      item.details = value;
      return value;
    } catch (error) {
      item.status = 'failed';
      item.error = error instanceof Error ? error.message : 'Unknown failure';
      throw error;
    } finally {
      item.durationMs = Date.now() - start;
      await save();
      console.info(`LIVE branch ${item.status}: ${name} (${item.durationMs}ms)`);
    }
  }
  const provider = new OpenAIProvider(
    loadAiConfig({
      OPENAI_API_KEY: config.openai.apiKey,
      OPENAI_TEXT_MODEL: config.openai.textModel,
      OPENAI_CORRECTION_MODEL: config.openai.correctionModel,
      OPENAI_LIVE_TRANSCRIBE_MODEL: config.openai.liveTranscribeModel,
      OPENAI_IMAGE_MODEL: config.openai.imageModel,
    }),
    {
      onAudit: (audit) => {
        providerRequests.push(audit);
      },
    },
  );
  const { app, db } = await createApp({ config, provider, interruptJobs: false, logger: false });
  const actors: ActorClient[] = [];
  try {
    await app.listen({ host: config.host, port });
    const a = new ActorClient(origin, origin),
      b = new ActorClient(origin, origin);
    a.user = session.a.user;
    a.cookie = session.a.cookie;
    b.user = session.b.user;
    b.cookie = session.b.cookie;
    actors.push(a, b);
    await Promise.all([a.connectEvents(), b.connectEvents()]);
    if (!process.argv.includes('--skip-detailed') && !onlyNamed)
      await step('A15 detailed input produces draft without follow-up questions', async () => {
        const originalText =
          '지난 토요일 오후 2시에 서울숲에서 친구 민수와 3km를 걸었어요. 벤치에 앉아 도시락을 먹고 다음 달 제주도 여행 계획을 이야기했어요. 걷기와 여행에 관심이 있어요.';
        const job = await a.call('prepareExperience', {
          originalText,
          answers: [],
          skipQuestions: false,
          commandId: id(),
        });
        const finished = await a.job(job.id);
        assert(finished.kind === 'experience.prepare' && finished.result);
        const draft = finished.result.draft;
        assert.equal(
          draft.questions.length,
          0,
          `Detailed grounded input should not require optional follow-up questions: ${draft.questions.join(' ')}`,
        );
        assert(draft.summary);
        assert.equal(draft.originalText, originalText);
        return {
          draftId: draft.id,
          questionCount: draft.questions.length,
          summary: draft.summary,
          context: draft.context,
          saved: false,
        };
      });
    if (onlyDetailed) {
      evidence.result = 'passed_detailed_experience_only';
      return;
    }
    await step(
      'A18 named participant command freezes only selected owner experiences and generates live image',
      async () => {
        const experiences = await a.call('experiences', undefined);
        assert(experiences.length > 0);
        let otherExperiences = await b.call('experiences', undefined);
        if (!otherExperiences.length) {
          const originalText =
            '지난 일요일 집 베란다에서 혼자 토마토와 바질을 심었어요. 화분에 흙을 넣고 물을 주었어요. 원예에 관심이 있어요.';
          const prepared = await b.call('prepareExperience', {
            originalText,
            answers: [],
            skipQuestions: true,
            commandId: id(),
          });
          const ready = await b.job(prepared.id);
          assert(ready.kind === 'experience.prepare' && ready.result?.draft.summary);
          const draft = ready.result.draft;
          await b.call('createExperience', {
            originalText: draft.originalText,
            answers: draft.answers,
            summary: draft.summary!,
            interests: draft.interests,
            context: draft.context,
            draftId: draft.id,
            commandId: id(),
          });
          otherExperiences = await b.call('experiences', undefined);
        }
        assert(
          otherExperiences.some((item) => item.ownerUserId === b.user.id),
          'The unselected participant must have an available experience to prove exclusion',
        );
        const study = await a.call('createStudy', {
          participantHandles: [b.user.handle],
          commandId: id(),
        });
        await b.call('joinStudy', { commandId: id() }, { studyId: study.id });
        await Promise.all([a.subscribe(study.id), b.subscribe(study.id)]);
        const reply = await b.chat(
          study.id,
          `${a.user.displayName} 님, 아이디 @${a.user.handle} 의 경험을 지명해서 스터디를 시작해줘.`,
        );
        const command = reply.commandResults.find((result) => result.jobId);
        assert(command?.jobId, 'Named natural-language start must execute product command');
        await a.job(command.jobId);
        const snapshot = await a.snapshot(study.id);
        assert(snapshot.topic?.content);
        assert.equal(snapshot.topic.focusUserId, a.user.id);
        const row = (
          await db.pool.query('SELECT generation_input FROM topics WHERE id=$1', [
            snapshot.topic.id,
          ])
        ).rows[0] as {
          generation_input: {
            focusUserId: string;
            experiences: { id: string; ownerUserId: string }[];
          };
        };
        assert.equal(row.generation_input.focusUserId, a.user.id);
        assert(
          row.generation_input.experiences.length > 0 &&
            row.generation_input.experiences.every((item) => item.ownerUserId === a.user.id),
        );
        assert(
          !row.generation_input.experiences.some((item) =>
            otherExperiences.some((other) => other.id === item.id),
          ),
        );
        assert.equal(snapshot.topic.content.kind, 'image');
        assert(snapshot.topic.content.sourceExperienceIds.length > 0);
        assert(
          snapshot.topic.content.sourceExperienceIds.every((sourceId) =>
            experiences.some((item) => item.id === sourceId),
          ),
        );
        assert(snapshot.topic.content.conversationInstruction);
        // Leave this generated topic available for read-only visual inspection without another paid image.
        return {
          studyId: study.id,
          topicId: snapshot.topic.id,
          state: snapshot.topic.state,
          focusUserId: snapshot.topic.focusUserId,
          generationExperienceIds: row.generation_input.experiences.map((item) => item.id),
          excludedExistingExperienceIds: otherExperiences.map((item) => item.id),
          contentExperienceIds: snapshot.topic.content.sourceExperienceIds,
          kind: snapshot.topic.content.kind,
          conversationInstruction: snapshot.topic.content.conversationInstruction,
        };
      },
    );
    if (onlyNamed) {
      evidence.result = 'passed_named_participant_only';
      return;
    }
    const c = new ActorClient(origin, origin),
      d = new ActorClient(origin, origin);
    actors.push(c, d);
    const suffix = Date.now().toString(36);
    c.user = await c.call('register', { displayName: '문장 C', handle: `sentence_c_${suffix}` });
    d.user = await d.call('register', { displayName: '문장 D', handle: `sentence_d_${suffix}` });
    await Promise.all([c.connectEvents(), d.connectEvents()]);
    const sentence = await step(
      'A19 no-experience context gate and accepted expression generate live sentence with instruction',
      async () => {
        assert.deepEqual(await c.call('experiences', undefined), []);
        assert.deepEqual(await d.call('experiences', undefined), []);
        const study = await c.call('createStudy', {
          participantHandles: [d.user.handle],
          commandId: id(),
        });
        await d.call('joinStudy', { commandId: id() }, { studyId: study.id });
        await Promise.all([c.subscribe(study.id), d.subscribe(study.id)]);
        await assert.rejects(c.command(study.id, 'study.start'), /CONTEXT_REQUIRED/);
        assert.equal((await c.snapshot(study.id)).study.status, 'waiting');
        const expression = await c.chat(
          study.id,
          '"회의 일정을 다음 주로 미루고 싶어요"를 자연스러운 영어 표현으로 배우고 싶어. 표현 기록에 저장해줘.',
        );
        assert(expression.shareProposalId);
        const accepted = await c.call(
          'decideShareProposal',
          { accepted: true, commandId: id() },
          { id: expression.shareProposalId },
        );
        assert(accepted.sharedExpression);
        const start = await d.command(study.id, 'study.start');
        assert(start.jobId);
        await c.job(start.jobId);
        const snapshot = await d.snapshot(study.id);
        assert(snapshot.topic?.content?.kind === 'sentence');
        assert(snapshot.topic.content.sentence);
        assert(snapshot.topic.content.conversationInstruction);
        assert.deepEqual(snapshot.topic.content.sourceExperienceIds, []);
        assert.equal(snapshot.topic.content.imageMediaId, null);
        assert(snapshot.topic.content.sharedExpressionIds.includes(accepted.sharedExpression.id));
        const row = (
          await db.pool.query('SELECT generation_input FROM topics WHERE id=$1', [
            snapshot.topic.id,
          ])
        ).rows[0] as {
          generation_input: {
            experiences: unknown[];
            sharedExpressions: { id: string }[];
            learningExpressions: unknown[];
          };
        };
        assert.deepEqual(row.generation_input.experiences, []);
        assert.deepEqual(row.generation_input.learningExpressions, []);
        assert.deepEqual(
          row.generation_input.sharedExpressions.map((item) => item.id),
          [accepted.sharedExpression.id],
        );
        return {
          studyId: study.id,
          topicId: snapshot.topic.id,
          sharedExpressionId: accepted.sharedExpression.id,
          content: snapshot.topic.content,
          contextRequiredBeforeSharing: true,
        };
      },
    );
    await step(
      'E06 second next phrase executes approval and next live sentence generation',
      async () => {
        const close = await c.command(sentence.studyId, 'topic.close');
        assert(close.jobId);
        await c.job(close.jobId);
        assert.equal((await d.snapshot(sentence.studyId)).topic?.state, 'review');
        const reply = await d.chat(sentence.studyId, '다음 주제 만들어줘');
        const next = reply.commandResults.find((result) => result.topicId !== sentence.topicId);
        assert(next?.jobId, 'Second phrase must execute advance_topic');
        await d.job(next.jobId);
        const snapshot = await c.snapshot(sentence.studyId);
        assert.equal(snapshot.topic?.ordinal, 2);
        assert(snapshot.topic?.content?.kind === 'sentence');
        assert(snapshot.topic.content.conversationInstruction);
        assert(snapshot.topic.content.sharedExpressionIds.includes(sentence.sharedExpressionId));
        const prior = (
          await db.pool.query('SELECT data FROM topics WHERE id=$1', [sentence.topicId])
        ).rows[0] as { data: { state: string; approvedAt: string | null } };
        assert.equal(prior.data.state, 'approved');
        assert(prior.data.approvedAt);
        const finalClose = await d.command(sentence.studyId, 'study.finish');
        assert(finalClose.jobId);
        await d.job(finalClose.jobId);
        await c.command(sentence.studyId, 'study.finish');
        assert.equal((await d.snapshot(sentence.studyId)).study.status, 'ended');
        return {
          studyId: sentence.studyId,
          priorTopicId: sentence.topicId,
          priorState: prior.data.state,
          nextTopicId: snapshot.topic.id,
          ordinal: snapshot.topic.ordinal,
          content: snapshot.topic.content,
          finalStatus: 'ended',
          note: 'This branch intentionally has no utterances; speaker-owned learning approval is covered by live-flow.',
        };
      },
    );
    evidence.result = process.argv.includes('--skip-detailed')
      ? 'passed_named_and_sentence_api_branches_only'
      : 'passed_live_api_branches_only';
  } catch (error) {
    evidence.result = 'failed';
    process.exitCode = 1;
    console.error(error instanceof Error ? error.message : 'Live branches failed');
  } finally {
    for (const actor of actors) actor.eventSocket?.close();
    await app.close();
    evidence.finishedAt = new Date().toISOString();
    await save();
    console.info(`Live branch evidence: ${path}`);
  }
}
