# routine-jikan

**時間になったら始められる & 始められたら既に終わっている**
*Start when the time is right — and it's already done when you start.*

ルーチン（朝の支度、夜の片付けなど）をタスク分割してタイマーで回すWebアプリ。
音声読み上げと環境音で、時計を見なくても「次はこれ」が分かる。

A web app that breaks routines (morning prep, evening cleanup, etc.) into timed tasks.
Voice announcements and ambient sounds guide you through — no need to watch the clock.

---

## 🌟 Features / 機能

### 🎯 Routine Timer / ルーチンタイマー

タスクを順番に自動で切り替えるタイマー。完了・スキップ・一時停止に対応。

An auto-advancing timer that moves through tasks in sequence. Supports completion, skip, and pause.

### 🎚️ Cost Levels / コストレベル

タスクごとに3段階の所要時間を設定可能。その日の余裕に合わせて選べる。

| Level | Label | Description |
|-------|-------|-------------|
| ★☆☆ | のんびり (Relaxed) | Longer durations |
| ★★☆ | 標準 (Standard) | Normal mode |
| ★★★ | タイムアタック (Time Attack) | Rushed — auto-skip on overrun |

### 📂 Groups / グループ

タスクをグループにまとめて管理。共有グループは複数のルーチンで再利用可能。

Group tasks together. Shared groups can be reused across multiple routines.

### 🗓️ Scheduling / スケジュール

曜日ごとにタスクの有効/無効を設定。平日だけ、週末だけなど柔軟に。

Enable/disable tasks per day of the week — weekdays only, weekends only, etc.

### 🔊 TTS / 音声読み上げ

タスク開始・終了・残り時間を音声でお知らせ。2つのプロバイダーを選択可能。

Voice announcements for task start, end, and remaining time. Two providers available:

| Provider | Description |
|----------|-------------|
| External TTS | AivisSpeech / VOICEVOX / OpenAI-compatible (auto-detected) |
| Web Speech API | Built-in browser speech synthesis (no setup needed) |

外部 TTS サーバーの API 形式は自動検出。AivisSpeech (VOICEVOX互換) も OpenAI互換サーバーもそのまま使える。
接続できない場合は自動的に Web Speech API にフォールバック。

The external TTS server's API format is auto-detected — works with both AivisSpeech (VOICEVOX-compatible) and OpenAI-compatible servers out of the box.
Falls back to Web Speech API automatically if the server is unavailable.

### 🎵 Ambient Sound / 環境音

Web Audio API によるリアルタイム生成。音声ファイル不要。

Real-time synthesis via Web Audio API — no audio files needed.

- チクタク (Tick) / 波の音 (Wave) / 雨音 (Rain) / ホワイトノイズ (White Noise)
- 音声読み上げ中は自動で音量を下げる (auto-ducking)

### 📊 History / 履歴

実行履歴の確認、CSV/JSON エクスポート。中断したルーチンの再開にも対応。

View execution history, export as CSV/JSON. Resume interrupted routines.

### 📱 PWA

ホーム画面に追加してアプリとして使える。タイマー中はスリープを防止 (Wake Lock)。

Add to home screen as an app. Screen stays on during timer execution (Wake Lock API).

---

## 🛠️ Tech Stack / 技術スタック

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Backend | Hono, Node.js 22 |
| Database | SQLite (LibSQL + Drizzle ORM) |
| Infrastructure | Docker Compose |
| Testing | Vitest |
| Package Manager | pnpm (workspace) |

---

## 🚀 Getting Started / はじめかた

### Prerequisites / 必要なもの

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose

### Setup / セットアップ

```bash
# Clone
git clone https://github.com/Seika86/routine-jikan.git
cd routine-jikan

# (Optional) Configure environment variables
cp .env.example .env

# Start
docker compose up --build
```

- **Web UI:** http://localhost:3000
- **API:** http://localhost:3001

初回起動時にデータベースのマイグレーションが自動で実行される。

Database migrations run automatically on first startup.

### TTS Setup (Optional) / TTS の設定

音声読み上げには2つの方法がある:

1. **Web Speech API** — セットアップ不要。ブラウザの設定から選べる。
2. **外部 TTS サーバー** — [AivisSpeech](https://aivis-project.com/)、[VOICEVOX](https://voicevox.hiroshiba.jp/)、OpenAI互換サーバーに対応（API 形式は自動検出）。

For TTS, you have two options:

1. **Web Speech API** — No setup needed. Select from the settings.
2. **External TTS server** — Supports [AivisSpeech](https://aivis-project.com/), [VOICEVOX](https://voicevox.hiroshiba.jp/), and OpenAI-compatible servers (API format is auto-detected).

外部 TTS サーバーを使う場合は `.env` に URL を設定:

To use an external TTS server, set the URL in `.env`:

```bash
VITE_TTS_URL=http://localhost:10101
```

設定後、コンテナを再起動してから UI の設定パネル (⚙️) で TTS サーバーを選択。

After setting, restart the container and select the TTS server from the settings panel (⚙️).

After setting, restart the container and select "AivisSpeech" from the settings panel (⚙️).
The speaker is auto-detected on first use.

---

## 📁 Project Structure / プロジェクト構成

```
routine-jikan/
├── packages/
│   ├── api/        # Backend (Hono + Drizzle + SQLite)
│   ├── web/        # Frontend (React + Vite + Tailwind)
│   └── shared/     # Shared types & domain logic
└── docker-compose.yml
```

---

## 📝 License / ライセンス

[MIT](./LICENSE)

---

## 🐹 Author

**Seika86** — [GitHub](https://github.com/Seika86)

Built with the help of **Kou** 🌊 (AI assistant)
