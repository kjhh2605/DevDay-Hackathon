import { z } from 'zod';
import { ApiErrorSchema, IdSchema, RevisionSchema, TimestampSchema } from './dto.js';
const streamId = { streamId: IdSchema };
const segment = { ...streamId, clientSegmentId: IdSchema };
const ping = z.strictObject({ type: z.literal('heartbeat.ping') });
const pong = z.strictObject({ type: z.literal('heartbeat.pong') });
export const AudioClientMessageSchema = z
  .discriminatedUnion('type', [
    z.strictObject({
      type: z.literal('audio.start'),
      topicId: IdSchema,
      clientStreamId: IdSchema,
      resumeStreamId: IdSchema.optional(),
      format: z.literal('pcm16'),
      sampleRate: z.literal(24000),
      channels: z.literal(1),
    }),
    z.strictObject({
      type: z.literal('audio.segment_start'),
      ...segment,
      startedAt: TimestampSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('audio.chunk'),
      ...segment,
      seq: RevisionSchema,
      pcmBase64: z
        .string()
        .min(1)
        .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
    }),
    z.strictObject({
      type: z.literal('audio.segment_commit'),
      ...segment,
      lastSeq: RevisionSchema,
      lastVoicedSample: RevisionSchema.optional(),
    }),
    z.strictObject({
      type: z.literal('audio.flush'),
      ...streamId,
      closeId: IdSchema,
      lastSegmentId: IdSchema.nullable(),
      lastSeq: RevisionSchema.nullable(),
    }),
    z.strictObject({ type: z.literal('audio.stop'), ...streamId }),
    ping,
    pong,
  ])
  .refine(
    (message) =>
      message.type !== 'audio.flush' ||
      (message.lastSegmentId === null) === (message.lastSeq === null),
    'Flush last segment and sequence must both be null or present',
  );
export const AudioServerMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('audio.ready'), ...streamId, topicId: IdSchema }),
  z.strictObject({
    type: z.literal('audio.segment_ready'),
    clientSegmentId: IdSchema,
    segmentId: IdSchema,
    startOrder: RevisionSchema,
  }),
  z.strictObject({
    type: z.literal('audio.segment_committed'),
    clientSegmentId: IdSchema,
    segmentId: IdSchema,
    lastSeq: RevisionSchema,
  }),
  z.strictObject({ type: z.literal('audio.flushed'), ...streamId, closeId: IdSchema }),
  z.strictObject({
    type: z.literal('audio.processing_error'),
    groupId: IdSchema.nullable(),
    segmentId: IdSchema.nullable(),
    error: ApiErrorSchema,
  }),
  z.strictObject({ type: z.literal('audio.error'), error: ApiErrorSchema, requestId: z.string() }),
  ping,
  pong,
]);
export type AudioClientMessage = z.infer<typeof AudioClientMessageSchema>;
export type AudioServerMessage = z.infer<typeof AudioServerMessageSchema>;
