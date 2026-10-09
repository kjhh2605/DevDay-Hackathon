import type {
  Actor,
  ChatExecutionContext,
  ChatStore,
  CreateJobInput,
  ExperienceStore,
  JobInputMap,
  JobsStore,
  LearningStore,
  SharingStore,
} from '@devday/application-ports';
import {
  JobSchema,
  type ApiError,
  type ChatMessage,
  type EndpointInput,
  type ExperienceDraft,
  type Feedback,
  type Job,
  type JobKind,
  type JobResult,
  type LearningItem,
  type ShareProposal,
  type SharedExpression,
  type Utterance,
} from '@devday/contracts';
import { CommandsService } from './commands.js';
import { id, now } from './base.js';
import { many, one, update } from '../db/client.js';
import { DomainError, requireValue } from './errors.js';

export class PrivateService extends CommandsService {
  readonly learning: LearningStore = {
    list: (actor, query) => this.listLearning(actor, query),
    saveFromChat: (actor, input) => this.saveChatLearning(actor, input),
  };
  readonly sharing: SharingStore = {
    createProposal: (actor, input) => this.createShareProposal(actor, input),
    listPending: async (actor, studyId) => {
      await this.assertMember(actor, studyId);
      return many<ShareProposal>(
        this.db.pool,
        "SELECT data FROM share_proposals WHERE owner_user_id=$1 AND study_id=$2 AND data->>'status'='pending' ORDER BY id",
        [actor.userId, studyId],
      );
    },
    decide: (actor, { proposalId, ...input }) => this.decideShare(actor, proposalId, input),
  };
  readonly jobs: JobsStore = {
    create: (input) => this.createJob(input),
    get: (actor, jobId) => this.getJob(actor, jobId),
    read: async (jobId) =>
      requireValue(await one<Job>(this.db.pool, 'SELECT data FROM jobs WHERE id=$1', [jobId])),
    readInput: <K extends JobKind>(jobId: string, kind: K) => this.readJobInput(jobId, kind),
    succeedIfRunning: (jobId, result) => this.succeedJob(jobId, result),
    failIfRunning: (jobId, error) => this.failJob(jobId, error),
    isRunning: async (jobId) =>
      (await one<Job>(this.db.pool, 'SELECT data FROM jobs WHERE id=$1', [jobId]))?.status ===
      'running',
  };
  readonly experiences: ExperienceStore = {
    saveDraft: (jobId, draft) => this.saveDraft(jobId, draft),
    getDraft: async (actor, draftId) => {
      const draft = requireValue(
        await one<ExperienceDraft>(this.db.pool, 'SELECT data FROM experience_drafts WHERE id=$1', [
          draftId,
        ]),
      );
      if (draft.ownerUserId !== actor.userId)
        throw new DomainError('NOT_OWNER', '본인의 경험 초안만 조회할 수 있습니다.', 403);
      return draft;
    },
  };
  readonly chat: ChatStore = {
    begin: (actor, { studyId, ...input }) => this.beginChat(actor, studyId, input),
    readForJob: (jobId) => this.readJobInput(jobId, 'chat.respond'),
    list: (actor, studyId) => this.listChat(actor, studyId),
    complete: (messageId, input) => this.completeChat(messageId, input),
    fail: (messageId, error, partial) => this.failChat(messageId, error, partial),
  };

  async listShareProposals(actor: Actor, studyId: string): Promise<ShareProposal[]> {
    await this.assertMember(actor, studyId);
    return many<ShareProposal>(
      this.db.pool,
      'SELECT data FROM share_proposals WHERE owner_user_id=$1 AND study_id=$2 ORDER BY id',
      [actor.userId, studyId],
    );
  }

  async listLearning(actor: Actor, query?: string | null): Promise<LearningItem[]> {
    const items = await many<LearningItem>(
      this.db.pool,
      "SELECT data FROM learning_items WHERE owner_user_id=$1 ORDER BY data->>'createdAt' DESC,id",
      [actor.userId],
    );
    const needle = query?.trim().toLocaleLowerCase();
    return needle
      ? items.filter((item) =>
          [item.expression, item.meaning, item.example].some((value) =>
            value.toLocaleLowerCase().includes(needle),
          ),
        )
      : items;
  }

