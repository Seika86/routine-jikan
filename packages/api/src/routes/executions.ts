import { Hono } from 'hono'
import { eq, desc, asc, and, inArray } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db, schema } from '../db/index.js'

const app = new Hono()

// POST /api/routines/:id/start — ルーチン実行を開始
app.post('/routines/:id/start', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<{
    costLevel: 'low' | 'medium' | 'high'
    groupOverrides?: Record<string, boolean> // groupId → enabled
  }>()

  const routine = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, id))
    .get()
  if (!routine) return c.json({ error: 'Routine not found' }, 404)

  // アイテム取得
  const items = await db.select().from(schema.routineItems)
    .where(eq(schema.routineItems.routineId, id))
    .orderBy(schema.routineItems.sortOrder)
    .all()

  // 今日の曜日（JST基準）
  const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const
  const jstNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }))
  const today = days[jstNow.getDay()]

  // タスクを展開（コストレベル適用、曜日フィルタ、グループON/OFF）
  const expandedTasks: Array<{
    taskName: string
    groupName: string | null
    baseDurationSec: number
    plannedDurationSec: number
    timerOverrun: string
    skippedByDay: boolean
  }> = []

  for (const item of items) {
    if (item.itemType !== 'group_ref' || !item.groupId) continue

    // グループON/OFFチェック
    const isEnabled = body.groupOverrides?.[item.groupId] ?? item.isEnabled
    if (!isEnabled) continue

    const group = await db.select().from(schema.taskGroups)
      .where(eq(schema.taskGroups.id, item.groupId))
      .get()
    if (!group) continue

    const tasks = await db.select().from(schema.tasks)
      .where(eq(schema.tasks.groupId, item.groupId))
      .orderBy(schema.tasks.sortOrder)
      .all()

    for (const task of tasks) {
      // 曜日フィルタ
      if (task.scheduledDays) {
        const scheduled: string[] = JSON.parse(task.scheduledDays)
        if (!scheduled.includes(today)) {
          expandedTasks.push({
            taskName: task.name,
            groupName: group.name,
            baseDurationSec: task.durationSec,
            plannedDurationSec: 0,
            timerOverrun: task.timerOverrun,
            skippedByDay: true,
          })
          continue
        }
      }

      // コストレベル適用
      let planned = task.durationSec
      if (body.costLevel === 'low' && task.costLowSec !== null) planned = task.costLowSec
      if (body.costLevel === 'high' && task.costHighSec !== null) planned = task.costHighSec

      // 0秒 = コストスキップ
      expandedTasks.push({
        taskName: task.name,
        groupName: group.name,
        baseDurationSec: task.durationSec,
        plannedDurationSec: planned,
        timerOverrun: task.timerOverrun,
        skippedByDay: false,
      })
    }
  }

  // 実行レコード作成
  const execId = nanoid()
  const now = new Date().toISOString()

  await db.insert(schema.routineExecutions).values({
    id: execId,
    routineId: id,
    costLevel: body.costLevel,
    startedAt: now,
    completedAt: null,
    status: 'in_progress',
    createdAt: now,
  })

  // タスク結果レコード作成
  for (let i = 0; i < expandedTasks.length; i++) {
    const task = expandedTasks[i]
    let status = 'pending'
    if (task.skippedByDay) {
      status = 'auto-skipped'  // 曜日スキップ
    } else if (task.plannedDurationSec === 0 && task.baseDurationSec > 0) {
      status = 'auto-skipped'  // コストスキップ
    }

    await db.insert(schema.taskResults).values({
      id: nanoid(),
      executionId: execId,
      taskName: task.taskName,
      groupName: task.groupName,
      baseDurationSec: task.baseDurationSec,
      plannedDurationSec: task.plannedDurationSec,
      actualDurationSec: 0,
      status,
      startedAt: null,
      completedAt: null,
      sortOrder: i,
    })
  }

  // レスポンス: 実行可能なタスクのみ返す
  const allResults = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.executionId, execId))
    .orderBy(asc(schema.taskResults.sortOrder))
    .all()

  return c.json({
    executionId: execId,
    routineName: routine.name,
    costLevel: body.costLevel,
    startedAt: now,
    tasks: allResults,
    activeTasks: allResults.filter(t => t.status === 'pending'),
    skippedTasks: allResults.filter(t => t.status === 'auto-skipped'),
    totalPlannedSec: allResults
      .filter(t => t.status === 'pending')
      .reduce((sum, t) => sum + t.plannedDurationSec, 0),
    defaultAmbientSoundType: routine.defaultAmbientSoundType,
    defaultAmbientSoundVolume: routine.defaultAmbientSoundVolume,
  }, 201)
})

