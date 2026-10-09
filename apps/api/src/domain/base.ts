import { createHash, randomUUID } from 'node:crypto';
import type { Actor, EventPublisher, AiJobs, MediaStore } from '@devday/application-ports';
import type {
  Study,
  Topic,
  Job,
  ApiError,
  StudySnapshot,
  Feedback,
  ChatMessage,
} from '@devday/contracts';
import { Database, one, many, update, type SqlClient } from '../db/client.js';
import { DomainError, requireValue } from './errors.js';
export const now = () => new Date().toISOString();
export const id = () => randomUUID();
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export type PendingEvent = { scope: 'user' | 'study'; id: string; type: string; payload: unknown };
export class DomainBase {
  aiJobs?: AiJobs;
  mediaStore?: MediaStore;
  constructor(
    readonly db: Database,
    readonly events: EventPublisher,
  ) {}
  async assertMember(actor: Actor, studyId: string, tx: SqlClient = this.db.pool) {
    const r = await tx.query(
      "SELECT 1 FROM study_members WHERE study_id=$1 AND user_id=$2 AND state='joined'",
      [studyId, actor.userId],
    );
    if (!r.rowCount) throw new DomainError('NOT_MEMBER', '스터디 참여 후 이용할 수 있습니다.', 403);
  }
  async study(tx: SqlClient, studyId: string, lock = false) {
    return requireValue(
      await one<Study>(tx, `SELECT data FROM studies WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
        studyId,
      ]),
    );
  }
  async topic(tx: SqlClient, topicId: string, lock = false) {
    return requireValue(
      await one<Topic>(tx, `SELECT data FROM topics WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [
        topicId,
      ]),
    );
  }
  async transaction<T>(fn: (tx: SqlClient, events: PendingEvent[]) => Promise<T>): Promise<T> {
    const events: PendingEvent[] = [];
    const result = await this.db.transaction((tx) => fn(tx, events));
    for (const event of events) await this.publish(event);
    return result;
  }
  async publish(event: PendingEvent) {
    const p = event.payload as Record<string, unknown>;
    const entity = event.type === 'study.changed' ? (p.study as Record<string, unknown>) : p;
    const entityId = String(
      entity.id ??
        entity.utteranceId ??
        entity.segmentId ??
        entity.studyId ??
        (Array.isArray(entity.itemIds) ? entity.itemIds[0] : undefined) ??
        event.id,
    );
    const entityRevision = Number(entity.revision ?? entity.partialRevision ?? 0);
    const envelope = {
      version: 1 as const,
      eventId: id(),
      type: event.type,
      scope: event.scope,
      studyId:
        event.scope === 'study' ? event.id : typeof p.studyId === 'string' ? p.studyId : null,
      entityId,
      entityRevision,
      occurredAt: now(),
      payload: event.payload,
    };
    if (event.scope === 'user') await this.events.toUser(event.id, envelope as never);
    else await this.events.toStudy(event.id, envelope as never);
  }
  async receipt<T>(
    tx: SqlClient,
    actor: Actor,
    commandId: string,
    route: string,
    payload: unknown,
    fn: () => Promise<T>,
  ): Promise<T> {
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      `${actor.userId}:${commandId}`,
    ]);
    const r = await tx.query(
      'SELECT route,payload,result FROM command_receipts WHERE actor_user_id=$1 AND command_id=$2',
      [actor.userId, commandId],
    );
    if (r.rowCount) {
      const prior = r.rows[0];
      if (prior.route !== route || stable(prior.payload) !== stable(payload))
        throw new DomainError('COMMAND_CONFLICT', '같은 요청 ID에 다른 입력을 사용할 수 없습니다.');
      return prior.result as T;
    }
    const result = await fn();
    await tx.query(
      'INSERT INTO command_receipts(actor_user_id,command_id,route,payload,result) VALUES($1,$2,$3,$4,$5)',
      [actor.userId, commandId, route, JSON.stringify(payload), JSON.stringify(result)],
    );
    return result;
  }
  async newJob(
    tx: SqlClient,
    input: {
      kind: Job['kind'];
      scope: 'study' | 'user';
      ownerUserId: string | null;
      studyId: string | null;
      targetId: string;
    },
    payload: unknown = null,
  ): Promise<Job> {
    const job = {
      ...input,
      id: id(),
      revision: 0,
      status: 'running',
      result: null,
      error: null,
      createdAt: now(),
      finishedAt: null,
    } as Job;
    await tx.query(
      'INSERT INTO jobs(id,kind,target_id,status,data,input) VALUES($1,$2,$3,$4,$5,$6)',
      [job.id, job.kind, job.targetId, job.status, JSON.stringify(job), JSON.stringify(payload)],
    );
    return job;
  }
  async updateJob(tx: SqlClient, job: Job) {
    await tx.query('UPDATE jobs SET status=$2,data=$3 WHERE id=$1', [
      job.id,
      job.status,
      JSON.stringify(job),
    ]);
  }
  jobEvent(events: PendingEvent[], job: Job) {
    events.push({
      scope: job.scope,
      id: job.scope === 'user' ? job.ownerUserId! : job.studyId!,
      type: 'job.updated',
      payload: job,
    });
  }
  async studyEvent(tx: SqlClient, events: PendingEvent[], study: Study) {
    const topic = study.currentTopicId ? await this.topic(tx, study.currentTopicId) : null;
    const jobs = await many<Job>(
      tx,
      "SELECT data FROM jobs WHERE data->>'studyId'=$1 AND data->>'scope'='study' AND status='running'",
      [study.id],
    );
    events.push({
      scope: 'study',
      id: study.id,
      type: 'study.changed',
      payload: { study, topic, jobs },
    });
  }
  async snapshot(actor: Actor, studyId: string): Promise<StudySnapshot> {
    return this.db.transaction(async (tx) => {
      await this.assertMember(actor, studyId, tx);
      const study = await this.study(tx, studyId);
      const topic = study.currentTopicId ? await this.topic(tx, study.currentTopicId) : null;
      const tid = topic?.id ?? null;
      return {
        study,
        topic,
        speechGroups: await many(
          tx,
          'SELECT data FROM speech_groups WHERE topic_id=$1 ORDER BY start_order',
          [topic?.id ?? null],
        ),
        segments: await many(
          tx,
          'SELECT data FROM transcript_segments WHERE topic_id=$1 ORDER BY start_order',
          [tid],
        ),
        utterances: await many(
          tx,
          "SELECT data FROM utterances WHERE topic_id=$1 ORDER BY (data->>'startOrder')::int,(data->>'sentenceIndex')::int",
          [tid],
        ),
        feedback: await many(
          tx,
          'SELECT f.data FROM feedback f JOIN utterances u ON u.id=f.id WHERE u.topic_id=$1',
          [tid],
        ),
        sharedExpressions: await many(tx, 'SELECT data FROM shared_expressions WHERE study_id=$1', [
          studyId,
        ]),
        jobs: await many(
          tx,
          "SELECT data FROM jobs WHERE data->>'studyId'=$1 AND data->>'scope'='study' ORDER BY data->>'createdAt'",
          [studyId],
        ),
      };
    }, true);
  }
  async getJob(actor: Actor, jobId: string) {
    const job = requireValue(
      await one<Job>(this.db.pool, 'SELECT data FROM jobs WHERE id=$1', [jobId]),
    );
    if (job.scope === 'user' && job.ownerUserId !== actor.userId)
      throw new DomainError('NOT_OWNER', '본인의 작업만 조회할 수 있습니다.', 403);
    if (job.scope === 'study') await this.assertMember(actor, job.studyId!);
    return job;
  }
  async failJob(jobId: string, error: ApiError): Promise<boolean> {
    return this.transaction(async (tx, events) => {
      const initial = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1', [jobId]);
      if (!initial) return false;
      // Every AI terminal write follows the same Study → Topic → entity → Job lock order.
      const study = initial.studyId ? await this.study(tx, initial.studyId, true) : null;
      const topic =
        initial.kind === 'topic.generate' || initial.kind === 'topic.close'
          ? await this.topic(tx, initial.targetId, true)
          : null;
      if (initial.kind === 'utterance.feedback') {
        const row = await tx.query('SELECT topic_id FROM utterances WHERE id=$1', [
          initial.targetId,
        ]);
        if (row.rowCount) {
          await this.topic(tx, row.rows[0]!.topic_id as string, true);
          await tx.query('SELECT id FROM utterances WHERE id=$1 FOR UPDATE', [initial.targetId]);
        }
      }
      const original = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
      if (!original || original.status !== 'running') return false;
      const job = {
        ...original,
        status: 'failed',
        error,
        result: null,
        finishedAt: now(),
        revision: original.revision + 1,
      } as Job;
      await this.updateJob(tx, job);
      this.jobEvent(events, job);
      if (
        topic &&
        job.kind === 'topic.generate' &&
        topic.generationJobId === job.id &&
        topic.state === 'generating'
      ) {
        topic.state = 'failed';
        topic.revision++;
        await update(tx, 'topics', topic.id, topic);
        if (study) {
          study.revision++;
          await update(tx, 'studies', study.id, study);
          await this.studyEvent(tx, events, study);
        }
      }
      if (job.kind === 'utterance.feedback') {
        const feedback = await one<Feedback>(tx, 'SELECT data FROM feedback WHERE id=$1', [
          job.targetId,
        ]);
        const input = (await tx.query('SELECT input FROM jobs WHERE id=$1', [jobId])).rows[0]
          ?.input as { correctionRevision?: number } | undefined;
        if (
          (feedback?.status === 'running' || feedback?.status === 'ready') &&
          feedback.inputCorrectionRevision === input?.correctionRevision
        ) {
          feedback.status = 'failed';
          feedback.items = [];
          feedback.error = error;
          feedback.revision++;
          await update(tx, 'feedback', feedback.utteranceId, feedback);
          events.push({
            scope: 'study',
            id: job.studyId!,
            type: 'feedback.updated',
            payload: feedback,
          });
        }
      }
      if (job.kind === 'chat.respond') {
        const message = await one<ChatMessage>(
          tx,
          'SELECT data FROM chat_messages WHERE id=$1 FOR UPDATE',
          [job.targetId],
        );
        if (message?.status === 'running') {
          message.status = 'failed';
          message.text = error.message;
          message.revision++;
          await update(tx, 'chat_messages', message.id, message);
          events.push({
            scope: 'user',
            id: message.ownerUserId,
            type: 'chat.message.updated',
            payload: message,
          });
        }
      }
      return true;
    });
  }
  async interruptJobs() {
    // Persist an explicit interrupted failure so retained audio can be retried after restart.
    await this.db.pool.query(`UPDATE speech_groups SET data = data || jsonb_build_object(
      'state', 'failed', 'revision', (data->>'revision')::int + 1,
      'closeReason', COALESCE(data->>'closeReason', 'mic_off'),
      'error', jsonb_build_object('phase','raw','code','PROCESS_INTERRUPTED','message','서버가 재시작되었습니다. 이 발화를 다시 처리해 주세요.'))
      WHERE data->>'state' IN ('collecting','deciding','correcting')`);

    const jobs = await many<Job>(this.db.pool, "SELECT data FROM jobs WHERE status='running'");
    for (const job of jobs)
      await this.failJob(job.id, {
        code: 'PROCESS_INTERRUPTED',
        message: '서버가 재시작되어 작업이 중단되었습니다. 새 요청으로 다시 실행해 주세요.',
        details: null,
      });
  }
  dispatch(kind: 'generateTopic' | 'closeTopic', jobId: string) {
    if (!this.aiJobs) return;
    void this.aiJobs[kind](jobId).catch(() =>
      this.failJob(jobId, {
        code: 'AI_FAILED',
        message: 'AI 작업을 완료하지 못했습니다. 새 요청으로 다시 실행해 주세요.',
        details: null,
      }),
    );
  }
}
function stable(input: unknown): string {
  if (Array.isArray(input)) return `[${input.map(stable).join(',')}]`;
  if (input && typeof input === 'object')
    return `{${Object.entries(input)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => JSON.stringify(k) + ':' + stable(v))
      .join(',')}}`;
  return JSON.stringify(input) ?? 'null';
}
