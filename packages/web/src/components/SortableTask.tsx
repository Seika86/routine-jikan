import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskItem } from '../hooks/useApi'

interface Props {
  task: TaskItem
  onEdit: () => void
  onDelete: () => void
}

export function SortableTask({ task, onEdit, onDelete }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className="flex items-center px-4 py-3 gap-2">
      {/* ドラッグハンドル */}
      <span
        {...attributes}
        {...listeners}
        className="text-text-dim cursor-grab active:cursor-grabbing touch-none text-xs select-none"
      >
        ⠿
      </span>

      <div className="flex-1 min-w-0">
        <p className="text-sm truncate">{task.name}</p>
        <div className="flex items-center gap-2 text-xs text-text-dim">
          <span>{formatDuration(task.durationSec)}</span>
          {task.costHighSec !== null && task.costHighSec === 0 && (
            <span className="text-warning">★★★でスキップ</span>
          )}
          {task.costHighSec !== null && task.costHighSec > 0 && (
            <span>★★★ {formatDuration(task.costHighSec)}</span>
          )}
          {task.scheduledDays && (
            <span className="text-primary">{formatDays(task.scheduledDays)}</span>
          )}
        </div>
      </div>
      <button
        onClick={onEdit}
        className="text-text-muted hover:text-text text-sm px-2 py-1 shrink-0"
      >
        編集
      </button>
      <button
        onClick={onDelete}
        className="text-danger/40 hover:text-danger text-sm px-2 py-1 shrink-0"
      >
        ×
      </button>
    </div>
  )
}

function formatDuration(sec: number): string {
  if (sec === 0) return '0秒'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}秒`
  if (s === 0) return `${m}分`
  return `${m}分${s}秒`
}

function formatDays(json: string): string {
  const days: string[] = JSON.parse(json)
  const labels: Record<string, string> = { mon: '月', tue: '火', wed: '水', thu: '木', fri: '金', sat: '土', sun: '日' }
  return days.map(d => labels[d] ?? d).join('・')
}
