# routine-jikan 設計監査レポート（設計監査班）

- 対象: ``（develop ブランチ, HEAD d84ad5e）
- 方針: 実装しない再設計レビュー。行レベルバグは対象外、設計構造のみ。全指摘に根拠 file:line 付き
- 重要度: S(致命的な設計欠陥) / A(製品版前に必須) / B(望ましい) / C(好み)

## 1. サマリ

最大の発見は **shared パッケージが web/api のどこからも import されていない**こと。ドメインロジック（コスト計算・曜日スキップ）が shared / API / web の3箇所に別実装され、唯一のテスト22件は「本番で一度も実行されないコード」を検証している。構造的な根本原因は Docker 構成が pnpm workspace を無視していること（パッケージ単体で `pnpm install`、lockfile も無い）。TimerPage は「useEffect による遷移検知」と「ハンドラ内の手続き的リセット」の二重機構が同居して Simple 違反の中心になっており、TTS の ducking は開始/終了コールバックの対応が保証されない設計。既知の tsc エラーの根本原因は `vite-env.d.ts` の不在（特定済み）。一方、timerState.ts・domain.ts・スナップショット型履歴スキーマなど「軽量・明示的」なモットー通りの良い設計も多く、再設計はゼロベースではなく「境界の張り直し」で足りる。

**指摘件数: S=1, A=6, B=7, C=2（計16件）**

---

## 2. 指摘一覧（重要度順）

### S-1. shared パッケージが完全に未使用 — ドメインロジック3重実装、テストは死蔵コードのみを検証

- **重要度: S**
- **根拠:**
  - `grep -rn "shared" packages/web/src packages/api/src` の import ヒット **0件**（機械確認済み）。`@routine-jikan/shared` を dependencies に持つ package.json も無し
  - 3重実装その1: `packages/shared/src/domain.ts:7-33`（`getEffectiveDuration` / `shouldSkipByDay` — テスト済・未使用）
  - 3重実装その2: `packages/api/src/routes/executions.ts:59-89`（start 時のコスト適用・曜日フィルタをインライン再実装。`executions.ts:28-30` は `domain.ts:68-72` の `dateToDayOfWeek` の再実装）
  - 3重実装その3: `packages/web/src/pages/StartPage.tsx:40-49`（見積もり時間計算でコストレベル適用を再々実装）
  - 型の二重定義: `packages/web/src/hooks/useApi.ts:84-182` に API レスポンス型を全て手書き。`shared/src/types.ts` の `CostLevel`/`TaskStatus` 等とは別系統
  - 構造的原因: `packages/web/Dockerfile` / `packages/api/Dockerfile` はパッケージ単体を COPY して `pnpm install`（workspace 非使用）。`docker-compose.yml` の web に `./packages/shared:/app/shared` の mount があるが（docker-compose.yml web.volumes 3行目）、Dockerfile にも import にも現れない「使うつもりだった痕跡」だけが残っている
- **何が問題か:** 「web/api の境界に共通ドメインを置く」という宣言（pnpm workspace + shared パッケージ + テスト）と実装が完全に乖離。仕様変更（例: コスト0秒=スキップのルール変更）は3箇所の同期修正が必要で、テストは何も守ってくれない。テスト可能な設計にした部分だけが使われていない、という逆転が起きている
- **再設計の方向性:** Docker 側を workspace ビルドに直す（ルートで `pnpm install`、`pnpm --filter` でビルド）か、逆に shared を諦めて「API がドメインの唯一の実装、web は結果を表示するだけ」に寄せるかの二択。前者なら executions.ts と StartPage の計算を domain.ts 呼び出しに置換し、API レスポンス型も shared に移す。中途半端な現状が最悪

### A-1. TimerPage: タスク遷移が「useEffect 検知」と「手続き的リセット」の二重機構

- **重要度: A**
- **根拠:**
  - 遷移検知 useEffect: `packages/web/src/pages/TimerPage.tsx:200-209`（`execution?.currentTask?.id` を `prevTaskId` ref と比較して読み上げ状態をリセット）
  - 同じリセットロジック（`startTask` + `prevTaskId` + 読み上げ ref 3種クリア）の手書きコピーが **5箇所**: init `124-145` / handleComplete `356-362` / handleSkip `388-394` / handleTaskDragEnd `438-444` / handlePromoteTask `469-474`
  - ハンドラが先に `prevTaskId.current` を書き換えるため、useEffect 側はガードで発火しない。コード自身がコメントで自認: `TimerPage.tsx:359`「読み上げ状態を明示的にリセット（タスク切り替えuseEffectがガードで発火しないため）」
  - handleComplete と handleSkip は約30行がほぼ同一（349-379 vs 381-410）
