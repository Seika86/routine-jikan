import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const app = new Hono()

// GET /api/groups — 一覧取得
app.get('/', async (c) => {
  const groups = await db.select().from(schema.taskGroups).all()
  return c.json(groups)
})

// GET /api/groups/:id — 詳細取得（tasks含む）
app.get('/:id', async (c) => {
  const { id } = c.req.param()

  const group = await db.select().from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, id))
    .get()

  if (!group) return c.json({ error: 'Group not found' }, 404)

  const tasks = await db.select().from(schema.tasks)
    .where(eq(schema.tasks.groupId, id))
    .orderBy(schema.tasks.sortOrder)
    .all()

  return c.json({ ...group, tasks })
})

// POST /api/groups — 新規作成
app.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    isShared?: boolean
  }>()

  const now = new Date().toISOString()
  const group = {
    id: nanoid(),
    name: body.name,
    isShared: body.isShared ?? false,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.taskGroups).values(group)
  return c.json(group, 201)
})

// PUT /api/groups/:id — 更新
app.put('/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<{
    name?: string
    isShared?: boolean
  }>()

  const existing = await db.select().from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, id))
    .get()

  if (!existing) return c.json({ error: 'Group not found' }, 404)

  await db.update(schema.taskGroups).set({
    ...body,
    updatedAt: new Date().toISOString(),
  }).where(eq(schema.taskGroups.id, id))

  const result = await db.select().from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, id))
    .get()

  return c.json(result)
})

// DELETE /api/groups/:id — 削除
app.delete('/:id', async (c) => {
  const { id } = c.req.param()

  const existing = await db.select().from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, id))
    .get()

  if (!existing) return c.json({ error: 'Group not found' }, 404)

  await db.delete(schema.taskGroups).where(eq(schema.taskGroups.id, id))
  return c.json({ ok: true })
})

export const groupsRouter = app
