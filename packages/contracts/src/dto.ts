import { z } from 'zod';

export const IdSchema = z.uuid();
export const TimestampSchema = z.iso.datetime();
export const RevisionSchema = z.number().int().nonnegative();
const text = z.string().min(1);
const revision = { revision: RevisionSchema };
export const HandleSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value) => value.replace(/\s/g, '').toLowerCase())
  .pipe(z.string().min(1));
export const UserSchema = z.strictObject({
  id: IdSchema,
  handle: z.string().min(1),
  displayName: text,
});
export const StudyMemberSchema = z.strictObject({
  userId: IdSchema,
  handle: text,
  displayName: text,
  state: z.enum(['invited', 'joined']),
});
export const StudySchema = z.strictObject({
  id: IdSchema,
  ...revision,
  status: z.enum(['waiting', 'active', 'ended']),
  currentTopicId: IdSchema.nullable(),
  transitionVersion: RevisionSchema,
  members: z.array(StudyMemberSchema),
  createdAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
});
const topicContent = {
  title: text,
  situationText: text,
  conversationInstruction: text,
  sourceExperienceIds: z.array(IdSchema),
  learningExpressionIds: z.array(IdSchema),
  sharedExpressionIds: z.array(IdSchema),
};
export const TopicContentSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    ...topicContent,
    kind: z.literal('image'),
    imageMediaId: IdSchema,
    sentence: z.null(),
    sourceExperienceIds: z.array(IdSchema).min(1),
  }),
  z.strictObject({
    ...topicContent,
    kind: z.literal('sentence'),
    imageMediaId: z.null(),
    sentence: text,
  }),
]);
export const TopicSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  studyId: IdSchema,
  ordinal: z.number().int().positive(),
  state: z.enum(['generating', 'talking', 'closing', 'review', 'approved', 'failed']),
  focusUserId: IdSchema.nullable(),
  content: TopicContentSchema.nullable(),
  generationJobId: IdSchema,
  approvedAt: TimestampSchema.nullable(),
});
export const ProcessingStatusSchema = z.enum(['pending', 'running', 'ready', 'failed']);
export const TranscriptSegmentSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  studyId: IdSchema,
  topicId: IdSchema,
  speakerUserId: IdSchema,
  startOrder: RevisionSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema.nullable(),
  rawText: z.string().nullable(),
  rawStatus: ProcessingStatusSchema,
  correctedText: z.string().nullable(),
  correctionStatus: ProcessingStatusSchema,
  sentenceStatus: z.enum(['pending', 'ready', 'failed']),
});
export const SourceRangeSchema = z
  .strictObject({
    segmentId: IdSchema,
    rawStart: RevisionSchema,
    rawEnd: RevisionSchema,
    correctedStart: RevisionSchema,
    correctedEnd: RevisionSchema,
  })
  .refine(
    (r) => r.rawEnd >= r.rawStart && r.correctedEnd >= r.correctedStart,
    'Range end must follow start',
  );
export const UtteranceSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  sentenceIndex: RevisionSchema,
  sourceRanges: z.array(SourceRangeSchema).min(1),
  studyId: IdSchema,
  topicId: IdSchema,
  speakerUserId: IdSchema,
  startOrder: RevisionSchema,
  startedAt: TimestampSchema,
  endedAt: TimestampSchema,
  rawText: z.string(),
  correctedText: z.string(),
  correctionStatus: ProcessingStatusSchema,
  correctionRevision: RevisionSchema,
  correctedBy: z.enum(['ai', 'human']),
  updatedAt: TimestampSchema,
});
export const ErrorCodeSchema = z.enum([
  'INVALID_INPUT',
  'UNIDENTIFIED',
  'NOT_MEMBER',
  'NOT_OWNER',
  'NOT_FOUND',
  'HANDLE_TAKEN',
  'STALE_TOPIC',
  'REVIEW_REQUIRED',
  'ACTION_NOT_READY',
  'FEEDBACK_STALE',
  'CONTEXT_REQUIRED',
  'AMBIGUOUS_PARTICIPANT',
  'AI_FAILED',
  'INTERNAL_ERROR',
  'PROCESS_INTERRUPTED',
  'COMMAND_CONFLICT',
  'AUDIO_FAILED',
  'TIMEOUT',
]);
export const ErrorDetailsSchema = z.record(z.string(), z.json()).nullable();
export const ApiErrorSchema = z.strictObject({
  code: ErrorCodeSchema,
  message: text,
  details: ErrorDetailsSchema,
});
export const FeedbackItemSchema = z.strictObject({
  id: IdSchema,
  category: text,
  summary: text,
  explanation: text,
  expression: text,
  meaning: text,
  example: text,
});
export const FeedbackSchema = z.strictObject({
  utteranceId: IdSchema,
  ...revision,
  inputCorrectionRevision: RevisionSchema,
  status: z.enum(['running', 'ready', 'stale', 'failed']),
  items: z.array(FeedbackItemSchema),
  error: ApiErrorSchema.nullable(),
});
export const LearningItemSchema = z.strictObject({
  id: IdSchema,
  ownerUserId: IdSchema,
  kind: z.enum(['word', 'expression']),
  expression: text,
  meaning: text,
  example: text,
  source: z.enum(['approved_feedback', 'chat']),
  sourceKey: text,
  sourceStudyId: IdSchema.nullable(),
  sourceUtteranceId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});
