import {
  bigint,
  bigserial,
  boolean,
  index,
  integer,
  pgTable,
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
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
    revision: bigint('revision', { mode: 'number' }).default(0),
    activeRunId: varchar('active_run_id', { length: 64 }).default(''),
    activeRunStartedAt: bigint('active_run_started_at', {
      mode: 'number',
    }).default(0),
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    conversationId: bigint('conversation_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    parentMessageId: bigint('parent_message_id', { mode: 'number' }).default(0),
    role: varchar('role', { length: 32 }).notNull(),
    content: text('content').default(''),
    contentJson: text('content_json').default(''),
    model: varchar('model', { length: 191 }).default(''),
    toolJson: text('tool_json').default(''),
    clientKey: varchar('client_key', { length: 64 }).default(''),
    source: varchar('source', { length: 20 }).default(''),
    status: varchar('status', { length: 20 }).default(''),
    activeRevision: integer('active_revision').default(0),
    seq: integer('seq').notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).default(0),
  },
  (table) => [
    index('idx_playground_messages_conversation_id').on(table.conversationId),
    index('idx_playground_messages_user_id').on(table.userId),
    index('idx_playground_messages_parent_message_id').on(
      table.parentMessageId
    ),
  ]
)

export const messageRevisions = pgTable(
  'playground_message_revisions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    messageId: bigint('message_id', { mode: 'number' }).notNull(),
    conversationId: bigint('conversation_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    revision: integer('revision').notNull(),
    content: text('content').default(''),
    contentJson: text('content_json').default(''),
    model: varchar('model', { length: 191 }).default(''),
    toolJson: text('tool_json').default(''),
    status: varchar('status', { length: 20 }).default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_pg_message_revision').on(table.messageId, table.revision),
    index('idx_playground_message_revisions_conversation_id').on(
      table.conversationId
    ),
    index('idx_playground_message_revisions_user_id').on(table.userId),
  ]
)

export const agentRuns = pgTable(
  'playground_agent_runs',
  {
    id: varchar('id', { length: 64 }).primaryKey(),
    conversationId: bigint('conversation_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    requestKey: varchar('request_key', { length: 64 }).notNull(),
    operation: varchar('operation', { length: 32 }).notNull(),
    userMessageId: bigint('user_message_id', { mode: 'number' }).default(0),
    assistantMessageId: bigint('assistant_message_id', {
      mode: 'number',
    }).default(0),
    baseRevision: bigint('base_revision', { mode: 'number' }).default(0),
    status: varchar('status', { length: 20 }).notNull(),
    errorMessage: text('error_message').default(''),
    leaseExpiresAt: bigint('lease_expires_at', { mode: 'number' }).default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('idx_pg_agent_request').on(table.userId, table.requestKey),
    index('idx_playground_agent_runs_conversation_id').on(table.conversationId),
    index('idx_playground_agent_runs_status').on(table.status),
    index('idx_playground_agent_runs_lease_expires_at').on(
      table.leaseExpiresAt
    ),
  ]
)

export const userMemories = pgTable(
  'playground_user_memories',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    content: text('content').default(''),
    category: varchar('category', { length: 32 }).default(''),
    sourceConversationId: bigint('source_conversation_id', {
      mode: 'number',
    }).default(0),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_user_memories_user_id').on(table.userId)]
)

export const personas = pgTable(
  'playground_personas',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    projectId: bigint('project_id', { mode: 'number' }).default(0),
    modality: varchar('modality', { length: 20 }).notNull(),
    model: varchar('model', { length: 191 }).default(''),
    prompt: text('prompt').default(''),
    resultUrl: varchar('result_url', { length: 1024 }).default(''),
    assetId: bigint('asset_id', { mode: 'number' }).default(0),
    quota: integer('quota').default(0),
    taskId: varchar('task_id', { length: 191 }).default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_runs_user_id').on(table.userId)]
)

export const voices = pgTable(
  'playground_voices',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    name: varchar('name', { length: 128 }).notNull(),
    assetId: bigint('asset_id', { mode: 'number' }).default(0),
    providerVoiceId: varchar('provider_voice_id', { length: 191 }).default(''),
    status: varchar('status', { length: 40 }).default(''),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_voices_user_id').on(table.userId)]
)

export const agents = pgTable(
  'playground_agents',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    doc: text('doc').default(''),
    cover: varchar('cover', { length: 500 }).default(''),
    // Legacy inspiration-canvas columns kept NOT NULL by the original
    // migration; writes must keep populating them.
    snapshot: text('snapshot').notNull(),
    revision: integer('revision').notNull(),
    inspirationTemplateId: bigint('inspiration_template_id', {
      mode: 'number',
    }).notNull(),
    inspirationVersionId: bigint('inspiration_version_id', {
      mode: 'number',
    }).notNull(),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [index('idx_playground_canvas_projects_user_id').on(table.userId)]
)

export const canvasVersions = pgTable(
  'playground_canvas_versions',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectId: bigint('project_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
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
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    projectId: bigint('project_id', { mode: 'number' }).notNull(),
    userId: bigint('user_id', { mode: 'number' }).notNull(),
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
