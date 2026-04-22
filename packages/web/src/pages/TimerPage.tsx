import { useEffect, useState, useRef, useCallback, useMemo } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { api, type StartResult, type ExecutionState } from '../hooks/useApi'
import { SortableExecutionTask } from '../components/SortableExecutionTask'
import * as tts from '../lib/tts'
import * as ambient from '../lib/ambient'
import type { AmbientType } from '../lib/ambient'
import {
  type TimerState,
  loadTimerState,
  startTask,
  pauseTimer,
  resumeTimer,
  calcTaskElapsedSec,
  clearTimerState,
} from '../lib/timerState'

interface Props {
  startResult: StartResult
  onFinish: () => void
}

export function TimerPage({ startResult, onFinish }: Props) {
  const [execution, setExecution] = useState<ExecutionState | null>(null)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [totalElapsedSec, setTotalElapsedSec] = useState(0)
  const [paused, setPaused] = useState(false)
  const [completed, setCompleted] = useState(false)
  const [ambientMuted, setAmbientMuted] = useState(false)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastSpokenRemaining = useRef<number | null>(null)
  const prevTaskId = useRef<string | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const lastSpokenOvertime = useRef<number | null>(null)
  const spokenTimeUp = useRef(false)
  const timerStateRef = useRef<TimerState | null>(null)
  const [wakeLockLog, setWakeLockLog] = useState<string[]>([])
  const [showDebug, setShowDebug] = useState(false)
  const [showTaskList, setShowTaskList] = useState(false)
  const [showAbandonConfirm, setShowAbandonConfirm] = useState(false)

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const addLog = useCallback((msg: string) => {
    const time = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    const entry = `${time} ${msg}`
    console.log(`[WakeLock] ${msg}`)
    setWakeLockLog((prev) => [...prev.slice(-9), entry])
  }, [])

  // 画面スリープ防止（Wake Lock API） + 復帰時に再取得
  useEffect(() => {
    const requestWakeLock = async () => {
      if (!('wakeLock' in navigator)) {
        addLog('❌ APIが使えない環境')
        return
      }
      try {
        if (wakeLockRef.current) {
          await wakeLockRef.current.release()
          wakeLockRef.current = null
        }
        wakeLockRef.current = await navigator.wakeLock.request('screen')
        addLog('✅ 取得成功')
        wakeLockRef.current.addEventListener('release', () => {
          addLog('⚠️ 解除された（OS or タブ非表示）')
        })
      } catch (err) {
        addLog(`❌ 取得失敗: ${err}`)
      }
    }
    requestWakeLock()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        addLog('👁️ 画面復帰 → 再取得')
        requestWakeLock()
      } else {
        addLog('😴 画面非表示')
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      wakeLockRef.current?.release()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [addLog])

  // 完了済みタスクの合計実時間を計算するヘルパー
  const calcCompletedTasksSec = useCallback((state: ExecutionState) => {
    return state.tasks
      .filter((t) => t.status === 'completed' || t.status === 'skipped')
      .reduce((sum, t) => sum + (t.actualDurationSec || 0), 0)
  }, [])

  // 実行状態を取得
  const refresh = useCallback(async () => {
    const state = await api.getExecution(startResult.executionId)
    setExecution(state)
    if (state.status !== 'in_progress') {
      setCompleted(true)
      clearTimerState()
    }
    return state
  }, [startResult.executionId])

  // 初期化: APIからstate取得 + localStorageからタイマー復元
  useEffect(() => {
    const init = async () => {
      const state = await refresh()
      if (state.status !== 'in_progress' || !state.currentTask) return

      // localStorageからタイマー状態を復元
      const saved = loadTimerState()
      if (saved && saved.taskId === state.currentTask.id) {
        // 同じタスクのタイマー状態がある → 復元
        timerStateRef.current = saved
        prevTaskId.current = state.currentTask.id
        if (saved.pausedAt !== null) {
          setPaused(true)
        }
      } else {
        // 初回起動 or タスクが変わっている → 新規開始
        timerStateRef.current = startTask(state.currentTask.id)
        prevTaskId.current = state.currentTask.id
      }

      // 即座にelapsedを更新
      const taskElapsed = calcTaskElapsedSec(timerStateRef.current)
      const completedSec = calcCompletedTasksSec(state)
      setElapsedSec(taskElapsed)
      setTotalElapsedSec(completedSec + taskElapsed)
    }
    init()
    // TTS ダッキング連携 + デバッグログ
    tts.setDuckingCallbacks(() => ambient.duckDown(), () => ambient.duckUp())
    tts.setDebugLog((msg) => addLog(`🔊 ${msg}`))
    // 環境音開始
    const soundType = (startResult.defaultAmbientSoundType as AmbientType) ?? 'none'
    const soundVolume = startResult.defaultAmbientSoundVolume ?? 50
    if (soundType !== 'none') {
      ambient.play(soundType, soundVolume)
    }
    // TTS AudioContextのキープアライブ開始（iOS Safari自動suspend対策）
    tts.startKeepAlive()
    return () => { ambient.stop(); tts.stopKeepAlive() }
  }, [refresh, calcCompletedTasksSec])

  // タイマー: localStorageのtaskStartedAtからの差分で毎秒計算
  // + visibilitychange で即時再計算（ブラウザのsetIntervalスロットリング対策）
  useEffect(() => {
    if (paused || completed) return

    const updateElapsed = () => {
      if (!timerStateRef.current || !execution) return
      const taskElapsed = calcTaskElapsedSec(timerStateRef.current)
      const completedSec = calcCompletedTasksSec(execution)
      setElapsedSec(taskElapsed)
      setTotalElapsedSec(completedSec + taskElapsed)
    }

    timerRef.current = setInterval(updateElapsed, 1000)

    // ブラウザがsetIntervalをスロットルしても、画面復帰時に即座に再計算する
    // + AudioContextのresume（suspend状態だとTTSが無音になる対策）
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        tts.resumeContext()
        updateElapsed()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [paused, completed, execution, calcCompletedTasksSec])

  // タスク切り替え時のTTS読み上げ
  useEffect(() => {
    const currentTask = execution?.currentTask
    if (!currentTask || currentTask.id === prevTaskId.current) return
    prevTaskId.current = currentTask.id
    lastSpokenRemaining.current = null
    lastSpokenOvertime.current = null
    spokenTimeUp.current = false
    // localStorageに新タスクの開始時刻を保存
    timerStateRef.current = startTask(currentTask.id)
  }, [execution?.currentTask?.id])

  // 残り時間の読み上げ（60秒、30秒、10秒）
  useEffect(() => {
    const currentTask = execution?.currentTask
    if (!currentTask || paused) return
    const planned = currentTask.plannedDurationSec
    const remaining = planned - elapsedSec
    for (const t of tts.REMAINING_THRESHOLDS) {
      if (t >= planned) continue
      if (remaining === t && lastSpokenRemaining.current !== t) {
        lastSpokenRemaining.current = t
        tts.speakRemaining(t)
        break
      }
    }
  }, [elapsedSec, execution?.currentTask, paused])

  // カウントダウン0到達時の読み上げ（「〇〇終了！次は××」）
  useEffect(() => {
    const currentTask = execution?.currentTask
    if (!currentTask || paused || spokenTimeUp.current) return
    const planned = currentTask.plannedDurationSec
    const remaining = planned - elapsedSec
    if (remaining <= 0) {
      spokenTimeUp.current = true
      const tasks = execution!.tasks
      const currentIdx = tasks.findIndex((t) => t.id === currentTask.id)
      const nextTask = tasks.find((t, i) => i > currentIdx && t.status === 'pending')
      tts.speakTaskEnd(currentTask.taskName, nextTask?.taskName)
    }
  }, [elapsedSec, execution, paused])

  // 超過時間の読み上げ（1分、5分、10分経過）
  useEffect(() => {
    const currentTask = execution?.currentTask
    if (!currentTask || paused) return
    const planned = currentTask.plannedDurationSec
    const overtime = elapsedSec - planned
    for (const t of tts.OVERTIME_THRESHOLDS) {
      if (overtime === t && lastSpokenOvertime.current !== t) {
        lastSpokenOvertime.current = t
        tts.speakOvertime(t)
        break
      }
    }
  }, [elapsedSec, execution?.currentTask, paused])

  // 残りタスクの合計見積もり時間
  const remainingTotalSec = useMemo(() => {
    if (!execution) return 0
    return execution.tasks
      .filter((t) => t.status === 'pending')
      .reduce((sum, t) => sum + t.plannedDurationSec, 0)
  }, [execution])

  // 全体終了予定時刻
  const estimatedEndTime = useMemo(() => {
    if (!execution?.currentTask) return null
    const currentRemaining = Math.max(0, execution.currentTask.plannedDurationSec - elapsedSec)
    const futureTasksSec = execution.tasks
      .filter((t) => t.status === 'pending' && t.id !== execution.currentTask!.id)
      .reduce((sum, t) => sum + t.plannedDurationSec, 0)
    const totalRemainingSec = currentRemaining + futureTasksSec
    return new Date(Date.now() + totalRemainingSec * 1000)
  }, [execution, elapsedSec])

  // 一時停止/再開のハンドラ
  const handleTogglePause = () => {
    if (!timerStateRef.current) return
    if (!paused) {
      timerStateRef.current = pauseTimer(timerStateRef.current)
    } else {
      timerStateRef.current = resumeTimer(timerStateRef.current)
    }
    setPaused(!paused)
  }

  // --- 完了画面 ---
  if (completed && execution) {
    const totalMin = Math.floor(totalElapsedSec / 60)
    const totalSecRem = totalElapsedSec % 60
    const completedCount = execution.tasks.filter(t => t.status === 'completed').length
    const skippedCount = execution.tasks.filter(t => t.status === 'skipped').length

    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-text">
        <div className="text-6xl mb-6">🎉</div>
        <h1 className="text-3xl font-bold mb-2">完了おめでとう！</h1>
        <p className="text-text-muted text-lg mb-8">{execution.routineName}</p>

        <div className="bg-surface rounded-xl p-6 w-full max-w-sm space-y-4 mb-8">
          <div className="flex justify-between">
            <span className="text-text-muted">コストレベル</span>
            <span className="font-bold">{COST_LABELS[execution.costLevel]}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">所要時間</span>
            <span className="font-bold font-mono">{totalMin}:{totalSecRem.toString().padStart(2, '0')}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-text-muted">完了タスク</span>
            <span className="font-bold text-success">{completedCount}</span>
          </div>
          {skippedCount > 0 && (
            <div className="flex justify-between">
              <span className="text-text-muted">スキップ</span>
              <span className="font-bold text-skip">{skippedCount}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-text-muted">終了時刻</span>
            <span className="font-bold">{new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}</span>
          </div>
        </div>

        <button
          onClick={onFinish}
          className="w-full max-w-sm bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl text-lg transition-colors"
        >
          トップへ戻る
        </button>
      </div>
    )
  }

  const currentTask = execution?.currentTask
  if (!execution || !currentTask) {
    return <div className="min-h-screen bg-bg flex items-center justify-center text-text-muted">読み込み中...</div>
  }

  const planned = currentTask.plannedDurationSec
  const remaining = planned - elapsedSec
  const isOverrun = remaining < 0
  const progress = Math.min(elapsedSec / planned, 1)

  // 全体進捗
  const doneCount = execution.completedCount + execution.skippedCount
  const totalActive = execution.totalCount

  const handleComplete = async () => {
    tts.unlock()  // モバイル音声unlock（ユーザー操作コンテキスト）
    const finishedTaskName = currentTask.taskName
    const alreadySpoken = spokenTimeUp.current
    await api.completeTask(startResult.executionId, currentTask.id, elapsedSec)
    setElapsedSec(0)
    const nextState = await api.getExecution(startResult.executionId)
    if (nextState.currentTask) {
      timerStateRef.current = startTask(nextState.currentTask.id)
      prevTaskId.current = nextState.currentTask.id
      // 読み上げ状態を明示的にリセット（タスク切り替えuseEffectがガードで発火しないため）
      lastSpokenRemaining.current = null
      lastSpokenOvertime.current = null
      spokenTimeUp.current = false
      // カウントダウン0で既に読み上げ済みならスキップ
      if (!alreadySpoken) {
        tts.speakTaskEnd(finishedTaskName, nextState.currentTask.taskName)
      }
    } else {
      clearTimerState()
      if (!alreadySpoken) {
        tts.speakTaskEnd(finishedTaskName)
      }
      ambient.stop()
    }
    setExecution(nextState)
    if (nextState.status !== 'in_progress') {
      clearTimerState()
      setCompleted(true)
    }
  }

  const handleSkip = async () => {
    tts.unlock()  // モバイル音声unlock（ユーザー操作コンテキスト）
    const skippedTaskName = currentTask.taskName
    const alreadySpoken = spokenTimeUp.current
    await api.skipTask(startResult.executionId, currentTask.id)
    setElapsedSec(0)
    const nextState = await api.getExecution(startResult.executionId)
    if (nextState.currentTask) {
      timerStateRef.current = startTask(nextState.currentTask.id)
      prevTaskId.current = nextState.currentTask.id
      // 読み上げ状態を明示的にリセット（タスク切り替えuseEffectがガードで発火しないため）
      lastSpokenRemaining.current = null
      lastSpokenOvertime.current = null
      spokenTimeUp.current = false
      if (!alreadySpoken) {
        tts.speakTaskEnd(skippedTaskName, nextState.currentTask.taskName)
      }
    } else {
      clearTimerState()
      if (!alreadySpoken) {
        tts.speakTaskEnd(skippedTaskName)
      }
      ambient.stop()
    }
    setExecution(nextState)
    if (nextState.status !== 'in_progress') {
      clearTimerState()
      setCompleted(true)
    }
  }

  const handleAbandon = async () => {
    await api.abandonExecution(startResult.executionId)
    clearTimerState()
    ambient.stop()
    setCompleted(true)
    await refresh()
  }

  const handleTaskDragEnd = async (event: DragEndEvent) => {
    if (!execution) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const pendingTasks = execution.tasks.filter(t => t.status === 'pending')
    const oldIndex = pendingTasks.findIndex(t => t.id === active.id)
    const newIndex = pendingTasks.findIndex(t => t.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reorderedPending = arrayMove(pendingTasks, oldIndex, newIndex)
    // 楽観的UI更新: 完了済み + 新順序のpending
    const doneTasks = execution.tasks.filter(t => t.status !== 'pending')
    const newTasks = [...doneTasks, ...reorderedPending]
    const newCurrentIndex = newTasks.findIndex(t => t.status === 'pending')
    const newCurrentTask = newCurrentIndex >= 0 ? newTasks[newCurrentIndex] : null

    // 現在タスクが変わったらタイマーリセット
    if (newCurrentTask && newCurrentTask.id !== currentTask.id) {
      timerStateRef.current = startTask(newCurrentTask.id)
      prevTaskId.current = newCurrentTask.id
      setElapsedSec(0)
      lastSpokenRemaining.current = null
      lastSpokenOvertime.current = null
    }

    setExecution({
      ...execution,
      tasks: newTasks,
      currentTaskIndex: newCurrentIndex,
      currentTask: newCurrentTask,
    })

    // API に永続化
    await api.reorderExecution(startResult.executionId, reorderedPending.map(t => t.id))
  }

  const handlePromoteTask = async (taskId: string) => {
    if (!execution) return
    const pendingTasks = execution.tasks.filter(t => t.status === 'pending')
    const targetIndex = pendingTasks.findIndex(t => t.id === taskId)
    if (targetIndex <= 0) return

    const reorderedPending = arrayMove(pendingTasks, targetIndex, 0)
    const doneTasks = execution.tasks.filter(t => t.status !== 'pending')
    const newTasks = [...doneTasks, ...reorderedPending]
    const newCurrentIndex = newTasks.findIndex(t => t.status === 'pending')
    const newCurrentTask = newCurrentIndex >= 0 ? newTasks[newCurrentIndex] : null

    if (newCurrentTask && newCurrentTask.id !== currentTask.id) {
      timerStateRef.current = startTask(newCurrentTask.id)
      prevTaskId.current = newCurrentTask.id
      setElapsedSec(0)
      lastSpokenRemaining.current = null
      lastSpokenOvertime.current = null
    }

    setExecution({
      ...execution,
      tasks: newTasks,
      currentTaskIndex: newCurrentIndex,
      currentTask: newCurrentTask,
    })

    await api.reorderExecution(startResult.executionId, reorderedPending.map(t => t.id))
  }

  const formatTimer = (sec: number) => {
    const abs = Math.abs(sec)
    const m = Math.floor(abs / 60)
    const s = abs % 60
    const sign = sec < 0 ? '+' : ''
    return `${sign}${m}:${s.toString().padStart(2, '0')}`
  }

  const formatTotalTime = (sec: number) => {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const formatEndTime = (date: Date) => {
    return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
  }

  return (
    <div className="flex flex-col min-h-screen bg-bg text-text">
      {/* デバッグログ（ルーチン名タップで表示/非表示） */}
      {showDebug && wakeLockLog.length > 0 && (
        <div className="mx-4 mt-1 p-2 bg-surface rounded text-xs font-mono text-text-dim space-y-0.5 max-h-32 overflow-y-auto">
          {wakeLockLog.map((log, i) => <div key={i}>{log}</div>)}
        </div>
      )}

      {/* ヘッダー情報 */}
      <div className="text-center py-2 text-sm text-text-muted">
        <span onClick={() => setShowDebug(!showDebug)} className="cursor-pointer">{execution.routineName}</span>
        <span className="mx-2">·</span>
        <span>{COST_LABELS[execution.costLevel]}</span>
        <span className="mx-2">·</span>
        <span>{doneCount}/{totalActive}</span>
        <span className="mx-2">·</span>
        <span>経過 {formatTotalTime(totalElapsedSec)}</span>
      </div>

      {/* 終了予定時刻 */}
      {estimatedEndTime && (
        <div className="text-center text-xs text-text-dim pb-1">
          終了予定 {formatEndTime(estimatedEndTime)}
        </div>
      )}

      {/* 全体プログレスバー */}
      <div className="mx-4 h-1.5 bg-surface-light rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-300"
          style={{ width: `${(doneCount / totalActive) * 100}%` }}
        />
      </div>

      {/* タスク一覧パネル */}
      {showTaskList && (
        <div className="mx-4 mt-2 bg-surface rounded-xl p-3 space-y-1.5 max-h-64 overflow-y-auto">
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleTaskDragEnd}>
            <SortableContext
              items={execution.tasks.filter(t => t.status === 'pending').map(t => t.id)}
              strategy={verticalListSortingStrategy}
            >
              {execution.tasks
                .filter(t => !t.status.startsWith('auto-skipped'))
                .map((task) => (
                  <SortableExecutionTask
                    key={task.id}
                    task={task}
                    isCurrent={task.id === currentTask.id}
                    onPromote={handlePromoteTask}
                  />
                ))}
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* メインエリア */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-8">
        {/* グループ名 */}
        {currentTask.groupName && (
          <p className="text-text-dim text-sm mb-1">[{currentTask.groupName}]</p>
        )}

        {/* タスク名 */}
        <h2 className="text-xl font-bold text-center mb-8">{currentTask.taskName}</h2>

        {/* タイマー */}
        <div className={`text-6xl font-mono font-bold mb-2 ${
          isOverrun ? 'text-danger animate-pulse' : 'text-text'
        }`}>
          {formatTimer(remaining)}
        </div>

        {/* 予定時間 */}
        <p className="text-text-dim text-sm mb-4">
          / {formatTimer(planned)}
        </p>

        {/* タスクプログレスバー */}
        <div className="w-full max-w-xs h-2 bg-surface-light rounded-full overflow-hidden mb-8">
          <div
            className={`h-full transition-all duration-1000 ${
              isOverrun ? 'bg-danger' : 'bg-primary'
            }`}
            style={{ width: `${Math.min(progress * 100, 100)}%` }}
          />
        </div>
      </div>

      {/* 操作ボタン */}
      <div className="px-4 pb-6 space-y-3">
        {/* メインアクション */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={handleSkip}
            className="bg-skip hover:bg-skip/80 text-white font-bold py-4 rounded-xl text-lg transition-colors"
          >
            ⏭️ スキップ
          </button>
          <button
            onClick={handleComplete}
            className="bg-success hover:bg-success/80 text-white font-bold py-4 rounded-xl text-lg transition-colors"
          >
            ✅ 完了！
          </button>
        </div>

        {/* サブアクション */}
        <div className="flex justify-between items-center">
          <button
            onClick={handleTogglePause}
            className="text-text-muted hover:text-text text-sm py-2 px-4"
          >
            {paused ? '▶️ 再開' : '⏸ 一時停止'}
          </button>
          <button
            onClick={() => setShowTaskList(!showTaskList)}
            className="text-text-muted hover:text-text text-sm py-2 px-4"
          >
            📋
          </button>
          <button
            onClick={() => setAmbientMuted(ambient.toggleMute())}
            className="text-text-muted hover:text-text text-sm py-2 px-4"
          >
            {ambientMuted ? '🔇' : '🔊'}
          </button>
          <button
            onClick={() => setShowAbandonConfirm(true)}
            className="text-danger/60 hover:text-danger text-sm py-2 px-4"
          >
            中断する
          </button>
        </div>
      </div>

      {/* 中断確認ダイアログ */}
      {showAbandonConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6" onClick={() => setShowAbandonConfirm(false)}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">ルーチンを中断しますか？</h3>
            <p className="text-text-muted text-sm">
              現在の進捗は保存されますが、残りのタスクはスキップされます。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowAbandonConfirm(false)}
                className="flex-1 bg-surface-light text-text font-bold py-3 rounded-xl transition-colors"
              >
                続ける
              </button>
              <button
                onClick={() => { setShowAbandonConfirm(false); handleAbandon() }}
                className="flex-1 bg-danger text-white font-bold py-3 rounded-xl transition-colors"
              >
                中断する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const COST_LABELS: Record<string, string> = {
  low: '★☆☆',
  medium: '★★☆',
  high: '★★★',
}
