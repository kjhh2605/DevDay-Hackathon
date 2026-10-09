import {
  UserSchema,
  StudySchema,
  TopicSchema,
  TranscriptSegmentSchema,
  UtteranceSchema,
  FeedbackSchema,
  LearningItemSchema,
  ExperienceSchema,
  ExperienceDraftSchema,
  ChatMessageSchema,
  ShareProposalSchema,
  SharedExpressionSchema,
  StudySnapshotSchema,
  JobSchema,
} from '@devday/contracts';

/** Stable, valid UUIDs let tests relate records without depending on random data. */
export function fixtureId(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

export const fixtureIds = {
  userA: fixtureId(1),
  userB: fixtureId(2),
  study: fixtureId(10),
  imageTopic: fixtureId(20),
  sentenceTopic: fixtureId(21),
  media: fixtureId(22),
  generationJob: fixtureId(30),
  failedJob: fixtureId(31),
  feedbackJob: fixtureId(32),
  segmentA: fixtureId(40),
  segmentB: fixtureId(41),
  utteranceA: fixtureId(50),
  utteranceB: fixtureId(51),
  feedbackItem: fixtureId(60),
  learningA: fixtureId(70),
  learningB: fixtureId(71),
  experienceA: fixtureId(80),
  experienceB: fixtureId(81),
  draft: fixtureId(82),
  chatA: fixtureId(90),
  chatB: fixtureId(91),
  proposal: fixtureId(100),
  sharedExpression: fixtureId(110),
} as const;

export const fixtureTime = '2026-10-09T00:00:00.000Z';

export const users = [
  UserSchema.parse({ id: fixtureIds.userA, handle: 'alex', displayName: '알렉스' }),
  UserSchema.parse({ id: fixtureIds.userB, handle: 'sam', displayName: '샘' }),
];
export const userA = users[0]!;
export const userB = users[1]!;

export const waitingStudy = StudySchema.parse({
  id: fixtureIds.study,
  revision: 1,
  status: 'waiting',
  currentTopicId: null,
  transitionVersion: 0,
  createdAt: fixtureTime,
  endedAt: null,
  members: users.map((user, index) => ({
    userId: user.id,
    handle: user.handle,
    displayName: user.displayName,
    state: index === 0 ? 'joined' : 'invited',
  })),
});

export const activeStudy = StudySchema.parse({
  ...waitingStudy,
  status: 'active',
  revision: 3,
  currentTopicId: fixtureIds.imageTopic,
  transitionVersion: 1,
  members: waitingStudy.members.map((member) => ({ ...member, state: 'joined' })),
});

export const invitations = [{ studyId: fixtureIds.study, inviter: userA, createdAt: fixtureTime }];

export const imageTopic = TopicSchema.parse({
  id: fixtureIds.imageTopic,
  studyId: fixtureIds.study,
  revision: 2,
  ordinal: 1,
  state: 'talking',
  focusUserId: null,
  generationJobId: fixtureIds.generationJob,
  approvedAt: null,
  content: {
    kind: 'image',
    title: '주말의 작은 도전',
    situationText: '두 친구가 공원에서 자전거를 타고 있습니다.',
    conversationInstruction:
      'Describe the picture and tell your partner about a time you tried something new.',
    imageMediaId: fixtureIds.media,
    sentence: null,
    sourceExperienceIds: [fixtureIds.experienceA],
    learningExpressionIds: [],
    sharedExpressionIds: [],
  },
});

export const sentenceTopic = TopicSchema.parse({
  ...imageTopic,
  id: fixtureIds.sentenceTopic,
  ordinal: 2,
  content: {
    kind: 'sentence',
    title: '새로운 관점',
    situationText: '익숙한 일을 다른 방법으로 해 보려 합니다.',
    conversationInstruction: 'Use “give it a try” in a conversation about a new idea.',
    imageMediaId: null,
    sentence: 'Let’s give it a try.',
    sourceExperienceIds: [],
    learningExpressionIds: [fixtureIds.learningA],
    sharedExpressionIds: [],
  },
});

export const generatingTopic = TopicSchema.parse({
  ...imageTopic,
  state: 'generating',
  revision: 1,
  content: null,
});
export const failedTopic = TopicSchema.parse({
  ...generatingTopic,
  state: 'failed',
  revision: 2,
  generationJobId: fixtureIds.failedJob,
});
export const reviewTopic = TopicSchema.parse({ ...imageTopic, state: 'review', revision: 4 });

const segmentBase = {
  studyId: fixtureIds.study,
  topicId: fixtureIds.imageTopic,
  revision: 3,
  startedAt: fixtureTime,
  endedAt: '2026-10-09T00:00:04.000Z',
  rawStatus: 'ready',
  correctionStatus: 'ready',
  sentenceStatus: 'ready',
};
export const transcriptSegments = [
  TranscriptSegmentSchema.parse({
    ...segmentBase,
    id: fixtureIds.segmentA,
    speakerUserId: fixtureIds.userA,
    startOrder: 1,
    rawText: 'I try bicycle last weekend.',
    correctedText: 'I try bicycle last weekend.',
  }),
  TranscriptSegmentSchema.parse({
    ...segmentBase,
    id: fixtureIds.segmentB,
    speakerUserId: fixtureIds.userB,
    startOrder: 2,
    rawText: 'That sounds fun!',
    correctedText: 'That sounds fun!',
  }),
];
export const liveSegment = TranscriptSegmentSchema.parse({
  ...transcriptSegments[0],
  revision: 1,
  endedAt: null,
  rawText: null,
  correctedText: null,
  rawStatus: 'running',
  correctionStatus: 'pending',
  sentenceStatus: 'pending',
});
export const rawSegment = TranscriptSegmentSchema.parse({
  ...transcriptSegments[0],
  revision: 2,
  correctedText: null,
  correctionStatus: 'running',
  sentenceStatus: 'pending',
});

export const utterances = transcriptSegments.map((segment, index) =>
  UtteranceSchema.parse({
    id: index === 0 ? fixtureIds.utteranceA : fixtureIds.utteranceB,
    studyId: segment.studyId,
    topicId: segment.topicId,
    speakerUserId: segment.speakerUserId,
    revision: 1,
    correctionRevision: 1,
    sentenceIndex: 0,
    startOrder: segment.startOrder,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    updatedAt: fixtureTime,
    rawText: segment.rawText,
    correctedText: segment.correctedText,
    correctedBy: 'ai',
    correctionStatus: 'ready',
    sourceRanges: [
      {
        segmentId: segment.id,
        rawStart: 0,
        rawEnd: segment.rawText!.length,
        correctedStart: 0,
        correctedEnd: segment.correctedText!.length,
      },
    ],
  }),
);

export const readyFeedback = FeedbackSchema.parse({
  utteranceId: fixtureIds.utteranceA,
  revision: 1,
  inputCorrectionRevision: 1,
  status: 'ready',
  error: null,
  items: [
    {
      id: fixtureIds.feedbackItem,
      category: 'grammar',
      summary: '지난 경험은 과거형으로 말해요.',
      explanation: 'last weekend처럼 지난 시점을 말할 때 과거형을 사용할 수 있어요.',
      expression: 'I tried riding a bicycle last weekend.',
      meaning: '지난 주말에 자전거 타기에 도전했어요.',
      example: 'I tried riding a bicycle with my friend.',
    },
  ],
});
export const emptyFeedback = FeedbackSchema.parse({
  ...readyFeedback,
  utteranceId: fixtureIds.utteranceB,
  items: [],
});
export const staleFeedback = FeedbackSchema.parse({
  ...readyFeedback,
  revision: 2,
  status: 'stale',
});
export const runningFeedback = FeedbackSchema.parse({
  ...readyFeedback,
  revision: 3,
  inputCorrectionRevision: 2,
  status: 'running',
  items: [],
});
export const failedFeedback = FeedbackSchema.parse({
  ...runningFeedback,
  revision: 4,
  status: 'failed',
  error: { code: 'AI_FAILED', message: '피드백을 생성하지 못했어요.', details: null },
});
export const editedUtterance = UtteranceSchema.parse({
  ...utterances[0],
  revision: 2,
  correctionRevision: 2,
  correctedBy: 'human',
  correctedText: 'I tried a bicycle last weekend.',
});

export const learningItems = [
  LearningItemSchema.parse({
    id: fixtureIds.learningA,
    ownerUserId: fixtureIds.userA,
    kind: 'expression',
    expression: readyFeedback.items[0]!.expression,
    meaning: readyFeedback.items[0]!.meaning,
    example: readyFeedback.items[0]!.example,
    source: 'approved_feedback',
    sourceKey: `feedback:${fixtureIds.imageTopic}:${fixtureIds.utteranceA}:${fixtureIds.feedbackItem}`,
    sourceStudyId: fixtureIds.study,
    sourceUtteranceId: fixtureIds.utteranceA,
    createdAt: fixtureTime,
  }),
  LearningItemSchema.parse({
    id: fixtureIds.learningB,
    ownerUserId: fixtureIds.userB,
    kind: 'expression',
    expression: 'give it a try',
    meaning: '한번 시도해 보다',
    example: 'Let’s give it a try.',
    source: 'chat',
    sourceKey: `chat:${fixtureIds.chatB}:1`,
    sourceStudyId: fixtureIds.study,
    sourceUtteranceId: null,
    createdAt: fixtureTime,
  }),
];

const context = {
  place: '공원',
  people: ['친구'],
  event: '자전거 타기',
  actions: ['처음 자전거를 타 봄'],
};
export const experiences = [
  ExperienceSchema.parse({
    id: fixtureIds.experienceA,
    revision: 1,
    ownerUserId: fixtureIds.userA,
    originalText: '지난 주말에 친구와 공원에서 처음 자전거를 타 봤어요.',
    answers: [],
    summary: '친구와 공원에서 자전거를 처음 타 본 경험',
    interests: ['자전거', '야외 활동'],
    context,
    updatedAt: fixtureTime,
  }),
  ExperienceSchema.parse({
    id: fixtureIds.experienceB,
    revision: 1,
    ownerUserId: fixtureIds.userB,
    originalText: '집에서 빵을 구웠어요.',
    answers: [],
    summary: '집에서 빵을 구운 경험',
    interests: ['베이킹'],
    context: { place: '집', people: [], event: '빵 굽기', actions: ['빵을 구움'] },
    updatedAt: fixtureTime,
  }),
];
export const experienceDraft = ExperienceDraftSchema.parse({
  id: fixtureIds.draft,
  revision: 1,
  ownerUserId: fixtureIds.userA,
  originalText: '지난 주말에 자전거를 탔어요.',
  answers: [],
  questions: ['어디에서 자전거를 탔나요?'],
  summary: null,
  interests: ['자전거'],
  context: { place: null, people: [], event: '자전거 타기', actions: ['자전거를 탐'] },
});
export const summarizedDraft = ExperienceDraftSchema.parse({
  ...experienceDraft,
  revision: 2,
  questions: [],
  summary: '지난 주말 자전거를 탄 경험',
});

export const pendingProposal = ShareProposalSchema.parse({
  id: fixtureIds.proposal,
  revision: 1,
  studyId: fixtureIds.study,
  ownerUserId: fixtureIds.userB,
  learningItemId: fixtureIds.learningB,
  expression: 'give it a try',
  status: 'pending',
  decidedAt: null,
});
export const acceptedProposal = ShareProposalSchema.parse({
  ...pendingProposal,
  revision: 2,
  status: 'accepted',
  decidedAt: fixtureTime,
});
export const declinedProposal = ShareProposalSchema.parse({
  ...pendingProposal,
  revision: 2,
  status: 'declined',
  decidedAt: fixtureTime,
});
export const sharedExpression = SharedExpressionSchema.parse({
  id: fixtureIds.sharedExpression,
  studyId: fixtureIds.study,
  contributorUserId: fixtureIds.userB,
  expression: 'give it a try',
  meaning: '한번 시도해 보다',
  example: 'Let’s give it a try.',
  sourceProposalId: fixtureIds.proposal,
});
export const chatMessages = [
  ChatMessageSchema.parse({
    id: fixtureIds.chatA,
    revision: 1,
    studyId: fixtureIds.study,
    ownerUserId: fixtureIds.userA,
    role: 'user',
    text: '자전거를 탄 경험을 어떻게 말하나요?',
    status: 'succeeded',
    commandResults: [],
    learningItemIds: [],
    shareProposalId: null,
    createdAt: fixtureTime,
  }),
  ChatMessageSchema.parse({
    id: fixtureIds.chatB,
    revision: 1,
    studyId: fixtureIds.study,
    ownerUserId: fixtureIds.userB,
    role: 'assistant',
    text: '“give it a try”는 한번 시도해 본다는 뜻이에요. 개인 학습에 저장했어요. 스터디에 공유할까요?',
    status: 'succeeded',
    commandResults: [],
    learningItemIds: [fixtureIds.learningB],
    shareProposalId: fixtureIds.proposal,
    createdAt: fixtureTime,
  }),
];

export const generatingJob = JobSchema.parse({
  id: fixtureIds.generationJob,
  revision: 1,
  kind: 'topic.generate',
  scope: 'study',
  studyId: fixtureIds.study,
  ownerUserId: null,
  targetId: fixtureIds.imageTopic,
  status: 'running',
  result: null,
  error: null,
  createdAt: fixtureTime,
  finishedAt: null,
});
export const succeededJob = JobSchema.parse({
  ...generatingJob,
  revision: 2,
  status: 'succeeded',
  result: { topicId: fixtureIds.imageTopic },
  finishedAt: fixtureTime,
});
export const failedJob = JobSchema.parse({
  ...generatingJob,
  id: fixtureIds.failedJob,
  revision: 2,
  status: 'failed',
  finishedAt: fixtureTime,
  error: { code: 'AI_FAILED', message: '주제를 생성하지 못했어요.', details: null },
});
export const feedbackJob = JobSchema.parse({
  ...generatingJob,
  id: fixtureIds.feedbackJob,
  kind: 'utterance.feedback',
  targetId: fixtureIds.utteranceA,
});
export const experienceJob = JobSchema.parse({
  ...generatingJob,
  id: fixtureId(33),
  kind: 'experience.prepare',
  scope: 'user',
  studyId: null,
  ownerUserId: fixtureIds.userA,
  targetId: fixtureIds.draft,
  status: 'succeeded',
  result: { draft: experienceDraft },
  finishedAt: fixtureTime,
});
export const chatJob = JobSchema.parse({
  ...generatingJob,
  id: fixtureId(34),
  kind: 'chat.respond',
  scope: 'user',
  ownerUserId: fixtureIds.userB,
  targetId: fixtureIds.chatB,
  status: 'succeeded',
  result: { messageId: fixtureIds.chatB },
  finishedAt: fixtureTime,
});
export const closeJob = JobSchema.parse({
  ...generatingJob,
  id: fixtureId(35),
  kind: 'topic.close',
  status: 'succeeded',
  result: { topicId: fixtureIds.imageTopic, utteranceIds: utterances.map((item) => item.id) },
  finishedAt: fixtureTime,
});
export const jobs = [succeededJob, failedJob, feedbackJob, experienceJob, chatJob, closeJob];

export const studySnapshot = StudySnapshotSchema.parse({
  study: activeStudy,
  topic: reviewTopic,
  segments: transcriptSegments,
  utterances,
  feedback: [readyFeedback, emptyFeedback],
  sharedExpressions: [],
  jobs: [],
});
export const emptyStudySnapshot = StudySnapshotSchema.parse({
  study: waitingStudy,
  topic: null,
  segments: [],
  utterances: [],
  feedback: [],
  sharedExpressions: [],
  jobs: [],
});
