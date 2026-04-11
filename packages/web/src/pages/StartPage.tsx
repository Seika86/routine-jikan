import { useEffect, useState } from 'react'
import { api, type RoutineDetail, type StartResult } from '../hooks/useApi'
import * as tts from '../lib/tts'

type CostLevel = 'low' | 'medium' | 'high'

const COST_LABELS: Record<CostLevel, { stars: string; label: string }> = {
  low: { stars: '★☆☆', label: 'のんびり' },
  medium: { stars: '★★☆', label: '標準' },
  high: { stars: '★★★', label: 'タイムアタック' },
}

interface Props {
  routineId: string
  onStart: (result: StartResult) => void
  onBack: () => void
}

export function StartPage({ routineId, onStart, onBack }: Props) {
  const [routine, setRoutine] = useState<RoutineDetail | null>(null)
  const [costLevel, setCostLevel] = useState<CostLevel>('medium')
  const [groupOverrides, setGroupOverrides] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    api.getRoutine(routineId).then((r) => {
      setRoutine(r)
      // デフォルトのON/OFF状態をセット
      const defaults: Record<string, boolean> = {}
      for (const item of r.items) {
        if (item.groupId) defaults[item.groupId] = item.isEnabled
      }
      setGroupOverrides(defaults)
    })
  }, [routineId])

  if (!routine) return <div className="text-center py-8 text-text-muted">読み込み中...</div>

  // コストレベルに応じた合計時間を計算
  const totalSec = routine.items.reduce((sum, item) => {
    if (!item.group || !groupOverrides[item.group.id]) return sum
    return sum + item.group.tasks.reduce((tSum, task) => {
      let dur = task.durationSec
      if (costLevel === 'low' && task.costLowSec !== null) dur = task.costLowSec
      if (costLevel === 'high' && task.costHighSec !== null) dur = task.costHighSec
      if (dur === 0) return tSum // 0秒=スキップ
      return tSum + dur
    }, 0)
  }, 0)

  const formatTime = (sec: number) => {
    const h = Math.floor(sec / 3600)
    const m = Math.floor((sec % 3600) / 60)
    if (h > 0) return `${h}時間${m}分`
    return `${m}分`
  }

  const handleStart = async () => {
    setLoading(true)
    // モバイルの音声自動再生制限を解除（ユーザー操作コンテキスト内）
    tts.unlock()
    const result = await api.startRoutine(routineId, { costLevel, groupOverrides })
    onStart(result)
  }

  return (
    <div className="space-y-6">
      {/* 戻るボタン */}
      <button onClick={onBack} className="text-text-muted text-sm">← 戻る</button>

      <h2 className="text-2xl font-bold">{routine.name}</h2>

      {/* コストレベル選択 */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-text-muted">コストレベル</h3>
        <div className="grid grid-cols-3 gap-2">
          {(['low', 'medium', 'high'] as CostLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setCostLevel(level)}
              className={`py-3 rounded-lg text-center transition-all ${
                costLevel === level
                  ? 'bg-primary text-white ring-2 ring-primary'
                  : 'bg-surface text-text-muted hover:bg-surface-light'
              }`}
            >
              <div className="text-lg">{COST_LABELS[level].stars}</div>
              <div className="text-xs mt-1">{COST_LABELS[level].label}</div>
            </button>
          ))}
        </div>
        <p className="text-center text-xl font-bold text-primary">
          見積もり: {formatTime(totalSec)}
        </p>
      </div>

      {/* グループON/OFF */}
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-text-muted">グループ</h3>
        <div className="space-y-1">
          {routine.items.map((item) => {
            if (!item.group) return null
            const enabled = groupOverrides[item.group.id] ?? true
            return (
              <label
                key={item.id}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  enabled ? 'bg-surface' : 'bg-surface/50 opacity-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) =>
                    setGroupOverrides({ ...groupOverrides, [item.group!.id]: e.target.checked })
                  }
                  className="w-5 h-5 rounded accent-primary"
                />
                <div className="flex-1">
                  <span className="font-medium">
                    {item.group.isShared && '★ '}
                    {item.group.name}
                  </span>
                  <span className="text-text-dim text-sm ml-2">
                    {item.group.tasks.length}タスク
                  </span>
                </div>
              </label>
            )
          })}
        </div>
      </div>

      {/* スタートボタン */}
      <button
        onClick={handleStart}
        disabled={loading}
        className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold text-xl py-4 rounded-xl transition-colors"
      >
        {loading ? '準備中...' : '🏁 開始！'}
      </button>
    </div>
  )
}
