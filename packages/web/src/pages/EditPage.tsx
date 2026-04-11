import { useEffect, useState, useCallback } from 'react'
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
import { api, type RoutineDetail, type RoutineItemExpanded, type TaskItem, type GroupListItem } from '../hooks/useApi'
import type { AmbientType } from '../lib/ambient'
import { TaskEditModal } from '../components/TaskEditModal'
import { GroupEditModal } from '../components/GroupEditModal'
import { SortableGroup } from '../components/SortableGroup'

interface Props {
  routineId: string
  onBack: () => void
}

interface EditingTask {
  task: TaskItem
  groupId: string
  groupName: string
}

interface EditingGroup {
  groupId: string
  groupName: string
  isShared: boolean
}

export function EditPage({ routineId, onBack }: Props) {
  const [routine, setRoutine] = useState<RoutineDetail | null>(null)
  const [editingTask, setEditingTask] = useState<EditingTask | null>(null)
  const [editingGroup, setEditingGroup] = useState<EditingGroup | null>(null)
  const [editingRoutine, setEditingRoutine] = useState(false)
  const [showSharedPicker, setShowSharedPicker] = useState(false)
  const [sharedGroups, setSharedGroups] = useState<GroupListItem[]>([])
  const [routineName, setRoutineName] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [ambientSoundType, setAmbientSoundType] = useState<AmbientType>('none')

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  )

  const refresh = useCallback(async () => {
    const r = await api.getRoutine(routineId)
    setRoutine(r)
    setRoutineName(r.name)
    setScheduledTime(r.scheduledTime ?? '')
    setAmbientSoundType((r.defaultAmbientSoundType as AmbientType) ?? 'none')
  }, [routineId])

  useEffect(() => { refresh() }, [refresh])

  if (!routine) return <div className="text-center py-8 text-text-muted">読み込み中...</div>

  const handleSaveRoutine = async () => {
    await api.updateRoutine(routineId, {
      name: routineName,
      scheduledTime: scheduledTime || null,
      defaultAmbientSoundType: ambientSoundType === 'none' ? null : ambientSoundType,
    })
    setEditingRoutine(false)
    await refresh()
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = routine.items.findIndex((i) => i.id === active.id)
    const newIndex = routine.items.findIndex((i) => i.id === over.id)
    const newItems = arrayMove(routine.items, oldIndex, newIndex)

    // 楽観的UI更新
    setRoutine({ ...routine, items: newItems })

    // APIで永続化
    await api.reorderItems(routineId, newItems.map((i) => i.id))
  }

  const handleDeleteTask = async (taskId: string) => {
    await api.deleteTask(taskId)
    await refresh()
  }

  const handleAddTask = async (groupId: string) => {
    await api.addTask(groupId, { name: '新しいタスク', durationSec: 60 })
    await refresh()
  }

  const handleAddGroup = async () => {
    const group = await api.createGroup({ name: '新しいグループ' })
    await api.addRoutineItem(routineId, { itemType: 'group_ref', groupId: group.id })
    await refresh()
  }

  const handleShowSharedPicker = async () => {
    const groups = await api.getGroups()
    // 共有グループで、このルーチンにまだ追加されていないものを表示
    const existingGroupIds = new Set(routine.items.map(i => i.groupId).filter(Boolean))
    setSharedGroups(groups.filter(g => g.isShared && !existingGroupIds.has(g.id)))
    setShowSharedPicker(true)
  }

  const handleAddSharedGroup = async (groupId: string) => {
    await api.addRoutineItem(routineId, { itemType: 'group_ref', groupId })
    setShowSharedPicker(false)
    await refresh()
  }

  const handleDeleteGroup = async (item: RoutineItemExpanded) => {
    await api.deleteRoutineItem(routineId, item.id)
    if (item.group && !item.group.isShared) {
      await api.deleteGroup(item.group.id)
    }
    await refresh()
  }

  return (
    <div className="space-y-6 pb-8">
      <button onClick={onBack} className="text-text-muted text-sm">← 戻る</button>

      {/* ルーチン基本情報 */}
      <div className="bg-surface rounded-xl p-4 space-y-3">
        {editingRoutine ? (
          <>
            <input
              value={routineName}
              onChange={(e) => setRoutineName(e.target.value)}
              className="w-full bg-surface-light rounded-lg px-3 py-2 text-lg font-bold text-text"
              placeholder="ルーチン名"
            />
            <div className="flex items-center gap-2">
              <label className="text-text-muted text-sm">予定時刻</label>
              <input
                type="time"
                value={scheduledTime}
                onChange={(e) => setScheduledTime(e.target.value)}
                className="bg-surface-light rounded-lg px-3 py-2 text-text"
              />
            </div>
            <div>
              <label className="text-text-muted text-sm block mb-1">環境音</label>
              <div className="grid grid-cols-5 gap-1">
                {AMBIENT_OPTIONS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmbientSoundType(value)}
                    className={`py-1.5 rounded-lg text-xs transition-all ${
                      ambientSoundType === value
                        ? 'bg-primary text-white'
                        : 'bg-surface-light text-text-muted hover:text-text'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={handleSaveRoutine} className="bg-primary text-white px-4 py-2 rounded-lg text-sm">保存</button>
              <button onClick={() => setEditingRoutine(false)} className="text-text-muted px-4 py-2 text-sm">キャンセル</button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold">{routine.name}</h2>
              {routine.scheduledTime && <p className="text-text-muted text-sm">{routine.scheduledTime}</p>}
            </div>
            <button onClick={() => setEditingRoutine(true)} className="text-primary text-sm">編集</button>
          </div>
        )}
      </div>

      {/* グループ一覧（ドラッグ&ドロップ） */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={routine.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {routine.items.map((item) => (
              <SortableGroup
                key={item.id}
                item={item}
                onEditTask={(task, gid, gname) => setEditingTask({ task, groupId: gid, groupName: gname })}
                onDeleteTask={handleDeleteTask}
                onAddTask={handleAddTask}
                onEditGroup={(item) => item.group && setEditingGroup({
                  groupId: item.group.id,
                  groupName: item.group.name,
                  isShared: item.group.isShared,
                })}
                onDeleteGroup={handleDeleteGroup}
                onRefresh={refresh}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {/* グループ追加ボタン */}
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={handleAddGroup}
          className="border-2 border-dashed border-surface-light text-text-muted hover:text-text hover:border-primary py-3 rounded-xl transition-colors text-sm"
        >
          + 新規グループ
        </button>
        <button
          onClick={handleShowSharedPicker}
          className="border-2 border-dashed border-surface-light text-text-muted hover:text-text hover:border-primary py-3 rounded-xl transition-colors text-sm"
        >
          ★ 共有グループ追加
        </button>
      </div>

      {/* 共有グループピッカー */}
      {showSharedPicker && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={() => setShowSharedPicker(false)}>
          <div className="bg-bg w-full max-w-lg rounded-t-2xl p-4 space-y-3 max-h-[60vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg">共有グループを追加</h3>
              <button onClick={() => setShowSharedPicker(false)} className="text-text-muted text-sm px-2 py-1">✕</button>
            </div>
            {sharedGroups.length === 0 ? (
              <p className="text-text-muted text-center py-4">追加できる共有グループがありません</p>
            ) : (
              sharedGroups.map(group => (
                <button
                  key={group.id}
                  onClick={() => handleAddSharedGroup(group.id)}
                  className="w-full bg-surface hover:bg-surface-light p-3 rounded-lg text-left transition-colors"
                >
                  <span className="font-medium">★ {group.name}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* グループ編集モーダル */}
      {editingGroup && (
        <GroupEditModal
          groupId={editingGroup.groupId}
          groupName={editingGroup.groupName}
          isShared={editingGroup.isShared}
          onSave={async (updates) => {
            await api.updateGroup(editingGroup.groupId, updates)
            setEditingGroup(null)
            await refresh()
          }}
          onClose={() => setEditingGroup(null)}
        />
      )}

      {/* タスク編集モーダル */}
      {editingTask && (
        <TaskEditModal
          task={editingTask.task}
          groupId={editingTask.groupId}
          groupName={editingTask.groupName}
          allGroups={routine.items
            .filter((i) => i.group)
            .map((i) => ({ id: i.group!.id, name: i.group!.name }))}
          onMove={async (newGroupId) => {
            await api.moveTask(editingTask.task.id, newGroupId)
            setEditingTask(null)
            await refresh()
          }}
          onSave={async (updates) => {
            await api.updateTask(editingTask.task.id, updates)
            setEditingTask(null)
            await refresh()
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  )
}

const AMBIENT_OPTIONS: { value: AmbientType; label: string }[] = [
  { value: 'none', label: 'なし' },
  { value: 'tick', label: 'チクタク' },
  { value: 'wave', label: '波' },
  { value: 'rain', label: '雨' },
  { value: 'whitenoise', label: 'ノイズ' },
]
