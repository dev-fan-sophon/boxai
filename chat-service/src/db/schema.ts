import {
  bigint,
  boolean,
  index,
  integer,
  pgTable,
  serial,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core'

/**
 * These tables were created by the gateway's GORM AutoMigrate and their
 * ownership transferred to boxai-chat as-is: same names, same columns, same
 * ids. Transferring ownership instead of copying data keeps conversation ids
 * stable for everything that references them (canvas share links, document
 * sandbox keys, build history) and makes rollback a route change.
 */

export const conversations = pgTable(
  'playground_conversations',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    title: varchar('title', { length: 255 }).default(''),
    model: varchar('model', { length: 191 }).default(''),
    group: varchar('group', { length: 50 }).default(''),
    kind: varchar('kind', { length: 20 }).default(''),
    metaJson: text('meta_json').default(''),
    pinned: boolean('pinned').default(false),
    source: varchar('source', { length: 20 }).default(''),
    summary: text('summary').default(''),
    summaryTailKey: varchar('summary_tail_key', { length: 64 }).default(''),
    summarySeq: integer('summary_seq'),
    memorySeq: integer('memory_seq'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_playground_conversations_user_id').on(table.userId),
    index('idx_playground_conversations_updated_at').on(table.updatedAt),
  ]
)

export const messages = pgTable(
  'playground_messages',
  {
    id: serial('id').primaryKey(),
    conversationId: integer('conversation_id').notNull(),
    userId: integer('user_id').notNull(),
    role: varchar('role', { length: 32 }).notNull(),
    content: text('content').default(''),
    contentJson: text('content_json').default(''),
    model: varchar('model', { length: 191 }).default(''),
    toolJson: text('tool_json').default(''),
    clientKey: varchar('client_key', { length: 64 }).default(''),
    source: varchar('source', { length: 20 }).default(''),
    seq: integer('seq').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_playground_messages_conversation_id').on(table.conversationId),
    index('idx_playground_messages_user_id').on(table.userId),
  ]
)

export const userMemories = pgTable(
  'playground_user_memories',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    content: text('content').default(''),
    category: varchar('category', { length: 32 }).default(''),
    sourceConversationId: integer('source_conversation_id').default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_user_memories_user_id').on(table.userId)]
)

export const personas = pgTable(
  'playground_personas',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    systemPrompt: text('system_prompt').default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_personas_user_id').on(table.userId)]
)

export const projects = pgTable(
  'playground_projects',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    modality: varchar('modality', { length: 20 }).notNull(),
    title: varchar('title', { length: 255 }).default(''),
    model: varchar('model', { length: 191 }).default(''),
    group: varchar('group', { length: 50 }).default(''),
    clientKey: varchar('client_key', { length: 64 }).default(''),
    lastPrompt: text('last_prompt').default(''),
    previewUrls: text('preview_urls').default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_projects_user_id').on(table.userId)]
)

export const runs = pgTable(
  'playground_runs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    projectId: integer('project_id').default(0),
    modality: varchar('modality', { length: 20 }).notNull(),
    model: varchar('model', { length: 191 }).default(''),
    prompt: text('prompt').default(''),
    resultUrl: varchar('result_url', { length: 1024 }).default(''),
    assetId: integer('asset_id').default(0),
    quota: integer('quota').default(0),
    taskId: varchar('task_id', { length: 191 }).default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_runs_user_id').on(table.userId)]
)

export const voices = pgTable(
  'playground_voices',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    assetId: integer('asset_id').default(0),
    providerVoiceId: varchar('provider_voice_id', { length: 191 }).default(''),
    status: varchar('status', { length: 40 }).default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_voices_user_id').on(table.userId)]
)

export const agents = pgTable(
  'playground_agents',
  {
    id: serial('id').primaryKey(),
    slug: varchar('slug', { length: 64 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description').default(''),
    category: varchar('category', { length: 64 }).default(''),
    icon: varchar('icon', { length: 64 }).default(''),
    actionType: varchar('action_type', { length: 20 }).default(''),
    actionValue: varchar('action_value', { length: 255 }).default(''),
    actionPrompt: text('action_prompt').default(''),
    accent: varchar('accent', { length: 128 }).default(''),
    sortOrder: integer('sort_order').default(0),
    enabled: boolean('enabled').default(false),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [uniqueIndex('idx_playground_agents_slug').on(table.slug)]
)

export const canvasProjects = pgTable(
  'playground_canvas_projects',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    doc: text('doc').default(''),
    cover: varchar('cover', { length: 500 }).default(''),
    // Legacy inspiration-canvas columns kept NOT NULL by the original
    // migration; writes must keep populating them.
    snapshot: text('snapshot').notNull(),
    revision: integer('revision').notNull(),
    inspirationTemplateId: integer('inspiration_template_id').notNull(),
    inspirationVersionId: integer('inspiration_version_id').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_canvas_projects_user_id').on(table.userId)]
)

export const canvasVersions = pgTable(
  'playground_canvas_versions',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull(),
    userId: integer('user_id').notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    doc: text('doc').default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    index('idx_playground_canvas_versions_project_id').on(table.projectId),
  ]
)

export const canvasShares = pgTable(
  'playground_canvas_shares',
  {
    id: serial('id').primaryKey(),
    projectId: integer('project_id').notNull(),
    userId: integer('user_id').notNull(),
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
    revokedAt: bigint('revoked_at', { mode: 'number' }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_playground_canvas_shares_project_id').on(table.projectId),
    uniqueIndex('idx_playground_canvas_shares_token_hash').on(table.tokenHash),
  ]
)