export const ExperienceAnswerSchema = z.strictObject({ question: text, answer: z.string() });
export const ExperienceContextSchema = z.strictObject({
  place: z.string().nullable(),
  people: z.array(z.string()),
  event: z.string().nullable(),
  actions: z.array(z.string()),
});
export const ExperienceFieldsSchema = z.strictObject({
  originalText: text,
  answers: z.array(ExperienceAnswerSchema),
  summary: text,
  interests: z.array(z.string()),
  context: ExperienceContextSchema,
});
export const ExperienceSchema = ExperienceFieldsSchema.extend({
  id: IdSchema,
  ...revision,
  ownerUserId: IdSchema,
  updatedAt: TimestampSchema,
});
export const ExperienceDraftSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  ownerUserId: IdSchema,
  originalText: text,
  answers: z.array(ExperienceAnswerSchema),
  questions: z.array(text),
  summary: z.string().nullable(),
  interests: z.array(z.string()),
  context: ExperienceContextSchema,
});
export const CommandResultSchema = z.strictObject({
  commandId: IdSchema,
  outcome: z.enum(['applied', 'already_applied', 'in_progress']),
  studyId: IdSchema,
  topicId: IdSchema.nullable(),
  jobId: IdSchema.nullable(),
  transitionVersion: RevisionSchema,
});
export const ChatMessageSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  studyId: IdSchema,
  ownerUserId: IdSchema,
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  status: z.enum(['running', 'succeeded', 'failed']),
  commandResults: z.array(CommandResultSchema),
  learningItemIds: z.array(IdSchema),
  shareProposalId: IdSchema.nullable(),
  createdAt: TimestampSchema,
});
export const ShareProposalSchema = z.strictObject({
  id: IdSchema,
  ...revision,
  studyId: IdSchema,
  ownerUserId: IdSchema,
  learningItemId: IdSchema,
  expression: text,
  status: z.enum(['pending', 'accepted', 'declined']),
  decidedAt: TimestampSchema.nullable(),
});
export const SharedExpressionSchema = z.strictObject({
  id: IdSchema,
  studyId: IdSchema,
  contributorUserId: IdSchema,
  expression: text,
  meaning: text,
  example: text,
  sourceProposalId: IdSchema,
});
const jobBase = {
  id: IdSchema,
  ...revision,
  scope: z.enum(['user', 'study']),
  ownerUserId: IdSchema.nullable(),
  studyId: IdSchema.nullable(),
  targetId: IdSchema,
  status: z.enum(['running', 'succeeded', 'failed']),
  error: ApiErrorSchema.nullable(),
  createdAt: TimestampSchema,
  finishedAt: TimestampSchema.nullable(),
};
export const jobResultSchemas = {
  'topic.generate': z.strictObject({ topicId: IdSchema }),
  'topic.close': z.strictObject({ topicId: IdSchema, utteranceIds: z.array(IdSchema) }),
  'experience.prepare': z.strictObject({ draft: ExperienceDraftSchema }),
  'utterance.feedback': z.strictObject({
    utteranceId: IdSchema,
    inputCorrectionRevision: RevisionSchema,
  }),
  'chat.respond': z.strictObject({ messageId: IdSchema }),
} as const;
export const JobSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      ...jobBase,
      kind: z.literal('topic.generate'),
      result: jobResultSchemas['topic.generate'].nullable(),
    }),
    z.strictObject({
      ...jobBase,
      kind: z.literal('topic.close'),
      result: jobResultSchemas['topic.close'].nullable(),
    }),
    z.strictObject({
      ...jobBase,
      kind: z.literal('experience.prepare'),
      result: jobResultSchemas['experience.prepare'].nullable(),
    }),
    z.strictObject({
      ...jobBase,
      kind: z.literal('utterance.feedback'),
      result: jobResultSchemas['utterance.feedback'].nullable(),
    }),
    z.strictObject({
      ...jobBase,
      kind: z.literal('chat.respond'),
      result: jobResultSchemas['chat.respond'].nullable(),
    }),
  ])
  .superRefine((job, ctx) => {
    if ((job.kind === 'chat.respond' || job.kind === 'experience.prepare') && job.scope !== 'user')
      ctx.addIssue({ code: 'custom', message: 'Private jobs must use user scope' });
    if ((job.kind === 'topic.generate' || job.kind === 'topic.close') && job.scope !== 'study')
      ctx.addIssue({ code: 'custom', message: 'Topic jobs must use study scope' });
    if (
      (job.scope === 'user' && job.ownerUserId === null) ||
      (job.scope === 'study' && job.studyId === null)
    )
      ctx.addIssue({ code: 'custom', message: 'Job scope must have its owner', path: ['scope'] });
    if (
      job.status === 'running' &&
      (job.result !== null || job.error !== null || job.finishedAt !== null)
    )
      ctx.addIssue({ code: 'custom', message: 'Running job cannot have a terminal result' });
    if (
      job.status === 'succeeded' &&
      (job.result === null || job.error !== null || job.finishedAt === null)
    )
      ctx.addIssue({ code: 'custom', message: 'Succeeded job requires result and finishedAt' });
    if (
      job.status === 'failed' &&
      (job.error === null || job.finishedAt === null || job.result !== null)
    )
      ctx.addIssue({ code: 'custom', message: 'Failed job requires error and finishedAt' });
  });
