/**
 * タイマー状態の永続化モジュール
 *
 * localStorageに「タスク開始時刻」を保存し、
 * hot reload / スリープ / タブ復帰でも正確な経過時間を復元する。
 */

const STORAGE_KEY = 'routine-jikan-timer-state'

export interface TimerState {
  taskId: string
  taskStartedAt: number    // タスク開始時のms timestamp
  pausedAt: number | null  // 一時停止した時のms timestamp（null = 実行中）
  pausedTotal: number      // 一時停止の累積ms
}

/** localStorageからタイマー状態を読み込む */
export function loadTimerState(): TimerState | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return JSON.parse(saved)
  } catch {}
  return null
}

/** localStorageにタイマー状態を保存する */
export function saveTimerState(state: TimerState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {}
}

/** タイマー状態をクリアする（ルーチン終了時） */
export function clearTimerState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

/** 新しいタスクを開始する */
export function startTask(taskId: string): TimerState {
  const state: TimerState = {
    taskId,
    taskStartedAt: Date.now(),
    pausedAt: null,
    pausedTotal: 0,
  }
  saveTimerState(state)
  return state
}

/** 一時停止する */
export function pauseTimer(state: TimerState): TimerState {
  const updated = { ...state, pausedAt: Date.now() }
  saveTimerState(updated)
  return updated
}

/** 再開する */
export function resumeTimer(state: TimerState): TimerState {
  if (state.pausedAt === null) return state
  const updated = {
    ...state,
    pausedTotal: state.pausedTotal + (Date.now() - state.pausedAt),
    pausedAt: null,
  }
  saveTimerState(updated)
  return updated
}

/** 現在のタスク経過秒数を計算する */
export function calcTaskElapsedSec(state: TimerState): number {
  const now = state.pausedAt ?? Date.now()
  return Math.max(0, Math.floor((now - state.taskStartedAt - state.pausedTotal) / 1000))
}
