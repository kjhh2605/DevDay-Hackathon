import type {
  ApiError,
  ChatMessage,
  CommandResult,
  DomainEvent,
  Experience,
  ExperienceDraft,
  Feedback,
  FeedbackItem,
  Job,
  JobKind,
  JobResult,
  LearningItem,
  PrepareExperienceInput,
  ShareProposal,
  SharedExpression,
  SourceRange,
  StudyCommand,
  StudySnapshot,
  TopicContent,
  TranscriptSegment,
  Utterance,
} from '@devday/contracts';

/** Constructed only after session authentication. Never accepted from external request bodies. */
export interface Actor {
  userId: string;
}
export interface StudyCommands {
  execute(actor: Actor, input: { studyId: string; command: StudyCommand }): Promise<CommandResult>;
}
export interface LearningStore {
  saveFromChat(
    actor: Actor,
    input: {
      studyId: string;
      messageId: string;
      toolOrdinal: number;
      kind: 'word' | 'expression';
      expression: string;
      meaning: string;
      example: string;
    },
  ): Promise<LearningItem>;
  list(actor: Actor, query?: string | null): Promise<LearningItem[]>;
}
export interface SharingStore {
  createProposal(
    actor: Actor,
    input: { studyId: string; learningItemId: string },
  ): Promise<ShareProposal>;
  listPending(actor: Actor, studyId: string): Promise<ShareProposal[]>;
  decide(
    actor: Actor,
    input: { proposalId: string; accepted: boolean; commandId: string },
  ): Promise<{ proposal: ShareProposal; sharedExpression: SharedExpression | null }>;
}
export interface SentenceDraft {
  sentenceIndex: number;
  sourceRanges: SourceRange[];
  speakerUserId: string;
  startOrder: number;
  startedAt: string;
  endedAt: string;
  rawText: string;
  correctedText: string;
}
export interface SpeechStore {
  begin(
    actor: Actor,
    input: { topicId: string; clientStreamId: string; clientSegmentId: string; startedAt: string },
  ): Promise<TranscriptSegment>;
  completeRaw(
    segmentId: string,
    input: { text: string; endedAt: string },
  ): Promise<TranscriptSegment>;
  applyCorrection(
    segmentId: string,
    input: { text: string; expectedRevision: number },
  ): Promise<TranscriptSegment | null>;
  /** Sentence-phase writes must supply and atomically check the originating close job. */
  fail(
    segmentId: string,
    phase: 'raw' | 'correction' | 'sentences',
    error: ApiError,
    originJobId?: string,
  ): Promise<void>;
  listSegments(topicId: string): Promise<TranscriptSegment[]>;
  /** Production close workers pass originJobId so timed-out work cannot affect a retry. */
  finalizeSentences(
    topicId: string,
    sentences: SentenceDraft[],
    originJobId?: string,
  ): Promise<Utterance[]>;
}
export interface FeedbackStore {
  start(
    actor: Actor,
    utteranceId: string,
    correctionRevision: number,
    commandId: string,
  ): Promise<Job>;
  getUtterance(actor: Actor, utteranceId: string): Promise<Utterance>;
  readForJob(jobId: string): Promise<Utterance>;
  applyIfCurrent(
    jobId: string,
    input: {
      utteranceId: string;
      inputCorrectionRevision: number;
      items: FeedbackItem[];
      error: ApiError | null;
    },
  ): Promise<Feedback | null>;
}
export interface TopicExperience {
  id: string;
  ownerUserId: string;
  summary: string;
  interests: string[];
  context: Experience['context'];
}
export interface TopicLearningExpression {
  id: string;
  expression: string;
  meaning: string;
  example: string;
}
export interface TopicContext {
  studyId: string;
  topicId: string;
  ordinal: number;
  focusUserId: string | null;
  experiences: TopicExperience[];
  learningExpressions: TopicLearningExpression[];
  sharedExpressions: SharedExpression[];
}
export interface TopicContextReader {
  read(jobId: string): Promise<TopicContext>;
}
export interface StudyStore {
  snapshot(actor: Actor, studyId: string): Promise<StudySnapshot>;
  getForTopic(actor: Actor, topicId: string): Promise<StudySnapshot>;
  applyGeneratedTopic(jobId: string, content: TopicContent): Promise<boolean>;
  completeClose(jobId: string): Promise<boolean>;
}
export interface ChatExecutionContext {
  actor: Actor;
  studyId: string;
  messageId: string;
  expectedTopicId: string | null;
  expectedTransitionVersion: number;
  text: string;
  history: ChatMessage[];
}
export interface JobInputMap {
  'topic.generate': { topicId: string };
  'topic.close': { topicId: string; closeId: string };
  'experience.prepare': PrepareExperienceInput & { ownerUserId: string };
  'utterance.feedback': { utteranceId: string; correctionRevision: number; ownerUserId: string };
  'chat.respond': ChatExecutionContext;
}
export type CreateJobInput = {
  [K in JobKind]: {
    kind: K;
    scope: 'user' | 'study';
    ownerUserId: string | null;
    studyId: string | null;
    targetId: string;
    input: JobInputMap[K];
  };
}[JobKind];
export interface JobsStore {
  create(input: CreateJobInput): Promise<Job>;
  get(actor: Actor, id: string): Promise<Job>;
  read(id: string): Promise<Job>;
  readInput<K extends JobKind>(id: string, kind: K): Promise<JobInputMap[K]>;
  succeedIfRunning(id: string, result: JobResult): Promise<boolean>;
  failIfRunning(id: string, error: ApiError): Promise<boolean>;
  isRunning(id: string): Promise<boolean>;
}
export interface ExperienceStore {
  saveDraft(
    jobId: string,
    draft: Omit<ExperienceDraft, 'id' | 'revision' | 'ownerUserId'>,
  ): Promise<ExperienceDraft | null>;
  getDraft(actor: Actor, id: string): Promise<ExperienceDraft>;
}
export interface ChatStore {
  begin(
    actor: Actor,
    input: { studyId: string; text: string; clientMessageId: string },
  ): Promise<{ message: ChatMessage; job: Job; existing: boolean }>;
  readForJob(jobId: string): Promise<ChatExecutionContext>;
  list(actor: Actor, studyId: string): Promise<ChatMessage[]>;
  complete(
    messageId: string,
    input: {
      text: string;
      commandResults: CommandResult[];
      learningItemIds: string[];
      shareProposalId: string | null;
    },
  ): Promise<ChatMessage | null>;
  fail(
    messageId: string,
    error: ApiError,
    partial?: {
      commandResults: CommandResult[];
      learningItemIds: string[];
      shareProposalId: string | null;
    },
  ): Promise<void>;
}
export interface AiJobs {
  generateTopic(jobId: string): Promise<void>;
  closeTopic(jobId: string): Promise<void>;
  prepareExperience(jobId: string): Promise<void>;
  feedback(jobId: string): Promise<void>;
  chat(jobId: string): Promise<void>;
}
export type UserEvent =
  | Extract<DomainEvent, { scope: 'user' }>
  | Extract<DomainEvent, { type: 'job.updated' }>;
