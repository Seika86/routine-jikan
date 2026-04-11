import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const app = new Hono()

// POST /api/groups/:groupId/tasks — タスク追加
app.post('/groups/:groupId/tasks', async (c) => {
  const { groupId } = c.req.param()
  const body = await c.req.json<{
    name: string
    durationSec: number
    costLowSec?: number | null
    costHighSec?: number | null
    timerOverrun?: string
    scheduledDays?: string[] | null
    ambientSoundType?: string | null
    ambientSoundVolume?: number | null
    ttsOnStart?: boolean
    ttsOnEnd?: boolean
    ttsOnRemaining?: number[] | null
    sortOrder?: number
  }>()

  const group = await db.select().from(schema.taskGroups)
    .where(eq(schema.taskGroups.id, groupId))
    .get()

  if (!group) return c.json({ error: 'Group not found' }, 404)

  // 次のsortOrderを取得
  const existingTasks = await db.select().from(schema.tasks)
    .where(eq(schema.tasks.groupId, groupId))
    .all()
  const maxOrder = existingTasks.reduce((max, t) => Math.max(max, t.sortOrder), -1)

  const now = new Date().toISOString()
  const task = {
    id: nanoid(),
    groupId,
    name: body.name,
    durationSec: body.durationSec,
    costLowSec: body.costLowSec ?? null,
    costHighSec: body.costHighSec ?? null,
    timerOverrun: body.timerOverrun ?? 'continue',
    scheduledDays: body.scheduledDays ? JSON.stringify(body.scheduledDays) : null,
    ambientSoundType: body.ambientSoundType ?? null,
    ambientSoundVolume: body.ambientSoundVolume ?? null,
    ttsOnStart: body.ttsOnStart ?? true,
    ttsOnEnd: body.ttsOnEnd ?? true,
    ttsOnRemaining: body.ttsOnRemaining ? JSON.stringify(body.ttsOnRemaining) : null,
    sortOrder: body.sortOrder ?? maxOrder + 1,
    createdAt: now,
    updatedAt: now,
  }

  await db.insert(schema.tasks).values(task)
  return c.json(task, 201)
})

// PUT /api/tasks/:id — タスク更新
app.put('/tasks/:id', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<{
    name?: string
    groupId?: string
    durationSec?: number
    costLowSec?: number | null
    costHighSec?: number | null
    timerOverrun?: string
    scheduledDays?: string[] | null
    ambientSoundType?: string | null
    ambientSoundVolume?: number | null
    ttsOnStart?: boolean
    ttsOnEnd?: boolean
    ttsOnRemaining?: number[] | null
    sortOrder?: number
  }>()

  const existing = await db.select().from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .get()

  if (!existing) return c.json({ error: 'Task not found' }, 404)

  const updateData: Record<string, unknown> = { updatedAt: new Date().toISOString() }

  // 明示的に渡されたフィールドだけ更新
  if (body.groupId !== undefined) updateData.groupId = body.groupId
  if (body.name !== undefined) updateData.name = body.name
  if (body.durationSec !== undefined) updateData.durationSec = body.durationSec
  if (body.costLowSec !== undefined) updateData.costLowSec = body.costLowSec
  if (body.costHighSec !== undefined) updateData.costHighSec = body.costHighSec
  if (body.timerOverrun !== undefined) updateData.timerOverrun = body.timerOverrun
  if (body.scheduledDays !== undefined) {
    updateData.scheduledDays = body.scheduledDays ? JSON.stringify(body.scheduledDays) : null
  }
  if (body.ambientSoundType !== undefined) updateData.ambientSoundType = body.ambientSoundType
  if (body.ambientSoundVolume !== undefined) updateData.ambientSoundVolume = body.ambientSoundVolume
  if (body.ttsOnStart !== undefined) updateData.ttsOnStart = body.ttsOnStart
  if (body.ttsOnEnd !== undefined) updateData.ttsOnEnd = body.ttsOnEnd
  if (body.ttsOnRemaining !== undefined) {
    updateData.ttsOnRemaining = body.ttsOnRemaining ? JSON.stringify(body.ttsOnRemaining) : null
  }
  if (body.sortOrder !== undefined) updateData.sortOrder = body.sortOrder

  await db.update(schema.tasks).set(updateData).where(eq(schema.tasks.id, id))

  const result = await db.select().from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .get()

  return c.json(result)
})

// DELETE /api/tasks/:id — タスク削除
app.delete('/tasks/:id', async (c) => {
  const { id } = c.req.param()

  const existing = await db.select().from(schema.tasks)
    .where(eq(schema.tasks.id, id))
    .get()

  if (!existing) return c.json({ error: 'Task not found' }, 404)

  await db.delete(schema.tasks).where(eq(schema.tasks.id, id))
  return c.json({ ok: true })
})

// PUT /api/groups/:groupId/tasks/reorder — タスク並べ替え
app.put('/groups/:groupId/tasks/reorder', async (c) => {
  const body = await c.req.json<{ taskIds: string[] }>()

  for (let i = 0; i < body.taskIds.length; i++) {
    await db.update(schema.tasks)
      .set({ sortOrder: i, updatedAt: new Date().toISOString() })
      .where(eq(schema.tasks.id, body.taskIds[i]))
  }

  return c.json({ ok: true })
})

export const tasksRouter = app
