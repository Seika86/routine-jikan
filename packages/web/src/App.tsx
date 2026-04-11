import { useWakeLock } from './hooks/useWakeLock'
import { useEffect, useState, useCallback } from 'react'
import { Layout } from './components/Layout'
import { StartPage } from './pages/StartPage'
import { TimerPage } from './pages/TimerPage'
import { EditPage } from './pages/EditPage'
import { HistoryPage } from './pages/HistoryPage'
import { api, type RoutineListItem, type StartResult } from './hooks/useApi'
import * as tts from './lib/tts'

const TIMER_SESSION_KEY = 'routine-jikan-active-timer'

type Page =
  | { type: 'home' }
  | { type: 'start'; routineId: string }
  | { type: 'timer'; startResult: StartResult }
  | { type: 'edit'; routineId: string }
  | { type: 'history' }

type TTSMode = 'external' | 'web-speech' | 'off'

const TTS_LABEL = import.meta.env.VITE_TTS_LABEL || 'TTS Server'

/** スリープ復帰時にタイマーを復元するため、sessionStorageから復元を試みる */
function tryRestoreTimerSession(): Page | null {
  try {
    const saved = sessionStorage.getItem(TIMER_SESSION_KEY)
    if (saved) {
      const startResult = JSON.parse(saved) as StartResult
      return { type: 'timer', startResult }
    }
  } catch {}
  return null
}

export function App() {
  useWakeLock()
  const [page, setPage] = useState<Page>(() => tryRestoreTimerSession() ?? { type: 'home' })
  const [routines, setRoutines] = useState<RoutineListItem[]>([])
  const [showSettings, setShowSettings] = useState(false)
  const [ttsMode, setTtsMode] = useState<TTSMode>(() => {
    const cfg = tts.getTTSConfig()
    if (!cfg.enabled) return 'off'
    return cfg.provider
  })

  // セッション復元時にAPIでin_progressか確認
  useEffect(() => {
    if (page.type !== 'timer') return
    const checkExecution = async () => {
      try {
        const state = await api.getExecution(page.startResult.executionId)
        if (state.status !== 'in_progress') {
          // 既に終了している場合はホームに戻る
          sessionStorage.removeItem(TIMER_SESSION_KEY)
          setPage({ type: 'home' })
        }
      } catch {
        // API失敗 → ホームに戻る
        sessionStorage.removeItem(TIMER_SESSION_KEY)
        setPage({ type: 'home' })
      }
    }
    checkExecution()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleTtsChange = (mode: TTSMode) => {
    setTtsMode(mode)
    if (mode === 'off') {
      tts.setTTSConfig({ enabled: false })
    } else {
      tts.setTTSConfig({ enabled: true, provider: mode })
    }
  }

  const refreshRoutines = useCallback(() => {
    api.getRoutines().then(setRoutines)
  }, [])

  useEffect(() => { refreshRoutines() }, [refreshRoutines])

  const goHome = () => {
    sessionStorage.removeItem(TIMER_SESSION_KEY)
    setPage({ type: 'home' })
    refreshRoutines()
  }

  const startTimer = (result: StartResult) => {
    try { sessionStorage.setItem(TIMER_SESSION_KEY, JSON.stringify(result)) } catch {}
    setPage({ type: 'timer', startResult: result })
  }

  const resumeExecution = async (executionId: string) => {
    try {
      // 実行状態とルーチン情報を取得してStartResultを組み立てる
      const exec = await api.getExecution(executionId)
      if (exec.status !== 'in_progress') return
      const routine = await api.getRoutine(exec.routineId)
      const startResult: StartResult = {
        executionId: exec.id,
        routineName: exec.routineName,
        costLevel: exec.costLevel,
        startedAt: exec.startedAt,
        tasks: exec.tasks,
        activeTasks: exec.tasks.filter(t => t.status !== 'skipped'),
        skippedTasks: exec.tasks.filter(t => t.status === 'skipped'),
        totalPlannedSec: exec.tasks
          .filter(t => t.status === 'pending' || t.status === 'in_progress')
          .reduce((sum, t) => sum + t.plannedDurationSec, 0),
        defaultAmbientSoundType: routine.defaultAmbientSoundType ?? null,
        defaultAmbientSoundVolume: routine.defaultAmbientSoundVolume ?? 50,
      }
      startTimer(startResult)
    } catch (e) {
      console.error('Failed to resume execution:', e)
    }
  }

  if (page.type === 'start') {
    return (
      <Layout>
        <StartPage
          routineId={page.routineId}
          onStart={startTimer}
          onBack={goHome}
        />
      </Layout>
    )
  }

  if (page.type === 'timer') {
    return (
      <TimerPage
        startResult={page.startResult}
        onFinish={goHome}
      />
    )
  }

  if (page.type === 'history') {
    return (
      <Layout>
        <HistoryPage onBack={goHome} onResume={resumeExecution} />
      </Layout>
    )
  }

  if (page.type === 'edit') {
    return (
      <Layout>
        <EditPage routineId={page.routineId} onBack={goHome} />
      </Layout>
    )
  }

  return (
    <Layout>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">ルーチン</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="text-text-muted hover:text-text text-sm"
            >
              ⚙️
            </button>
            <button
              onClick={() => setPage({ type: 'history' })}
              className="text-text-muted hover:text-text text-sm"
            >
              📊 履歴
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="bg-surface rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-semibold text-text-muted">🔊 音声読み上げ</h3>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'external' as TTSMode, label: TTS_LABEL },
                { value: 'web-speech' as TTSMode, label: '端末音声' },
                { value: 'off' as TTSMode, label: 'OFF' },
              ]).map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => handleTtsChange(value)}
                  className={`py-2 rounded-lg text-sm transition-all ${
                    ttsMode === value
                      ? 'bg-primary text-white'
                      : 'bg-surface-light text-text-muted hover:text-text'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {routines.length === 0 && (
          <p className="text-text-muted text-center py-8">読み込み中...</p>
        )}

        {routines.map((routine) => (
          <div key={routine.id} className="bg-surface rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-lg">{routine.name}</span>
              <div className="flex items-center gap-3">
                {routine.scheduledTime && (
                  <span className="text-text-muted text-sm">⏰ {routine.scheduledTime}</span>
                )}
                <button
                  onClick={() => setPage({ type: 'edit', routineId: routine.id })}
                  className="text-text-dim hover:text-text text-sm"
                >
                  ✏️
                </button>
              </div>
            </div>
            {routine.defaultAmbientSoundType && (
              <p className="text-text-dim text-sm">
                🔊 {SOUND_LABELS[routine.defaultAmbientSoundType] ?? routine.defaultAmbientSoundType}
              </p>
            )}
            <button
              onClick={() => setPage({ type: 'start', routineId: routine.id })}
              className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-3 rounded-lg transition-colors"
            >
              スタート
            </button>
          </div>
        ))}

        {/* ルーチン追加ボタン */}
        <button
          onClick={async () => {
            const routine = await api.createRoutine({ name: '新しいルーチン' })
            refreshRoutines()
            setPage({ type: 'edit', routineId: routine.id })
          }}
          className="w-full border-2 border-dashed border-surface-light text-text-muted hover:text-text hover:border-primary py-4 rounded-xl transition-colors"
        >
          + ルーチンを追加
        </button>
      </div>
    </Layout>
  )
}

const SOUND_LABELS: Record<string, string> = {
  tick: 'チクタク',
  wave: '波の音',
  rain: '雨音',
  whitenoise: 'ホワイトノイズ',
}
