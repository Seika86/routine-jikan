const BASE = '/api'

async function fetchJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options?.headers },
  })
  if (!res.ok) {
    throw new Error(`API error: ${options?.method ?? 'GET'} ${path} → ${res.status}`)
  }
  return res.json()
}

export const api = {
  // ルーチン
  getRoutines: () => fetchJson<RoutineListItem[]>('/routines'),
  getRoutine: (id: string) => fetchJson<RoutineDetail>(`/routines/${id}`),

  createRoutine: (body: { name: string }) =>
    fetchJson<RoutineListItem>('/routines', { method: 'POST', body: JSON.stringify(body) }),
  deleteRoutine: (id: string) =>
    fetchJson(`/routines/${id}`, { method: 'DELETE' }),

  // 実行
  startRoutine: (id: string, body: StartBody) =>
    fetchJson<StartResult>(`/routines/${id}/start`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getExecution: (id: string) => fetchJson<ExecutionState>(`/executions/${id}`),
  completeTask: (execId: string, taskId: string, actualDurationSec: number) =>
    fetchJson(`/executions/${execId}/tasks/${taskId}/complete`, {
      method: 'POST',
      body: JSON.stringify({ actualDurationSec }),
    }),
  skipTask: (execId: string, taskId: string) =>
    fetchJson(`/executions/${execId}/tasks/${taskId}/skip`, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  abandonExecution: (execId: string) =>
    fetchJson(`/executions/${execId}/abandon`, { method: 'POST' }),
  reorderExecution: (execId: string, taskIds: string[]) =>
    fetchJson(`/executions/${execId}/reorder`, { method: 'PUT', body: JSON.stringify({ taskIds }) }),
  deleteExecution: (execId: string) =>
    fetchJson(`/executions/${execId}`, { method: 'DELETE' }),

  // ルーチン編集
  updateRoutine: (id: string, body: Record<string, unknown>) =>
    fetchJson(`/routines/${id}`, { method: 'PUT', body: JSON.stringify(body) }),

  // グループ
  createGroup: (body: { name: string; isShared?: boolean }) =>
    fetchJson<{ id: string }>('/groups', { method: 'POST', body: JSON.stringify(body) }),
  updateGroup: (id: string, body: { name?: string; isShared?: boolean }) =>
    fetchJson(`/groups/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteGroup: (id: string) =>
    fetchJson(`/groups/${id}`, { method: 'DELETE' }),

  getGroups: () =>
    fetchJson<GroupListItem[]>('/groups'),

  // タスク
  addTask: (groupId: string, body: { name: string; durationSec: number }) =>
    fetchJson(`/groups/${groupId}/tasks`, { method: 'POST', body: JSON.stringify(body) }),
  updateTask: (id: string, body: TaskUpdate) =>
    fetchJson(`/tasks/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTask: (id: string) =>
    fetchJson(`/tasks/${id}`, { method: 'DELETE' }),
  reorderTasks: (groupId: string, taskIds: string[]) =>
    fetchJson(`/groups/${groupId}/tasks/reorder`, { method: 'PUT', body: JSON.stringify({ taskIds }) }),
  moveTask: (taskId: string, newGroupId: string) =>
    fetchJson(`/tasks/${taskId}`, { method: 'PUT', body: JSON.stringify({ groupId: newGroupId }) }),

  // ルーチンアイテム
  addRoutineItem: (routineId: string, body: { itemType: string; groupId?: string }) =>
    fetchJson(`/routines/${routineId}/items`, { method: 'POST', body: JSON.stringify(body) }),
  deleteRoutineItem: (routineId: string, itemId: string) =>
    fetchJson(`/routines/${routineId}/items/${itemId}`, { method: 'DELETE' }),
  reorderItems: (routineId: string, itemIds: string[]) =>
    fetchJson(`/routines/${routineId}/items/reorder`, { method: 'PUT', body: JSON.stringify({ itemIds }) }),
}

// --- 型定義 ---

export interface RoutineListItem {
  id: string
  name: string
  scheduledTime: string | null
  defaultAmbientSoundType: string | null
  defaultAmbientSoundVolume: number
}

export interface RoutineDetail extends RoutineListItem {
  items: RoutineItemExpanded[]
}

export interface RoutineItemExpanded {
  id: string
  routineId: string
  itemType: string
  groupId: string | null
  isEnabled: boolean
  sortOrder: number
  group?: {
    id: string
    name: string
    isShared: boolean
    tasks: TaskItem[]
  }
}

export interface GroupListItem {
  id: string
  name: string
  isShared: boolean
}

export interface TaskItem {
  id: string
  name: string
  durationSec: number
  costLowSec: number | null
  costHighSec: number | null
  timerOverrun: string | null
  scheduledDays: string | null
}

export interface TaskUpdate {
  name?: string
  durationSec?: number
  costLowSec?: number | null
  costHighSec?: number | null
  timerOverrun?: string
  scheduledDays?: string[] | null
  groupId?: string
}

export interface StartBody {
  costLevel: 'low' | 'medium' | 'high'
  groupOverrides?: Record<string, boolean>
}

export interface StartResult {
  executionId: string
  routineName: string
  costLevel: string
  startedAt: string
  tasks: TaskResult[]
  activeTasks: TaskResult[]
  skippedTasks: TaskResult[]
  totalPlannedSec: number
  defaultAmbientSoundType: string | null
  defaultAmbientSoundVolume: number
}

export interface TaskResult {
  id: string
  taskName: string
  groupName: string | null
  baseDurationSec: number
  plannedDurationSec: number
  actualDurationSec: number
  status: string
  startedAt: string | null
  completedAt: string | null
}

export interface ExecutionState {
  id: string
  routineId: string
  routineName: string
  costLevel: string
  startedAt: string
  status: string
  tasks: TaskResult[]
  currentTaskIndex: number
  currentTask: TaskResult | null
  completedCount: number
  skippedCount: number
  totalCount: number
}
