export type CostLevel = 'low' | 'medium' | 'high'

export type TaskStatus = 'completed' | 'skipped' | 'auto-skipped (day)' | 'auto-skipped (cost)'

export type TimerOverrunBehavior = 'continue' | 'auto-next'

export type AmbientSoundType = 'tick' | 'wave' | 'rain' | 'whitenoise' | 'none'

export type DayOfWeek = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

export interface TaskDef {
  name: string
  durationSec: number
  costLowSec: number | null
  costHighSec: number | null
  scheduledDays: DayOfWeek[] | null
  timerOverrun: TimerOverrunBehavior
}

export interface GroupDef {
  name: string
  tasks: TaskDef[]
  isShared: boolean
}