- **何が問題か:** 「遷移はどこで起きるのか」の答えが2系統ある。useEffect は実質 init 復元経路の保険としてだけ生きており、読み手は5箇所全てを読まないと遷移の全体像が分からない。リセット項目を1つ増やすと5箇所修正（漏れたら発火タイミング依存のバグ）。Seika の「状態遷移は別関数に分けて明示的に」モットーに真っ向から反する
- **再設計の方向性:** 「タスクが t1→t2 に切り替わった」を単一の関数 `transitionToTask(nextTask, {speak})` に集約し、全ハンドラ・init・DnD がそれだけを呼ぶ。useEffect による遷移検知は廃止（サーバー状態の変化起点は全てハンドラ内で分かるので、検知の必要がそもそも無い）。ライブラリ不要、関数抽出のみで解決する

### A-2. TTS: ducking の開始/終了コールバック対応が保証されない latest-wins 設計

- **重要度: A**（既知課題の裏取り・深掘り）
- **根拠:**
  - `packages/web/src/lib/tts.ts:53-54` — `onSpeakStart`/`onSpeakEnd` は module-level の生コールバック。対応管理（カウンタ・所有権）が無い
  - `tts.ts:254-263` `cancelCurrentAudio()` が旧 source を `stop()` → 旧 source の `onended`（`tts.ts:284-288`）は `currentSource === source` のガードを **null 代入にしか使っておらず**、`onSpeakEnd?.()`（= ambient.duckUp）は無条件に発火する。新しい発話が始まった直後に旧発話の duckUp が走り得る
  - `ambient.ts:215-228` — `duckDown()` は `preDuckGain = gainNode.gain.value` を保存するため、ダッキング中に再 duckDown すると「下がった音量」を復元値として記録する（`play()` での 1.0 リセット `ambient.ts:176-179` は「前回の duckUp 漏れ対策」とコメントで自認）
  - フォールバック連鎖で二重発火: `speakVoicevox` は `onSpeakStart?.()`（tts.ts:179）後に失敗すると `speakWebSpeech` に落ち、そこで `utterance.onstart` が再度 `onSpeakStart` を呼ぶ（tts.ts:123）
  - 発話の直列化機構が無い: `speak()` は Promise を返すが TimerPage 側は全て投げっぱなし（TimerPage.tsx:144, 221, 238, 251 — await 無し）。「latest-wins」は cancelCurrentAudio の副作用として偶然成立しているだけで、Web Speech 経路（`speechSynthesis.cancel()` tts.ts:109）と AudioContext 経路で挙動が違う
- **何が問題か:** 「読みにくい」の正体は、(1) 対応が崩れるコールバック対、(2) 2種類のキャンセル機構、(3) 呼び出し側が結果を待たない fire-and-forget、の3つが暗黙に絡んでいること。ducking 音量が戻らない・戻りすぎる系の不具合はこの構造から必然的に生まれる
- **再設計の方向性:** 「現在の発話」を1つのオブジェクト（id 付き）で表し、start/end 通知はその id 経由でのみ発火（古い id の end は無視）。ducking はカウンタでなく「アクティブ発話が存在するか」の boolean 導出にする。latest-wins を明示するなら `speak()` の先頭で「前の発話の後始末（end 通知含む）」を同期的に完了させる1関数に寄せる

### A-3. 既知 tsc エラーの根本原因: `vite-env.d.ts` 不在（＋tsconfig に vite/client 型が無い）

- **重要度: A**（担当課題・特定完了）
- **根拠:**
  - エラー位置 `App.tsx(22,31)` = `packages/web/src/App.tsx:22` の `import.meta.env`（`env` は正確に22行31桁目）
  - `find packages/web -name "*.d.ts"`（node_modules 除外）の結果は **0件** — create-vite が通常生成する `src/vite-env.d.ts`（`/// <reference types="vite/client" />`）が存在しない
  - `packages/web/tsconfig.json` にも `"types": ["vite/client"]` が無い（compilerOptions 全13項目を確認）
  - よって TS 標準の `ImportMeta` 型には `env` プロパティが無く、`Property 'env' does not exist on type 'ImportMeta'` で赤になる。Docker 内かどうかは無関係（型定義ファイルの欠落）
