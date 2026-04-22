/**
 * TTS (Text-to-Speech) モジュール
 * - Web Speech API（ブラウザ内蔵）
 * - AivisSpeech / VOICEVOX（/audio_query + /synthesis）
 * - OpenAI互換 TTS（/v1/audio/speech）
 *
 * 外部 TTS サーバー接続時に自動検出:
 *   /speakers が応答 → VOICEVOX 形式
 *   /speakers が失敗 → OpenAI 形式にフォールバック
 */

export type TTSProvider = 'web-speech' | 'external'

type ExternalFormat = 'voicevox' | 'openai' | 'unknown'

export interface TTSConfig {
  enabled: boolean
  provider: TTSProvider
  voice: string | null  // Web Speech: voice name, OpenAI: voice id ("alloy" etc)
  speakerId: number | null // VOICEVOX: speaker style ID
  detectedFormat: ExternalFormat
  rate: number   // 0.5 - 2.0
  pitch: number  // 0 - 2.0 (Web Speechのみ)
  volume: number // 0 - 1.0
  externalUrl: string // 外部 TTS サーバー URL
}

const defaultConfig: TTSConfig = {
  enabled: true,
  provider: 'external',
  voice: 'alloy',
  speakerId: null,
  detectedFormat: 'unknown',
  rate: 1.0,
  pitch: 1.0,
  volume: 1.0,
  externalUrl: '/tts', // Vite proxy経由
}

const STORAGE_KEY = 'routine-jikan-tts'

function loadConfig(): TTSConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) return { ...defaultConfig, ...JSON.parse(saved) }
  } catch {}
  return { ...defaultConfig }
}

let config: TTSConfig = loadConfig()

// ダッキング用コールバック（環境音との連携）
let onSpeakStart: (() => void) | null = null
let onSpeakEnd: (() => void) | null = null

// デバッグログコールバック（TimerPage の画面ログに出す）
let debugLog: ((msg: string) => void) | null = null
function log(msg: string) { debugLog?.(msg) }

// 再生中のAudio要素（HTMLAudioElement フォールバック用）
let currentAudio: HTMLAudioElement | null = null

// TTS 再生用 AudioContext（モバイルでHTMLAudioElementより信頼性が高い）
let ttsContext: AudioContext | null = null
let currentSource: AudioBufferSourceNode | null = null

function getTTSContext(): AudioContext | null {
  if (ttsContext) return ttsContext
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return null
    ttsContext = new Ctx()
    return ttsContext
  } catch {
    return null
  }
}

export function setTTSConfig(newConfig: Partial<TTSConfig>) {
  config = { ...config, ...newConfig }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {}
}

export function getTTSConfig(): Readonly<TTSConfig> {
  return { ...config }
}

export function setDuckingCallbacks(start: () => void, end: () => void) {
  onSpeakStart = start
  onSpeakEnd = end
}

export async function speak(text: string): Promise<void> {
  if (!config.enabled) { log(`speak skip (disabled): ${text}`); return }
  log(`speak: "${text}" provider=${config.provider}`)
  if (config.provider === 'external') {
    return speakExternal(text)
  }
  return speakWebSpeech(text)
}

/** Web Speech API で読み上げ */
function speakWebSpeech(text: string): Promise<void> {
  if (!window.speechSynthesis) return Promise.resolve()

  return new Promise((resolve) => {
    window.speechSynthesis.cancel()

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = 'ja-JP'
    utterance.rate = config.rate
    utterance.pitch = config.pitch
    utterance.volume = config.volume

    if (config.voice) {
      const voices = window.speechSynthesis.getVoices()
      const found = voices.find((v) => v.name === config.voice)
      if (found) utterance.voice = found
    }

    utterance.onstart = () => onSpeakStart?.()
    utterance.onend = () => { onSpeakEnd?.(); resolve() }
    utterance.onerror = () => { onSpeakEnd?.(); resolve() }

    window.speechSynthesis.speak(utterance)
  })
}

// --- 外部 TTS（自動検出） ---

