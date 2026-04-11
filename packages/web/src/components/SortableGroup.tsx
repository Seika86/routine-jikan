import { useSortable } from '@dnd-kit/sortable'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { SortableTask } from './SortableTask'
import { api, type RoutineItemExpanded, type TaskItem } from '../hooks/useApi'
import { useState, useEffect } from 'react'

interface Props {
  item: RoutineItemExpanded
  onEditTask: (task: TaskItem, groupId: string, groupName: string) => void
  onDeleteTask: (taskId: string) => void
  onAddTask: (groupId: string) => void
  onEditGroup: (item: RoutineItemExpanded) => void
  onDeleteGroup: (item: RoutineItemExpanded) => void
  onRefresh: () => void
}

export function SortableGroup({ item, onEditTask, onDeleteTask, onAddTask, onEditGroup, onDeleteGroup, onRefresh }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  })
  const [tasks, setTasks] = useState(item.group?.tasks ?? [])

  // propsからタスクを同期（refresh後に名前・時間等の変更を反映）
  useEffect(() => {
    if (item.group) {
      setTasks(item.group.tasks)
    }
  }, [item])

  const taskSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  if (!item.group) return null
  const group = item.group

  const handleTaskDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = tasks.findIndex((t) => t.id === active.id)
    const newIndex = tasks.findIndex((t) => t.id === over.id)
    const newTasks = arrayMove(tasks, oldIndex, newIndex)

    // 楽観的UI更新
    setTasks(newTasks)

    // APIで永続化
    await api.reorderTasks(group.id, newTasks.map((t) => t.id))
    onRefresh()
  }

  return (
    <div ref={setNodeRef} style={style} className="bg-surface rounded-xl overflow-hidden">
      {/* グループヘッダー */}
      <div className="flex items-center justify-between px-4 py-3 bg-surface-light">
        <div className="flex items-center gap-2">
          <span
            {...attributes}
            {...listeners}
            className="text-text-dim cursor-grab active:cursor-grabbing touch-none select-none"
          >⠿</span>
          {group.isShared && <span className="text-warning text-xs">★共有</span>}
          <span className="font-semibold">{group.name}</span>
          <span className="text-text-dim text-xs">{group.tasks.length}タスク</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => onAddTask(group.id)}
            className="text-primary text-sm px-1 py-1"
          >
            ➕
          </button>
          <button
            onClick={() => onEditGroup(item)}
            className="text-text-muted hover:text-text text-sm px-1 py-1"
          >
            ⚙️
          </button>
          <button
            onClick={() => onDeleteGroup(item)}
            className="text-danger/60 hover:text-danger text-sm px-1 py-1"
          >
            🗑
          </button>
        </div>
      </div>

      {/* タスク一覧（ドラッグ&ドロップ） */}
      <DndContext sensors={taskSensors} collisionDetection={closestCenter} onDragEnd={handleTaskDragEnd}>
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          <div className="divide-y divide-surface-light">
            {tasks.map((task) => (
              <SortableTask
                key={task.id}
                task={task}
                onEdit={() => onEditTask(task, group.id, group.name)}
                onDelete={() => onDeleteTask(task.id)}
              />
            ))}
            {tasks.length === 0 && (
              <p className="px-4 py-3 text-text-dim text-sm">タスクなし</p>
            )}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  )
}
