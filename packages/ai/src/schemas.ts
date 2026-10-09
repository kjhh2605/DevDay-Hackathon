import { z } from 'zod';
import { ExperienceContextSchema, FeedbackItemSchema } from '@devday/contracts';

export const FeedbackOutputSchema = z.strictObject({
  items: z.array(FeedbackItemSchema.omit({ id: true })).max(6),
});
export const ExperienceAnalysisSchema = z.strictObject({
  questions: z.array(z.string().min(1)).max(3),
  summaryQuotes: z.array(z.string().min(1)).min(1),
  interests: z.array(z.string().min(1)),
  context: ExperienceContextSchema,
});
export const TopicPlanSchema = z.strictObject({
  kind: z.enum(['image', 'sentence']),
  title: z.string().min(1),
  situationText: z.string().min(1),
  conversationInstruction: z.string().min(1),
  sentence: z.string().nullable(),
  sourceExperienceIds: z.array(z.uuid()),
  learningExpressionIds: z.array(z.uuid()),
  sharedExpressionIds: z.array(z.uuid()),
  imagePrompt: z.string().nullable(),
});
export const SentencePlanSchema = z.strictObject({
  sentences: z.array(
    z.strictObject({
      slices: z
        .array(
          z.strictObject({
            segmentId: z.uuid(),
            rawSlice: z.string(),
            correctedSlice: z.string(),
          }),
        )
        .min(1),
    }),
  ),
});

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _meta, ...json } = z.toJSONSchema(schema);
  return json;
}
export function assertGroundedExperience(
  analysis: z.infer<typeof ExperienceAnalysisSchema>,
  originalText: string,
  answers: { answer: string }[],
): void {
  const sources = [originalText, ...answers.map((answer) => answer.answer)];
  const facts = [
    ...analysis.summaryQuotes,
    ...analysis.interests,
    ...analysis.context.people,
    ...analysis.context.actions,
    ...(analysis.context.place ? [analysis.context.place] : []),
    ...(analysis.context.event ? [analysis.context.event] : []),
  ];
  if (facts.some((fact) => !sources.some((source) => source.includes(fact)))) {
    throw new Error('UNGROUNDED_EXPERIENCE: factual fields must quote the user source');
  }
}

/** Questions fill missing situation facts; they are not an invitation to embellish a complete record. */
export function selectExperienceQuestions(
  analysis: z.infer<typeof ExperienceAnalysisSchema>,
  skipQuestions: boolean,
): string[] {
  const { place, people, event, actions } = analysis.context;
  const hasSetting = Boolean(place?.trim());
  const hasPeople = people.some((person) => person.trim().length > 0);
  const hasActivity = Boolean(event?.trim()) || actions.some((action) => action.trim().length > 0);
  // Called only after exact-source grounding has succeeded. A stated place, participants and
  // event/activity already provide a concrete situation for conversation and image planning.
  if (skipQuestions || (hasSetting && hasPeople && hasActivity)) return [];
  return analysis.questions;
}

export function validateTopicPlan(
  plan: z.infer<typeof TopicPlanSchema>,
  context: {
    experiences: { id: string; ownerUserId: string }[];
    learningExpressions: { id: string }[];
    sharedExpressions: { id: string }[];
    focusUserId: string | null;
  },
): void {
  const experiences = context.experiences.filter(
    (e) => !context.focusUserId || e.ownerUserId === context.focusUserId,
  );
  const hasAll = (ids: string[], allowed: { id: string }[]) =>
    ids.every((id) => allowed.some((item) => item.id === id)) && new Set(ids).size === ids.length;
  if (
    !hasAll(plan.sourceExperienceIds, experiences) ||
    !hasAll(plan.learningExpressionIds, context.learningExpressions) ||
    !hasAll(plan.sharedExpressionIds, context.sharedExpressions)
  )
    throw new Error('UNKNOWN_TOPIC_SOURCE');
  const expressionCount = plan.learningExpressionIds.length + plan.sharedExpressionIds.length;
  if (
    plan.kind === 'image' &&
    (!plan.sourceExperienceIds.length || !plan.imagePrompt?.trim() || plan.sentence !== null)
  )
    throw new Error('IMAGE_REQUIRES_EXPERIENCE');
  if (
    plan.kind === 'sentence' &&
    (!plan.sentence?.trim() || plan.imagePrompt !== null || !expressionCount)
  )
    throw new Error('SENTENCE_REQUIRES_EXPRESSION');
  if ((context.learningExpressions.length || context.sharedExpressions.length) && !expressionCount)
    throw new Error('TOPIC_OMITTED_LEARNING_EXPRESSIONS');
}