// GET /api/executions — 実行履歴一覧（:id より先にマッチさせる）
app.get('/executions', async (c) => {
  const executions = await db.select().from(schema.routineExecutions)
    .orderBy(desc(schema.routineExecutions.startedAt))
    .all()

  const enriched = await Promise.all(
    executions.map(async (exec) => {
      const routine = await db.select().from(schema.routines)
        .where(eq(schema.routines.id, exec.routineId))
        .get()
      const results = await db.select().from(schema.taskResults)
        .where(eq(schema.taskResults.executionId, exec.id))
        .all()
      return {
        ...exec,
        routineName: routine?.name ?? '(削除済み)',
        completedCount: results.filter(r => r.status === 'completed').length,
        skippedCount: results.filter(r => r.status === 'skipped').length,
        totalCount: results.filter(r => !r.status.startsWith('auto-skipped')).length,
        totalActualSec: results.reduce((sum, r) => sum + r.actualDurationSec, 0),
      }
    }),
  )
  return c.json(enriched)
})

// GET /api/executions/export — CSV/JSONエクスポート
app.get('/executions/export', async (c) => {
  const format = c.req.query('format') ?? 'csv'
  const from = c.req.query('from')
  const to = c.req.query('to')

  let executions = await db.select().from(schema.routineExecutions)
    .orderBy(desc(schema.routineExecutions.startedAt))
    .all()
  if (from) executions = executions.filter(e => e.startedAt >= from)
  if (to) executions = executions.filter(e => e.startedAt <= to + 'T23:59:59.999Z')

  const rows: Array<Record<string, unknown>> = []
  for (const exec of executions) {
    const routine = await db.select().from(schema.routines)
      .where(eq(schema.routines.id, exec.routineId)).get()
    const results = await db.select().from(schema.taskResults)
      .where(eq(schema.taskResults.executionId, exec.id)).all()
    for (const r of results) {
      rows.push({
        date: exec.startedAt.split('T')[0],
        routine: routine?.name ?? '',
        cost_level: exec.costLevel,
        task: r.taskName,
        group: r.groupName ?? '',
        base_sec: r.baseDurationSec,
        planned_sec: r.plannedDurationSec,
        actual_sec: r.actualDurationSec,
        diff_sec: r.actualDurationSec - r.plannedDurationSec,
        status: r.status,
      })
    }
  }

  if (format === 'json') return c.json(rows)

  const header = 'date,routine,cost_level,task,group,base_sec,planned_sec,actual_sec,diff_sec,status'
  const csvEscape = (s: string) => s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s
  const csvRows = rows.map(r =>
    `${r.date},${csvEscape(String(r.routine))},${r.cost_level},${csvEscape(String(r.task))},${csvEscape(String(r.group))},${r.base_sec},${r.planned_sec},${r.actual_sec},${r.diff_sec},${r.status}`
  )
  return new Response([header, ...csvRows].join('\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="routine-jikan-export.csv"' },
  })
})

// GET /api/executions/:id — 実行状態取得
app.get('/executions/:id', async (c) => {
  const { id } = c.req.param()

  const execution = await db.select().from(schema.routineExecutions)
    .where(eq(schema.routineExecutions.id, id))
    .get()
  if (!execution) return c.json({ error: 'Execution not found' }, 404)

  const routine = await db.select().from(schema.routines)
    .where(eq(schema.routines.id, execution.routineId))
    .get()

  const results = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.executionId, id))
    .orderBy(asc(schema.taskResults.sortOrder))
    .all()

  // 現在のタスク（最初のpending）
  const currentIndex = results.findIndex(r => r.status === 'pending')

  return c.json({
    ...execution,
    routineName: routine?.name,
    tasks: results,
    currentTaskIndex: currentIndex,
    currentTask: currentIndex >= 0 ? results[currentIndex] : null,
    completedCount: results.filter(r => r.status === 'completed').length,
    skippedCount: results.filter(r => r.status === 'skipped').length,
    totalCount: results.filter(r => r.status !== 'auto-skipped').length,
  })
})

