import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { TaskResult } from '../hooks/useApi'

interface Props {
  task: TaskResult
  isCurrent: boolean
  onPromote?: (taskId: string) => void
}

export function SortableExecutionTask({ task, isCurrent, onPromote }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: task.status !== 'pending',  // current task is also pending
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const statusIcon = task.status === 'completed' ? '✅'
    : task.status === 'skipped' ? '⏭️'
    : task.status.startsWith('auto-skipped') ? '⏩'
    : isCurrent ? '▶️'
    : ''

  const isDone = task.status !== 'pending'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg ${
        isCurrent ? 'bg-primary/20 ring-1 ring-primary' : isDone ? 'opacity-40' : 'bg-surface-light'
      }`}
    >
      {/* ドラッグハンドル（pending + current） */}
      {!isDone ? (
        <span
          {...attributes}
          {...listeners}
          className="text-text-dim cursor-grab active:cursor-grabbing touch-none text-xs select-none"
        >
          ⠿
        </span>
      ) : (
        <span className="text-xs w-4 text-center">{statusIcon}</span>
      )}

      <div className="flex-1 min-w-0">
        <p className={`text-sm truncate ${isDone ? 'line-through' : ''}`}>{task.taskName}</p>
        {task.groupName && (
          <p className="text-xs text-text-dim truncate">{task.groupName}</p>
        )}
      </div>

      {!isDone && !isCurrent && onPromote && (
        <button
          type="button"
          onClick={() => onPromote(task.id)}
          className="text-primary hover:opacity-80 active:opacity-60 shrink-0 w-7 h-7 flex items-center justify-center rounded-full bg-primary/10 touch-manipulation"
          aria-label="このタスクを次に実行"
        >
          ▶
        </button>
      )}

      <span className="text-xs text-text-dim font-mono shrink-0">
        {formatDuration(task.plannedDurationSec)}
      </span>
    </div>
  )
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}秒`
  if (s === 0) return `${m}分`
  return `${m}:${s.toString().padStart(2, '0')}`
}
