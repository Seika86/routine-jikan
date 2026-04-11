import type { CostLevel, DayOfWeek, TaskDef } from './types.js'

/**
 * コストレベルに応じたタスクの実効時間を返す
 * - 0秒の場合はスキップ対象（呼び出し元で判定）
 */
export function getEffectiveDuration(task: TaskDef, costLevel: CostLevel): number {
  switch (costLevel) {
    case 'low':
      return task.costLowSec ?? task.durationSec
    case 'medium':
      return task.durationSec
    case 'high':
      return task.costHighSec ?? task.durationSec
  }
}

/**
 * コストレベルによる自動スキップ判定（0秒 = スキップ）
 */
export function shouldSkipByCost(task: TaskDef, costLevel: CostLevel): boolean {
  return getEffectiveDuration(task, costLevel) === 0
}

/**
 * 曜日による自動スキップ判定
 * - scheduledDays が null → 毎日実行（スキップしない）
 * - scheduledDays に今日が含まれない → スキップ
 */
export function shouldSkipByDay(task: TaskDef, today: DayOfWeek): boolean {
  if (task.scheduledDays === null) return false
  return !task.scheduledDays.includes(today)
}

/**
 * グループ内の全タスクがスキップ対象か判定
 * → 全部スキップならグループ自体を非表示にする
 */
export function shouldHideGroup(
  tasks: TaskDef[],
  today: DayOfWeek,
  costLevel: CostLevel = 'medium',
): boolean {
  return tasks.every(
    (task) => shouldSkipByDay(task, today) || shouldSkipByCost(task, costLevel),
  )
}

/**
 * ルーチンの合計見積もり時間を計算（コストレベル・曜日フィルタ適用済み）
 */
export function calcTotalDuration(
  tasks: TaskDef[],
  costLevel: CostLevel,
  today: DayOfWeek,
): number {
  return tasks.reduce((total, task) => {
    if (shouldSkipByDay(task, today)) return total
    if (shouldSkipByCost(task, costLevel)) return total
    return total + getEffectiveDuration(task, costLevel)
  }, 0)
}

/**
 * JavaScript Date → DayOfWeek
 * タイムゾーンを指定可能（デフォルト: Asia/Tokyo）
 */
export function dateToDayOfWeek(date: Date, timeZone = 'Asia/Tokyo'): DayOfWeek {
  const days: DayOfWeek[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
  const localized = new Date(date.toLocaleString('en-US', { timeZone }))
  return days[localized.getDay()]
}
