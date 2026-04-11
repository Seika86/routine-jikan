import { nanoid } from 'nanoid'
import { db, schema } from './index.js'

const now = new Date().toISOString()
const id = () => nanoid()

// ヘルパー: グループ作成 → タスク追加 → グループID返却
async function createGroup(
  name: string,
  isShared: boolean,
  tasks: Array<{
    name: string
    durationSec: number
    costLowSec?: number | null
    costHighSec?: number | null
    timerOverrun?: string
    scheduledDays?: string[] | null
  }>,
) {
  const groupId = id()
  await db.insert(schema.taskGroups).values({
    id: groupId, name, isShared, createdAt: now, updatedAt: now,
  })

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]
    await db.insert(schema.tasks).values({
      id: id(),
      groupId,
      name: t.name,
      durationSec: t.durationSec,
      costLowSec: t.costLowSec ?? null,
      costHighSec: t.costHighSec ?? null,
      timerOverrun: t.timerOverrun ?? 'continue',
      scheduledDays: t.scheduledDays ? JSON.stringify(t.scheduledDays) : null,
      ambientSoundType: null,
      ambientSoundVolume: null,
      ttsOnStart: true,
      ttsOnEnd: true,
      ttsOnRemaining: null,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
    })
  }

  return groupId
}

// ヘルパー: ルーチンにグループ参照を追加
async function addGroupRef(routineId: string, groupId: string, sortOrder: number, isEnabled = true) {
  await db.insert(schema.routineItems).values({
    id: id(), routineId, itemType: 'group_ref', taskId: null, groupId, isEnabled, sortOrder, createdAt: now,
  })
}

async function seed() {
  console.log('🌱 Seeding...')

  // 既存データ削除
  await db.delete(schema.routineItems)
  await db.delete(schema.taskResults)
  await db.delete(schema.routineExecutions)
  await db.delete(schema.tasks)
  await db.delete(schema.taskGroups)
  await db.delete(schema.routines)

  // === 共有グループ（複数ルーチンで再利用） ===
  const 体重測定 = await createGroup('体重測定', true, [
    { name: '体重を量る', durationSec: 60 },
  ])

  const 食器洗い = await createGroup('食器洗い', true, [
    { name: '食器を洗う', durationSec: 300 },
  ])

  const ゴミ出し = await createGroup('ゴミ出し', true, [
    { name: 'プラごみを出す', durationSec: 60, scheduledDays: ['mon'] },
    { name: '燃えるゴミを出す', durationSec: 60, scheduledDays: ['tue', 'fri'] },
    { name: '缶・ビンを出す', durationSec: 60, scheduledDays: ['wed'] },
  ])

  // === 朝ルーチン グループ ===
  const 起床 = await createGroup('起床', false, [
    { name: '起きてカーテンを開ける', durationSec: 30 },
    { name: 'トイレ・水を飲む', durationSec: 120 },
  ])

  const 洗顔 = await createGroup('洗顔', false, [
    { name: '洗顔・スキンケア', durationSec: 120 },
  ])

  const 着替え = await createGroup('着替え', false, [
    { name: '着替える', durationSec: 120 },
    { name: '身だしなみチェック', durationSec: 60 },
  ])

  const 朝食 = await createGroup('朝食', false, [
    { name: '朝食を準備する', durationSec: 120 },
    { name: '朝食を食べる', durationSec: 480, costLowSec: 900, costHighSec: 300 },
  ])

  const 歯磨き朝 = await createGroup('歯磨き', false, [
    { name: '歯磨き', durationSec: 300, timerOverrun: 'auto-next' },
  ])

  const 出発準備 = await createGroup('出発準備', false, [
    { name: '持ち物チェック', durationSec: 60 },
    { name: '戸締まり確認・出発', durationSec: 60 },
  ])

  // === 夜ルーチン グループ ===
  const 夕食 = await createGroup('夕食', false, [
    { name: '夕食を準備する', durationSec: 300 },
    { name: '夕食を食べる', durationSec: 1200, costLowSec: 1800, costHighSec: 900 },
  ])

  const 帰宅処理 = await createGroup('帰宅処理', false, [
    { name: '手洗い・うがい', durationSec: 60 },
    { name: '荷物を片付ける', durationSec: 120 },
    { name: '明日の持ち物を確認する', durationSec: 120 },
  ])

  const お風呂 = await createGroup('お風呂', false, [
    { name: 'シャワー', durationSec: 360 },
    { name: '入浴', durationSec: 300, costLowSec: 1200, costHighSec: 180 },
    { name: 'スキンケア・着替え', durationSec: 180 },
    { name: 'ドライヤー', durationSec: 300 },
  ])

  const 就寝準備 = await createGroup('就寝準備', false, [
    { name: '歯磨き', durationSec: 300, timerOverrun: 'auto-next' },
    { name: '明日の準備', durationSec: 120 },
    { name: 'ストレッチ', durationSec: 300 },
    { name: '就寝', durationSec: 30 },
  ])

  // === ルーチン作成 ===
  const morningId = id()
  await db.insert(schema.routines).values({
    id: morningId,
    name: '朝ルーチン',
    scheduledTime: '06:00',
    defaultAmbientSoundType: 'tick',
    defaultAmbientSoundVolume: 40,
    defaultAmbientSoundDuckOnTts: true,
    createdAt: now,
    updatedAt: now,
  })

  const nightId = id()
  await db.insert(schema.routines).values({
    id: nightId,
    name: '夜ルーチン',
    scheduledTime: '21:00',
    defaultAmbientSoundType: 'rain',
    defaultAmbientSoundVolume: 30,
    defaultAmbientSoundDuckOnTts: true,
    createdAt: now,
    updatedAt: now,
  })

  // === 朝ルーチン アイテム構成 ===
  let order = 0
  for (const gid of [起床, 洗顔, 体重測定, 着替え, 朝食, 歯磨き朝, 出発準備, ゴミ出し]) {
    await addGroupRef(morningId, gid, order++)
  }

  // === 夜ルーチン アイテム構成 ===
  order = 0
  for (const gid of [夕食, 帰宅処理, お風呂, 食器洗い, 就寝準備, 体重測定]) {
    await addGroupRef(nightId, gid, order++)
  }

  // 集計
  const routineCount = (await db.select().from(schema.routines).all()).length
  const groupCount = (await db.select().from(schema.taskGroups).all()).length
  const taskCount = (await db.select().from(schema.tasks).all()).length

  console.log(`✅ Seed完了! ルーチン: ${routineCount}, グループ: ${groupCount}, タスク: ${taskCount}`)
}

seed().catch(console.error)
