import {
  endpointRegistry,
  JobSchema,
  StudySnapshotSchema,
  type ApiError,
  type EndpointName,
  type EndpointInput,
  type EndpointOutput,
  type EndpointParams,
  type StudySnapshot,
} from '@devday/contracts';
import * as seed from './data.js';

export class FixtureError extends Error {
  constructor(
    readonly status: number,
    readonly code: ApiError['code'],
    message: string,
  ) {
    super(message);
  }
}

export interface FixtureStoreOptions {
  /** Session selection is a mock transport concern, never an HTTP actor parameter. */
  userId?: string | null;
  scenario?: 'waiting' | 'talking' | 'review' | 'generating' | 'failed' | 'empty';
}

/** Isolated state per story/test; no mutable process-wide fixture singleton. */
export function createFixtureStore(options: FixtureStoreOptions = {}) {
  let currentUserId = options.userId === undefined ? seed.fixtureIds.userA : options.userId;
  let counter = 1000;
  const nextId = () => seed.fixtureId(counter++);
  const now = () => new Date().toISOString();
  const scenario = options.scenario ?? 'review';
  const state = {
    users: structuredClone(seed.users),
    snapshot: structuredClone(
      scenario === 'waiting' || scenario === 'empty' ? seed.emptyStudySnapshot : seed.studySnapshot,
    ),
    learningItems: structuredClone(scenario === 'empty' ? [] : seed.learningItems),
    experiences: structuredClone(scenario === 'empty' ? [] : seed.experiences),
    drafts: structuredClone([seed.experienceDraft, seed.summarizedDraft]),
    chatMessages: structuredClone(scenario === 'empty' ? [] : seed.chatMessages),
    proposals: structuredClone(scenario === 'empty' ? [] : [seed.pendingProposal]),
    jobs: structuredClone(seed.jobs),
  };
  if (scenario === 'talking') {
    state.snapshot.topic = structuredClone(seed.imageTopic);
    state.snapshot.utterances = [];
    state.snapshot.feedback = [];
  } else if (scenario === 'generating' || scenario === 'failed') {
    state.snapshot.topic = structuredClone(
      scenario === 'generating' ? seed.generatingTopic : seed.failedTopic,
    );
    state.snapshot.segments = [];
    state.snapshot.utterances = [];
    state.snapshot.feedback = [];
    state.snapshot.jobs = [
      structuredClone(scenario === 'generating' ? seed.generatingJob : seed.failedJob),
    ];
  }
  const receipts = new Map<string, { signature: string; output: unknown }>();
  const actor = () => {
    const user = state.users.find((item) => item.id === currentUserId);
    if (!user) throw new FixtureError(401, 'UNIDENTIFIED', '먼저 이름과 아이디를 등록해 주세요.');
    return user;
  };
  const member = (studyId: string, allowInvited = false) => {
    const user = actor();
    if (state.snapshot.study.id !== studyId)
      throw new FixtureError(404, 'NOT_FOUND', '스터디가 없어요.');
    if (
      !state.snapshot.study.members.some(
        (item) => item.userId === user.id && (allowInvited || item.state === 'joined'),
      )
    ) {
      throw new FixtureError(403, 'NOT_MEMBER', '입장한 참여자만 조회할 수 있어요.');
    }
    return user;
  };
  const snapshot = (): StudySnapshot =>
    StudySnapshotSchema.parse({
      ...state.snapshot,
      jobs: state.jobs.filter(
        (job) => job.scope === 'study' && job.studyId === state.snapshot.study.id,
      ),
    });
  const failMissing = () => {
    throw new FixtureError(404, 'NOT_FOUND', '항목을 찾을 수 없어요.');
  };

  function dispatch(name: EndpointName, params: Record<string, string>, input: unknown): unknown {
    switch (name) {
      case 'register': {
        const body = endpointRegistry.register.input.parse(input);
        if (state.users.some((user) => user.handle === body.handle))
          throw new FixtureError(409, 'HANDLE_TAKEN', '이미 사용 중인 아이디예요.');
        const user = { id: nextId(), ...body };
        state.users.push(user);
        currentUserId = user.id;
        return user;
      }
      case 'me':
        return actor();
      case 'resolveUsers': {
        actor();
        const { handles } = endpointRegistry.resolveUsers.input.parse(input);
        return {
          users: state.users.filter((user) => handles.includes(user.handle)),
          missingHandles: handles.filter(
            (handle) => !state.users.some((user) => user.handle === handle),
          ),
        };
      }
      case 'invitations': {
        const user = actor();
        return state.snapshot.study.members.some(
          (item) => item.userId === user.id && item.state === 'invited',
        )
          ? [
              {
                studyId: state.snapshot.study.id,
                inviter: state.users.find(
                  (item) => item.id === state.snapshot.study.members[0]?.userId,
                )!,
                createdAt: state.snapshot.study.createdAt,
              },
            ]
          : [];
      }
      case 'createStudy': {
        const user = actor();
        const { participantHandles } = endpointRegistry.createStudy.input.parse(input);
        const invitees = participantHandles.map(
          (handle) => state.users.find((item) => item.handle === handle) ?? failMissing(),
        );
        state.snapshot = {
          ...structuredClone(seed.emptyStudySnapshot),
          study: {
            ...structuredClone(seed.waitingStudy),
            id: nextId(),
            createdAt: now(),
            members: [
              {
                userId: user.id,
                handle: user.handle,
                displayName: user.displayName,
                state: 'joined',
              },
              ...invitees
                .filter(
                  (item, index, all) =>
                    item.id !== user.id && all.findIndex((entry) => entry.id === item.id) === index,
                )
                .map((item) => ({
                  userId: item.id,
                  handle: item.handle,
                  displayName: item.displayName,
                  state: 'invited' as const,
                })),
            ],
          },
        };
        return state.snapshot.study;
      }
      case 'joinStudy': {
        const user = member(params.studyId!, true);
        if (state.snapshot.study.status === 'ended')
          throw new FixtureError(409, 'ACTION_NOT_READY', '종료된 스터디예요.');
        const membership = state.snapshot.study.members.find((item) => item.userId === user.id)!;
        if (membership.state === 'invited') {
          membership.state = 'joined';
          state.snapshot.study.revision++;
        }
        return snapshot();
      }
      case 'studySnapshot':
        member(params.studyId!);
        return snapshot();
      case 'learningItems': {
        const user = actor();
        return state.learningItems.filter((item) => item.ownerUserId === user.id);
      }
      case 'experiences': {
        const user = actor();
        return state.experiences.filter((item) => item.ownerUserId === user.id);
      }
      case 'shareProposals': {
        const user = actor();
        member(params.studyId!);
        return state.proposals.filter(
          (item) => item.ownerUserId === user.id && item.studyId === params.studyId,
        );
      }
      case 'chatMessages': {
        const user = member(params.studyId!);
        return state.chatMessages.filter(
          (item) => item.ownerUserId === user.id && item.studyId === params.studyId,
        );
      }
      case 'job': {
        const user = actor();
        const job = state.jobs.find((item) => item.id === params.id) ?? failMissing();
        if (job.scope === 'user' && job.ownerUserId !== user.id)
          throw new FixtureError(403, 'NOT_OWNER', '본인의 작업만 조회할 수 있어요.');
        if (job.scope === 'study') member(job.studyId!);
        return job;
      }
      case 'updateCorrection': {
        const utterance =
          state.snapshot.utterances.find((item) => item.id === params.id) ?? failMissing();
        member(utterance.studyId);
        if (state.snapshot.topic?.state !== 'review')
          throw new FixtureError(409, 'ACTION_NOT_READY', '검토 중에 수정할 수 있어요.');
        const { text } = endpointRegistry.updateCorrection.input.parse(input);
        utterance.correctedText = text;
        utterance.correctedBy = 'human';
        utterance.correctionRevision++;
        utterance.revision++;
        utterance.updatedAt = now();
        const feedback =
          state.snapshot.feedback.find((item) => item.utteranceId === utterance.id) ??
          failMissing();
        feedback.status = 'stale';
        feedback.revision++;
        return { utterance, feedback };
      }
      case 'requestFeedback': {
        const utterance =
          state.snapshot.utterances.find((item) => item.id === params.id) ?? failMissing();
        member(utterance.studyId);
        const { correctionRevision } = endpointRegistry.requestFeedback.input.parse(input);
        if (correctionRevision !== utterance.correctionRevision)
          throw new FixtureError(409, 'FEEDBACK_STALE', '수정된 문장으로 다시 요청해 주세요.');
        const feedback =
          state.snapshot.feedback.find((item) => item.utteranceId === utterance.id) ??
          failMissing();
        Object.assign(feedback, {
          status: 'running',
          inputCorrectionRevision: correctionRevision,
          revision: feedback.revision + 1,
          items: [],
          error: null,
        });
        const job = JobSchema.parse({
          ...seed.feedbackJob,
          id: nextId(),
          studyId: utterance.studyId,
          targetId: utterance.id,
          createdAt: now(),
        });
        state.jobs.push(job);
        return job;
      }
      case 'sendChatMessage': {
        const user = member(params.studyId!);
        const { text } = endpointRegistry.sendChatMessage.input.parse(input);
        const message = {
          ...structuredClone(seed.chatMessages[0]!),
          id: nextId(),
          ownerUserId: user.id,
          studyId: params.studyId!,
          text,
          status: 'running' as const,
          createdAt: now(),
        };
        const job = JobSchema.parse({
          ...seed.chatJob,
          id: nextId(),
          ownerUserId: user.id,
          studyId: params.studyId!,
          targetId: message.id,
          status: 'running',
          result: null,
          error: null,
          finishedAt: null,
          createdAt: now(),
        });
        state.chatMessages.push(message);
        state.jobs.push(job);
        return { message, job };
      }
      case 'decideShareProposal': {
        const proposal = state.proposals.find((item) => item.id === params.id) ?? failMissing();
        if (proposal.ownerUserId !== actor().id)
          throw new FixtureError(403, 'NOT_OWNER', '본인의 공유 제안만 응답할 수 있어요.');
        member(proposal.studyId);
        if (proposal.status === 'pending') {
          if (state.snapshot.study.status === 'ended')
            throw new FixtureError(409, 'ACTION_NOT_READY', '종료된 스터디에는 공유할 수 없어요.');
          const { accepted } = endpointRegistry.decideShareProposal.input.parse(input);
          proposal.status = accepted ? 'accepted' : 'declined';
          proposal.revision++;
          proposal.decidedAt = now();
          if (accepted) {
            const item = state.learningItems.find((entry) => entry.id === proposal.learningItemId)!;
            state.snapshot.sharedExpressions.push({
              id: nextId(),
              studyId: proposal.studyId,
              contributorUserId: proposal.ownerUserId,
              expression: item.expression,
              meaning: item.meaning,
              example: item.example,
              sourceProposalId: proposal.id,
            });
          }
        }
        return {
          proposal,
          sharedExpression:
            state.snapshot.sharedExpressions.find(
              (item) => item.sourceProposalId === proposal.id,
            ) ?? null,
        };
      }
      case 'prepareExperience': {
        const user = actor();
        const body = endpointRegistry.prepareExperience.input.parse(input);
        const draft = {
          ...structuredClone(body.skipQuestions ? seed.summarizedDraft : seed.experienceDraft),
          id: nextId(),
          ownerUserId: user.id,
          originalText: body.originalText,
          answers: body.answers,
          summary: body.skipQuestions ? body.originalText : null,
        };
        state.drafts.push(draft);
        const job = JobSchema.parse({
          ...seed.experienceJob,
          id: nextId(),
          ownerUserId: user.id,
          targetId: draft.id,
          result: { draft },
          createdAt: now(),
          finishedAt: now(),
        });
        state.jobs.push(job);
        return job;
      }
      case 'createExperience': {
        const user = actor();
        const {
          draftId,
          commandId: _commandId,
          ...body
        } = endpointRegistry.createExperience.input.parse(input);
        if (!state.drafts.some((item) => item.id === draftId && item.ownerUserId === user.id))
          failMissing();
        const experience = {
          ...body,
          id: nextId(),
          ownerUserId: user.id,
          revision: 1,
          updatedAt: now(),
        };
        state.experiences.push(experience);
        return experience;
      }
      case 'updateExperience': {
        const user = actor();
        const experience = state.experiences.find((item) => item.id === params.id) ?? failMissing();
        if (experience.ownerUserId !== user.id)
          throw new FixtureError(403, 'NOT_OWNER', '본인의 경험만 수정할 수 있어요.');
        const { commandId: _commandId, ...body } =
          endpointRegistry.updateExperience.input.parse(input);
        Object.assign(experience, body, { revision: experience.revision + 1, updatedAt: now() });
        return experience;
      }
      case 'studyCommand': {
        member(params.studyId!);
        const command = endpointRegistry.studyCommand.input.parse(input);
        const { study, topic } = state.snapshot;
        if (
          command.expectedTopicId !== study.currentTopicId ||
          command.expectedTransitionVersion !== study.transitionVersion
        ) {
          throw new FixtureError(409, 'STALE_TOPIC', '스터디 상태가 변경되었어요.');
        }
        if (command.type === 'topic.advance' && topic?.state === 'talking')
          throw new FixtureError(409, 'REVIEW_REQUIRED', '먼저 주제를 종료하고 검토해 주세요.');
        if (topic?.state === 'generating' || topic?.state === 'closing')
          throw new FixtureError(409, 'ACTION_NOT_READY', '진행 중인 작업을 기다려 주세요.');
        if (study.status === 'ended')
          throw new FixtureError(409, 'ACTION_NOT_READY', '종료된 스터디예요.');
        if (
          command.type === 'topic.advance' &&
          topic?.state !== 'review' &&
          topic?.state !== 'failed'
        ) {
          throw new FixtureError(
            409,
            'ACTION_NOT_READY',
            '검토 중이거나 생성 실패한 주제에서 진행할 수 있어요.',
          );
        }
        if (
          'focusUserId' in command &&
          command.focusUserId !== null &&
          !study.members.some(
            (item) => item.userId === command.focusUserId && item.state === 'joined',
          )
        ) {
          throw new FixtureError(400, 'INVALID_INPUT', '입장한 참여자를 지정해 주세요.');
        }
        if (command.type === 'study.start' || command.type === 'topic.advance') {
          const hasExperience = state.experiences.some(
            (item) =>
              study.members.some(
                (entry) => entry.userId === item.ownerUserId && entry.state === 'joined',
              ) &&
              (!command.focusUserId || item.ownerUserId === command.focusUserId),
          );
          const hasExpressions =
            command.type === 'topic.advance' &&
            (state.snapshot.sharedExpressions.length > 0 ||
              state.snapshot.feedback.some(
                (item) => item.status === 'ready' && item.items.length > 0,
              ));
          if (!hasExperience && !hasExpressions)
            throw new FixtureError(422, 'CONTEXT_REQUIRED', '먼저 경험을 저장해 주세요.');
        }
        let jobId: string | null = null;
        if (
          command.type === 'topic.close' ||
          (command.type === 'study.finish' && topic?.state === 'talking')
        ) {
          if (topic?.state !== 'talking')
            throw new FixtureError(409, 'ACTION_NOT_READY', '대화 중인 주제가 없어요.');
          topic.state = 'closing';
          topic.revision++;
          const job = JobSchema.parse({
            ...seed.closeJob,
            id: nextId(),
            targetId: topic.id,
            studyId: study.id,
            status: 'running',
            result: null,
            finishedAt: null,
            createdAt: now(),
          });
          state.jobs.push(job);
          jobId = job.id;
        } else {
          if (topic?.state === 'review') {
            if (
              state.snapshot.segments.some(
                (item) =>
                  item.rawStatus !== 'ready' ||
                  item.correctionStatus !== 'ready' ||
                  item.sentenceStatus !== 'ready',
              ) ||
              state.snapshot.feedback.some((item) => item.status !== 'ready') ||
              state.snapshot.utterances.some(
                (utterance) =>
                  !state.snapshot.feedback.some(
                    (item) =>
                      item.utteranceId === utterance.id &&
                      item.inputCorrectionRevision === utterance.correctionRevision,
                  ),
              )
            ) {
              throw new FixtureError(409, 'FEEDBACK_STALE', '최신 피드백을 확인해 주세요.');
            }
            for (const feedback of state.snapshot.feedback) {
              const utterance = state.snapshot.utterances.find(
                (item) => item.id === feedback.utteranceId,
              )!;
              for (const item of feedback.items) {
                const sourceKey = `feedback:${topic.id}:${utterance.id}:${item.id}`;
                if (
                  !state.learningItems.some(
                    (entry) =>
                      entry.ownerUserId === utterance.speakerUserId &&
                      entry.sourceKey === sourceKey,
                  )
                ) {
                  state.learningItems.push({
                    id: nextId(),
                    ownerUserId: utterance.speakerUserId,
                    kind: 'expression',
                    expression: item.expression,
                    meaning: item.meaning,
                    example: item.example,
                    source: 'approved_feedback',
                    sourceKey,
                    sourceStudyId: study.id,
                    sourceUtteranceId: utterance.id,
                    createdAt: now(),
                  });
                }
              }
            }
            topic.state = 'approved';
            topic.approvedAt = now();
            topic.revision++;
          } else if (command.type === 'study.start' && study.status !== 'waiting') {
            throw new FixtureError(409, 'ACTION_NOT_READY', '이미 시작한 스터디예요.');
          }
          if (command.type === 'study.finish') {
            study.status = 'ended';
            study.endedAt = now();
          } else {
            const topicId = topic?.state === 'failed' ? topic.id : nextId();
            const job = JobSchema.parse({
              ...seed.generatingJob,
              id: nextId(),
              studyId: study.id,
              targetId: topicId,
              createdAt: now(),
            });
            state.snapshot.topic = {
              ...structuredClone(seed.generatingTopic),
              id: topicId,
              studyId: study.id,
              ordinal: topic?.state === 'failed' ? topic.ordinal : (topic?.ordinal ?? 0) + 1,
              generationJobId: job.id,
              focusUserId: 'focusUserId' in command ? command.focusUserId : null,
            };
            study.currentTopicId = topicId;
            study.status = 'active';
            state.snapshot.segments = [];
            state.snapshot.utterances = [];
            state.snapshot.feedback = [];
            state.jobs.push(job);
            jobId = job.id;
          }
        }
        study.revision++;
        study.transitionVersion++;
        return {
          commandId: command.commandId,
          outcome: 'applied',
          studyId: study.id,
          topicId: study.currentTopicId,
          jobId,
          transitionVersion: study.transitionVersion,
        };
      }
    }
  }

  function execute<K extends EndpointName>(
    name: K,
    params: EndpointParams<K>,
    input: EndpointInput<K>,
  ): EndpointOutput<K> {
    const endpoint = endpointRegistry[name];
    const parsedParams = endpoint.params.parse(params);
    const parsedInput = endpoint.input.parse(input);
    const receiptId =
      parsedInput && typeof parsedInput === 'object'
        ? 'commandId' in parsedInput
          ? parsedInput.commandId
          : 'clientMessageId' in parsedInput
            ? parsedInput.clientMessageId
            : undefined
        : undefined;
    const key = receiptId ? `${actor().id}:${String(receiptId)}` : null;
    const signature = JSON.stringify({ name, params: parsedParams, input: parsedInput });
    if (key && receipts.has(key)) {
      const existing = receipts.get(key)!;
      if (existing.signature !== signature)
        throw new FixtureError(
          409,
          'COMMAND_CONFLICT',
          '같은 명령 ID에 다른 요청을 사용할 수 없어요.',
        );
      return structuredClone(existing.output) as EndpointOutput<K>;
    }
    const result = endpoint.output.parse(dispatch(name, parsedParams, parsedInput));
    if (key) receipts.set(key, { signature, output: structuredClone(result) });
    return structuredClone(result) as EndpointOutput<K>;
  }

  return {
    state,
    execute,
    snapshot,
    getCurrentUserId: () => currentUserId,
    setCurrentUser: (userId: string | null) => {
      currentUserId = userId;
    },
  };
}
export type FixtureStore = ReturnType<typeof createFixtureStore>;