- **何が問題か:** 「型チェックを通してから確認依頼」という運用ルール（CLAUDE.md）の起点が常に赤で、型チェックが儀式化するリスク
- **再設計の方向性:** `packages/web/src/vite-env.d.ts` に `/// <reference types="vite/client" />` を1行置く（または tsconfig に `"types": ["vite/client"]`）。1ファイル追加で恒久解決。製品版では `ImportMetaEnv` インターフェース拡張で `VITE_TTS_LABEL` 等に型を付けると env のタイポも検出できる

### A-4. lockfile が存在せず、Docker ビルドが workspace を無視 — ビルド再現性ゼロ

- **重要度: A**
- **根拠:**
  - リポ全体に `pnpm-lock.yaml` が **1つも無い**（find で機械確認）
  - `packages/web/Dockerfile` / `packages/api/Dockerfile`: `COPY package.json ./` → `RUN pnpm install`（lockfile なし・`^` レンジ解決）。ビルドのたびに依存バージョンが変わり得る
  - `pnpm-workspace.yaml` は `packages/*` を宣言しているが、上記の通り Docker ビルド単位はパッケージ単体で、workspace は実質機能していない（S-1 の構造的原因でもある）
  - web の依存は React 19 / Vite 6 / Tailwind 4 と最新系（packages/web/package.json）— レンジ解決の変動リスクが高い層
- **何が問題か:** 「昨日ビルドできたイメージが今日壊れる」を防ぐ仕組みが無い。改修フェーズの学習環境としても、動作差異の原因切り分けを難しくする
- **再設計の方向性:** ルートで `pnpm install` して lockfile をコミット。Dockerfile はルートコンテキストで `pnpm-lock.yaml` + `pnpm fetch` / `--filter` を使う構成に（pnpm 標準機能のみで可、追加ツール不要）

### A-5. status 文字列が型・スキーマコメント・実装の三者で不一致

- **重要度: A**
- **根拠:**
  - `shared/src/types.ts:3` — `TaskStatus = 'completed' | 'skipped' | 'auto-skipped (day)' | 'auto-skipped (cost)'`（`pending`/`in_progress` が無い）
  - `api/src/db/schema.ts:84` コメント — `completed | skipped | auto-skipped (day) | auto-skipped (cost)`
  - 実装が実際に書く値: `executions.ts:110-114` — `'pending'` と **`'auto-skipped'`**（day/cost の区別なし）
  - 判定方法も2流派が混在: `startsWith('auto-skipped')`（executions.ts:179, history.ts:27, TimerPage.tsx:549）と `!== 'auto-skipped'`（executions.ts:266）。今は書き込み値が `'auto-skipped'` のみなので偶然同値だが、型どおり `'auto-skipped (day)'` を書き始めた瞬間に totalCount が画面によってズレる
  - web 側の `TaskResult.status` は `string`（useApi.ts:164）で、この不一致をコンパイラが検出できない
- **何が問題か:** ドメインの中心的な enum が「どこにも正が無い」状態。S-1（shared 未使用）の具体的被害例
- **再設計の方向性:** shared に `TaskStatus`（pending / in_progress 含む・skip 理由は別カラム or `skipReason` フィールドに分離）と `ExecutionStatus` を正として定義し、API 書き込み・web 判定の両方をそれに寄せる。`startsWith` 判定は廃止

### A-6. AUTH_TOKEN は API に実装済みだが、web クライアントは一切トークンを送らない

- **重要度: A**
- **根拠:**
  - API 側: `api/src/index.ts:23-36` — `AUTH_TOKEN` 設定時に `/api/*` へ Bearer or query token を要求
  - web 側: `useApi.ts:3-12` の `fetchJson` はヘッダに `Content-Type` しか付けず、トークン設定手段も無い。`.env.example` にも AUTH_TOKEN の web 側受け渡しの記述なし
