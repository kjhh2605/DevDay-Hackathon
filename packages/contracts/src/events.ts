import { z } from 'zod';
import {
  ApiErrorSchema,
  ChatMessageSchema,
  ExperienceDraftSchema,
  FeedbackSchema,
  IdSchema,
  InvitationSchema,
  JobSchema,
  RevisionSchema,
  ShareProposalSchema,
  SharedExpressionSchema,
  StudySchema,
  StudySnapshotSchema,
  TimestampSchema,
  TopicSchema,
  TranscriptSegmentSchema,
  UtteranceSchema,
} from './dto.js';
const envelope = {
  version: z.literal(1),
  eventId: IdSchema,
  studyId: IdSchema.nullable(),
  entityId: IdSchema,
  entityRevision: RevisionSchema,
  occurredAt: TimestampSchema,
};
function studyEvent<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({
    ...envelope,
    studyId: IdSchema,
    type: z.literal(type),
    scope: z.literal('study'),
    payload,
  });
}
function userEvent<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ ...envelope, type: z.literal(type), scope: z.literal('user'), payload });
}
export const eventSchemas = {
  'invitation.created': userEvent('invitation.created', InvitationSchema),
  'study.changed': studyEvent(
    'study.changed',
    z.strictObject({ study: StudySchema, topic: TopicSchema.nullable(), jobs: z.array(JobSchema) }),
  ),
  'transcript.partial': studyEvent(
    'transcript.partial',
    z.strictObject({
      segmentId: IdSchema,
      speakerUserId: IdSchema,
      startOrder: RevisionSchema,
      partialText: z.string(),
      partialRevision: RevisionSchema,
    }),
  ),
  'transcript.segment.updated': studyEvent('transcript.segment.updated', TranscriptSegmentSchema),
  'utterance.updated': studyEvent('utterance.updated', UtteranceSchema),
  'feedback.updated': studyEvent('feedback.updated', FeedbackSchema),
  'audio.flush_requested': userEvent(
    'audio.flush_requested',
    z.strictObject({ topicId: IdSchema, closeId: IdSchema }),
  ),
  'job.updated': z.strictObject({
    ...envelope,
    type: z.literal('job.updated'),
    scope: z.enum(['user', 'study']),
    payload: JobSchema,
  }),
  'shared-expression.added': studyEvent('shared-expression.added', SharedExpressionSchema),
  'chat.message.updated': userEvent('chat.message.updated', ChatMessageSchema),
  'share-proposal.updated': userEvent('share-proposal.updated', ShareProposalSchema),
  'learning-items.changed': userEvent(
    'learning-items.changed',
    z.strictObject({ itemIds: z.array(IdSchema) }),
  ),
  'experience-draft.ready': userEvent('experience-draft.ready', ExperienceDraftSchema),
} as const;
export const EventSchema = z
  .discriminatedUnion('type', [
    eventSchemas['invitation.created'],
    eventSchemas['study.changed'],
    eventSchemas['transcript.partial'],
    eventSchemas['transcript.segment.updated'],
    eventSchemas['utterance.updated'],
    eventSchemas['feedback.updated'],
    eventSchemas['audio.flush_requested'],
    eventSchemas['job.updated'],
    eventSchemas['shared-expression.added'],
    eventSchemas['chat.message.updated'],
    eventSchemas['share-proposal.updated'],
    eventSchemas['learning-items.changed'],
    eventSchemas['experience-draft.ready'],
  ])
  .superRefine((event, ctx) => {
    const entity = event.type === 'study.changed' ? event.payload.study : event.payload;
    if ('id' in entity && entity.id !== event.entityId)
      ctx.addIssue({ code: 'custom', message: 'Event entity ID must match its payload' });
    if (event.type === 'feedback.updated' && event.payload.utteranceId !== event.entityId)
      ctx.addIssue({ code: 'custom', message: 'Feedback event must reference its utterance' });
    if (
      event.type === 'study.changed' &&
      (event.payload.study.revision !== event.entityRevision ||
        event.payload.study.id !== event.studyId ||
        event.payload.study.currentTopicId !== (event.payload.topic?.id ?? null))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Study event must describe the same study revision and current topic',
      });
    if ('revision' in event.payload && event.payload.revision !== event.entityRevision)
      ctx.addIssue({ code: 'custom', message: 'Event revision must match the entity revision' });
    if (
      event.type === 'study.changed' &&
      event.payload.jobs.some((job) => job.scope !== 'study' || job.studyId !== event.studyId)
    )
      ctx.addIssue({ code: 'custom', message: 'Study changes cannot expose private jobs' });
    if (
      event.type === 'job.updated' &&
      (event.scope !== event.payload.scope || event.studyId !== event.payload.studyId)
    )
      ctx.addIssue({ code: 'custom', message: 'Job event scope must match payload' });
  });
export const EventClientMessageSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('study.subscribe'), studyId: IdSchema }),
  z.strictObject({ type: z.literal('heartbeat.ping') }),
  z.strictObject({ type: z.literal('heartbeat.pong') }),
]);
export const StudySnapshotMessageSchema = z
  .strictObject({
    type: z.literal('study.snapshot'),
    studyId: IdSchema,
    snapshot: StudySnapshotSchema,
  })
  .refine(
    (message) => message.studyId === message.snapshot.study.id,
    'Snapshot study ID must match subscription',
  );
export const EventServerMessageSchema = z.union([
  EventSchema,
  StudySnapshotMessageSchema,
  z.strictObject({ type: z.literal('heartbeat.ping') }),
  z.strictObject({ type: z.literal('heartbeat.pong') }),
  z.strictObject({ type: z.literal('error'), error: ApiErrorSchema, requestId: z.string() }),
]);
export const eventNames = Object.keys(eventSchemas) as (keyof typeof eventSchemas)[];
export type DomainEvent = z.infer<typeof EventSchema>;
export type Event = DomainEvent;
export type EventName = DomainEvent['type'];
export type EventClientMessage = z.infer<typeof EventClientMessageSchema>;
export type EventServerMessage = z.infer<typeof EventServerMessageSchema>;
export type StudySnapshotMessage = z.infer<typeof StudySnapshotMessageSchema>;