/** サーバーの API 形式を検出して記憶 */
async function detectFormat(): Promise<ExternalFormat> {
  if (config.detectedFormat !== 'unknown') return config.detectedFormat

  try {
    const res = await fetch(`${config.externalUrl}/speakers`)
    if (res.ok) {
      const speakers = await res.json() as { styles: { id: number }[] }[]
      if (speakers.length > 0 && speakers[0].styles.length > 0) {
        const id = speakers[0].styles[0].id
        setTTSConfig({ detectedFormat: 'voicevox', speakerId: id })
        return 'voicevox'
      }
    }
  } catch {}

  // /speakers 失敗 → OpenAI 形式と判定
  setTTSConfig({ detectedFormat: 'openai' })
  return 'openai'
}

/** 外部 TTS で読み上げ（自動検出） */
async function speakExternal(text: string): Promise<void> {
  try {
    const format = await detectFormat()
    if (format === 'voicevox') {
      return await speakVoicevox(text)
    }
    return await speakOpenAI(text)
  } catch {
    console.warn('External TTS unreachable, falling back to Web Speech API')
    return speakWebSpeech(text)
  }
}

/** VOICEVOX 互換 API（AivisSpeech 等）で読み上げ */
async function speakVoicevox(text: string): Promise<void> {
  try {
    cancelCurrentAudio()

    const speakerId = config.speakerId
    if (speakerId == null) {
      console.warn('No VOICEVOX speaker available, falling back to Web Speech API')
      return speakWebSpeech(text)
    }

    onSpeakStart?.()

    // Step 1: audio_query
    const queryRes = await fetch(
      `${config.externalUrl}/audio_query?text=${encodeURIComponent(text)}&speaker=${speakerId}`,
      { method: 'POST' },
    )
    if (!queryRes.ok) {
      console.warn('VOICEVOX audio_query failed, falling back to Web Speech API')
      onSpeakEnd?.()
      return speakWebSpeech(text)
    }
    const audioQuery = await queryRes.json()

    audioQuery.speedScale = config.rate
    audioQuery.volumeScale = config.volume

    // Step 2: synthesis
    const synthRes = await fetch(
      `${config.externalUrl}/synthesis?speaker=${speakerId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(audioQuery),
      },
    )
    if (!synthRes.ok) {
      console.warn('VOICEVOX synthesis failed, falling back to Web Speech API')
      onSpeakEnd?.()
      return speakWebSpeech(text)
    }

    return playBlob(await synthRes.blob())
  } catch {
    console.warn('VOICEVOX unreachable, falling back to Web Speech API')
    onSpeakEnd?.()
    return speakWebSpeech(text)
  }
}

/** OpenAI 互換 API で読み上げ */
async function speakOpenAI(text: string): Promise<void> {
  try {
    cancelCurrentAudio()
    onSpeakStart?.()

    const res = await fetch(`${config.externalUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'tts-1',
        voice: config.voice ?? 'alloy',
        input: text,
        speed: config.rate,
      }),
    })

    log(`openai fetch: ${res.status}`)
    if (!res.ok) {
      onSpeakEnd?.()
      return speakWebSpeech(text)
    }

    const blob = await res.blob()
    log(`openai blob: ${blob.size}B ${blob.type}`)
    return playBlob(blob)
  } catch (e) {
    log(`openai error: ${e}`)
    onSpeakEnd?.()
    return speakWebSpeech(text)
  }
}

// --- ユーティリティ ---

function cancelCurrentAudio() {
  if (currentSource) {
    try { currentSource.stop() } catch {}
    currentSource = null
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio = null
  }
}