export const StudySnapshotSchema = z
  .strictObject({
    study: StudySchema,
    topic: TopicSchema.nullable(),
    segments: z.array(TranscriptSegmentSchema),
    utterances: z.array(UtteranceSchema),
    feedback: z.array(FeedbackSchema),
    sharedExpressions: z.array(SharedExpressionSchema),
    jobs: z.array(JobSchema),
  })
  .superRefine((snapshot, ctx) => {
    if (snapshot.study.currentTopicId !== (snapshot.topic?.id ?? null))
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot topic must match study currentTopicId',
        path: ['topic'],
      });
    if (snapshot.topic && snapshot.topic.studyId !== snapshot.study.id)
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot topic belongs to a different study',
        path: ['topic'],
      });
    if (
      [...snapshot.segments, ...snapshot.utterances].some(
        (item) => item.studyId !== snapshot.study.id || item.topicId !== snapshot.topic?.id,
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot transcripts must belong to its current topic',
      });
    if (
      snapshot.feedback.some(
        (item) => !snapshot.utterances.some((utterance) => utterance.id === item.utteranceId),
      )
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Feedback must reference a snapshot utterance',
        path: ['feedback'],
      });
    if (snapshot.sharedExpressions.some((item) => item.studyId !== snapshot.study.id))
      ctx.addIssue({
        code: 'custom',
        message: 'Shared expressions must belong to the snapshot study',
      });
    if (snapshot.jobs.some((job) => job.scope !== 'study' || job.studyId !== snapshot.study.id))
      ctx.addIssue({
        code: 'custom',
        message: 'Snapshot must contain study-scoped jobs only',
        path: ['jobs'],
      });
  });
export const InvitationSchema = z.strictObject({
  studyId: IdSchema,
  inviter: UserSchema,
  createdAt: TimestampSchema,
});
const commandBase = { commandId: IdSchema, expectedTransitionVersion: RevisionSchema };
export const StudyCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commandBase,
    type: z.literal('study.start'),
    expectedTopicId: z.null(),
    focusUserId: IdSchema.nullable(),
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('topic.advance'),
    expectedTopicId: IdSchema,
    focusUserId: IdSchema.nullable(),
  }),
  z.strictObject({ ...commandBase, type: z.literal('topic.close'), expectedTopicId: IdSchema }),
  z.strictObject({
    ...commandBase,
    type: z.literal('study.finish'),
    expectedTopicId: IdSchema.nullable(),
  }),
]);
export type User = z.infer<typeof UserSchema>;
export type Study = z.infer<typeof StudySchema>;
export type Topic = z.infer<typeof TopicSchema>;
export type TopicContent = z.infer<typeof TopicContentSchema>;
export type TranscriptSegment = z.infer<typeof TranscriptSegmentSchema>;
export type SourceRange = z.infer<typeof SourceRangeSchema>;
export type Utterance = z.infer<typeof UtteranceSchema>;
export type Feedback = z.infer<typeof FeedbackSchema>;
export type FeedbackItem = z.infer<typeof FeedbackItemSchema>;
export type LearningItem = z.infer<typeof LearningItemSchema>;
export type Experience = z.infer<typeof ExperienceSchema>;
export type ExperienceDraft = z.infer<typeof ExperienceDraftSchema>;
export type ExperienceContext = z.infer<typeof ExperienceContextSchema>;
export type ExperienceAnswer = z.infer<typeof ExperienceAnswerSchema>;
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ShareProposal = z.infer<typeof ShareProposalSchema>;
export type SharedExpression = z.infer<typeof SharedExpressionSchema>;
export type CommandResult = z.infer<typeof CommandResultSchema>;
export type StudyCommand = z.infer<typeof StudyCommandSchema>;
export type StudySnapshot = z.infer<typeof StudySnapshotSchema>;
export type Invitation = z.infer<typeof InvitationSchema>;
export type Job = z.infer<typeof JobSchema>;
export type JobKind = Job['kind'];
export type JobResult = NonNullable<Job['result']>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
