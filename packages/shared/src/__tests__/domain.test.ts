import { describe, test, expect } from 'vitest'
import {
  getEffectiveDuration,
  shouldSkipByCost,
  shouldSkipByDay,
  shouldHideGroup,
  calcTotalDuration,
  dateToDayOfWeek,
} from '../domain.js'
import type { TaskDef } from '../types.js'

// --- テスト用タスク定義 ---

const 入浴: TaskDef = {
  name: '入浴',
  durationSec: 600,       // ★★☆ 10分
  costLowSec: 1200,       // ★☆☆ 20分
  costHighSec: 300,        // ★★★ 5分
  scheduledDays: null,
  timerOverrun: 'continue',
}

const 歯磨き: TaskDef = {
  name: '歯磨き貯金起動',
  durationSec: 300,        // 5分
  costLowSec: null,        // 全レベル同じ
  costHighSec: null,
  scheduledDays: null,
  timerOverrun: 'auto-next',
}

const 写真で成長記録: TaskDef = {
  name: '写真で成長記録',
  durationSec: 60,         // ★★☆ 1分
  costLowSec: null,
  costHighSec: 0,          // ★★★ 自動スキップ！
  scheduledDays: null,
  timerOverrun: 'continue',
}

const ゴミ出し_プラごみ: TaskDef = {
  name: 'ゴミ出し（プラごみ）',
  durationSec: 60,
  costLowSec: null,
  costHighSec: null,
  scheduledDays: ['mon'],
  timerOverrun: 'continue',
}

const ゴミ出し_燃えるゴミ: TaskDef = {
  name: 'ゴミ出し（燃えるゴミ）',
  durationSec: 60,
  costLowSec: null,
  costHighSec: null,
  scheduledDays: ['tue', 'fri'],
  timerOverrun: 'continue',
}

const ゴミ出し_缶ビン: TaskDef = {
  name: 'ゴミ出し（缶・ビン）',
  durationSec: 60,
  costLowSec: null,
  costHighSec: null,
  scheduledDays: ['wed'],
  timerOverrun: 'continue',
}

// --- getEffectiveDuration ---

describe('getEffectiveDuration', () => {
  test('★★★モードで入浴タスクのdurationが5分になる', () => {
    expect(getEffectiveDuration(入浴, 'high')).toBe(300)
  })

  test('★★☆モードで入浴タスクのdurationが10分になる', () => {
    expect(getEffectiveDuration(入浴, 'medium')).toBe(600)
  })

  test('★☆☆モードで入浴タスクのdurationが20分になる', () => {
    expect(getEffectiveDuration(入浴, 'low')).toBe(1200)
  })

  test('costOverrides未設定のタスクは全レベルでデフォルト時間', () => {
    expect(getEffectiveDuration(歯磨き, 'low')).toBe(300)
    expect(getEffectiveDuration(歯磨き, 'medium')).toBe(300)
    expect(getEffectiveDuration(歯磨き, 'high')).toBe(300)
  })

  test('★★★モードでcostOverrides.high=0のタスクは0秒を返す', () => {
    expect(getEffectiveDuration(写真で成長記録, 'high')).toBe(0)
  })
})

// --- shouldSkipByCost ---

describe('shouldSkipByCost', () => {
  test('★★★モードでcostOverrides.high=0のタスクが自動スキップ対象になる', () => {
    expect(shouldSkipByCost(写真で成長記録, 'high')).toBe(true)
  })

  test('★★☆モードでは写真タスクはスキップされない', () => {
    expect(shouldSkipByCost(写真で成長記録, 'medium')).toBe(false)
  })

  test('★☆☆モードでcostOverrides.low=0のタスクが自動スキップ対象になる', () => {
    const task: TaskDef = { ...歯磨き, costLowSec: 0 }
    expect(shouldSkipByCost(task, 'low')).toBe(true)
  })

  test('通常タスクはどのレベルでもスキップされない', () => {
    expect(shouldSkipByCost(入浴, 'low')).toBe(false)
    expect(shouldSkipByCost(入浴, 'medium')).toBe(false)
    expect(shouldSkipByCost(入浴, 'high')).toBe(false)
  })
})