// POST /api/executions/:id/tasks/:taskId/complete — タスク完了
app.post('/executions/:id/tasks/:taskId/complete', async (c) => {
  const { id, taskId } = c.req.param()
  const body = await c.req.json<{ actualDurationSec: number }>()

  const result = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.id, taskId))
    .get()
  if (!result) return c.json({ error: 'Task result not found' }, 404)

  await db.update(schema.taskResults).set({
    status: 'completed',
    actualDurationSec: body.actualDurationSec,
    completedAt: new Date().toISOString(),
  }).where(eq(schema.taskResults.id, taskId))

  // 全タスク完了チェック
  await checkExecutionCompletion(id)

  return c.json({ ok: true })
})

// POST /api/executions/:id/tasks/:taskId/skip — タスクスキップ（未完了）
app.post('/executions/:id/tasks/:taskId/skip', async (c) => {
  const { id, taskId } = c.req.param()
  const body = await c.req.json<{ actualDurationSec?: number }>().catch(() => ({}))

  const result = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.id, taskId))
    .get()
  if (!result) return c.json({ error: 'Task result not found' }, 404)

  await db.update(schema.taskResults).set({
    status: 'skipped',
    actualDurationSec: (body as { actualDurationSec?: number }).actualDurationSec ?? 0,
    completedAt: new Date().toISOString(),
  }).where(eq(schema.taskResults.id, taskId))

  await checkExecutionCompletion(id)

  return c.json({ ok: true })
})

// POST /api/executions/:id/abandon — ルーチン中断
app.post('/executions/:id/abandon', async (c) => {
  const { id } = c.req.param()

  await db.update(schema.routineExecutions).set({
    status: 'abandoned',
    completedAt: new Date().toISOString(),
  }).where(eq(schema.routineExecutions.id, id))

  return c.json({ ok: true })
})

// DELETE /api/executions/:id — 実行履歴を削除（taskResultsはカスケード削除）
app.delete('/executions/:id', async (c) => {
  const { id } = c.req.param()

  const execution = await db.select().from(schema.routineExecutions)
    .where(eq(schema.routineExecutions.id, id))
    .get()
  if (!execution) return c.json({ error: 'Execution not found' }, 404)

  await db.delete(schema.routineExecutions)
    .where(eq(schema.routineExecutions.id, id))

  return c.json({ ok: true })
})

// PUT /api/executions/:id/reorder — 実行中タスクの並べ替え（pendingのみ）
app.put('/executions/:id/reorder', async (c) => {
  const { id } = c.req.param()
  const body = await c.req.json<{ taskIds: string[] }>()

  const execution = await db.select().from(schema.routineExecutions)
    .where(eq(schema.routineExecutions.id, id))
    .get()
  if (!execution) return c.json({ error: 'Execution not found' }, 404)
  if (execution.status !== 'in_progress') return c.json({ error: 'Execution is not in progress' }, 400)

  // 全タスクを取得して現在のsortOrderを把握
  const allResults = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.executionId, id))
    .orderBy(asc(schema.taskResults.sortOrder))
    .all()

  // pending タスクだけが対象
  const pendingTasks = allResults.filter(r => r.status === 'pending')
  const pendingIds = new Set(pendingTasks.map(r => r.id))

  // バリデーション: 送られてきたIDがすべてpendingか
  for (const tid of body.taskIds) {
    if (!pendingIds.has(tid)) return c.json({ error: `Task ${tid} is not pending` }, 400)
  }

  // completed/skipped/auto-skipped タスクの最大sortOrderを基準に、pendingタスクをその後に並べる
  const nonPendingMax = allResults
    .filter(r => r.status !== 'pending')
    .reduce((max, r) => Math.max(max, r.sortOrder), -1)

  // 新しい順番で sortOrder を更新
  for (let i = 0; i < body.taskIds.length; i++) {
    await db.update(schema.taskResults)
      .set({ sortOrder: nonPendingMax + 1 + i })
      .where(eq(schema.taskResults.id, body.taskIds[i]))
  }

  return c.json({ ok: true })
})

// 全pendingタスクが完了したかチェック → execution を completed に
async function checkExecutionCompletion(executionId: string) {
  const results = await db.select().from(schema.taskResults)
    .where(eq(schema.taskResults.executionId, executionId))
    .all()

  const hasPending = results.some(r => r.status === 'pending')
  if (!hasPending) {
    await db.update(schema.routineExecutions).set({
      status: 'completed',
      completedAt: new Date().toISOString(),
    }).where(eq(schema.routineExecutions.id, executionId))
  }
}

export const executionsRouter = app
