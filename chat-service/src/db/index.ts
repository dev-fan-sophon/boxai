import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { config } from '../config'
import * as schema from './schema'

/**
 * The service connects to the same Postgres the gateway uses; the tables in
 * schema.ts are owned by boxai-chat, everything else stays the gateway's.
 * No drizzle migrations run against the transferred tables: GORM created
 * them and their shape is frozen at transfer.
 */

const client = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
})

export const db = drizzle(client, { schema })

export { schema }
