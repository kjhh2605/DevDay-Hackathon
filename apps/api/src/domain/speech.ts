import type {
  Actor,
  SpeechStore,
  FeedbackStore,
  StudyStore,
  TopicContextReader,
  SentenceDraft,
  TopicContext,
} from '@devday/application-ports';
import {
  TopicContentSchema,
  type TranscriptSegment,
  type Utterance,
  type Feedback,
  type Job,
  type EndpointInput,
} from '@devday/contracts';
import { PrivateService } from './private.js';
import { id, now, type PendingEvent } from './base.js';
import { one, many, update, type SqlClient } from '../db/client.js';
import { DomainError, requireValue } from './errors.js';
export class SpeechService extends PrivateService {
  async lockUtterance(tx: SqlClient, utteranceId: string) {
    const original = requireValue(
      await one<Utterance>(tx, 'SELECT data FROM utterances WHERE id=$1', [utteranceId]),
    );
    const study = await this.study(tx, original.studyId, true);
    const topic = await this.topic(tx, original.topicId, true);
    const utterance = requireValue(
      await one<Utterance>(tx, 'SELECT data FROM utterances WHERE id=$1 FOR UPDATE', [utteranceId]),
    );
    if (study.currentTopicId !== topic.id || !['closing', 'review'].includes(topic.state))
      throw new DomainError('ACTION_NOT_READY', '현재 검토 중인 문장만 변경할 수 있습니다.');
    return { study, topic, utterance };
  }
  async lockSegment(tx: SqlClient, segmentId: string) {
    const original = requireValue(
      await one<TranscriptSegment>(tx, 'SELECT data FROM transcript_segments WHERE id=$1', [
        segmentId,
      ]),
    );
    const study = await this.study(tx, original.studyId, true);
    const topic = await this.topic(tx, original.topicId, true);
    const segment = requireValue(
      await one<TranscriptSegment>(
        tx,
        'SELECT data FROM transcript_segments WHERE id=$1 FOR UPDATE',
        [segmentId],
      ),
    );
    if (study.currentTopicId !== topic.id || !['talking', 'closing'].includes(topic.state))
      throw new DomainError('ACTION_NOT_READY', '음성 입력이 마감되었습니다.');
    return { study, topic, segment };
  }
  segmentEvent(events: PendingEvent[], segment: TranscriptSegment) {
    events.push({
      scope: 'study',
      id: segment.studyId,
      type: 'transcript.segment.updated',
      payload: segment,
    });
  }
  speech: SpeechStore = {
    begin: async (actor, input) =>
      this.transaction(async (tx, events) => {
        const initial = await this.topic(tx, input.topicId);
        await this.study(tx, initial.studyId, true);
        const topic = await this.topic(tx, input.topicId, true);
        await this.assertMember(actor, topic.studyId, tx);
        if (!['talking', 'closing'].includes(topic.state))
          throw new DomainError('ACTION_NOT_READY', '대화 중에만 음성을 입력할 수 있습니다.');
        const count = await tx.query(
          'SELECT COALESCE(MAX(start_order),-1)+1 AS next FROM transcript_segments WHERE topic_id=$1',
          [topic.id],
        );
        const segment: TranscriptSegment = {
          id: id(),
          revision: 0,
          studyId: topic.studyId,
          topicId: topic.id,
          speakerUserId: actor.userId,
          startOrder: Number(count.rows[0]!.next),
          startedAt: input.startedAt,
          endedAt: null,
          rawText: null,
          rawStatus: 'running',
          correctedText: null,
          correctionStatus: 'pending',
          sentenceStatus: 'pending',
        };
        await tx.query(
          'INSERT INTO transcript_segments(id,study_id,topic_id,speaker_user_id,start_order,data) VALUES($1,$2,$3,$4,$5,$6)',
          [
            segment.id,
            segment.studyId,
            segment.topicId,
            segment.speakerUserId,
            segment.startOrder,
            JSON.stringify(segment),
          ],
        );
        this.segmentEvent(events, segment);
        return segment;
      }),
    completeRaw: async (segmentId, input) =>
      this.transaction(async (tx, events) => {
        const { segment } = await this.lockSegment(tx, segmentId);
        if (segment.rawStatus === 'ready') return segment;
        segment.rawText = input.text;
        segment.endedAt = input.endedAt;
        segment.rawStatus = 'ready';
        segment.correctionStatus = 'running';
        segment.revision++;
        await update(tx, 'transcript_segments', segment.id, segment);
        this.segmentEvent(events, segment);
        return segment;
      }),
    applyCorrection: async (segmentId, input) =>
      this.transaction(async (tx, events) => {
        const { segment } = await this.lockSegment(tx, segmentId);
        if (segment.revision !== input.expectedRevision) return null;
        if (segment.rawStatus !== 'ready')
          throw new DomainError('ACTION_NOT_READY', '원문 전사가 완료되지 않았습니다.');
        segment.correctedText = input.text;
        segment.correctionStatus = 'ready';
        segment.revision++;
        await update(tx, 'transcript_segments', segment.id, segment);
        this.segmentEvent(events, segment);
        return segment;
      }),
    fail: async (segmentId, phase, _error, originJobId) =>
      this.transaction(async (tx, events) => {
        const { segment } = await this.lockSegment(tx, segmentId);
        if (originJobId) {
          const job = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [
            originJobId,
          ]);
          if (
            !job ||
            job.status !== 'running' ||
            job.kind !== 'topic.close' ||
            job.targetId !== segment.topicId
          )
            return;
        }
        if (phase === 'raw') segment.rawStatus = 'failed';
        if (phase === 'correction') segment.correctionStatus = 'failed';
        if (phase === 'sentences') segment.sentenceStatus = 'failed';
        segment.revision++;
        await update(tx, 'transcript_segments', segment.id, segment);
        this.segmentEvent(events, segment);
      }),
    listSegments: async (topicId) =>
      many<TranscriptSegment>(
        this.db.pool,
        'SELECT data FROM transcript_segments WHERE topic_id=$1 ORDER BY start_order',
        [topicId],
      ),
    finalizeSentences: async (topicId, sentences, originJobId) =>
      this.transaction(async (tx, events) => {
        const initial = await this.topic(tx, topicId);
        await this.study(tx, initial.studyId, true);
        const topic = await this.topic(tx, topicId, true);
        if (topic.state !== 'closing')
          throw new DomainError('ACTION_NOT_READY', '음성 마감 중에 문장을 확정할 수 있습니다.');
        if (originJobId) {
          const job = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [
            originJobId,
          ]);
          if (
            !job ||
            job.status !== 'running' ||
            job.kind !== 'topic.close' ||
            job.targetId !== topicId
          )
            throw new DomainError('ACTION_NOT_READY', '마감 작업이 이미 종료되었습니다.');
        }
        const existing = await many<Utterance>(
          tx,
          "SELECT data FROM utterances WHERE topic_id=$1 ORDER BY (data->>'startOrder')::int,(data->>'sentenceIndex')::int",
          [topicId],
        );
        if (existing.length) return existing;
        const segments = await many<TranscriptSegment>(
          tx,
          'SELECT data FROM transcript_segments WHERE topic_id=$1 ORDER BY start_order',
          [topicId],
        );
        validateSentences(segments, sentences);
        const utterances: Utterance[] = [];
        for (const sentence of sentences) {
          const utterance: Utterance = {
            ...sentence,
            id: id(),
            revision: 0,
            studyId: topic.studyId,
            topicId,
            correctionStatus: 'ready',
            correctionRevision: 0,
            correctedBy: 'ai',
            updatedAt: now(),
          };
          await tx.query(
            'INSERT INTO utterances(id,study_id,topic_id,speaker_user_id,data) VALUES($1,$2,$3,$4,$5)',
            [
              utterance.id,
              utterance.studyId,
              topicId,
              utterance.speakerUserId,
              JSON.stringify(utterance),
            ],
          );
          utterances.push(utterance);
          events.push({
            scope: 'study',
            id: topic.studyId,
            type: 'utterance.updated',
            payload: utterance,
          });
        }
        for (const segment of segments) {
          segment.sentenceStatus = 'ready';
          segment.revision++;
          await update(tx, 'transcript_segments', segment.id, segment);
          this.segmentEvent(events, segment);
        }
        return utterances;
      }),
  };
  feedback: FeedbackStore = {
    start: async (actor, utteranceId, correctionRevision, commandId) => {
      const job = await this.startFeedback(actor, utteranceId, { correctionRevision, commandId });
      if (this.aiJobs && job.status === 'running')
        void this.aiJobs.feedback(job.id).catch(() =>
          this.failJob(job.id, {
            code: 'AI_FAILED',
            message: '피드백 생성에 실패했습니다.',
            details: null,
          }),
        );
      return job;
    },
    getUtterance: async (actor, utteranceId) => {
      const utterance = requireValue(
        await one<Utterance>(this.db.pool, 'SELECT data FROM utterances WHERE id=$1', [
          utteranceId,
        ]),
      );
      await this.assertMember(actor, utterance.studyId);
      return utterance;
    },
    readForJob: async (jobId) => {
      const job = await this.jobs.read(jobId);
      if (job.kind !== 'utterance.feedback' || job.status !== 'running')
        throw new DomainError('ACTION_NOT_READY', '피드백 작업이 이미 끝났습니다.');
      const input = await this.jobs.readInput(jobId, 'utterance.feedback');
      const utterance = requireValue(
        await one<Utterance>(this.db.pool, 'SELECT data FROM utterances WHERE id=$1', [
          input.utteranceId,
        ]),
      );
      if (utterance.correctionRevision !== input.correctionRevision)
        throw new DomainError('FEEDBACK_STALE', '문장이 변경되었습니다.');
      return utterance;
    },
    applyIfCurrent: async (jobId, input) =>
      this.transaction(async (tx, events) => {
        const { topic, utterance } = await this.lockUtterance(tx, input.utteranceId);
        const job = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
        if (
          !job ||
          job.status !== 'running' ||
          job.kind !== 'utterance.feedback' ||
          job.targetId !== utterance.id ||
          utterance.correctionRevision !== input.inputCorrectionRevision
        )
          return null;
        const prior = await one<Feedback>(tx, 'SELECT data FROM feedback WHERE id=$1', [
          utterance.id,
        ]);
        const feedback: Feedback = {
          utteranceId: utterance.id,
          revision: (prior?.revision ?? -1) + 1,
          inputCorrectionRevision: input.inputCorrectionRevision,
          status: input.error ? 'failed' : 'ready',
          items: input.error ? [] : input.items,
          error: input.error,
        };
        await tx.query(
          'INSERT INTO feedback(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
          [utterance.id, JSON.stringify(feedback)],
        );
        // Ready feedback and its successful job are one commit: approval cannot
        // observe a ready result whose still-running job later times out.
        const terminal = {
          ...job,
          status: input.error ? 'failed' : 'succeeded',
          result: input.error
            ? null
            : { utteranceId: utterance.id, inputCorrectionRevision: input.inputCorrectionRevision },
          error: input.error,
          finishedAt: now(),
          revision: job.revision + 1,
        } as Job;
        await this.updateJob(tx, terminal);
        events.push({
          scope: 'study',
          id: topic.studyId,
          type: 'feedback.updated',
          payload: feedback,
        });
        this.jobEvent(events, terminal);
        return feedback;
      }),
  };
  async editCorrection(
    actor: Actor,
    utteranceId: string,
    input: EndpointInput<'updateCorrection'>,
  ) {
    return this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, `correction:${utteranceId}`, input, async () => {
        const { topic, utterance } = await this.lockUtterance(tx, utteranceId);
        await this.assertMember(actor, topic.studyId, tx);
        if (topic.state !== 'review')
          throw new DomainError('ACTION_NOT_READY', '검토 화면에서 보정문을 수정해 주세요.');
        utterance.correctedText = input.text;
        utterance.correctedBy = 'human';
        utterance.correctionRevision++;
        utterance.revision++;
        utterance.updatedAt = now();
        await update(tx, 'utterances', utterance.id, utterance);
        const prior = await one<Feedback>(tx, 'SELECT data FROM feedback WHERE id=$1', [
          utterance.id,
        ]);
        const feedback: Feedback = {
          utteranceId: utterance.id,
          revision: (prior?.revision ?? -1) + 1,
          inputCorrectionRevision: prior?.inputCorrectionRevision ?? 0,
          status: 'stale',
          items: prior?.items ?? [],
          error: null,
        };
        await tx.query(
          'INSERT INTO feedback(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data',
          [utterance.id, JSON.stringify(feedback)],
        );
        events.push(
          { scope: 'study', id: topic.studyId, type: 'utterance.updated', payload: utterance },
          { scope: 'study', id: topic.studyId, type: 'feedback.updated', payload: feedback },
        );
        return { utterance, feedback };
      }),
    );
  }
  async startFeedback(actor: Actor, utteranceId: string, input: EndpointInput<'requestFeedback'>) {
    return this.transaction(async (tx, events) =>
      this.receipt(tx, actor, input.commandId, `feedback:${utteranceId}`, input, async () => {
        const { topic, utterance } = await this.lockUtterance(tx, utteranceId);
        await this.assertMember(actor, topic.studyId, tx);
        if (topic.state !== 'review' || utterance.correctionRevision !== input.correctionRevision)
          throw new DomainError('FEEDBACK_STALE', '최신 보정문에서 피드백을 요청해 주세요.');
        const existing = await one<Job>(
          tx,
          "SELECT data FROM jobs WHERE target_id=$1 AND kind='utterance.feedback' AND status='running' AND (input->>'correctionRevision')::int=$2 FOR UPDATE",
          [utterance.id, utterance.correctionRevision],
        );
        if (existing) return existing;
        const job = await this.newJob(
          tx,
          {
            kind: 'utterance.feedback',
            scope: 'study',
            ownerUserId: null,
            studyId: topic.studyId,
            targetId: utterance.id,
          },
          {
            utteranceId: utterance.id,
            correctionRevision: utterance.correctionRevision,
            ownerUserId: utterance.speakerUserId,
          },
        );
        const prior = await one<Feedback>(tx, 'SELECT data FROM feedback WHERE id=$1', [
          utterance.id,
        ]);
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
        events.push({
          scope: 'study',
          id: topic.studyId,
          type: 'feedback.updated',
          payload: feedback,
        });
        this.jobEvent(events, job);
        return job;
      }),
    );
  }
  studies: StudyStore = {
    snapshot: (actor, studyId) => this.snapshot(actor, studyId),
    getForTopic: async (actor, topicId) => {
      const topic = await this.topic(this.db.pool, topicId);
      return this.snapshot(actor, topic.studyId);
    },
    applyGeneratedTopic: async (jobId, content) =>
      this.transaction(async (tx, events) => {
        const initial = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1', [jobId]);
        if (!initial || initial.kind !== 'topic.generate') return false;
        const study = await this.study(tx, initial.studyId!, true);
        const topic = await this.topic(tx, initial.targetId, true);
        const job = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
        if (
          !job ||
          job.status !== 'running' ||
          topic.state !== 'generating' ||
          topic.generationJobId !== jobId ||
          study.currentTopicId !== topic.id
        )
          return false;
        topic.content = TopicContentSchema.parse(content);
        topic.state = 'talking';
        topic.revision++;
        await update(tx, 'topics', topic.id, topic);
        study.revision++;
        await update(tx, 'studies', study.id, study);
        await this.studyEvent(tx, events, study);
        return true;
      }),
    completeClose: async (jobId) =>
      this.transaction(async (tx, events) => {
        const initial = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1', [jobId]);
        if (!initial || initial.kind !== 'topic.close') return false;
        const study = await this.study(tx, initial.studyId!, true);
        const topic = await this.topic(tx, initial.targetId, true);
        const job = await one<Job>(tx, 'SELECT data FROM jobs WHERE id=$1 FOR UPDATE', [jobId]);
        if (
          !job ||
          job.status !== 'running' ||
          topic.state !== 'closing' ||
          study.currentTopicId !== topic.id
        )
          return false;
        const segments = await many<TranscriptSegment>(
          tx,
          'SELECT data FROM transcript_segments WHERE topic_id=$1',
          [topic.id],
        );
        if (
          segments.some(
            (s) =>
              s.rawStatus !== 'ready' ||
              s.correctionStatus !== 'ready' ||
              s.sentenceStatus !== 'ready',
          )
        )
          throw new DomainError('ACTION_NOT_READY', '마지막 음성 처리가 완료되지 않았습니다.');
        const unfinished = await tx.query(
          "SELECT u.id FROM utterances u LEFT JOIN feedback f ON f.id=u.id WHERE u.topic_id=$1 AND (f.id IS NULL OR f.data->>'status' IN ('running','stale'))",
          [topic.id],
        );
        if (unfinished.rowCount)
          throw new DomainError('ACTION_NOT_READY', '문장 피드백 처리 중입니다.');
        topic.state = 'review';
        topic.revision++;
        study.revision++;
        study.transitionVersion++;
        await update(tx, 'topics', topic.id, topic);
        await update(tx, 'studies', study.id, study);
        await this.studyEvent(tx, events, study);
        return true;
      }),
  };
  topicContext: TopicContextReader = {
    read: async (jobId) => {
      const job = await this.jobs.read(jobId);
      if (job.kind !== 'topic.generate')
        throw new DomainError('INVALID_INPUT', '주제 생성 작업이 아닙니다.', 400);
      const r = await this.db.pool.query('SELECT generation_input,data FROM topics WHERE id=$1', [
        job.targetId,
      ]);
      const row = requireValue(r.rows[0]);
      const topic = row.data as { id: string; ordinal: number };
      return { ...row.generation_input, topicId: topic.id, ordinal: topic.ordinal } as TopicContext;
    },
  };
}
export function validateSentences(segments: TranscriptSegment[], sentences: SentenceDraft[]) {
  const used = new Map<string, { raw: Set<number>; corrected: Set<number> }>();
  for (const segment of segments) {
    if (
      segment.rawStatus !== 'ready' ||
      segment.correctionStatus !== 'ready' ||
      segment.rawText === null ||
      segment.correctedText === null
    )
      throw new DomainError(
        'ACTION_NOT_READY',
        '전사와 보정이 완료되어야 문장을 확정할 수 있습니다.',
      );
    used.set(segment.id, { raw: new Set(), corrected: new Set() });
  }
  const keys = new Set<string>();
  for (const sentence of sentences) {
    if (!sentence.sourceRanges.length)
      throw new DomainError('INVALID_INPUT', '문장 원문 범위가 필요합니다.', 400);
    const raw: string[] = [];
    const corrected: string[] = [];
    let previous = -1;
    for (const range of sentence.sourceRanges) {
      const segment = segments.find((s) => s.id === range.segmentId);
      if (
        !segment ||
        segment.speakerUserId !== sentence.speakerUserId ||
        segment.startOrder < previous
      )
        throw new DomainError('INVALID_INPUT', '문장 발화자 또는 순서가 올바르지 않습니다.', 400);
      previous = segment.startOrder;
      for (const [field, start, end] of [
        ['raw', range.rawStart, range.rawEnd],
        ['corrected', range.correctedStart, range.correctedEnd],
      ] as const) {
        const text = field === 'raw' ? segment.rawText! : segment.correctedText!;
        if (
          !Number.isInteger(start) ||
          !Number.isInteger(end) ||
          start < 0 ||
          end < start ||
          end > text.length
        )
          throw new DomainError('INVALID_INPUT', '문장 범위가 올바르지 않습니다.', 400);
        for (let i = start; i < end; i++) {
          if (/\s/u.test(text[i]!)) continue;
          const set = used.get(segment.id)![field];
          if (set.has(i))
            throw new DomainError('INVALID_INPUT', '원문을 중복으로 참조할 수 없습니다.', 400);
          set.add(i);
        }
      }
      raw.push(segment.rawText!.slice(range.rawStart, range.rawEnd));
      corrected.push(segment.correctedText!.slice(range.correctedStart, range.correctedEnd));
    }
    const first = segments.find((s) => s.id === sentence.sourceRanges[0]!.segmentId)!;
    const key = `${sentence.startOrder}:${sentence.sentenceIndex}`;
    if (
      sentence.startOrder !== first.startOrder ||
      keys.has(key) ||
      raw.join('\n') !== sentence.rawText ||
      corrected.join('\n') !== sentence.correctedText
    )
      throw new DomainError(
        'INVALID_INPUT',
        '문장 내용은 원문 범위와 정확히 일치해야 합니다.',
        400,
      );
    keys.add(key);
  }
  for (const segment of segments) {
    for (const [field, text] of [
      ['raw', segment.rawText!],
      ['corrected', segment.correctedText!],
    ] as const) {
      for (let i = 0; i < text.length; i++) {
        if (!/\s/u.test(text[i]!) && !used.get(segment.id)![field].has(i))
          throw new DomainError('INVALID_INPUT', '문장에서 원문 문자가 누락되었습니다.', 400);
      }
    }
  }
}
