import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

// --- ルーチン ---

export const routines = sqliteTable('routines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  scheduledTime: text('scheduled_time'), // "07:00" or null
  defaultAmbientSoundType: text('default_ambient_sound_type'), // tick|wave|rain|whitenoise|none
  defaultAmbientSoundVolume: integer('default_ambient_sound_volume').default(50),
  defaultAmbientSoundDuckOnTts: integer('default_ambient_sound_duck_on_tts', { mode: 'boolean' }).default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// --- タスクグループ ---

export const taskGroups = sqliteTable('task_groups', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  isShared: integer('is_shared', { mode: 'boolean' }).default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// --- タスク（グループに属する） ---

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  groupId: text('group_id').notNull().references(() => taskGroups.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  durationSec: integer('duration_sec').notNull(), // ★★☆ デフォルト
  costLowSec: integer('cost_low_sec'),            // ★☆☆ (null = durationSecと同じ)
  costHighSec: integer('cost_high_sec'),           // ★★★ (null = durationSecと同じ, 0 = 自動スキップ)
  timerOverrun: text('timer_overrun').notNull().default('continue'), // continue | auto-next
  scheduledDays: text('scheduled_days'),           // JSON: ["mon","tue"] or null (=毎日)
  ambientSoundType: text('ambient_sound_type'),    // タスク個別オーバーライド
  ambientSoundVolume: integer('ambient_sound_volume'),
  // NOTE: 以下のTTSフィールドはDB保存のみ。フロントエンドでは未使用（将来の個別タスクTTS設定用に予約）
  ttsOnStart: integer('tts_on_start', { mode: 'boolean' }).default(true),
  ttsOnEnd: integer('tts_on_end', { mode: 'boolean' }).default(true),
  ttsOnRemaining: text('tts_on_remaining'),        // JSON: [60, 30, 10] 秒
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

// --- ルーチンアイテム（タスクまたはグループ参照） ---

export const routineItems = sqliteTable('routine_items', {
  id: text('id').primaryKey(),
  routineId: text('routine_id').notNull().references(() => routines.id, { onDelete: 'cascade' }),
  itemType: text('item_type').notNull(), // "task" | "group_ref"
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
  groupId: text('group_id').references(() => taskGroups.id, { onDelete: 'cascade' }),
  isEnabled: integer('is_enabled', { mode: 'boolean' }).default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
})

// --- 実行記録 ---

export const routineExecutions = sqliteTable('routine_executions', {
  id: text('id').primaryKey(),
  routineId: text('routine_id').notNull().references(() => routines.id),
  costLevel: text('cost_level').notNull(), // low | medium | high
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  status: text('status').notNull(), // in_progress | completed | abandoned
  createdAt: text('created_at').notNull(),
})

// --- タスク実行結果 ---

export const taskResults = sqliteTable('task_results', {
  id: text('id').primaryKey(),
  executionId: text('execution_id').notNull().references(() => routineExecutions.id, { onDelete: 'cascade' }),
  taskName: text('task_name').notNull(),
  groupName: text('group_name'),
  baseDurationSec: integer('base_duration_sec').notNull(),
  plannedDurationSec: integer('planned_duration_sec').notNull(),
  actualDurationSec: integer('actual_duration_sec').notNull().default(0),
  status: text('status').notNull(), // completed | skipped | auto-skipped (day) | auto-skipped (cost)
  startedAt: text('started_at'),
  completedAt: text('completed_at'),
  sortOrder: integer('sort_order').notNull().default(0),
})
