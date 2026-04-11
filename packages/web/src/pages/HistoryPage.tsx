import { useEffect, useState } from 'react'
import { api } from '../hooks/useApi'

interface ExecutionSummary {
  id: string
  routineName: string
  costLevel: string
  startedAt: string
  completedAt: string | null
  status: string
  completedCount: number
  skippedCount: number
  totalCount: number
  totalActualSec: number
}

interface Props {
  onBack: () => void
  onResume: (executionId: string) => void
}

export function HistoryPage({ onBack, onResume }: Props) {
  const [executions, setExecutions] = useState<ExecutionSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [deleteTarget, setDeleteTarget] = useState<ExecutionSummary | null>(null)

  useEffect(() => {
    fetch('/api/executions')
      .then((r) => r.json())
      .then((data) => { setExecutions(data); setLoading(false) })
  }, [])

  const handleDelete = async () => {
    if (!deleteTarget) return
    await api.deleteExecution(deleteTarget.id)
    setExecutions((prev) => prev.filter((e) => e.id !== deleteTarget.id))
    setDeleteTarget(null)
  }

  const handleExportCSV = () => {
    window.open('/api/executions/export?format=csv', '_blank')
  }

  const handleExportJSON = () => {
    window.open('/api/executions/export?format=json', '_blank')
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="text-text-muted text-sm">← 戻る</button>
        <div className="flex gap-2">
          <button onClick={handleExportCSV} className="text-primary text-sm px-3 py-1 bg-surface rounded-lg">CSV</button>
          <button onClick={handleExportJSON} className="text-primary text-sm px-3 py-1 bg-surface rounded-lg">JSON</button>
        </div>
      </div>

      <h2 className="text-xl font-bold">実行履歴</h2>

      {loading && <p className="text-text-muted text-center py-8">読み込み中...</p>}

      {!loading && executions.length === 0 && (
        <p className="text-text-muted text-center py-8">まだ実行履歴がありません</p>
      )}

      {/* 削除確認ダイアログ */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-6" onClick={() => setDeleteTarget(null)}>
          <div className="bg-surface rounded-xl p-6 w-full max-w-sm space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold">履歴を削除しますか？</h3>
            <p className="text-text-muted text-sm">
              {deleteTarget.routineName}（{new Date(deleteTarget.startedAt).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric' })}）の記録を削除します。この操作は取り消せません。
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 bg-surface-light text-text font-bold py-3 rounded-xl transition-colors"
              >
                キャンセル
              </button>
              <button
                onClick={handleDelete}
                className="flex-1 bg-danger text-white font-bold py-3 rounded-xl transition-colors"
              >
                削除する
              </button>
            </div>
          </div>
        </div>
      )}

      {executions.map((exec) => {
        const date = new Date(exec.startedAt)
        const dateStr = date.toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', weekday: 'short' })
        const timeStr = date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })
        const totalMin = Math.floor(exec.totalActualSec / 60)
        const totalSecRem = exec.totalActualSec % 60

        return (
          <div key={exec.id} className="bg-surface rounded-xl p-4 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-semibold">{exec.routineName}</span>
                <span className="text-text-muted text-sm ml-2">{COST_LABELS[exec.costLevel]}</span>
              </div>
              <StatusBadge status={exec.status} />
            </div>
            <div className="flex items-center gap-4 text-sm text-text-muted">
              <span>{dateStr} {timeStr}</span>
              <span className="font-mono">{totalMin}:{totalSecRem.toString().padStart(2, '0')}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-xs">
                <span className="text-success">✅ {exec.completedCount}</span>
                {exec.skippedCount > 0 && <span className="text-skip">⏭️ {exec.skippedCount}</span>}
                <span className="text-text-dim">/ {exec.totalCount}</span>
              </div>
              <div className="flex items-center gap-2">
                {exec.status === 'in_progress' && (
                  <button
                    onClick={() => onResume(exec.id)}
                    className="bg-warning/20 text-warning text-xs font-bold px-3 py-1.5 rounded-lg hover:bg-warning/30 transition-colors"
                  >
                    ▶️ 再開する
                  </button>
                )}
                <button
                  onClick={() => setDeleteTarget(exec)}
                  className="text-text-dim hover:text-danger text-xs px-2 py-1.5 rounded-lg transition-colors"
                >
                  🗑️
                </button>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: 'bg-success/20 text-success',
    abandoned: 'bg-danger/20 text-danger',
    in_progress: 'bg-warning/20 text-warning',
  }
  const labels: Record<string, string> = {
    completed: '完了',
    abandoned: '中断',
    in_progress: '実行中',
  }
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${styles[status] ?? 'bg-surface-light text-text-dim'}`}>
      {labels[status] ?? status}
    </span>
  )
}

const COST_LABELS: Record<string, string> = {
  low: '★☆☆',
  medium: '★★☆',
  high: '★★★',
}
