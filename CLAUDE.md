# CLAUDE.md

ユーザーには日本語で回答してください。

## 開発手法

**sdd+codd** — SDD (Spec-Driven Development) + CoDD (Co-Driven Development) で運用。
設計書を確認してから実装し、実装後に設計書を更新する。

## プロジェクト概要

**ルーチン時間 (routine-jikan)** — 生活ルーチンをタスク分割してタイマーで回すWebアプリ。

> 「時間になったら始められる & 始められたら既に終わっている」

## 技術スタック

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite, Tailwind CSS v4 |
| Backend | Hono, Node.js 22 |
| Database | SQLite (LibSQL + Drizzle ORM) |
| Infrastructure | Docker Compose |
| Testing | Vitest |
| Package Manager | pnpm (workspace) |

## よく使うコマンド

```bash
# 起動
docker compose up --build

# 型チェック（nodeはホストに入っていない）
docker compose exec web npx tsc --noEmit

# テスト
docker compose exec web npx vitest run

# コンテナ再起動（HMRがリモートデバイスに届かない場合）
docker compose restart web
```

## リポジトリ情報

- **GitHub:** Seika86/routine-jikan (PUBLIC)
- **ブランチ運用:** `develop`（日常開発） → `main`（リリース）
- **ライセンス:** MIT

## 環境変数（.env）

`.env.example` を参照。個人設定（TTS URL、ラベル）は `.env` に書く（`.gitignore` 済み）。

## 注意事項

- リモートデバイスで確認する場合、Vite HMR が届かないことがある → `docker compose restart web` してから確認
- 型チェックは Docker 内で実行する（ホストに node がない）
- 動作確認を依頼する前に `docker compose exec web npx tsc --noEmit` を通すこと