  async saveChatLearning(
    actor: Actor,
    input: Parameters<LearningStore['saveFromChat']>[1],
  ): Promise<LearningItem> {
    return this.transaction(async (tx, events) => {
      await this.assertMember(actor, input.studyId, tx);
      const message = requireValue(
        await one<ChatMessage>(tx, 'SELECT data FROM chat_messages WHERE id=$1', [input.messageId]),
      );
      if (
        message.ownerUserId !== actor.userId ||
        message.studyId !== input.studyId ||
        message.role !== 'assistant'
      ) {
        throw new DomainError(
          'NOT_OWNER',
          '본인의 챗봇 답변에서만 학습 항목을 저장할 수 있습니다.',
          403,
        );
      }
      if (!Number.isSafeInteger(input.toolOrdinal) || input.toolOrdinal < 0)
        throw new DomainError('INVALID_INPUT', '도구 실행 순서가 올바르지 않습니다.', 400);
      const sourceKey = `chat:${input.messageId}:${input.toolOrdinal}`;
      // Serialize against job expiry before allowing a provider result to produce side effects.
      const job = requireValue(
        await one<Job>(
          tx,
          'SELECT j.data FROM jobs j JOIN chat_messages m ON m.job_id=j.id WHERE m.id=$1 FOR UPDATE OF j',
          [input.messageId],
        ),
      );
      const existing = await one<LearningItem>(
        tx,
        'SELECT data FROM learning_items WHERE owner_user_id=$1 AND source_key=$2',
        [actor.userId, sourceKey],
      );
      if (existing) return existing;
      if (job.status !== 'running' || message.status !== 'running')
        throw new DomainError('ACTION_NOT_READY', '챗봇 작업이 이미 종료되었습니다.');
      const item: LearningItem = {
        id: id(),
        ownerUserId: actor.userId,
        kind: input.kind,
        expression: input.expression,
        meaning: input.meaning,
        example: input.example,
        source: 'chat',
        sourceKey,
        sourceStudyId: input.studyId,
        sourceUtteranceId: null,
        createdAt: now(),
      };
      await tx.query(
        'INSERT INTO learning_items(id,owner_user_id,source_key,data) VALUES($1,$2,$3,$4)',
        [item.id, actor.userId, sourceKey, JSON.stringify(item)],
      );
      events.push({
        scope: 'user',
        id: actor.userId,
        type: 'learning-items.changed',
        payload: { itemIds: [item.id] },
      });
      return item;
    });
  }

  async createShareProposal(
    actor: Actor,
    input: Parameters<SharingStore['createProposal']>[1],
  ): Promise<ShareProposal> {
    return this.transaction(async (tx, events) => {
      const study = await this.study(tx, input.studyId, true);
      await this.assertMember(actor, study.id, tx);
      const item = requireValue(
        await one<LearningItem>(tx, 'SELECT data FROM learning_items WHERE id=$1 FOR UPDATE', [
          input.learningItemId,
        ]),
      );
      if (item.ownerUserId !== actor.userId || item.sourceStudyId !== study.id)
        throw new DomainError(
          'NOT_OWNER',
          '이 스터디에서 본인이 저장한 표현만 공유할 수 있습니다.',
          403,
        );
      if (item.source !== 'chat' || item.kind !== 'expression')
        throw new DomainError(
          'INVALID_INPUT',
          '챗봇에서 학습한 표현만 공유를 제안할 수 있습니다.',
          400,
        );
      const existing = await one<ShareProposal>(
        tx,
        'SELECT data FROM share_proposals WHERE learning_item_id=$1',
        [item.id],
      );
      if (existing) return existing;
      if (study.status === 'ended')
        throw new DomainError(
          'ACTION_NOT_READY',
          '종료된 스터디에는 새 표현을 공유할 수 없습니다.',
        );
      const messageId = item.sourceKey.split(':')[1];
      const job = requireValue(
        await one<Job>(
          tx,
          'SELECT j.data FROM jobs j JOIN chat_messages m ON m.job_id=j.id WHERE m.id=$1 FOR UPDATE OF j',
          [messageId],
        ),
      );
      if (job.status !== 'running' || job.ownerUserId !== actor.userId)
        throw new DomainError('ACTION_NOT_READY', '챗봇 작업이 이미 종료되었습니다.');
      const proposal: ShareProposal = {
        id: id(),
        revision: 0,
        studyId: study.id,
        ownerUserId: actor.userId,
        learningItemId: item.id,
        expression: item.expression,
        status: 'pending',
        decidedAt: null,
      };
      await tx.query(
        'INSERT INTO share_proposals(id,owner_user_id,study_id,learning_item_id,data) VALUES($1,$2,$3,$4,$5)',
        [proposal.id, actor.userId, study.id, item.id, JSON.stringify(proposal)],
      );
      events.push({
        scope: 'user',
        id: actor.userId,
        type: 'share-proposal.updated',
        payload: proposal,
      });
      return proposal;
    });
  }

