import type { Actor } from '@devday/application-ports';
import type {
  StudyCommand,
  CommandResult,
  Study,
  Topic,
  Feedback,
  Utterance,
  TranscriptSegment,
  LearningItem,
  Experience,
  SharedExpression,
  Job,
} from '@devday/contracts';
import { AccountsService } from './accounts.js';
import { id, now, type PendingEvent } from './base.js';
import { many, one, update, type SqlClient } from '../db/client.js';
import { DomainError } from './errors.js';
export class CommandsService extends AccountsService {
  async generationContext(
    tx: SqlClient,
    study: Study,
    focusUserId: string | null,
    previousTopicId: string | null,
  ) {
    const participants = study.members.filter((m) => m.state === 'joined');
    if (focusUserId && !participants.some((m) => m.userId === focusUserId))
      throw new DomainError('NOT_MEMBER', '참여한 사용자의 경험만 지정할 수 있습니다.', 403);
    const owners = focusUserId ? [focusUserId] : participants.map((m) => m.userId);
    const experiences = await many<Experience>(
      tx,
      'SELECT data FROM experiences WHERE owner_user_id=ANY($1)',
      [owners],
    );
    const learningExpressions = previousTopicId
      ? await many<LearningItem>(
          tx,
          "SELECT l.data FROM learning_items l JOIN utterances u ON u.id=(l.data->>'sourceUtteranceId')::uuid WHERE u.topic_id=$1 AND l.data->>'source'='approved_feedback'",
          [previousTopicId],
        )
      : [];
    const sharedExpressions = await many<SharedExpression>(
      tx,
      'SELECT data FROM shared_expressions WHERE study_id=$1',
      [study.id],
    );
    if (!experiences.length && !learningExpressions.length && !sharedExpressions.length)
      throw new DomainError('CONTEXT_REQUIRED', '참여자의 경험을 먼저 저장해 주세요.', 422);
    return {
      studyId: study.id,
      focusUserId,
      participants,
      experiences: experiences.map(({ id, ownerUserId, summary, interests, context }) => ({
        id,
        ownerUserId,
        summary,
        interests,
        context,
      })),
      learningExpressions,
      sharedExpressions,
    };
  }
  async reserveTopic(
    tx: SqlClient,
    events: PendingEvent[],
    study: Study,
    focusUserId: string | null,
    previous: Topic | null,
    retry = false,
  ) {
    const context = retry
      ? (await tx.query('SELECT generation_input FROM topics WHERE id=$1', [previous!.id])).rows[0]!
          .generation_input
      : await this.generationContext(tx, study, focusUserId, previous?.id ?? null);
    const topicId = retry ? previous!.id : id();
    const job = await this.newJob(
      tx,
      {
        kind: 'topic.generate',
        scope: 'study',
        ownerUserId: null,
        studyId: study.id,
        targetId: topicId,
      },
      { topicId },
    );
    const topic: Topic = retry
      ? {
          ...previous!,
          state: 'generating',
          generationJobId: job.id,
          revision: previous!.revision + 1,
        }
      : {
          id: topicId,
          revision: 0,
          studyId: study.id,
          ordinal: (previous?.ordinal ?? 0) + 1,
          state: 'generating',
          focusUserId,
          content: null,
          generationJobId: job.id,
          approvedAt: null,
        };
    if (retry) await update(tx, 'topics', topic.id, topic);
    else
      await tx.query(
        'INSERT INTO topics(id,study_id,ordinal,data,generation_input) VALUES($1,$2,$3,$4,$5)',
        [topic.id, study.id, topic.ordinal, JSON.stringify(topic), JSON.stringify(context)],
      );
    study.currentTopicId = topic.id;
    study.status = 'active';
    study.transitionVersion++;
    study.revision++;
    await update(tx, 'studies', study.id, study);
    this.jobEvent(events, job);
    await this.studyEvent(tx, events, study);
    return { topic, job };
  }
  async approve(tx: SqlClient, events: PendingEvent[], study: Study, topic: Topic) {
    const segments = await many<TranscriptSegment>(
      tx,
      'SELECT data FROM transcript_segments WHERE topic_id=$1',
      [topic.id],
    );
    const utterances = await many<Utterance>(
      tx,
      'SELECT data FROM utterances WHERE topic_id=$1 FOR UPDATE',
      [topic.id],
    );
    const feedback = await many<Feedback>(
      tx,
      'SELECT f.data FROM feedback f JOIN utterances u ON u.id=f.id WHERE u.topic_id=$1',
      [topic.id],
    );
    const badSegments = segments.filter(
      (s) =>
        s.rawStatus !== 'ready' || s.correctionStatus !== 'ready' || s.sentenceStatus !== 'ready',
    );
    const badUtterances = utterances.filter(
      (u) =>
        !feedback.some(
          (f) =>
            f.utteranceId === u.id &&
            f.status === 'ready' &&
            f.inputCorrectionRevision === u.correctionRevision,
        ),
    );
    if (badSegments.length || badUtterances.length)
      throw new DomainError(
        'FEEDBACK_STALE',
        '모든 문장의 최신 피드백을 확인한 뒤 승인해 주세요.',
        409,
        { segmentIds: badSegments.map((s) => s.id), utteranceIds: badUtterances.map((u) => u.id) },
      );
    const ownerItems = new Map<string, string[]>();
    for (const u of utterances) {
      for (const f of feedback.find((f) => f.utteranceId === u.id)!.items) {
        const item: LearningItem = {
          id: id(),
          ownerUserId: u.speakerUserId,
          kind: 'expression',
          expression: f.expression,
          meaning: f.meaning,
          example: f.example,
          source: 'approved_feedback',
          sourceKey: `feedback:${topic.id}:${u.id}:${f.id}`,
          sourceStudyId: study.id,
          sourceUtteranceId: u.id,
          createdAt: now(),
        };
        const result = await tx.query(
          'INSERT INTO learning_items(id,owner_user_id,source_key,data) VALUES($1,$2,$3,$4) ON CONFLICT(owner_user_id,source_key) DO NOTHING RETURNING id',
          [item.id, item.ownerUserId, item.sourceKey, JSON.stringify(item)],
        );
        if (result.rowCount)
          ownerItems.set(item.ownerUserId, [...(ownerItems.get(item.ownerUserId) ?? []), item.id]);
      }
    }
    for (const [owner, itemIds] of ownerItems)
      events.push({
        scope: 'user',
        id: owner,
        type: 'learning-items.changed',
        payload: { itemIds },
      });
    topic.state = 'approved';
    topic.approvedAt = now();
    topic.revision++;
    await update(tx, 'topics', topic.id, topic);
  }
  async execute(
    actor: Actor,
    input: { studyId: string; command: StudyCommand },
  ): Promise<CommandResult> {
    let dispatch: { kind: 'generateTopic' | 'closeTopic'; id: string } | undefined;
    const result = await this.transaction(async (tx, events) =>
      this.receipt(
        tx,
        actor,
        input.command.commandId,
        `study.command:${input.studyId}`,
        input.command,
        async () => {
          const command = input.command;
          const study = await this.study(tx, input.studyId, true);
          await this.assertMember(actor, study.id, tx);
          const topic = study.currentTopicId
            ? await this.topic(tx, study.currentTopicId, true)
            : null;
          const base = (): CommandResult => ({
            commandId: command.commandId,
            outcome: 'applied',
            studyId: study.id,
            topicId: study.currentTopicId,
            jobId: null,
            transitionVersion: study.transitionVersion,
          });
          if (
            command.expectedTopicId !== study.currentTopicId ||
            command.expectedTransitionVersion !== study.transitionVersion
          )
            throw new DomainError(
              'STALE_TOPIC',
              '주제가 변경되었습니다. 현재 상태를 확인한 뒤 다시 요청해 주세요.',
            );
          if (study.status === 'ended')
            throw new DomainError('ACTION_NOT_READY', '이미 종료된 스터디입니다.');
          if (topic?.state === 'generating' || topic?.state === 'closing') {
            const job = await one<Job>(
              tx,
              "SELECT data FROM jobs WHERE target_id=$1 AND status='running' AND kind=$2",
              [topic.id, topic.state === 'generating' ? 'topic.generate' : 'topic.close'],
            );
            const same =
              topic.state === 'generating'
                ? command.type === 'study.start' || command.type === 'topic.advance'
                : command.type === 'topic.close' || command.type === 'study.finish';
            if (job) {
              if (same) return { ...base(), outcome: 'in_progress' as const, jobId: job.id };
              throw new DomainError('ACTION_NOT_READY', '현재 작업이 끝난 뒤 요청해 주세요.');
            }
            if (topic.state === 'generating')
              throw new DomainError('ACTION_NOT_READY', '주제 생성 상태를 확인해 주세요.');
          }
          if (command.type === 'study.start') {
            if (study.status !== 'waiting' || topic)
              throw new DomainError('ACTION_NOT_READY', '스터디가 이미 시작되었습니다.');
            const reserved = await this.reserveTopic(tx, events, study, command.focusUserId, null);
            dispatch = { kind: 'generateTopic', id: reserved.job.id };
            return { ...base(), jobId: reserved.job.id };
          }
          if (command.type === 'topic.advance') {
            if (!topic) throw new DomainError('ACTION_NOT_READY', '현재 주제가 없습니다.');
            if (topic.state === 'failed') {
              const reserved = await this.reserveTopic(
                tx,
                events,
                study,
                topic.focusUserId,
                topic,
                true,
              );
              dispatch = { kind: 'generateTopic', id: reserved.job.id };
              return { ...base(), jobId: reserved.job.id };
            }
            if (topic.state === 'talking')
              throw new DomainError(
                'REVIEW_REQUIRED',
                '주제 대화를 종료하고 피드백을 검토해 주세요.',
              );
            if (topic.state !== 'review')
              throw new DomainError(
                'ACTION_NOT_READY',
                '검토가 끝난 뒤 다음 주제로 이동할 수 있습니다.',
              );
            await this.approve(tx, events, study, topic);
            const reserved = await this.reserveTopic(tx, events, study, command.focusUserId, topic);
            dispatch = { kind: 'generateTopic', id: reserved.job.id };
            return { ...base(), jobId: reserved.job.id };
          }
          if (
            topic &&
            (topic.state === 'talking' || topic.state === 'closing') &&
            (command.type === 'topic.close' || command.type === 'study.finish')
          ) {
            topic.state = 'closing';
            topic.revision++;
            study.transitionVersion++;
            study.revision++;
            await update(tx, 'topics', topic.id, topic);
            await update(tx, 'studies', study.id, study);
            const job = await this.newJob(
              tx,
              {
                kind: 'topic.close',
                scope: 'study',
                ownerUserId: null,
                studyId: study.id,
                targetId: topic.id,
              },
              { topicId: topic.id, closeId: id() },
            );
            this.jobEvent(events, job);
            await this.studyEvent(tx, events, study);
            dispatch = { kind: 'closeTopic', id: job.id };
            return { ...base(), jobId: job.id };
          }
          if (command.type === 'study.finish') {
            if (topic?.state === 'review') await this.approve(tx, events, study, topic);
            else if (topic && topic.state !== 'failed')
              throw new DomainError('ACTION_NOT_READY', '피드백 검토를 완료해 주세요.');
            study.status = 'ended';
            study.endedAt = now();
            study.transitionVersion++;
            study.revision++;
            await update(tx, 'studies', study.id, study);
            await this.studyEvent(tx, events, study);
            return base();
          }
          throw new DomainError('ACTION_NOT_READY', '현재 상태에서 실행할 수 없는 요청입니다.');
        },
      ),
    );
    if (dispatch) this.dispatch(dispatch.kind, dispatch.id);
    return result;
  }
}
