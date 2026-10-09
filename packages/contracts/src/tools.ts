import { z } from 'zod';
import { IdSchema } from './dto.js';
const empty = z.strictObject({});
export const toolSchemas = {
  get_study_context: empty,
  start_study: z.strictObject({ focusUserId: IdSchema.nullable() }),
  close_topic: empty,
  advance_topic: z.strictObject({ focusUserId: IdSchema.nullable() }),
  finish_study: empty,
  explain_word: z.strictObject({ word: z.string().min(1), context: z.string().nullable() }),
  learn_expression: z.strictObject({ text: z.string().min(1), context: z.string().nullable() }),
  list_my_learning: z.strictObject({ query: z.string().nullable() }),
  request_sentence_feedback: z.strictObject({ utteranceId: IdSchema }),
} as const;
export type ToolName = keyof typeof toolSchemas;
export type ToolInput<K extends ToolName> = z.infer<(typeof toolSchemas)[K]>;
const descriptions: Record<ToolName, string> = {
  get_study_context: 'Read shared study state, participants and allowed actions.',
  start_study: 'Start the waiting study from participants saved experiences.',
  close_topic: 'Close current audio input and prepare sentence feedback for review.',
  advance_topic:
    'Approve reviewed feedback, save to each speaker and generate the next topic. Both next-topic request phrasings use this command.',
  finish_study:
    'Close a talking topic for review, or approve a reviewed final topic and end the study.',
  explain_word: 'Explain a word and save it privately for the requesting user.',
  learn_expression:
    'Teach an English expression, save it privately and propose explicit yes/no sharing.',
  list_my_learning: 'Read only the requesting user learning records.',
  request_sentence_feedback:
    'Request feedback for one utterance at its latest correction revision.',
};
/** Enforces the strict subset before the provider receives a schema. */
export function assertStrictToolSchema(value: unknown, path = '$'): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const schema = value as Record<string, unknown>;
  if (schema.type === 'object') {
    if (schema.additionalProperties !== false)
      throw new Error(`${path}: additionalProperties must be false`);
    const properties = schema.properties as Record<string, unknown> | undefined;
    const names = Object.keys(properties ?? {});
    if (
      !Array.isArray(schema.required) ||
      names.length !== schema.required.length ||
      names.some((name) => !(schema.required as unknown[]).includes(name))
    )
      throw new Error(`${path}: every property must be required`);
  }
  for (const [key, child] of Object.entries(schema)) {
    if (Array.isArray(child))
      child.forEach((item, index) => assertStrictToolSchema(item, `${path}.${key}[${index}]`));
    else if (child && typeof child === 'object') assertStrictToolSchema(child, `${path}.${key}`);
  }
}
export function strictToolDefinitions() {
  return (Object.keys(toolSchemas) as ToolName[]).map((name) => {
    const { $schema: _dialect, ...parameters } = z.toJSONSchema(toolSchemas[name]);
    // JSON Schema omits required for an empty object; strict function calling requires it.
    if (!('required' in parameters)) parameters.required = [];
    assertStrictToolSchema(parameters);
    return {
      type: 'function' as const,
      name,
      description: descriptions[name],
      parameters,
      strict: true as const,
    };
  });
}