- **何が問題か:** 「認証を有効化すると自アプリが全滅する」半実装。公開リポ＋外部公開を見据えた機能に見えるが、設計として結線されていない
- **再設計の方向性:** ローカル専用と割り切るなら API 側の認証コードごと削除（最小限の原則）。外部公開するなら Vite proxy でサーバー側注入（ブラウザにトークンを持たせない）が最も簡単で漏洩面も安全

### B-1. Wake Lock の二重実装（App のフックと TimerPage のインライン実装が同時稼働）

- **重要度: B**
- **根拠:** `App.tsx:37` で `useWakeLock()`（実装: `hooks/useWakeLock.ts:3-31`）、TimerPage は同じ処理＋デバッグログ付きを自前実装（`TimerPage.tsx:46, 67-103`）。TimerPage 表示中は 2つの sentinel と 2つの visibilitychange リスナが並走する
- **何が問題か:** 同一責務のコードが2系統。片方を直しても直った気がしないパターンの温床。TimerPage 676行の肥大要因のひとつ（wake lock + ログ UI で約50行）
- **再設計の方向性:** `useWakeLock(options?: { onLog })` にログコールバックを足して一本化し、TimerPage のインライン実装を削除。App 側は「常時 wake lock が要るか」を再検討（タイマー中だけで良いはず）

### B-2. 死んだコード/設定: history.ts ルーター未マウント＋executions.ts に全文複製、tsconfig.base.json は誰も継承していない

- **重要度: B**
- **根拠:**
  - `api/src/routes/history.ts`（125行）は `index.ts` のどこにも route されない。`index.ts:11` コメント「historyRouter は executionsRouter に統合済み」。一覧＋CSV export のロジックは `executions.ts:158-233` にほぼ逐語コピーが存在（csvEscape まで別実装 history.ts:105-110 vs executions.ts:226）
  - `tsconfig.base.json` は存在するが、web/api/shared の tsconfig いずれにも `"extends"` が無く、同じ9項目を3ファイルに手書きコピー（差分: web=jsx/noEmit, api=outDir/rootDir, shared=declaration）
- **何が問題か:** 「正がどっちか分からないファイル」がリポに残ると、改修時に間違った方を編集する事故が起きる。base tsconfig は「共通化した」という誤解を生む看板だけの状態
- **再設計の方向性:** history.ts を削除。各 tsconfig を `"extends": "../../tsconfig.base.json"` に直す（Docker ビルドコンテキストがパッケージ単体のままだと extends 先が COPY されない点に注意 — A-4 のルートコンテキスト化とセットで）

### B-3. YAGNI フィールド群: DB・編集UIに存在するが動作しない機能が3系統

- **重要度: B**
- **根拠:**
  - タスク個別 TTS/環境音: `schema.ts:37-42`（`ambientSoundType`/`ambientSoundVolume`/`ttsOnStart`/`ttsOnEnd`/`ttsOnRemaining`、NOTE コメントで「フロント未使用」を自認）。tasks ルートは受け付けて保存する（tasks.ts:18-22, 99-105）が、web は送りも読みもしない（grep 0件）
  - `timerOverrun: 'auto-next'`: 編集UIで設定可能（TaskEditModal.tsx:31）だが TimerPage に `timerOverrun` の参照が **0件**（grep 確認）— 設定しても何も起きない
  - `routineItems.itemType='task'`: スキーマ（schema.ts:53-54）と API（routine-items.ts:12-13）は単体タスク直付けを受け付けるが、start 展開は `group_ref` 以外を無視し（executions.ts:43）、web も `group_ref` しか作らない（EditPage.tsx:106,119）
- **何が問題か:** 「設定できるのに効かない」はユーザー（=Seika 本人）への嘘になる。またスキーマ・API・型の表面積を無意味に広げ、S-1/A-5 のような不一致の発生源になる
- **再設計の方向性:** 製品版スキーマからは一旦全て落とす（1in1out の精神で「実装した時に足す」）。特に `itemType` は group_ref 固定にして nullable `taskId` を削除するとデータモデルが一段単純になる

### B-4. API ルーター構成の不統一（マウント規約が3流派）

