import { useState } from 'react'
import type { TaskItem, TaskUpdate } from '../hooks/useApi'

const ALL_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
const DAY_LABELS: Record<string, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' }

interface GroupOption {
  id: string
  name: string
}

interface Props {
  task: TaskItem
  groupId: string
  groupName: string
  allGroups?: GroupOption[]
  onSave: (updates: TaskUpdate) => Promise<void>
  onMove?: (newGroupId: string) => Promise<void>
  onClose: () => void
}



export function TaskEditModal({ task, groupId, groupName, allGroups, onSave, onMove, onClose }: Props) {
  const [name, setName] = useState(task.name)
  const [durationMin, setDurationMin] = useState(Math.floor(task.durationSec / 60))
  const [durationSec, setDurationSec] = useState(task.durationSec % 60)
  const [costLowMin, setCostLowMin] = useState(task.costLowSec !== null ? Math.floor(task.costLowSec / 60) : '')
  const [costHighMin, setCostHighMin] = useState(task.costHighSec !== null ? Math.floor(task.costHighSec / 60) : '')
  const [timerOverrun, setTimerOverrun] = useState(task.timerOverrun ?? 'continue')
  const [scheduledDays, setScheduledDays] = useState<string[]>(
    task.scheduledDays ? JSON.parse(task.scheduledDays) : []
  )
  const [useSchedule, setUseSchedule] = useState(task.scheduledDays !== null)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    await onSave({
      name,
      durationSec: durationMin * 60 + durationSec,
      costLowSec: costLowMin !== '' ? Number(costLowMin) * 60 : null,
      costHighSec: costHighMin !== '' ? Number(costHighMin) * 60 : null,
      timerOverrun,
      scheduledDays: useSchedule && scheduledDays.length > 0 ? scheduledDays : null,
    })
    setSaving(false)
  }

  const toggleDay = (day: string) => {
    setScheduledDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center">
      <div className="bg-surface w-full max-w-lg rounded-t-2xl sm:rounded-2xl p-6 max-h-[90vh] overflow-y-auto space-y-5">
        {/* ヘッダー */}
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg">タスク編集</h3>
          <button onClick={onClose} className="text-text-muted hover:text-text text-xl">×</button>
        </div>

        <p className="text-text-dim text-xs">{groupName}</p>

        {/* タスク名 */}
        <div className="space-y-1">
          <label className="text-text-muted text-sm">タスク名</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-surface-light rounded-lg px-3 py-2 text-text"
          />
        </div>

        {/* デフォルト時間 ★★☆ */}
        <div className="space-y-1">
          <label className="text-text-muted text-sm">デフォルト時間 ★★☆</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="0"
              value={durationMin}
              onChange={(e) => setDurationMin(Number(e.target.value))}
              className="w-20 bg-surface-light rounded-lg px-3 py-2 text-text text-center"
            />
            <span className="text-text-muted">分</span>
            <input
              type="number"
              min="0"
              max="59"
              value={durationSec}
              onChange={(e) => setDurationSec(Number(e.target.value))}
              className="w-20 bg-surface-light rounded-lg px-3 py-2 text-text text-center"
            />
            <span className="text-text-muted">秒</span>
          </div>
        </div>

        {/* コストオーバーライド */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-text-muted text-sm">★☆☆ のんびり</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                value={costLowMin}
                onChange={(e) => setCostLowMin(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="—"
                className="w-full bg-surface-light rounded-lg px-3 py-2 text-text text-center"
              />
              <span className="text-text-muted text-sm">分</span>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-text-muted text-sm">★★★ タイムアタック</label>
            <div className="flex items-center gap-1">
              <input
                type="number"
                min="0"
                value={costHighMin}
                onChange={(e) => setCostHighMin(e.target.value === '' ? '' : Number(e.target.value))}
                placeholder="—"
                className="w-full bg-surface-light rounded-lg px-3 py-2 text-text text-center"
              />
              <span className="text-text-muted text-sm">分</span>
            </div>
            <p className="text-text-dim text-xs">0分 = 自動スキップ</p>
          </div>
        </div>

        {/* タイマー超過 */}
        <div className="space-y-1">
          <label className="text-text-muted text-sm">タイマー超過時</label>
          <div className="grid grid-cols-2 gap-2">
            {(['continue', 'auto-next'] as const).map((opt) => (
              <button
                key={opt}
                onClick={() => setTimerOverrun(opt)}
                className={`py-2 rounded-lg text-sm transition-colors ${
                  timerOverrun === opt
                    ? 'bg-primary text-white'
                    : 'bg-surface-light text-text-muted'
                }`}
              >
                {opt === 'continue' ? 'カウントアップ' : '自動スキップ'}
              </button>
            ))}
          </div>
        </div>

        {/* 曜日スケジュール */}
        <div className="space-y-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useSchedule}
              onChange={(e) => setUseSchedule(e.target.checked)}
              className="w-4 h-4 accent-primary"
            />
            <span className="text-text-muted text-sm">曜日スケジュール</span>
          </label>
          {useSchedule && (
            <div className="flex gap-1">
              {ALL_DAYS.map((day) => (
                <button
                  key={day}
                  onClick={() => toggleDay(day)}
                  className={`w-10 h-10 rounded-full text-sm font-bold transition-colors ${
                    scheduledDays.includes(day)
                      ? 'bg-primary text-white'
                      : 'bg-surface-light text-text-dim'
                  }`}
                >
                  {DAY_LABELS[day]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* グループ間移動 */}
        {allGroups && allGroups.length > 1 && onMove && (
          <div className="space-y-1">
            <label className="text-text-muted text-sm">グループ移動</label>
            <select
              value={groupId}
              onChange={async (e) => {
                if (e.target.value !== groupId) {
                  await onMove(e.target.value)
                }
              }}
              className="w-full bg-surface-light rounded-lg px-3 py-2 text-text"
            >
              {allGroups.map((g) => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* 保存ボタン */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full bg-primary hover:bg-primary-dark disabled:opacity-50 text-white font-bold py-3 rounded-xl transition-colors"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}
