import type {
  ApiError,
  CommandResult,
  ErrorCode,
  Job,
  JobKind,
  JobResult,
} from '@devday/contracts';
import type {
  Actor,
  CreateJobInput,
  EventPublisher,
  JobInputMap,
  JobsStore,
  MediaPutInput,
  MediaStore,
  ResolvedImage,
  StudyCommands,
  StudyEvent,
  UserEvent,
} from './index.js';

/** Small in-memory adapters for application tests; no database, server or AI runtime. */
export class FakePortError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FakePortError';
  }
}

function sequenceId(): () => string {
  let next = 0;
  return () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, '0')}`;
}

export interface FakeStoreOptions {
  id?: () => string;
  now?: () => string;
}

export interface FakeJobsStoreOptions extends FakeStoreOptions {
  studyMembers?: Readonly<Record<string, readonly string[]>>;
}

export class FakeJobsStore implements JobsStore {
  private readonly jobs = new Map<string, Job>();
  private readonly inputs = new Map<string, CreateJobInput>();
  private readonly studyMembers = new Map<string, Set<string>>();
  private readonly id: () => string;
  private readonly now: () => string;

  constructor(options: FakeJobsStoreOptions = {}) {
    this.id = options.id ?? sequenceId();
    this.now = options.now ?? (() => new Date().toISOString());
    for (const [studyId, members] of Object.entries(options.studyMembers ?? {})) {
      this.setStudyMembers(studyId, members);
    }
  }

  setStudyMembers(studyId: string, userIds: readonly string[]): void {
    this.studyMembers.set(studyId, new Set(userIds));
  }

  grantStudyAccess(studyId: string, userId: string): void {
    const members = this.studyMembers.get(studyId) ?? new Set<string>();
    members.add(userId);
    this.studyMembers.set(studyId, members);
  }

  async create(input: CreateJobInput): Promise<Job> {
    if (
      (input.scope === 'user' && !input.ownerUserId) ||
      (input.scope === 'study' && !input.studyId)
    ) {
      throw new FakePortError('INVALID_INPUT', 'Job scope requires its owner or study');
    }
    const job: Job = {
      id: this.id(),
      revision: 0,
      kind: input.kind,
      scope: input.scope,
      ownerUserId: input.ownerUserId,
      studyId: input.studyId,
      targetId: input.targetId,
      status: 'running',
      result: null,
      error: null,
      createdAt: this.now(),
      finishedAt: null,
    };
    if (this.jobs.has(job.id)) throw new FakePortError('COMMAND_CONFLICT', 'Duplicate fake job ID');
    this.jobs.set(job.id, job);
    this.inputs.set(job.id, structuredClone(input));
    return structuredClone(job);
  }

  async get(actor: Actor, id: string): Promise<Job> {
    const job = this.requireJob(id);
    if (job.scope === 'user' && job.ownerUserId !== actor.userId) {
      throw new FakePortError('NOT_OWNER', 'Job belongs to another user');
    }
    if (job.scope === 'study' && !this.studyMembers.get(job.studyId!)?.has(actor.userId)) {
      throw new FakePortError('NOT_MEMBER', 'User is not a member of this study');
    }
    return structuredClone(job);
  }

  async read(id: string): Promise<Job> {
    return structuredClone(this.requireJob(id));
  }

  async readInput<K extends JobKind>(id: string, kind: K): Promise<JobInputMap[K]> {
    this.requireJob(id);
    const input = this.inputs.get(id)!;
    if (input.kind !== kind)
      throw new FakePortError('INVALID_INPUT', 'Job kind does not match requested input');
    // The discriminant was checked above; TypeScript cannot narrow a generic mapped lookup.
    return structuredClone(input.input) as JobInputMap[K];
  }

  async succeedIfRunning(id: string, result: JobResult): Promise<boolean> {
    const job = this.requireJob(id);
    if (job.status !== 'running') return false;
    const terminal = {
      ...job,
      revision: job.revision + 1,
      status: 'succeeded' as const,
      finishedAt: this.now(),
      error: null,
    };
    let succeeded: Job;
    switch (job.kind) {
      case 'topic.generate':
        if (!('topicId' in result) || 'utteranceIds' in result) return this.invalidResult();
        succeeded = { ...terminal, kind: job.kind, result: { topicId: result.topicId } };
        break;
      case 'topic.close':
        if (!('utteranceIds' in result)) return this.invalidResult();
        succeeded = {
          ...terminal,
          kind: job.kind,
          result: { topicId: result.topicId, utteranceIds: result.utteranceIds },
        };
        break;
      case 'experience.prepare':
        if (!('draft' in result)) return this.invalidResult();
        succeeded = { ...terminal, kind: job.kind, result: { draft: result.draft } };
        break;
      case 'utterance.feedback':
        if (!('inputCorrectionRevision' in result)) return this.invalidResult();
        succeeded = {
          ...terminal,
          kind: job.kind,
          result: {
            utteranceId: result.utteranceId,
            inputCorrectionRevision: result.inputCorrectionRevision,
          },
        };
        break;
      case 'chat.respond':
        if (!('messageId' in result)) return this.invalidResult();
        succeeded = { ...terminal, kind: job.kind, result: { messageId: result.messageId } };
        break;
    }
    this.jobs.set(id, structuredClone(succeeded));
    return true;
  }

  async failIfRunning(id: string, error: ApiError): Promise<boolean> {
    const job = this.requireJob(id);
    if (job.status !== 'running') return false;
    this.jobs.set(id, {
      ...job,
      revision: job.revision + 1,
      status: 'failed',
      result: null,
      error: structuredClone(error),
      finishedAt: this.now(),
    });
    return true;
  }

  async isRunning(id: string): Promise<boolean> {
    return this.requireJob(id).status === 'running';
  }

  private requireJob(id: string): Job {
    const job = this.jobs.get(id);
    if (!job) throw new FakePortError('NOT_FOUND', 'Job not found');
    return job;
  }

  private invalidResult(): never {
    throw new FakePortError('INVALID_INPUT', 'Job result does not match job kind');
  }
}

export type FakePublication =
  | { scope: 'user'; userId: string; event: UserEvent }
  | { scope: 'study'; studyId: string; event: StudyEvent };

export class FakeEventPublisher implements EventPublisher {
  private readonly recorded: FakePublication[] = [];

  get publications(): FakePublication[] {
    return structuredClone(this.recorded);
  }

  async toUser(userId: string, event: UserEvent): Promise<void> {
    if (event.scope !== 'user')
      throw new FakePortError('INVALID_INPUT', 'Study event cannot use a user channel');
    if ('ownerUserId' in event.payload && event.payload.ownerUserId !== userId) {
      throw new FakePortError('NOT_OWNER', 'Private event belongs to another user');
    }
    if (
      event.type === 'job.updated' &&
      (event.payload.scope !== 'user' || event.studyId !== event.payload.studyId)
    ) {
      throw new FakePortError('INVALID_INPUT', 'Job event scope does not match its payload');
    }
    this.recorded.push({ scope: 'user', userId, event: structuredClone(event) });
  }

  async toStudy(studyId: string, event: StudyEvent): Promise<void> {
    if (event.scope !== 'study' || event.studyId !== studyId) {
      throw new FakePortError('INVALID_INPUT', 'Event does not belong to this study channel');
    }
    if (
      event.type === 'job.updated' &&
      (event.payload.scope !== 'study' || event.payload.studyId !== studyId)
    ) {
      throw new FakePortError('INVALID_INPUT', 'Private job cannot use a study channel');
    }
    if (
      event.type === 'study.changed' &&
      (event.payload.study.id !== studyId ||
        event.payload.jobs.some((job) => job.scope !== 'study' || job.studyId !== studyId))
    ) {
      throw new FakePortError('INVALID_INPUT', 'Study event contains foreign or private state');
    }
    if ('studyId' in event.payload && event.payload.studyId !== studyId) {
      throw new FakePortError('INVALID_INPUT', 'Event payload belongs to another study');
    }
    this.recorded.push({ scope: 'study', studyId, event: structuredClone(event) });
  }
}

export class FakeMediaStore implements MediaStore {
  private readonly media = new Map<string, MediaPutInput>();
  private readonly id: () => string;

  constructor(options: Pick<FakeStoreOptions, 'id'> = {}) {
    this.id = options.id ?? sequenceId();
  }

  get writes(): { mediaId: string; input: MediaPutInput }[] {
    return [...this.media].map(([mediaId, input]) => ({ mediaId, input: structuredClone(input) }));
  }

  async put(input: MediaPutInput): Promise<{ mediaId: string }> {
    const mediaId = this.id();
    if (this.media.has(mediaId))
      throw new FakePortError('COMMAND_CONFLICT', 'Duplicate fake media ID');
    this.media.set(mediaId, structuredClone(input));
    return { mediaId };
  }

  async resolveImage(mediaId: string): Promise<ResolvedImage> {
    const input = this.media.get(mediaId);
    if (!input || input.kind !== 'image') throw new FakePortError('NOT_FOUND', 'Image not found');
    return { kind: 'bytes', bytes: new Uint8Array(input.bytes), contentType: input.contentType };
  }
}

export type StudyCommandExecution = {
  actor: Actor;
  input: Parameters<StudyCommands['execute']>[1];
};
export type FakeStudyCommandHandler = (
  actor: Actor,
  input: StudyCommandExecution['input'],
) => CommandResult | Promise<CommandResult>;

export class FakeStudyCommands implements StudyCommands {
  private readonly recorded: StudyCommandExecution[] = [];

  constructor(private readonly handler: FakeStudyCommandHandler) {}

  get executions(): StudyCommandExecution[] {
    return structuredClone(this.recorded);
  }

  async execute(actor: Actor, input: StudyCommandExecution['input']): Promise<CommandResult> {
    const execution = structuredClone({ actor, input });
    this.recorded.push(execution);
    return structuredClone(
      await this.handler(structuredClone(execution.actor), structuredClone(execution.input)),
    );
  }
}
