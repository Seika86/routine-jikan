import { Hono } from 'hono'
import { eq, desc } from 'drizzle-orm'
import { db, schema } from '../db/index.js'

const app = new Hono()

// GET /api/executions — 実行履歴一覧
app.get('/', async (c) => {
  const executions = await db.select().from(schema.routineExecutions)
    .orderBy(desc(schema.routineExecutions.startedAt))
    .all()

  // ルーチン名と集計を付与
  const enriched = await Promise.all(
    executions.map(async (exec) => {
      const routine = await db.select().from(schema.routines)
        .where(eq(schema.routines.id, exec.routineId))
        .get()
      const results = await db.select().from(schema.taskResults)
        .where(eq(schema.taskResults.executionId, exec.id))
        .all()

      const completedCount = results.filter(r => r.status === 'completed').length
      const skippedCount = results.filter(r => r.status === 'skipped').length
      const totalCount = results.filter(r => !r.status.startsWith('auto-skipped')).length
      const totalActualSec = results.reduce((sum, r) => sum + r.actualDurationSec, 0)

      return {
        ...exec,
        routineName: routine?.name ?? '(削除済み)',
        completedCount,
        skippedCount,
        totalCount,
        totalActualSec,
      }
    }),
  )

  return c.json(enriched)
})

// GET /api/executions/export — CSV/JSONエクスポート
app.get('/export', async (c) => {
  const format = c.req.query('format') ?? 'csv'
  const from = c.req.query('from')
  const to = c.req.query('to')

  let executions = await db.select().from(schema.routineExecutions)
    .orderBy(desc(schema.routineExecutions.startedAt))
    .all()

  // 日付フィルタ
  if (from) executions = executions.filter(e => e.startedAt >= from)
  if (to) executions = executions.filter(e => e.startedAt <= to + 'T23:59:59.999Z')

  // 全結果を収集
  const rows: ExportRow[] = []
  for (const exec of executions) {
    const routine = await db.select().from(schema.routines)
      .where(eq(schema.routines.id, exec.routineId))
      .get()
    const results = await db.select().from(schema.taskResults)
      .where(eq(schema.taskResults.executionId, exec.id))
      .all()

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

  if (format === 'json') {
    return c.json(rows)
  }

  // CSV
  const header = 'date,routine,cost_level,task,group,base_sec,planned_sec,actual_sec,diff_sec,status'
  const csvRows = rows.map(r =>
    `${r.date},${csvEscape(r.routine)},${r.cost_level},${csvEscape(r.task)},${csvEscape(r.group)},${r.base_sec},${r.planned_sec},${r.actual_sec},${r.diff_sec},${r.status}`
  )
  const csv = [header, ...csvRows].join('\n')

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="routine-jikan-export.csv"',
    },
  })
})

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

interface ExportRow {
  date: string
  routine: string
  cost_level: string
  task: string
  group: string
  base_sec: number
  planned_sec: number
  actual_sec: number
  diff_sec: number
  status: string
}

export const historyRouter = app