async function playBlob(blob: Blob): Promise<void> {
  const ctx = getTTSContext()
  if (ctx) {
    try {
      log(`playBlob ctx.state=${ctx.state}`)
      if (ctx.state === 'suspended') {
        await ctx.resume()
        log(`playBlob after resume: ${ctx.state}`)
      }
      const arrayBuffer = await blob.arrayBuffer()
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer)
      log(`playBlob decoded: ${audioBuffer.duration.toFixed(2)}s`)

      return await new Promise<void>((resolve) => {
        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        const gain = ctx.createGain()
        gain.gain.value = config.volume
        source.connect(gain).connect(ctx.destination)
        source.onended = () => {
          if (currentSource === source) currentSource = null
          onSpeakEnd?.()
          resolve()
        }
        currentSource = source
        source.start(0)
        log('playBlob: source started')
      })
    } catch (e) {
      log(`playBlob AudioContext error: ${e}`)
    }
  }

  log('playBlob fallback HTMLAudio')
  const url = URL.createObjectURL(blob)
  const audio = new Audio(url)
  audio.volume = config.volume
  currentAudio = audio

  return new Promise((resolve) => {
    audio.onended = () => {
      URL.revokeObjectURL(url)
      currentAudio = null
      onSpeakEnd?.()
      resolve()
    }
    audio.onerror = () => {
      log('HTMLAudio onerror')
      URL.revokeObjectURL(url)
      currentAudio = null
      onSpeakEnd?.()
      resolve()
    }
    audio.play().catch((e) => {
      log(`HTMLAudio play reject: ${e}`)
      URL.revokeObjectURL(url)
      currentAudio = null
      onSpeakEnd?.()
      resolve()
    })
  })
}

/** 検出済みフォーマットをリセット（サーバー変更時に呼ぶ） */
export function resetDetectedFormat() {
  setTTSConfig({ detectedFormat: 'unknown', speakerId: null })
}

/** 残り時間を読み上げ用テキストに変換 */
export function formatTimeForSpeech(sec: number): string {
  const abs = Math.abs(sec)
  const m = Math.floor(abs / 60)
  const s = abs % 60

  if (abs >= 60) {
    if (s === 0) return `${m}分`
    return `${m}分${s}秒`
  }
  return `${s}秒`
}

/** タスク開始時の読み上げ */
export function speakTaskStart(taskName: string, durationSec: number) {
  const time = formatTimeForSpeech(durationSec)
  speak(`${taskName}、${time}`)
}

/** タスク完了時の読み上げ（現タスク名 + 次のタスク案内） */
export function speakTaskEnd(currentTaskName: string, nextTaskName?: string) {
  if (nextTaskName) {
    speak(`${currentTaskName}終了！次は${nextTaskName}`)
  } else {
    speak('全タスク完了！おつかれさま！')
  }
}

/** 超過時間の読み上げ */
export function speakOvertime(sec: number) {
  const text = `${formatTimeForSpeech(sec)}経ったよ`
  speak(text)
}

/** 残り時間の読み上げ */
export function speakRemaining(sec: number) {
  const text = `残り${formatTimeForSpeech(sec)}`
  speak(text)
}

/** 利用可能なWeb Speech API音声一覧を取得 */
export function getAvailableVoices(): SpeechSynthesisVoice[] {
  if (!window.speechSynthesis) return []
  return window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('ja'))
}

// --- 読み上げ閾値（TimerPage から参照） ---

/** 残り時間読み上げの秒数しきい値（カウントダウン） */
export const REMAINING_THRESHOLDS = [60, 30, 10] as const

/** 超過時間読み上げの秒数しきい値（1分・5分・10分経過） */
export const OVERTIME_THRESHOLDS = [60, 300, 600] as const

/**
 * モバイル自動再生制限の解除（要ユーザー操作コンテキスト）
 * Start ボタン onClick から呼ばれる前提で、AudioContext を resume して
 * 以降の programmatic な音声再生を許可する（iOS Safari / Chrome モバイル対策）
 */
export function unlock() {
  const ctx = getTTSContext()
  if (!ctx) { log('unlock: no AudioContext'); return }
  log(`unlock: state=${ctx.state}`)
  if (ctx.state === 'suspended') {
    ctx.resume()
      .then(() => log(`unlock resumed: state=${ctx.state}`))
      .catch((e) => log(`unlock resume error: ${e}`))
  }
  try {
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    log('unlock: silent buffer started')
  } catch (e) { log(`unlock silent buf error: ${e}`) }
}

/** デバッグログコールバックの登録 */
export function setDebugLog(cb: (msg: string) => void) { debugLog = cb }

/** AudioContext の suspend 対策（定期 ping、現状は resume のみ） */
export function startKeepAlive() {
  const ctx = getTTSContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}

/** keep-alive の停止（互換スタブ） */
export function stopKeepAlive() {}

/** スリープ復帰時の AudioContext.resume */
export function resumeContext() {
  const ctx = getTTSContext()
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {})
}
