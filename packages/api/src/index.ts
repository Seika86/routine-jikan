import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serve } from '@hono/node-server'
import { migrate } from 'drizzle-orm/libsql/migrator'
import { db } from './db/index.js'
import { routinesRouter } from './routes/routines.js'
import { groupsRouter } from './routes/groups.js'
import { tasksRouter } from './routes/tasks.js'
import { routineItemsRouter } from './routes/routine-items.js'
import { executionsRouter } from './routes/executions.js'
// historyRouter は executionsRouter に統合済み

// 起動時にマイグレーション実行
console.log('🔄 Running migrations...')
await migrate(db, { migrationsFolder: './drizzle' })
console.log('✅ Migrations complete!')

const app = new Hono()

app.use('/*', cors())

// シンプルトークン認証（AUTH_TOKEN 未設定なら認証スキップ）
const AUTH_TOKEN = process.env.AUTH_TOKEN
if (AUTH_TOKEN) {
  app.use('/api/*', async (c, next) => {
    // healthは認証不要
    if (c.req.path === '/api/health') return next()
    const token = c.req.header('Authorization')?.replace('Bearer ', '')
      ?? c.req.query('token')
    if (token !== AUTH_TOKEN) {
      return c.json({ error: 'Unauthorized' }, 401)
    }
    return next()
  })
  console.log('🔒 Token auth enabled')
}

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', db: 'connected' })
})

// ルーティング
app.route('/api/routines', routinesRouter)
app.route('/api/groups', groupsRouter)
app.route('/api', tasksRouter)
app.route('/api/routines', routineItemsRouter)
app.route('/api', executionsRouter)

const port = 3001
console.log(`🌊 ルーチン時間 API listening on port ${port}`)
serve({ fetch: app.fetch, port })
