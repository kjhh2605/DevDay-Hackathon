import { sentenceSources, mapGroupSentenceRanges } from './group-sentences.js';
import { randomUUID } from 'node:crypto';
import type { AiJobs, ApplicationPorts } from '@devday/application-ports';
import { TopicContentSchema, type ApiError, type JobKind, type JobResult } from '@devday/contracts';
import type { AiProvider } from './provider.js';
import { PROMPTS } from './prompts.js';
import {
  assertGroundedExperience,
  ExperienceAnalysisSchema,
  FeedbackOutputSchema,
  jsonSchema,
  SentencePlanSchema,
  selectExperienceQuestions,
  TopicPlanSchema,
  validateTopicPlan,
} from './schemas.js';
import { runChat } from './chat.js';

export interface AudioCloser {
  flushTopic(topicId: string, closeId: string): Promise<void>;
}
export function publicAiError(error: unknown): ApiError {
  const timeout = error instanceof Error && /timeout|timed out/i.test(error.message);
  return {
    code: timeout ? 'TIMEOUT' : 'AI_FAILED',
    message: timeout
      ? 'AI 처리 시간이 초과되었습니다. 새 요청으로 다시 시도해 주세요.'
      : 'AI 처리에 실패했습니다. 새 요청으로 다시 시도해 주세요.',
    details: null,
  };
}
export async function withTimeout<T>(task: Promise<T>, milliseconds: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('AI timeout')), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function createAiJobs(
  ports: ApplicationPorts,
  provider: AiProvider,
  audio: AudioCloser,
): AiJobs {
  const active = new Map<string, Promise<void>>();
  function run(
    jobId: string,
    kind: JobKind,
    timeout: number,
    work: () => Promise<JobResult>,
  ): Promise<void> {
    const existing = active.get(jobId);
    if (existing) return existing;
    const task = (async () => {
      const job = await ports.jobs.read(jobId);
      if (job.status !== 'running') return;
      if (job.kind !== kind) throw new Error('JOB_KIND_MISMATCH');
      try {
        await ports.jobs.succeedIfRunning(jobId, await withTimeout(work(), timeout));
      } catch (error) {
        // The durable store terminates the job and its visible entity atomically.
        // A separate entity write here would leave the job open to late provider writes.
        await ports.jobs.failIfRunning(jobId, publicAiError(error));
      }
    })().finally(() => active.delete(jobId));
    active.set(jobId, task);
    return task;
  }
  const jobs: AiJobs = {
    generateTopic(jobId) {
      return run(jobId, 'topic.generate', 240_000, async () => {
        const context = await ports.topicContext.read(jobId);
        const experiences = context.experiences.filter(
          (experience) => !context.focusUserId || experience.ownerUserId === context.focusUserId,
        );
        if (
          !experiences.length &&
          !context.learningExpressions.length &&
          !context.sharedExpressions.length
        )
          throw new Error('CONTEXT_REQUIRED');
        const input = { ...context, experiences };
        const plan = TopicPlanSchema.parse(
          await provider.structured(
            'topic_plan',
            jsonSchema(TopicPlanSchema),
            PROMPTS.topic,
            input,
          ),
        );
        validateTopicPlan(plan, input);
        let imageMediaId: string | null = null;
        if (plan.kind === 'image') {
          const image = await provider.image(plan.imagePrompt!);
          if (!image.bytes.byteLength) throw new Error('EMPTY_IMAGE');
          if (!(await ports.jobs.isRunning(jobId))) throw new Error('JOB_EXPIRED');
          ({ mediaId: imageMediaId } = await ports.media.put({
            kind: 'image',
            studyId: context.studyId,
            bytes: image.bytes,
            contentType: image.contentType,
          }));
        }
        const { imagePrompt: _prompt, ...contentFields } = plan;
        const content = TopicContentSchema.parse({ ...contentFields, imageMediaId });
        if (!(await ports.studies.applyGeneratedTopic(jobId, content)))
          throw new Error('JOB_EXPIRED');
        return { topicId: context.topicId };
      });
    },
    prepareExperience(jobId) {
      return run(jobId, 'experience.prepare', 60_000, async () => {
        const input = await ports.jobs.readInput(jobId, 'experience.prepare');
        const analysis = ExperienceAnalysisSchema.parse(
          await provider.structured(
            'experience_analysis',
            jsonSchema(ExperienceAnalysisSchema),
            PROMPTS.experience,
            {
              originalText: input.originalText,
              answers: input.answers,
              skipQuestions: input.skipQuestions,
            },
          ),
        );
        assertGroundedExperience(analysis, input.originalText, input.answers);
        const draft = await ports.experiences.saveDraft(jobId, {
          originalText: input.originalText,
          answers: input.answers,
          questions: selectExperienceQuestions(analysis, input.skipQuestions),
          summary: analysis.summaryQuotes.join(' '),
          interests: analysis.interests,
          context: analysis.context,
        });
        if (!draft) throw new Error('JOB_EXPIRED');
        return { draft };
      });
    },
    feedback(jobId) {
      return run(jobId, 'utterance.feedback', 60_000, async () => {
        const utterance = await ports.feedback.readForJob(jobId);
        const input = await ports.jobs.readInput(jobId, 'utterance.feedback');
        if (input.correctionRevision !== utterance.correctionRevision)
          throw new Error('FEEDBACK_STALE');
        const result = FeedbackOutputSchema.parse(
          await provider.structured(
            'sentence_feedback',
            jsonSchema(FeedbackOutputSchema),
            PROMPTS.feedback,
            { correctedText: utterance.correctedText },
          ),
        );
        const applied = await ports.feedback.applyIfCurrent(jobId, {
          utteranceId: utterance.id,
          inputCorrectionRevision: input.correctionRevision,
          items: result.items.map((item) => ({ ...item, id: randomUUID() })),
          error: null,
        });
        if (!applied) throw new Error('FEEDBACK_STALE');
        return { utteranceId: utterance.id, inputCorrectionRevision: input.correctionRevision };
      });
    },
    closeTopic(jobId) {
      return run(jobId, 'topic.close', 180_000, async () => {
        const { topicId, closeId } = await ports.jobs.readInput(jobId, 'topic.close');
        await audio.flushTopic(topicId, closeId);
        const segments = await ports.speech.listSegments(topicId);
        const groups = await ports.speech.listGroups(topicId);
        if (
          segments.some(
            (segment) => segment.rawStatus !== 'ready' || segment.correctionStatus !== 'ready',
          )
        )
          throw new Error('INCOMPLETE_TRANSCRIPTION');
        let utterances;
        try {
          const sources = sentenceSources(segments, groups);
          const sourceInput = sources.map(
            ({ id, speakerUserId, startOrder, rawText, correctedText }) => ({
              id,
              speakerUserId,
              startOrder,
              rawText,
              correctedText,
            }),
          );
          const plan = sources.length
            ? SentencePlanSchema.parse(
                await provider.structured(
                  'sentence_ranges',
                  jsonSchema(SentencePlanSchema),
                  PROMPTS.sentences,
                  { segments: sourceInput },
                ),
              )
            : { sentences: [] };
          const sentences = mapGroupSentenceRanges(segments, groups, plan);
          if (!(await ports.jobs.isRunning(jobId))) throw new Error('JOB_EXPIRED');
          utterances = await ports.speech.finalizeSentences(topicId, sentences, jobId);
        } catch (error) {
          if (await ports.jobs.isRunning(jobId))
            await Promise.all(
              segments.map((segment) =>
                ports.speech.fail(segment.id, 'sentences', publicAiError(error), jobId),
              ),
            );
          throw error;
        }
        // Each sentence has its own revision-bound job; a failed sentence is visible for explicit retry in review.
        await Promise.all(
          utterances.map(async (utterance) => {
            const job = await ports.jobs.create({
              kind: 'utterance.feedback',
              scope: 'study',
              ownerUserId: null,
              studyId: utterance.studyId,
              targetId: utterance.id,
              input: {
                utteranceId: utterance.id,
                correctionRevision: utterance.correctionRevision,
                ownerUserId: utterance.speakerUserId,
              },
            });
            await jobs.feedback(job.id);
          }),
        );
        if (!(await ports.studies.completeClose(jobId))) throw new Error('CLOSE_NOT_READY');
        return { topicId, utteranceIds: utterances.map((utterance) => utterance.id) };
      });
    },
    chat(jobId) {
      return run(jobId, 'chat.respond', 180_000, () => runChat(jobId, ports, provider));
    },
  };
  return jobs;
}
