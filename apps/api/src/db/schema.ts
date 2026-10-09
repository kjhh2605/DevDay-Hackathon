import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  primaryKey,
  uniqueIndex,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
const dto = () => jsonb('data').notNull();
export const users = pgTable('users', {
  id: uuid().primaryKey(),
  handle: text().notNull().unique(),
  data: dto(),
});
export const userSessions = pgTable('user_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});
export const studies = pgTable('studies', { id: uuid().primaryKey(), data: dto() });
export const studyMembers = pgTable(
  'study_members',
  {
    studyId: uuid('study_id')
      .references(() => studies.id)
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id)
      .notNull(),
    state: text().notNull(),
    inviterUserId: uuid('inviter_user_id')
      .references(() => users.id)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.studyId, t.userId] })],
);
export const experiences = pgTable('experiences', {
  id: uuid().primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .references(() => users.id)
    .notNull(),
  data: dto(),
});
export const experienceDrafts = pgTable('experience_drafts', {
  id: uuid().primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .references(() => users.id)
    .notNull(),
  data: dto(),
});
export const topics = pgTable(
  'topics',
  {
    id: uuid().primaryKey(),
    studyId: uuid('study_id')
      .references(() => studies.id)
      .notNull(),
    ordinal: integer().notNull(),
    data: dto(),
    generationInput: jsonb('generation_input'),
  },
  (t) => [uniqueIndex('topics_study_ordinal').on(t.studyId, t.ordinal)],
);
export const transcriptSegments = pgTable(
  'transcript_segments',
  {
    id: uuid().primaryKey(),
    studyId: uuid('study_id')
      .references(() => studies.id)
      .notNull(),
    topicId: uuid('topic_id')
      .references(() => topics.id)
      .notNull(),
    speakerUserId: uuid('speaker_user_id')
      .references(() => users.id)
      .notNull(),
    startOrder: integer('start_order').notNull(),
    data: dto(),
  },
  (t) => [uniqueIndex('segments_topic_order').on(t.topicId, t.startOrder)],
);
export const utterances = pgTable('utterances', {
  id: uuid().primaryKey(),
  studyId: uuid('study_id')
    .references(() => studies.id)
    .notNull(),
  topicId: uuid('topic_id')
    .references(() => topics.id)
    .notNull(),
  speakerUserId: uuid('speaker_user_id')
    .references(() => users.id)
    .notNull(),
  data: dto(),
});
export const feedback = pgTable('feedback', {
  id: uuid()
    .primaryKey()
    .references(() => utterances.id),
  data: dto(),
});
export const learningItems = pgTable(
  'learning_items',
  {
    id: uuid().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .references(() => users.id)
      .notNull(),
    sourceKey: text('source_key').notNull(),
    data: dto(),
  },
  (t) => [uniqueIndex('learning_owner_source').on(t.ownerUserId, t.sourceKey)],
);
export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey(),
    kind: text().notNull(),
    targetId: uuid('target_id').notNull(),
    status: text().notNull(),
    data: dto(),
    input: jsonb(),
  },
  (t) => [
    uniqueIndex('jobs_active_generation')
      .on(t.targetId)
      .where(sql`${t.kind} = 'topic.generate' and ${t.status} = 'running'`),
  ],
);
export const chatMessages = pgTable(
  'chat_messages',
  {
    id: uuid().primaryKey(),
    ownerUserId: uuid('owner_user_id')
      .references(() => users.id)
      .notNull(),
    studyId: uuid('study_id')
      .references(() => studies.id)
      .notNull(),
    clientMessageId: uuid('client_message_id'),
    data: dto(),
    context: jsonb(),
    jobId: uuid('job_id').references(() => jobs.id),
  },
  (t) => [uniqueIndex('chat_owner_client').on(t.ownerUserId, t.clientMessageId)],
);
export const shareProposals = pgTable('share_proposals', {
  id: uuid().primaryKey(),
  ownerUserId: uuid('owner_user_id')
    .references(() => users.id)
    .notNull(),
  studyId: uuid('study_id')
    .references(() => studies.id)
    .notNull(),
  learningItemId: uuid('learning_item_id')
    .references(() => learningItems.id)
    .notNull()
    .unique(),
  data: dto(),
});
export const sharedExpressions = pgTable('shared_expressions', {
  id: uuid().primaryKey(),
  studyId: uuid('study_id')
    .references(() => studies.id)
    .notNull(),
  sourceProposalId: uuid('source_proposal_id')
    .references(() => shareProposals.id)
    .notNull()
    .unique(),
  data: dto(),
});
export const commandReceipts = pgTable(
  'command_receipts',
  {
    actorUserId: uuid('actor_user_id')
      .references(() => users.id)
      .notNull(),
    commandId: uuid('command_id').notNull(),
    route: text().notNull(),
    payload: jsonb().notNull(),
    result: jsonb().notNull(),
  },
  (t) => [primaryKey({ columns: [t.actorUserId, t.commandId] })],
);
export const media = pgTable('media', {
  id: uuid().primaryKey(),
  studyId: uuid('study_id')
    .references(() => studies.id)
    .notNull(),
  segmentId: uuid('segment_id').references(() => transcriptSegments.id),
  kind: text().notNull(),
  storageKey: text('storage_key').notNull(),
  contentType: text('content_type').notNull(),
});

export const speechGroups = pgTable(
  'speech_groups',
  {
    id: uuid().primaryKey(),
    studyId: uuid('study_id')
      .references(() => studies.id)
      .notNull(),
    topicId: uuid('topic_id')
      .references(() => topics.id)
      .notNull(),
    speakerUserId: uuid('speaker_user_id')
      .references(() => users.id)
      .notNull(),
    startOrder: integer('start_order').notNull(),
    data: dto(),
  },
  (t) => [
    uniqueIndex('speech_groups_open_speaker')
      .on(t.topicId, t.speakerUserId)
      .where(
        sql`${t.data}->>'state' IN ('collecting','deciding') AND ${t.data}->>'closeReason' IS NULL`,
      ),
  ],
);