- **重要度: B**
- **根拠:** `api/src/index.ts:43-47` — ①`/api/routines` に相対パスの routinesRouter、②同じ `/api/routines` に routineItemsRouter も重ねてマウント、③`/api` に絶対パス内包の tasksRouter（`tasks.ts:9` が `/groups/:groupId/tasks` を持つ＝groups の URL 空間に tasks.ts が書き込む）と executionsRouter（`executions.ts:9` が `/routines/:id/start` を持つ＝routines の URL 空間に executions.ts が書き込む）
- **何が問題か:** 「この URL はどのファイルか」が URL からもファイル名からも推測できない。`/api/routines/:id/start` を探して routines.ts を開くと存在しない。ルート衝突時の優先順位も Hono の登録順依存になる（routine-items.ts:47 の注意コメントが既にその兆候）
- **再設計の方向性:** 「1リソース1ファイル、マウントは `/api/<resource>`、ファイル内は相対パス」の1規約に統一。`/routines/:id/start` のようなリソース跨ぎは「実行(execution)の作成」として `POST /executions`（body に routineId）へ寄せると綺麗に収まる

### B-5. 書き込み系のループ更新にトランザクションが無い

- **重要度: B**
- **根拠:** reorder 3箇所がいずれも逐次 UPDATE ループ: `executions.ts:372-376` / `tasks.ts:135-139` / `routine-items.ts:51-57`。start のタスク一括 INSERT も同様（executions.ts:108-130）。リポ内に `db.transaction` の使用は 0件
- **何が問題か:** 途中失敗で sortOrder が半分だけ入れ替わった状態が残る。個人アプリ＋SQLite なので実害確率は低いが、「実行レコード作成＋taskResults 一括作成」（start）は原子性が欲しい単位
- **再設計の方向性:** Drizzle の `db.transaction()` で start と reorder を包むだけ（追加依存なし）。reorder は `CASE WHEN` 一括 UPDATE にすれば N 回往復も消える

### B-6. リクエストボディが `c.req.json<T>()` の型キャストのみで実行時検証ゼロ

- **重要度: B**
- **根拠:** 全ルートで `await c.req.json<{...}>()` パターン（例: executions.ts:11-14, tasks.ts:11-24, routines.ts:58-64）。generics は実行時に何も保証しない。`durationSec` に負数・文字列が来てもそのまま INSERT される
- **何が問題か:** 「型があるように見えて無い」境界。web 側の手書き型（S-1）とペアで、二重に嘘をつく構造。ただし重厚な zod 導入は望まれていない前提
- **再設計の方向性:** shared に「リクエスト型 + 数行の手書きガード関数（`isStartBody(x): x is StartBody`）」を置く程度で十分。バリデーションライブラリは入れない。信頼できない入力を受けるのは実質数エンドポイントなので手書きで回る規模

### B-7. HistoryPage だけ api クライアントを迂回して素の fetch

- **重要度: B**
- **根拠:** `HistoryPage.tsx:28` — `fetch('/api/executions')` 直叩き（エラーハンドリング無し、`res.ok` 未確認）。同ファイルの削除は `api.deleteExecution`（35行目）を使っており、同一画面内で2流派。`api` オブジェクトに `getExecutions()` が存在しないのが原因
- **何が問題か:** fetchJson のエラー整形（useApi.ts:8-10）が効かない抜け道。API 呼び出しの一覧性（useApi.ts が全カタログ）という良い設計を自ら崩している
- **再設計の方向性:** `api.getExecutions()` を追加して置換。「fetch は useApi.ts 内のみ」を規約化（lint で `no-restricted-globals` にすると機械的に守れるが、規約メモだけでも可）

### C-1. COST_LABELS 等の表示定数が3ファイルに重複定義

- **重要度: C**
- **根拠:** `TimerPage.tsx:672-676` と `HistoryPage.tsx:160-164`（同一内容）、`StartPage.tsx:7-11`（stars+label の拡張版）。SOUND_LABELS/AMBIENT_OPTIONS も App.tsx:252-257 と EditPage.tsx:344-350 で别定義
- **再設計の方向性:** `web/src/lib/labels.ts` に1箇所。好みの範囲だが、★表記を変えたくなった時に気づく

### C-2. N+1 クエリ（ループ内 await select）

- **重要度: C**（個人アプリのデータ量なら許容）
- **根拠:** executions 一覧（executions.ts:164-183）、export（同 200-221）、routine 詳細展開（routines.ts:31-51）、start 展開（executions.ts:49-57）
- **再設計の方向性:** 製品版で履歴が数百件を超えるなら `inArray` でまとめ取り（executions.ts:2 で既に import 済みなのに未使用）。Drizzle の relational query に寄せても良い。今すぐは不要

