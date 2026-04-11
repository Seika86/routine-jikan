import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const app = new Hono()

// POST /api/routines/:routineId/items — アイテム追加
app.post('/:routineId/items', async (c) => {
  const { routineId } = c.req.param()
  const body = await c.req.json<{
    itemType: 'task' | 'group_ref'
    taskId?: string
    groupId?: string
    isEnabled?: boolean
    sortOrder?: number
  }>()

  const routine = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, routineId))
    .get()

  if (!routine) return c.json({ error: 'Routine not found' }, 404)

  // 次のsortOrderを取得
  const existingItems = await db.select().from(schema.routineItems)
    .where(eq(schema.routineItems.routineId, routineId))
    .all()
  const maxOrder = existingItems.reduce((max, i) => Math.max(max, i.sortOrder), -1)

  const item = {
    id: nanoid(),
    routineId,
    itemType: body.itemType,
    taskId: body.taskId ?? null,
    groupId: body.groupId ?? null,
    isEnabled: body.isEnabled ?? true,
    sortOrder: body.sortOrder ?? maxOrder + 1,
    createdAt: new Date().toISOString(),
  }

  await db.insert(schema.routineItems).values(item)
  return c.json(item, 201)
})

// PUT /api/routines/:routineId/items/reorder — アイテム並べ替え
// ⚠️ 静的パス reorder を :itemId より先に登録（Honoはパラメータに先にマッチするため）
app.put('/:routineId/items/reorder', async (c) => {
  const body = await c.req.json<{ itemIds: string[] }>()

  for (let i = 0; i < body.itemIds.length; i++) {
    await db.update(schema.routineItems)
      .set({ sortOrder: i })
      .where(eq(schema.routineItems.id, body.itemIds[i]))
  }

  return c.json({ ok: true })
})

// PUT /api/routines/:routineId/items/:itemId — アイテム更新（ON/OFF切替等）
app.put('/:routineId/items/:itemId', async (c) => {
  const { itemId } = c.req.param()
  const body = await c.req.json<{ isEnabled?: boolean }>()

  const existing = await db.select().from(schema.routineItems)
    .where(eq(schema.routineItems.id, itemId))
    .get()

  if (!existing) return c.json({ error: 'Item not found' }, 404)

  if (body.isEnabled !== undefined) {
    await db.update(schema.routineItems)
      .set({ isEnabled: body.isEnabled })
      .where(eq(schema.routineItems.id, itemId))
  }

  const result = await db.select().from(schema.routineItems)
    .where(eq(schema.routineItems.id, itemId))
    .get()

  return c.json(result)
})

// DELETE /api/routines/:routineId/items/:itemId — アイテム削除
app.delete('/:routineId/items/:itemId', async (c) => {
  const { itemId } = c.req.param()

  await db.delete(schema.routineItems)
    .where(eq(schema.routineItems.id, itemId))

  return c.json({ ok: true })
})

export const routineItemsRouter = app
