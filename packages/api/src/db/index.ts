import { createClient } from '@libsql/client'
import { drizzle } from 'drizzle-orm/libsql'
import * as schema from './schema.js'

const DB_PATH = process.env.DB_PATH || 'file:./data/routine-jikan.db'

const client = createClient({ url: DB_PATH })
export const db = drizzle(client, { schema })
export { schema }