// --- shouldSkipByDay ---

describe('shouldSkipByDay', () => {
  test('水曜以外はゴミ出し（缶・ビン）が自動スキップされる', () => {
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'mon')).toBe(true)
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'tue')).toBe(true)
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'wed')).toBe(false) // 水曜は実行
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'thu')).toBe(true)
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'fri')).toBe(true)
  })

  test('月曜はプラごみのみ実行される', () => {
    expect(shouldSkipByDay(ゴミ出し_プラごみ, 'mon')).toBe(false)
    expect(shouldSkipByDay(ゴミ出し_燃えるゴミ, 'mon')).toBe(true)
    expect(shouldSkipByDay(ゴミ出し_缶ビン, 'mon')).toBe(true)
  })

  test('scheduledDays: null のタスクは毎日実行される', () => {
    expect(shouldSkipByDay(入浴, 'mon')).toBe(false)
    expect(shouldSkipByDay(入浴, 'sun')).toBe(false)
  })
})

// --- shouldHideGroup ---

describe('shouldHideGroup', () => {
  const ゴミ出しグループ = [ゴミ出し_プラごみ, ゴミ出し_燃えるゴミ, ゴミ出し_缶ビン]

  test('日曜はゴミ出しグループ全体が非表示', () => {
    expect(shouldHideGroup(ゴミ出しグループ, 'sun')).toBe(true)
  })

  test('月曜はゴミ出しグループが表示される（プラごみがある）', () => {
    expect(shouldHideGroup(ゴミ出しグループ, 'mon')).toBe(false)
  })

  test('グループ内タスクが全てコストスキップ対象の場合trueを返す', () => {
    const allSkipGroup: TaskDef[] = [
      { ...写真で成長記録 },
      { ...歯磨き, costHighSec: 0 },
    ]
    expect(shouldHideGroup(allSkipGroup, 'mon', 'high')).toBe(true)
  })

  test('グループ内に1つでも実行タスクがあればfalse', () => {
    const mixedGroup: TaskDef[] = [写真で成長記録, 入浴]
    expect(shouldHideGroup(mixedGroup, 'mon', 'high')).toBe(false)
  })
})

// --- calcTotalDuration ---

describe('calcTotalDuration', () => {
  const tasks = [入浴, 歯磨き, 写真で成長記録]

  test('★★☆モードの合計: 10m + 5m + 1m = 960秒', () => {
    expect(calcTotalDuration(tasks, 'medium', 'mon')).toBe(960)
  })

  test('★★★モードの合計: 5m + 5m + 0(スキップ) = 600秒', () => {
    expect(calcTotalDuration(tasks, 'high', 'mon')).toBe(600)
  })

  test('★☆☆モードの合計: 20m + 5m + 1m = 1560秒', () => {
    expect(calcTotalDuration(tasks, 'low', 'mon')).toBe(1560)
  })

  test('曜日スキップされたタスクは合計に含まれない', () => {
    const withScheduled = [...tasks, ゴミ出し_缶ビン]
    // 月曜: 缶ビンはスキップ
    expect(calcTotalDuration(withScheduled, 'medium', 'mon')).toBe(960)
    // 水曜: 缶ビンも含む
    expect(calcTotalDuration(withScheduled, 'medium', 'wed')).toBe(1020)
  })
})

// --- dateToDayOfWeek ---

describe('dateToDayOfWeek', () => {
  test('2026-03-17（火）→ tue', () => {
    expect(dateToDayOfWeek(new Date('2026-03-17'))).toBe('tue')
  })

  test('2026-03-22（日）→ sun', () => {
    expect(dateToDayOfWeek(new Date('2026-03-22'))).toBe('sun')
  })
})