export type StudyEvent =
  | Extract<DomainEvent, { scope: 'study' }>
  | Extract<DomainEvent, { type: 'job.updated' }>;
export interface EventPublisher {
  toUser(userId: string, event: UserEvent): Promise<void>;
  toStudy(studyId: string, event: StudyEvent): Promise<void>;
}
export interface MediaPutInput {
  kind: 'image' | 'audio';
  studyId: string;
  segmentId?: string;
  bytes: Uint8Array;
  contentType: string;
}
export type ResolvedImage =
  | { kind: 'bytes'; bytes: Uint8Array; contentType: string }
  | { kind: 'redirect'; url: string };
export interface MediaStore {
  put(input: MediaPutInput): Promise<{ mediaId: string }>;
  /** HTTP adapter must authorize study membership before resolving stored image bytes. */
  resolveImage(mediaId: string): Promise<ResolvedImage>;
}
export interface ApplicationPorts {
  studyCommands: StudyCommands;
  learning: LearningStore;
  sharing: SharingStore;
  speech: SpeechStore;
  feedback: FeedbackStore;
  topicContext: TopicContextReader;
  studies: StudyStore;
  jobs: JobsStore;
  experiences: ExperienceStore;
  chat: ChatStore;
  events: EventPublisher;
  media: MediaStore;
}