---

## 3. 良い設計（再設計時に壊さないこと）

- **timerState.ts（web/src/lib/timerState.ts 全体）**: 「開始時刻の timestamp を正として毎秒導出」という設計が正しい（setInterval の積算ではない）。純粋関数＋localStorage の薄い層で、そのままテスト可能。モットーの模範
- **shared/domain.ts の中身自体**: 純粋関数群＋22テスト（`__tests__/domain.test.ts`、実データ風の日本語フィクスチャ付き）。問題は「未使用」なだけで、コードの質は製品版の核に据えられる
- **taskResults のスナップショット方式**: `taskName`/`plannedDurationSec` を値コピーし、tasks への FK を持たない（schema.ts:76-88）。routine 削除時も履歴が壊れない `SET NULL`＋意図コメント（schema.ts:65-66）。履歴の整合性設計として正解
- **App.tsx の Page 判別共用体ルーティング**（App.tsx:13-18）: ルーターライブラリ無しの discriminated union で、この規模には必要十分。過剰設計をしていない好例
- **ambient.ts の公開 API の狭さ**: `play/stop/setVolume/toggleMute/duckDown/duckUp` のみ export し、AudioContext 配線を完全に隠蔽（ambient.ts:161-233）。duck の preDuckGain 問題（A-2 参照）を直せば構造は維持で良い
- **TTS 閾値定数の共有**（tts.ts:382-385 `REMAINING_THRESHOLDS`/`OVERTIME_THRESHOLDS`）: マジックナンバーを1箇所に置いて TimerPage から参照。良い
- **TimerPage の読み上げ 3 useEffect 分割**（残り時間 212-225 / 0到達 228-240 / 超過 243-255）: 「状態遷移は別 useEffect に」のモットー通りで、この分割自体は維持すべき。問題はリセット用 ref の管理（A-1）であって分割ではない
- **API の 404 パターンの一貫性**: 全ルートで「存在チェック → `{ error }` + 404」が統一されている（routines.ts:22, groups.ts:22, tasks.ts:30 ほか）
- **Hono ルーティング順序への注意コメント**（routine-items.ts:47-48、executions.ts:158）: ハマりどころを未来の読み手に残す姿勢
- **start 直後の完了判定**（executions.ts:132-134）: 「全タスク auto-skipped で詰む」エッジケースへの防御と理由コメント

## 4. 判断に迷った点・未確認事項

- **tsc エラーの実行再確認は未実施**: Docker コンテナを起動しない方針のため、A-3 は静的解析（`.d.ts` 不在＋tsconfig 内容＋エラー座標の一致）による特定。ただし座標 (22,31) が `import.meta.env` の `env` に正確に一致するため確度は高い
- **設計書との整合**: `docs/codd/graph.yaml` は Obsidian の要件定義書 v1.8 / 設計書 v1.11 を指すが、Obsidian 側は今回未読。B-3 の未実装フィールド群が「設計書上は将来仕様として正当」の可能性はある（その場合も「UIで設定できて効かない」状態の解消は必要）
- **TTS「latest-wins キュー」の呼称**: コード上に明示的なキュー構造は存在しない（tts.ts 全体確認済み）。cancelCurrentAudio による事実上の latest-wins と判断し、A-2 はその前提で書いた
- **`completed` useState（TimerPage.tsx:41）** は `execution.status !== 'in_progress'` から導出可能な重複状態だが、abandon 時の即時画面切替（417行、refresh 前に setCompleted）に使われており、単純削除はできない。A-1 の遷移関数集約の中で「サーバー状態 or 楽観状態」のどちらを正とするか決めるのが筋
- **web コンテナの `docker compose exec web npx tsc --noEmit` で vitest も動く前提**（CLAUDE.md 記載）だが、web パッケージに vitest は devDependencies に無く、テストは shared のみ。テスト実行がどの環境で回っているかは未確認（shared はホスト node 無しでは回せないはず）
- **StartResult vs ExecutionState の二重表現**: App.tsx:93-117 `resumeExecution` が ExecutionState から StartResult を手組みで復元しており、TimerPage の入力型として2つの「実行の姿」が併存する。A-1 の再設計で TimerPage の入力を executionId のみにすれば消える構造だが、指摘一覧に入れるか迷い、A-1 の方向性に含める形とした
