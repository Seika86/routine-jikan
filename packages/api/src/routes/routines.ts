import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const app = new Hono()

// GET /api/routines — 一覧取得
app.get('/', async (c) => {
  const routines = await db.select().from(schema.routines).all()
  return c.json(routines)
})

// GET /api/routines/:id — 詳細取得（items展開済み）
app.get('/:id', async (c) => {
  const { id } = c.req.param()

  const routine = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, id))
    .get()

  if (!routine) return c.json({ error: 'Routine not found' }, 404)

  // items を取得（sortOrder順）
  const items = await db.select().from(schema.routineItems)
    .where(eq(schema.routineItems.routineId, id))
    .orderBy(schema.routineItems.sortOrder)
    .all()

  // 各アイテムを展開（グループ参照の場合はグループ＋タスクも取得）
  const expandedItems = await Promise.all(
    items.map(async (item) => {
      if (item.itemType === 'group_ref' && item.groupId) {
        const group = await db.select().from(schema.taskGroups)
          .where(eq(schema.taskGroups.id, item.groupId))
          .get()
        const tasks = await db.select().from(schema.tasks)
          .where(eq(schema.tasks.groupId, item.groupId))
          .orderBy(schema.tasks.sortOrder)
          .all()
        return { ...item, group: group ? { ...group, tasks } : null }
      }
      if (item.itemType === 'task' && item.taskId) {
        const task = await db.select().from(schema.tasks)
          .where(eq(schema.tasks.id, item.taskId))
          .get()
        return { ...item, task }
      }
      return item
    }),
  )

  return c.json({ ...routine, items: expandedItems })
})

// POST /api/routines — 新規作成
app.post('/', async (c) => {
  const body = await c.req.json<{
    name: string
    scheduledTime?: string | null
    defaultAmbientSoundType?: string | null
    defaultAmbientSoundVolume?: number
    defaultAmbientSoundDuckOnTts?: boolean
  }>()

  const now = new Date().toISOString()
  const routine = {
    id: nanoid(),
    name: body.name,
    scheduledTime: body.scheduledTime ?? null,
    defaultAmbientSoundType: body.defaultAmbientSoundType ?? null,
    defaultAmbientSoundVolume: body.defaultAmbientSoundVolume ?? 50,
    defaultAmbientSoundDuckOnTts: body.defaultAmbientSoundDuckOnTts ?? true,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.routines).values(routine)
  return c.json(routine, 201)
})

// PUT /api/routines/:id — 更新
app.put('/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<{
    name?: string
    scheduledTime?: string | null
    defaultAmbientSoundType?: string | null
    defaultAmbientSoundVolume?: number
    defaultAmbientSoundDuckOnTts?: boolean
  }>()

  const existing = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, id))
    .get()

  if (!existing) return c.json({ error: 'Routine not found' }, 404)

  const updated = {
    ...body,
    updatedAt: new Date().toISOString(),
  }

  await db.update(schema.routines).set(updated).where(eq(schema.routines.id, id))

  const result = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, id))
    .get()

  return c.json(result)
})

// DELETE /api/routines/:id — 削除
app.delete('/:id', async (c) => {
  const { id } = c.req.param()

  const existing = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, id))
    .get()

  if (!existing) return c.json({ error: 'Routine not found' }, 404)

  await db.delete(schema.routines).where(eq(schema.routines.id, id))
  return c.json({ ok: true })
})

export const routinesRouter = app
