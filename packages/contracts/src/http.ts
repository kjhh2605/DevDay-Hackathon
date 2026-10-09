import { z } from 'zod';
import {
  ApiErrorSchema,
  ChatMessageSchema,
  CommandResultSchema,
  ExperienceAnswerSchema,
  ExperienceFieldsSchema,
  ExperienceSchema,
  HandleSchema,
  IdSchema,
  InvitationSchema,
  JobSchema,
  LearningItemSchema,
  RevisionSchema,
  ShareProposalSchema,
  SharedExpressionSchema,
  StudyCommandSchema,
  StudySchema,
  StudySnapshotSchema,
  UserSchema,
  UtteranceSchema,
  FeedbackSchema,
} from './dto.js';
const empty = z.strictObject({});
const idParams = z.strictObject({ id: IdSchema });
const studyParams = z.strictObject({ studyId: IdSchema });
const commandId = { commandId: IdSchema };
export const PrepareExperienceInputSchema = z.strictObject({
  originalText: z.string().min(1),
  answers: z.array(ExperienceAnswerSchema),
  skipQuestions: z.boolean(),
  ...commandId,
});
export const CreateExperienceInputSchema = ExperienceFieldsSchema.extend({
  draftId: IdSchema,
  ...commandId,
});
export const UpdateExperienceInputSchema = ExperienceFieldsSchema.extend(commandId);
export const CorrectionResultSchema = z.strictObject({
  utterance: UtteranceSchema,
  feedback: FeedbackSchema,
});
export const SendChatResultSchema = z.strictObject({ message: ChatMessageSchema, job: JobSchema });
export const ShareDecisionResultSchema = z.strictObject({
  proposal: ShareProposalSchema,
  sharedExpression: SharedExpressionSchema.nullable(),
});
function endpoint<P extends z.ZodType, I extends z.ZodType, O extends z.ZodType>(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  params: P,
  input: I,
  output: O,
) {
  return { method, path, params, input, output } as const;
}
export const endpointRegistry = {
  register: endpoint(
    'POST',
    '/auth/register',
    empty,
    z.strictObject({ displayName: z.string().trim().min(1).max(100), handle: HandleSchema }),
    UserSchema,
  ),
  me: endpoint('GET', '/me', empty, z.undefined(), UserSchema),
  resolveUsers: endpoint(
    'POST',
    '/users/resolve',
    empty,
    z.strictObject({ handles: z.array(HandleSchema) }),
    z.strictObject({ users: z.array(UserSchema), missingHandles: z.array(z.string()) }),
  ),
  invitations: endpoint('GET', '/me/invitations', empty, z.undefined(), z.array(InvitationSchema)),
  createStudy: endpoint(
    'POST',
    '/studies',
    empty,
    z.strictObject({ participantHandles: z.array(HandleSchema), ...commandId }),
    StudySchema,
  ),
  joinStudy: endpoint(
    'POST',
    '/studies/:studyId/join',
    studyParams,
    z.strictObject(commandId),
    StudySnapshotSchema,
  ),
  studySnapshot: endpoint(
    'GET',
    '/studies/:studyId',
    studyParams,
    z.undefined(),
    StudySnapshotSchema,
  ),
  studyCommand: endpoint(
    'POST',
    '/studies/:studyId/commands',
    studyParams,
    StudyCommandSchema,
    CommandResultSchema,
  ),
  updateCorrection: endpoint(
    'PATCH',
    '/utterances/:id/correction',
    idParams,
    z.strictObject({ text: z.string().min(1), ...commandId }),
    CorrectionResultSchema,
  ),
  requestFeedback: endpoint(
    'POST',
    '/utterances/:id/feedback',
    idParams,
    z.strictObject({ correctionRevision: RevisionSchema, ...commandId }),
    JobSchema,
  ),
  chatMessages: endpoint(
    'GET',
    '/studies/:studyId/chat/messages',
    studyParams,
    z.undefined(),
    z.array(ChatMessageSchema),
  ),
  sendChatMessage: endpoint(
    'POST',
    '/studies/:studyId/chat/messages',
    studyParams,
    z.strictObject({ text: z.string().trim().min(1), clientMessageId: IdSchema }),
    SendChatResultSchema,
  ),
  shareProposals: endpoint(
    'GET',
    '/studies/:studyId/share-proposals',
    studyParams,
    z.undefined(),
    z.array(ShareProposalSchema),
  ),
  decideShareProposal: endpoint(
    'POST',
    '/share-proposals/:id/decision',
    idParams,
    z.strictObject({ accepted: z.boolean(), ...commandId }),
    ShareDecisionResultSchema,
  ),
  learningItems: endpoint(
    'GET',
    '/me/learning-items',
    empty,
    z.undefined(),
    z.array(LearningItemSchema),
  ),
  experiences: endpoint('GET', '/me/experiences', empty, z.undefined(), z.array(ExperienceSchema)),
  prepareExperience: endpoint(
    'POST',
    '/me/experience-drafts/prepare',
    empty,
    PrepareExperienceInputSchema,
    JobSchema,
  ),
  createExperience: endpoint(
    'POST',
    '/me/experiences',
    empty,
    CreateExperienceInputSchema,
    ExperienceSchema,
  ),
  updateExperience: endpoint(
    'PATCH',
    '/me/experiences/:id',
    idParams,
    UpdateExperienceInputSchema,
    ExperienceSchema,
  ),
  job: endpoint('GET', '/jobs/:id', idParams, z.undefined(), JobSchema),
} as const;
export const endpoints = endpointRegistry;
export const mediaEndpoint = {
  method: 'GET',
  path: '/media/:id',
  params: idParams,
  response: 'image',
} as const;
export const API_BASE_PATH = '/api/v1';
export const ErrorEnvelopeSchema = z.strictObject({
  error: ApiErrorSchema,
  requestId: z.string().min(1),
});
export const successEnvelopeSchema = <S extends z.ZodType>(data: S) =>
  z.strictObject({ data, requestId: z.string().min(1) });
export type EndpointName = keyof typeof endpointRegistry;
export type EndpointInput<K extends EndpointName> = z.input<(typeof endpointRegistry)[K]['input']>;
export type EndpointParams<K extends EndpointName> = z.input<
  (typeof endpointRegistry)[K]['params']
>;
export type EndpointOutput<K extends EndpointName> = z.output<
  (typeof endpointRegistry)[K]['output']
>;
export type PrepareExperienceInput = z.infer<typeof PrepareExperienceInputSchema>;
export type CreateExperienceInput = z.infer<typeof CreateExperienceInputSchema>;
export type UpdateExperienceInput = z.infer<typeof UpdateExperienceInputSchema>;
