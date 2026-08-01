import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'bun:test'

import postgres from 'postgres'

const databaseUrl = process.env.AGENT_HISTORY_TEST_DATABASE_URL
const integrationTest = databaseUrl ? describe : describe.skip
const sql = databaseUrl ? postgres(databaseUrl, { max: 1 }) : null

type AgentHistory = typeof import('./agent-history')
let history: AgentHistory

integrationTest('agent history PostgreSQL transactions', () => {
  beforeAll(async () => {
    if (!sql || !databaseUrl) return
    process.env.DATABASE_URL = databaseUrl
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS playground_conversations (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        title VARCHAR(255) DEFAULT '',
        model VARCHAR(191) DEFAULT '',
        "group" VARCHAR(50) DEFAULT '',
        kind VARCHAR(20) DEFAULT '',
        meta_json TEXT DEFAULT '',
        pinned BOOLEAN DEFAULT FALSE,
        source VARCHAR(20) DEFAULT '',
        summary TEXT DEFAULT '',
        summary_tail_key VARCHAR(64) DEFAULT '',
        summary_seq INTEGER DEFAULT 0,
        memory_seq INTEGER DEFAULT 0,
        revision BIGINT DEFAULT 0,
        active_run_id VARCHAR(64) DEFAULT '',
        active_run_started_at BIGINT DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS playground_messages (
        id BIGSERIAL PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        parent_message_id BIGINT DEFAULT 0,
        role VARCHAR(32) NOT NULL,
        content TEXT DEFAULT '',
        content_json TEXT DEFAULT '',
        model VARCHAR(191) DEFAULT '',
        tool_json TEXT DEFAULT '',
        client_key VARCHAR(64) DEFAULT '',
        source VARCHAR(20) DEFAULT '',
        status VARCHAR(20) DEFAULT '',
        active_revision INTEGER DEFAULT 0,
        seq INTEGER NOT NULL,
        created_at BIGINT NOT NULL,
        updated_at BIGINT DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS playground_message_revisions (
        id BIGSERIAL PRIMARY KEY,
        message_id BIGINT NOT NULL,
        conversation_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        revision INTEGER NOT NULL,
        content TEXT DEFAULT '',
        content_json TEXT DEFAULT '',
        model VARCHAR(191) DEFAULT '',
        tool_json TEXT DEFAULT '',
        status VARCHAR(20) DEFAULT '',
        created_at BIGINT NOT NULL,
        UNIQUE(message_id, revision)
      );
      CREATE TABLE IF NOT EXISTS playground_agent_runs (
        id VARCHAR(64) PRIMARY KEY,
        conversation_id BIGINT NOT NULL,
        user_id BIGINT NOT NULL,
        request_key VARCHAR(64) NOT NULL,
        operation VARCHAR(32) NOT NULL,
        user_message_id BIGINT DEFAULT 0,
        assistant_message_id BIGINT DEFAULT 0,
        base_revision BIGINT DEFAULT 0,
        status VARCHAR(20) NOT NULL,
        error_message TEXT DEFAULT '',
        lease_expires_at BIGINT DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL,
        UNIQUE(user_id, request_key)
      );
      CREATE TABLE IF NOT EXISTS playground_user_memories (
        id BIGSERIAL PRIMARY KEY,
        user_id BIGINT NOT NULL,
        content TEXT DEFAULT '',
        category VARCHAR(32) DEFAULT '',
        source_conversation_id BIGINT DEFAULT 0,
        created_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      );
    `)
    history = await import('./agent-history')
  })

  beforeEach(async () => {
    if (!sql) return
    await sql.unsafe(`
      TRUNCATE playground_message_revisions,
        playground_agent_runs,
        playground_messages,
        playground_user_memories,
        playground_conversations RESTART IDENTITY
    `)
  })

  afterAll(async () => {
    await sql?.end()
  })

  async function createConversation(): Promise<number> {
    if (!sql) throw new Error('integration database is unavailable')
    const now = Math.floor(Date.now() / 1000)
    const rows = await sql<{ id: number }[]>`
      INSERT INTO playground_conversations
        (user_id, title, model, "group", kind, created_at, updated_at)
      VALUES (7, 'test', 'test-model', 'default', 'chat', ${now}, ${now})
      RETURNING id
    `
    return Number(rows[0]!.id)
  }

  test('serializes appends and keeps request keys idempotent', async () => {
    if (!sql) return
    const conversationId = await createConversation()
    const requestKey = crypto.randomUUID()
    const started = await history.startAgentRun({
      conversationId,
      userId: 7,
      trigger: 'submit-message',
      incoming: {
        content: 'hello',
        contentJson: JSON.stringify([{ type: 'text', text: 'hello' }]),
        clientKey: 'u1',
      },
      requestKey,
      model: 'test-model',
    })
    expect(started.operation).toBe('append')

    await expect(
      history.startAgentRun({
        conversationId,
        userId: 7,
        trigger: 'submit-message',
        incoming: { content: 'racing', clientKey: 'u2' },
        requestKey: crypto.randomUUID(),
        model: 'test-model',
      })
    ).rejects.toThrow('another response is still generating')

    const finished = await history.finishAgentRun(started.runId, 7, {
      content: 'world',
      contentJson: JSON.stringify([{ type: 'text', text: 'world' }]),
      clientKey: 'a1',
      model: 'test-model',
    })
    expect(finished?.revision).toBe(2)

    await expect(
      history.startAgentRun({
        conversationId,
        userId: 7,
        trigger: 'submit-message',
        incoming: { content: 'hello', clientKey: 'u1' },
        requestKey,
        model: 'test-model',
      })
    ).rejects.toThrow('request already submitted')
    const counts = await sql<{ messages: number; revisions: number }[]>`
      SELECT
        (SELECT count(*)::int FROM playground_messages) AS messages,
        (SELECT count(*)::int FROM playground_message_revisions) AS revisions
    `
    expect(counts[0]).toMatchObject({ messages: 2, revisions: 2 })
  })

  test('revises, invalidates memory, and fences stale runs', async () => {
    if (!sql) return
    const conversationId = await createConversation()

    const appendTurn = async (
      userKey: string,
      assistantKey: string,
      text: string
    ) => {
      const started = await history.startAgentRun({
        conversationId,
        userId: 7,
        trigger: 'submit-message',
        incoming: { content: text, clientKey: userKey },
        requestKey: crypto.randomUUID(),
        model: 'test-model',
      })
      const finished = await history.finishAgentRun(started.runId, 7, {
        content: `answer ${text}`,
        clientKey: assistantKey,
        model: 'test-model',
      })
      expect(finished).not.toBeNull()
    }
    await appendTurn('u1', 'a1', 'first')
    await appendTurn('u2', 'a2', 'second')

    const now = Math.floor(Date.now() / 1000)
    await sql`
      INSERT INTO playground_user_memories
        (user_id, content, source_conversation_id, created_at, updated_at)
      VALUES (7, 'derived', ${conversationId}, ${now}, ${now})
    `

    const regeneration = await history.startAgentRun({
      conversationId,
      userId: 7,
      trigger: 'regenerate-message',
      targetMessageKey: 'a1',
      requestKey: crypto.randomUUID(),
      model: 'test-model',
    })
    expect(regeneration.operation).toBe('regenerate')
    const messagesAfterRegenerate = await sql<{ client_key: string }[]>`
      SELECT client_key FROM playground_messages ORDER BY seq
    `
    expect([...messagesAfterRegenerate]).toEqual([
      { client_key: 'u1' },
      { client_key: 'a1' },
    ])
    const memoriesAfterRegenerate = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM playground_user_memories
    `
    expect([...memoriesAfterRegenerate]).toEqual([{ count: 0 }])

    const regenerated = await history.finishAgentRun(regeneration.runId, 7, {
      content: 'new answer',
      clientKey: 'a1',
      model: 'test-model',
    })
    expect(regenerated?.message.activeRevision).toBe(2)

    const staleRevision = regenerated!.revision - 1
    await expect(
      history.editAgentMessage(
        conversationId,
        7,
        'u1',
        { content: 'stale edit' },
        staleRevision
      )
    ).rejects.toThrow('conversation changed')

    const editedRevision = await history.editAgentMessage(
      conversationId,
      7,
      'u1',
      {
        content: 'edited first',
        contentJson: JSON.stringify([{ type: 'text', text: 'edited first' }]),
      },
      regenerated!.revision
    )
    const messagesAfterEdit = await sql<
      { client_key: string; content: string }[]
    >`SELECT client_key, content FROM playground_messages ORDER BY seq`
    expect([...messagesAfterEdit]).toEqual([
      { client_key: 'u1', content: 'edited first' },
      { client_key: 'a1', content: 'new answer' },
    ])

    const activatedRevision = await history.activateMessageRevision(
      conversationId,
      7,
      'u1',
      1,
      editedRevision
    )
    const activeUserMessage = await sql<
      { content: string; active_revision: number }[]
    >`
      SELECT content, active_revision
      FROM playground_messages
      WHERE client_key = 'u1'
    `
    expect([...activeUserMessage]).toEqual([
      { content: 'first', active_revision: 1 },
    ])

    const retry = await history.startAgentRun({
      conversationId,
      userId: 7,
      trigger: 'regenerate-message',
      targetMessageKey: 'u1',
      requestKey: crypto.randomUUID(),
      model: 'test-model',
    })
    expect(retry.operation).toBe('regenerate')
    await history.stopAgentRun(retry.runId, 7, conversationId)
    expect(
      await history.finishAgentRun(retry.runId, 7, {
        content: 'obsolete',
        clientKey: 'obsolete-a1',
      })
    ).toBeNull()

    const deletedRevision = await history.deleteAgentMessage(
      conversationId,
      7,
      'u1',
      activatedRevision + 1
    )
    expect(deletedRevision).toBe(activatedRevision + 2)
    const messagesAfterDelete = await sql<{ client_key: string }[]>`
      SELECT client_key FROM playground_messages ORDER BY seq
    `
    expect([...messagesAfterDelete]).toEqual([{ client_key: 'a1' }])
  })

  test('recovers an expired lease without deadlocking its late completion', async () => {
    if (!sql) return
    const conversationId = await createConversation()
    const expired = await history.startAgentRun({
      conversationId,
      userId: 7,
      trigger: 'submit-message',
      incoming: { content: 'old request', clientKey: 'old-user' },
      requestKey: crypto.randomUUID(),
      model: 'test-model',
    })
    const expiredAt = Math.floor(Date.now() / 1000) - 1
    await sql`
      UPDATE playground_agent_runs
      SET lease_expires_at = ${expiredAt}
      WHERE id = ${expired.runId}
    `
    await sql`
      UPDATE playground_conversations
      SET active_run_started_at = ${expiredAt - 3600}
      WHERE id = ${conversationId}
    `

    const [replacement, staleFinish] = await Promise.all([
      history.startAgentRun({
        conversationId,
        userId: 7,
        trigger: 'submit-message',
        incoming: { content: 'new request', clientKey: 'new-user' },
        requestKey: crypto.randomUUID(),
        model: 'test-model',
      }),
      history.finishAgentRun(expired.runId, 7, {
        content: 'late answer',
        clientKey: 'late-assistant',
      }),
    ])
    expect(staleFinish).toBeNull()
    expect(replacement.runId).not.toBe(expired.runId)

    const replacementFinish = await history.finishAgentRun(
      replacement.runId,
      7,
      {
        content: 'current answer',
        clientKey: 'current-assistant',
      }
    )
    expect(replacementFinish).not.toBeNull()
  })

  test('persists a partial stopped answer and makes later stop idempotent', async () => {
    if (!sql) return
    const conversationId = await createConversation()
    const started = await history.startAgentRun({
      conversationId,
      userId: 7,
      trigger: 'submit-message',
      incoming: { content: 'long request', clientKey: 'stop-user' },
      requestKey: crypto.randomUUID(),
      model: 'test-model',
    })
    const saved = await history.finishAgentRun(started.runId, 7, {
      content: 'partial answer',
      clientKey: 'stop-assistant',
      status: 'stopped',
    })
    expect(saved?.message).toMatchObject({
      content: 'partial answer',
      status: 'stopped',
    })
    expect(await history.stopAgentRun(started.runId, 7, conversationId)).toBe(
      false
    )
    const rows = await sql<{ status: string }[]>`
      SELECT status FROM playground_agent_runs WHERE id = ${started.runId}
    `
    expect([...rows]).toEqual([{ status: 'stopped' }])
  })

  test('does not apply memory extracted from a superseded transcript', async () => {
    if (!sql) return
    const conversationId = await createConversation()
    const now = Math.floor(Date.now() / 1000)
    await sql`
      INSERT INTO playground_messages
        (conversation_id, user_id, role, content, client_key, status,
         active_revision, seq, created_at, updated_at)
      VALUES
        (${conversationId}, 7, 'user', 'first', 'memory-u1', 'complete', 1, 0, ${now}, ${now}),
        (${conversationId}, 7, 'assistant', 'answer', 'memory-a1', 'complete', 1, 1, ${now}, ${now}),
        (${conversationId}, 7, 'user', 'second', 'memory-u2', 'complete', 1, 2, ${now}, ${now}),
        (${conversationId}, 7, 'assistant', 'answer', 'memory-a2', 'complete', 1, 3, ${now}, ${now})
    `

    const oldFetch = globalThis.fetch
    const oldEnvironment = {
      enabled: process.env.PLAYGROUND_MEMORY_ENABLED,
      baseUrl: process.env.PLAYGROUND_MEMORY_BASE_URL,
      apiKey: process.env.PLAYGROUND_MEMORY_API_KEY,
      model: process.env.PLAYGROUND_MEMORY_MODEL,
      summary: process.env.PLAYGROUND_MEMORY_SUMMARY_ENABLED,
      every: process.env.PLAYGROUND_MEMORY_EXTRACT_EVERY,
    }
    process.env.PLAYGROUND_MEMORY_ENABLED = 'true'
    process.env.PLAYGROUND_MEMORY_BASE_URL = 'http://memory.test'
    process.env.PLAYGROUND_MEMORY_API_KEY = 'test-key'
    process.env.PLAYGROUND_MEMORY_MODEL = 'test-memory-model'
    process.env.PLAYGROUND_MEMORY_SUMMARY_ENABLED = 'false'
    process.env.PLAYGROUND_MEMORY_EXTRACT_EVERY = '2'

    let releaseModel!: () => void
    let markModelStarted!: () => void
    const modelStarted = new Promise<void>((resolve) => {
      markModelStarted = resolve
    })
    const modelReleased = new Promise<void>((resolve) => {
      releaseModel = resolve
    })
    globalThis.fetch = Object.assign(
      async () => {
        markModelStarted()
        await modelReleased
        return Response.json({
          choices: [
            {
              message: {
                content:
                  '{"add":[{"content":"stale memory","category":"project"}],"update":[],"delete":[]}',
              },
            },
          ],
        })
      },
      { preconnect: () => {} }
    )

    try {
      const { runMemoryMaintenance } = await import('../memory/maintenance')
      const maintenance = runMemoryMaintenance(7, conversationId, true)
      await modelStarted
      const revision = await history.editAgentMessage(
        conversationId,
        7,
        'memory-u1',
        { content: 'corrected first' },
        0
      )
      expect(revision).toBe(1)
      releaseModel()
      await maintenance
      const memories = await sql<{ content: string }[]>`
        SELECT content FROM playground_user_memories
      `
      expect([...memories]).toEqual([])
    } finally {
      releaseModel()
      globalThis.fetch = oldFetch
      const restore = (name: string, value: string | undefined) => {
        if (value === undefined) delete process.env[name]
        else process.env[name] = value
      }
      restore('PLAYGROUND_MEMORY_ENABLED', oldEnvironment.enabled)
      restore('PLAYGROUND_MEMORY_BASE_URL', oldEnvironment.baseUrl)
      restore('PLAYGROUND_MEMORY_API_KEY', oldEnvironment.apiKey)
      restore('PLAYGROUND_MEMORY_MODEL', oldEnvironment.model)
      restore('PLAYGROUND_MEMORY_SUMMARY_ENABLED', oldEnvironment.summary)
      restore('PLAYGROUND_MEMORY_EXTRACT_EVERY', oldEnvironment.every)
    }
  })
})