  async decideShare(
    actor: Actor,
    proposalId: string,
    input: EndpointInput<'decideShareProposal'>,
  ): Promise<{ proposal: ShareProposal; sharedExpression: SharedExpression | null }> {
    return this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, `sharing.decide:${proposalId}`, input, async () => {
        const initial = requireValue(
          await one<ShareProposal>(tx, 'SELECT data FROM share_proposals WHERE id=$1', [
            proposalId,
          ]),
        );
        if (initial.ownerUserId !== actor.userId)
          throw new DomainError('NOT_OWNER', '본인의 공유 제안만 결정할 수 있습니다.', 403);
        // Topic reservation takes this same lock: acceptance is included either wholly in this snapshot or the next one.
        const study = await this.study(tx, initial.studyId, true);
        await this.assertMember(actor, study.id, tx);
        const proposal = requireValue(
          await one<ShareProposal>(tx, 'SELECT data FROM share_proposals WHERE id=$1 FOR UPDATE', [
            proposalId,
          ]),
        );
        if (proposal.status !== 'pending') {
          return {
            proposal,
            sharedExpression: await one<SharedExpression>(
              tx,
              'SELECT data FROM shared_expressions WHERE source_proposal_id=$1',
              [proposalId],
            ),
          };
        }
        if (study.status === 'ended')
          throw new DomainError(
            'ACTION_NOT_READY',
            '종료된 스터디에는 새 표현을 공유할 수 없습니다.',
          );
        let sharedExpression: SharedExpression | null = null;
        if (input.accepted) {
          const item = requireValue(
            await one<LearningItem>(
              tx,
              'SELECT data FROM learning_items WHERE id=$1 AND owner_user_id=$2',
              [proposal.learningItemId, actor.userId],
            ),
          );
          sharedExpression = {
            id: id(),
            studyId: study.id,
            contributorUserId: actor.userId,
            expression: item.expression,
            meaning: item.meaning,
            example: item.example,
            sourceProposalId: proposal.id,
          };
          await tx.query(
            'INSERT INTO shared_expressions(id,study_id,source_proposal_id,data) VALUES($1,$2,$3,$4)',
            [sharedExpression.id, study.id, proposal.id, JSON.stringify(sharedExpression)],
          );
          events.push({
            scope: 'study',
            id: study.id,
            type: 'shared-expression.added',
            payload: sharedExpression,
          });
        }
        proposal.status = input.accepted ? 'accepted' : 'declined';
        proposal.decidedAt = now();
        proposal.revision++;
        await update(tx, 'share_proposals', proposal.id, proposal);
        events.push({
          scope: 'user',
          id: actor.userId,
          type: 'share-proposal.updated',
          payload: proposal,
        });
        return { proposal, sharedExpression };
      }),
    );
  }

  async createJob(input: CreateJobInput): Promise<Job> {
    return this.transaction(async (tx, events) => {
      if (input.kind === 'utterance.feedback') {
        const initial = requireValue(
          await one<Utterance>(tx, 'SELECT data FROM utterances WHERE id=$1', [input.targetId]),
        );
        const study = await this.study(tx, initial.studyId, true);
        const topic = await this.topic(tx, initial.topicId, true);
        const utterance = requireValue(
          await one<Utterance>(tx, 'SELECT data FROM utterances WHERE id=$1 FOR UPDATE', [
            input.targetId,
          ]),
        );
        if (study.currentTopicId !== topic.id || !['closing', 'review'].includes(topic.state)) {
          throw new DomainError(
            'ACTION_NOT_READY',
            '현재 검토 중인 문장만 피드백을 요청할 수 있습니다.',
          );
        }
        if (
          input.input.utteranceId !== utterance.id ||
          input.input.correctionRevision !== utterance.correctionRevision
        ) {
          throw new DomainError('FEEDBACK_STALE', '최신 보정문에서 피드백을 요청해 주세요.');
        }
        if (
          input.scope !== 'study' ||
          input.studyId !== study.id ||
          input.ownerUserId !== null ||
          input.input.ownerUserId !== utterance.speakerUserId
        ) {
          throw new DomainError(
            'INVALID_INPUT',
            '피드백 작업의 소유자와 스터디가 일치하지 않습니다.',
            400,
          );
        }
        const active = await one<Job>(
          tx,
          "SELECT data FROM jobs WHERE kind='utterance.feedback' AND target_id=$1 AND status='running' AND (input->>'correctionRevision')::int=$2 FOR UPDATE",
          [utterance.id, utterance.correctionRevision],
        );
        if (active) return active;
        const prior = await one<Feedback>(tx, 'SELECT data FROM feedback WHERE id=$1', [
          utterance.id,
        ]);
        // A user-requested close retry only reruns unfinished work; completed sentences retain their feedback.
        if (
          topic.state === 'closing' &&
          prior?.status === 'ready' &&
          prior.inputCorrectionRevision === utterance.correctionRevision
        ) {
          const completed = await one<Job>(
            tx,
            "SELECT data FROM jobs WHERE kind='utterance.feedback' AND target_id=$1 AND status='succeeded' AND (input->>'correctionRevision')::int=$2 ORDER BY data->>'finishedAt' DESC LIMIT 1",
            [utterance.id, utterance.correctionRevision],
          );
          if (completed) return completed;
        }

        const feedback: Feedback = {
          utteranceId: utterance.id,
          revision: (prior?.revision ?? -1) + 1,
          inputCorrectionRevision: utterance.correctionRevision,
          status: 'running',
          items: [],
          error: null,
        };
        await tx.query(
          'INSERT INTO feedback(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
          [utterance.id, JSON.stringify(feedback)],
        );
        events.push({ scope: 'study', id: study.id, type: 'feedback.updated', payload: feedback });
      }
      const { input: payload, ...fields } = input;
      const job = await this.newJob(tx, fields, payload);
      this.jobEvent(events, job);
      return job;
    });
  }

  async readJobInput<K extends JobKind>(jobId: string, kind: K): Promise<JobInputMap[K]> {
    const result = await this.db.pool.query('SELECT kind,input FROM jobs WHERE id=$1', [jobId]);
    const row = requireValue(result.rows[0]);
    if (row.kind !== kind)
      throw new DomainError('INVALID_INPUT', '작업 종류가 일치하지 않습니다.', 400);
    return requireValue(row.input) as JobInputMap[K];
  }

  async succeedJob(jobId: string, result: JobResult): Promise<boolean> {
    return this.transaction(async (tx, events) => {
      const original = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
      if (!original || original.status !== 'running') return false;
      const job = JobSchema.parse({
        ...original,
        status: 'succeeded',
        result,
        error: null,
        revision: original.revision + 1,
        finishedAt: now(),
      });
      await this.updateJob(tx, job);
      this.jobEvent(events, job);
      return true;
    });
  }

  async prepareExperience(actor: Actor, input: EndpointInput<'prepareExperience'>): Promise<Job> {
    return this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, 'experience.prepare', input, async () => {
        const job = await this.newJob(
          tx,
          {
            kind: 'experience.prepare',
            scope: 'user',
            ownerUserId: actor.userId,
            studyId: null,
            targetId: id(),
          },
          { ...input, ownerUserId: actor.userId },
        );
        this.jobEvent(events, job);
        return job;
      }),
    );
  }

  async saveDraft(
    jobId: string,
    input: Omit<ExperienceDraft, 'id' | 'revision' | 'ownerUserId'>,
  ): Promise<ExperienceDraft | null> {
    return this.transaction(async (tx, events) => {
      const job = requireValue(
        await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]),
      );
      if (job.kind !== 'experience.prepare')
        throw new DomainError('INVALID_INPUT', '경험 준비 작업이 아닙니다.', 400);
      if (job.status !== 'running') return null;
      const existing = await one<ExperienceDraft>(
        tx,
        'SELECT data FROM experience_drafts WHERE id=$1',
        [job.targetId],
      );
      if (existing) return existing;
      const draft: ExperienceDraft = {
        ...input,
        id: job.targetId,
        revision: 0,
        ownerUserId: job.ownerUserId!,
      };
      await tx.query('INSERT INTO experience_drafts(id,owner_user_id,data) VALUES($1,$2,$3)', [
        draft.id,
        draft.ownerUserId,
        JSON.stringify(draft),
      ]);
      events.push({
        scope: 'user',
        id: draft.ownerUserId,
        type: 'experience-draft.ready',
        payload: draft,
      });
      return draft;
    });
  }

  async listChat(actor: Actor, studyId: string): Promise<ChatMessage[]> {
    await this.assertMember(actor, studyId);
    return many<ChatMessage>(
      this.db.pool,
      "SELECT data FROM chat_messages WHERE owner_user_id=$1 AND study_id=$2 ORDER BY data->>'createdAt',id",
      [actor.userId, studyId],
    );
  }

  async beginChat(
    actor: Actor,
    studyId: string,
    input: EndpointInput<'sendChatMessage'>,
  ): Promise<{ message: ChatMessage; job: Job; existing: boolean }> {
    return this.transaction(async (tx, events) => {
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
        `chat:${actor.userId}:${input.clientMessageId}`,
      ]);
      const prior = await tx.query(
        'SELECT data,job_id FROM chat_messages WHERE owner_user_id=$1 AND client_message_id=$2',
        [actor.userId, input.clientMessageId],
      );
      if (prior.rowCount) {
        const message = prior.rows[0]!.data as ChatMessage;
        if (message.studyId !== studyId || message.text !== input.text)
          throw new DomainError(
            'COMMAND_CONFLICT',
            '같은 메시지 ID에 다른 입력을 사용할 수 없습니다.',
          );
        await this.assertMember(actor, studyId, tx);
        return {
          message,
          job: requireValue(
            await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1', [prior.rows[0]!.job_id]),
          ),
          existing: true,
        };
      }
      const study = await this.study(tx, studyId, true);
      await this.assertMember(actor, studyId, tx);
      const history = await many<ChatMessage>(
        tx,
        "SELECT data FROM chat_messages WHERE owner_user_id=$1 AND study_id=$2 ORDER BY data->>'createdAt',id",
        [actor.userId, studyId],
      );
      const receivedAt = Math.max(
        Date.now(),
        history.length ? Date.parse(history[history.length - 1]!.createdAt) + 1 : 0,
      );
      const fields = {
        revision: 0,
        studyId,
        ownerUserId: actor.userId,
        commandResults: [],
        learningItemIds: [],
        shareProposalId: null,
      };
      const message: ChatMessage = {
        ...fields,
        id: id(),
        role: 'user',
        text: input.text,
        status: 'succeeded',
        createdAt: new Date(receivedAt).toISOString(),
      };
      const assistant: ChatMessage = {
        ...fields,
        id: id(),
        role: 'assistant',
        text: '',
        status: 'running',
        createdAt: new Date(receivedAt + 1).toISOString(),
      };
      const context: ChatExecutionContext = {
        actor: { userId: actor.userId },
        studyId,
        messageId: assistant.id,
        expectedTopicId: study.currentTopicId,
        expectedTransitionVersion: study.transitionVersion,
        text: input.text,
        history,
      };
      const job = await this.newJob(
        tx,
        {
          kind: 'chat.respond',
          scope: 'user',
          ownerUserId: actor.userId,
          studyId,
          targetId: assistant.id,
        },
        context,
      );
      await tx.query(
        'INSERT INTO chat_messages(id,owner_user_id,study_id,client_message_id,data,context,job_id) VALUES($1,$2,$3,$4,$5,$6,$7)',
        [
          message.id,
          actor.userId,
          studyId,
          input.clientMessageId,
          JSON.stringify(message),
          JSON.stringify(context),
          job.id,
        ],
      );
      await tx.query(
        'INSERT INTO chat_messages(id,owner_user_id,study_id,data,context,job_id) VALUES($1,$2,$3,$4,$5,$6)',
        [
          assistant.id,
          actor.userId,
          studyId,
          JSON.stringify(assistant),
          JSON.stringify(context),
          job.id,
        ],
      );
      this.jobEvent(events, job);
      for (const changed of [message, assistant])
        events.push({
          scope: 'user',
          id: actor.userId,
          type: 'chat.message.updated',
          payload: changed,
        });
      return { message, job, existing: false };
    });
  }

  async completeChat(
    messageId: string,
    input: Parameters<ChatStore['complete']>[1],
  ): Promise<ChatMessage | null> {
    return this.transaction(async (tx, events) => {
      const job = await one<Job>(
        tx,
        'SELECT j.data FROM jobs j JOIN chat_messages m ON m.job_id=j.id WHERE m.id=$1 FOR UPDATE OF j',
        [messageId],
      );
      if (
        !job ||
        job.kind !== 'chat.respond' ||
        job.status !== 'running' ||
        job.targetId !== messageId
      )
        return null;
      const message = requireValue(
        await one<ChatMessage>(tx, 'SELECT data FROM chat_messages WHERE id=$1 FOR UPDATE', [
          messageId,
        ]),
      );
      if (message.status !== 'running') return null;
      if (input.commandResults.some((result) => result.studyId !== message.studyId))
        throw new DomainError('INVALID_INPUT', '명령 결과의 스터디가 일치하지 않습니다.', 400);
      if (input.learningItemIds.length) {
        const owned = await many<LearningItem>(
          tx,
          'SELECT data FROM learning_items WHERE id=ANY($1::uuid[]) AND owner_user_id=$2',
          [input.learningItemIds, message.ownerUserId],
        );
        if (new Set(input.learningItemIds).size !== owned.length)
          throw new DomainError('NOT_OWNER', '다른 사용자의 학습 항목을 연결할 수 없습니다.', 403);
      }
      if (input.shareProposalId) {
        const proposal = requireValue(
          await one<ShareProposal>(tx, 'SELECT data FROM share_proposals WHERE id=$1', [
            input.shareProposalId,
          ]),
        );
        if (proposal.ownerUserId !== message.ownerUserId || proposal.studyId !== message.studyId)
          throw new DomainError('NOT_OWNER', '다른 사용자의 공유 제안을 연결할 수 없습니다.', 403);
      }
      const completed: ChatMessage = {
        ...message,
        ...input,
        status: 'succeeded',
        revision: message.revision + 1,
      };
      await update(tx, 'chat_messages', messageId, completed);
      const terminal = JobSchema.parse({
        ...job,
        status: 'succeeded',
        result: { messageId },
        error: null,
        finishedAt: now(),
        revision: job.revision + 1,
      });
      await this.updateJob(tx, terminal);
      this.jobEvent(events, terminal);
      events.push({
        scope: 'user',
        id: message.ownerUserId,
        type: 'chat.message.updated',
        payload: completed,
      });
      return completed;
    });
  }

  async failChat(
    messageId: string,
    error: ApiError,
    partial?: Pick<ChatMessage, 'commandResults' | 'learningItemIds' | 'shareProposalId'>,
  ): Promise<void> {
    await this.transaction(async (tx, events) => {
      const job = await one<Job>(
        tx,
        'SELECT j.data FROM jobs j JOIN chat_messages m ON m.job_id=j.id WHERE m.id=$1 FOR UPDATE OF j',
        [messageId],
      );
      if (
        !job ||
        job.kind !== 'chat.respond' ||
        job.status !== 'running' ||
        job.targetId !== messageId
      )
        return;
      const message = await one<ChatMessage>(
        tx,
        'SELECT data FROM chat_messages WHERE id=$1 FOR UPDATE',
        [messageId],
      );
      if (!message || message.status !== 'running') return;
      if (partial) Object.assign(message, partial);
      message.text = error.message;
      message.status = 'failed';
      message.revision++;
      await update(tx, 'chat_messages', messageId, message);
      const terminal = JobSchema.parse({
        ...job,
        status: 'failed',
        result: null,
        error,
        finishedAt: now(),
        revision: job.revision + 1,
      });
      await this.updateJob(tx, terminal);
      this.jobEvent(events, terminal);
      events.push({
        scope: 'user',
        id: message.ownerUserId,
        type: 'chat.message.updated',
        payload: message,
      });
    });
  }
}
