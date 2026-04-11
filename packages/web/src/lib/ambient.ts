/**
 * 環境音（BGM）モジュール
 * - Web Audio API でループ再生
 * - TTS時の自動ダッキング
 * - プリセット: tick, wave, rain, whitenoise
 */

export type AmbientType = 'tick' | 'wave' | 'rain' | 'whitenoise' | 'none'

interface AmbientState {
  type: AmbientType
  volume: number  // 0-100
  muted: boolean
  playing: boolean
}

let audioContext: AudioContext | null = null
let gainNode: GainNode | null = null
let oscillatorNode: OscillatorNode | null = null
let noiseNode: AudioBufferSourceNode | null = null
let tickInterval: ReturnType<typeof setInterval> | null = null
let preDuckGain = 1.0  // ダッキング前のgainNode値を記録

const state: AmbientState = {
  type: 'none',
  volume: 50,
  muted: false,
  playing: false,
}

// 正規化された音量（0-1）
function getNormalizedVolume(): number {
  if (state.muted) return 0
  return state.volume / 100
}

function getContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext()
    gainNode = audioContext.createGain()
    gainNode.connect(audioContext.destination)
  }
  return audioContext
}

function stopCurrent() {
  if (tickInterval) {
    clearInterval(tickInterval)
    tickInterval = null
  }
  if (oscillatorNode) {
    try { oscillatorNode.stop() } catch {}
    oscillatorNode = null
  }
  if (noiseNode) {
    try { noiseNode.stop() } catch {}
    noiseNode = null
  }
  state.playing = false
}

/** チクタク音（メトロノーム風） */
function startTick() {
  const ctx = getContext()
  const vol = getNormalizedVolume()

  tickInterval = setInterval(() => {
    const osc = ctx.createOscillator()
    const tickGain = ctx.createGain()
    osc.connect(tickGain)
    tickGain.connect(gainNode!)

    osc.frequency.value = 800
    osc.type = 'sine'
    tickGain.gain.setValueAtTime(vol * 0.3, ctx.currentTime)
    tickGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08)

    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + 0.08)
  }, 1000) // 1秒ごと
}

/** ホワイトノイズ */
function startWhitenoise() {
  const ctx = getContext()
  const bufferSize = ctx.sampleRate * 2
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1
  }

  noiseNode = ctx.createBufferSource()
  noiseNode.buffer = buffer
  noiseNode.loop = true

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = getNormalizedVolume() * 0.15
  noiseNode.connect(noiseGain)
  noiseGain.connect(gainNode!)
  noiseNode.start()
}

/** 波の音（フィルタードノイズ） */
function startWave() {
  const ctx = getContext()
  const bufferSize = ctx.sampleRate * 4
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    // 波っぽいうねりを加える
    const wave = Math.sin(i / ctx.sampleRate * 0.3) * 0.5 + 0.5
    data[i] = (Math.random() * 2 - 1) * wave
  }

  noiseNode = ctx.createBufferSource()
  noiseNode.buffer = buffer
  noiseNode.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'lowpass'
  filter.frequency.value = 400

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = getNormalizedVolume() * 0.25

  noiseNode.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(gainNode!)
  noiseNode.start()
}

/** 雨音（フィルタードノイズ + ランダムドリップ） */
function startRain() {
  const ctx = getContext()
  const bufferSize = ctx.sampleRate * 3
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1)
  }

  noiseNode = ctx.createBufferSource()
  noiseNode.buffer = buffer
  noiseNode.loop = true

  const filter = ctx.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 800
  filter.Q.value = 0.5

  const noiseGain = ctx.createGain()
  noiseGain.gain.value = getNormalizedVolume() * 0.2

  noiseNode.connect(filter)
  filter.connect(noiseGain)
  noiseGain.connect(gainNode!)
  noiseNode.start()
}

// --- Public API ---

export function play(type: AmbientType, volume?: number) {
  stopCurrent()
  state.type = type
  if (volume !== undefined) state.volume = volume
  if (type === 'none') return

  // AudioContext は ユーザー操作後にのみ作成可能
  getContext()
  if (audioContext?.state === 'suspended') {
    audioContext.resume()
  }

  // マスターgainを1.0にリセット（前回のduckUp漏れ対策）
  if (gainNode) {
    gainNode.gain.value = 1.0
    preDuckGain = 1.0
  }

  switch (type) {
    case 'tick': startTick(); break
    case 'wave': startWave(); break
    case 'rain': startRain(); break
    case 'whitenoise': startWhitenoise(); break
  }
  state.playing = true
}

export function stop() {
  stopCurrent()
  state.type = 'none'
}

export function setVolume(volume: number) {
  state.volume = volume
  if (gainNode) {
    gainNode.gain.value = getNormalizedVolume()
  }
}

export function toggleMute(): boolean {
  state.muted = !state.muted
  if (gainNode) {
    gainNode.gain.value = getNormalizedVolume()
  }
  return state.muted
}

export function isMuted(): boolean {
  return state.muted
}

/** TTS ダッキング: 音量を一時的に下げる */
export function duckDown() {
  if (gainNode && state.playing) {
    const ctx = getContext()
    preDuckGain = gainNode.gain.value
    gainNode.gain.setTargetAtTime(preDuckGain * 0.2, ctx.currentTime, 0.1)
  }
}

/** TTS ダッキング解除: 音量を元に戻す */
export function duckUp() {
  if (gainNode && state.playing) {
    const ctx = getContext()
    gainNode.gain.setTargetAtTime(preDuckGain, ctx.currentTime, 0.3)
  }
}

export function getState(): Readonly<AmbientState> {
  return { ...state }
}
