# routine-jikan 再設計レビュー — API/データ層班

対象: `packages/api/` + `packages/shared/`（契約観点） + docker-compose / .env.example
方針: 実装なし・指摘のみ。重要度 S/A/B/C、確認済み(因果を追い切った) / 疑い(未確認) を明記。
パスは `` からの相対。

## 検証環境メモ（実測済みの前提）

- 稼働中の api コンテナ内で `@libsql/client`（`file:` URL）に対し `PRAGMA foreign_keys` を実行 → **`1`（有効）を実測確認**（sqlite_version 3.45.1）。素の SQLite と違い libsql は FK 既定 ON。よって schema.ts の `ON DELETE cascade / set null` は実際に効いている。「SQLite だから FK オフ」の落とし穴は**踏んでいない**（ただし後述 D-9: 暗黙依存なので明示化推奨）
- migrate 3 本（0000〜0002）と schema.ts の突き合わせ: 0002 で `routine_executions.routine_id` を NOT NULL → nullable + SET NULL に張り替え済みで、**現行 schema.ts と最終マイグレーション状態は整合**

---

## 1. サマリ

| 重要度 | バグ | 設計指摘 | 計 |
|--------|-----|---------|----|
| S | 2 | 1 | 3 |
| A | 6 | 2 | 8 |
| B | 9 | 3 | 12 |
| C | 9 | 3 | 12 |
| **計** | **26** | **9** | **35** |

**最重要**: 依頼で警戒されていた「サイレント失敗」（WHERE 空振りでも 200 成功）を **4 箇所で確認**（S-A1, A-2, A-3, A-4）。特に `POST /executions/:id/abandon` は存在チェックが一切なく、存在しない ID でも `{ok:true}` を返す。

### サイレント失敗パターン全数チェック結果（update/delete の行数未確認）

| 箇所 | 存在/所有チェック | 判定 |
|------|------------------|------|
| executions.ts:317 abandon の update | **なし** | ❌ サイレント成功 (A-1) |
| routine-items.ts:88 item delete | **なし** | ❌ サイレント成功 (A-2) |
| tasks.ts:136 tasks reorder の update | **なし**（groupId すら未使用） | ❌ サイレント no-op + 越境更新 (A-3) |
| routine-items.ts:52 items reorder の update | **なし**（routineId 未使用） | ❌ サイレント no-op + 越境更新 (A-4) |
| executions.ts:280/302 complete/skip | 事前 select で 404 | ⭕（ただし B-1 の紐付け穴あり） |
| executions.ts:373 実行中 reorder | pending 集合で検証 | ⭕（ただし B-2 の重複穴あり） |
| tasks.ts:108/127, routines.ts:104/123, groups.ts:66/88 | 事前 select で 404 | ⭕ |

なお全箇所共通で「select → update」の 2 段構え（TOCTOU）であり、Drizzle+libsql の `rowsAffected`（ライブラリ仕様・要裏取り: `ResultSet.rowsAffected`）を見れば 1 クエリで済む。→ D-2。

---

## 2. バグ一覧（重要度順）

### S-1. ルーチン開始が非トランザクション — 途中失敗で「タスク欠落の実行中レコード」が残る
- **重要度**: S / **確認済み**（コード因果。実クラッシュは未再現）
- **根拠**: packages/api/src/routes/executions.ts:97-134 — `db.insert(routineExecutions)`（:97）→ ループで N 回 `db.insert(taskResults)`（:108-130）→ 完了判定（:134）。`db.transaction()` も `batch()` も不使用
- **発火条件**: taskResults 挿入ループ途中でプロセス死・DB エラー（例: 不正な body 由来の制約違反はループ前に展開済みだが、ディスク満杯・コンテナ再起動等）
- **症状**: `status='in_progress'` の execution にタスクが 0〜一部しか無い状態が永続。タスク 0 件だと :134 の完了判定にも到達しないため **永遠に in_progress のゴミが残る**。クライアントは 500 を受けるが DB には半端なレコードが確定済み
- **修正方針**: 実行作成〜taskResults 挿入〜完了判定を `db.transaction()` で 1 境界に。挿入は `values([...])` の一括 insert にすれば N 回ループ自体が消える

### S-2. seed が無条件全削除 + 失敗しても exit code 0
- **重要度**: S / **確認済み**
- **根拠**: packages/api/src/db/seed.ts:61-66（6 テーブル全 delete、確認なし）、:183 `seed().catch(console.error)` — 例外を握りつぶして正常終了
- **発火条件**: 運用 DB に対して seed を誤実行（DB_PATH は env 次第で本番 volume を向く）。または seed 途中で失敗
- **症状**: ①ユーザーの実データ（実行履歴含む）が全消滅。②途中失敗時もログに error が出るだけで exit 0 → スクリプト/CI からは成功扱い（サイレント失敗）。③全削除→再挿入の途中で死ぬと空 DB のまま
- **修正方針**: `process.exit(1)` を catch に。既存データ有無をチェックして `--force` なしでは削除拒否。全体を 1 トランザクションに

### A-1. `POST /executions/:id/abandon` — 存在しない ID でも `{ok:true}` 200（探していたサイレント失敗そのもの）
- **重要度**: A / **確認済み**
- **根拠**: packages/api/src/routes/executions.ts:314-323 — 他の全エンドポイントにある事前 select + 404 が**この 1 本だけ無い**。update の WHERE が空振りしても `c.json({ ok: true })`
- **発火条件**: 削除済み/typo の executionId で中断操作（クライアントの古い画面から等）
- **症状**: フロント（web/src/hooks/useApi.ts:41-42 `abandonExecution`）は成功として画面遷移、DB は無変化。周辺 PJ で 3 件続いたパターンと同型
- **付随**: 存在チェックだけでなく status ガードも無い — completed 済み実行を abandon すると `status` と `completedAt` を上書きし完了履歴を破壊する（:317-320）
- **修正方針**: 事前 select（or rowsAffected 確認）で 404。`status !== 'in_progress'` なら 409/400

### A-2. `DELETE /routines/:routineId/items/:itemId` — 存在しない ID でも `{ok:true}` 200
- **重要度**: A / **確認済み**
- **根拠**: packages/api/src/routes/routine-items.ts:85-92 — 存在チェックなしで delete → 固定 `{ok:true}`。同ファイルの PUT（:65-69）には 404 があるのに delete だけ欠落
- **発火条件**: 二重クリック・古い画面からの削除。また `:routineId` は完全未使用（:86）なので、別ルーチンの itemId を渡しても消える（越境削除）
- **症状**: 空振り時もフロントは削除成功表示。リロードで「消えてない」が発覚
- **修正方針**: 事前 select + routineId 一致チェックで 404

### A-3. `PUT /groups/:groupId/tasks/reorder` — groupId 完全無視・ID 未検証・非原子
- **重要度**: A / **確認済み**
- **根拠**: packages/api/src/routes/tasks.ts:132-142 — `groupId` param を一切参照せず、`taskIds` の存在・所属・網羅性も未検証のまま `sortOrder: i` で逐次 update
- **発火条件**: ①存在しない ID 混入 → その update だけ空振りで 200（サイレント部分成功）。②別グループのタスク ID を渡す → **他グループの並び順を破壊**。③グループ内の一部だけ渡す → 渡されなかったタスクと `0..n-1` が衝突し sortOrder 重複。④ループ途中失敗 → 半分だけ並び替わった状態が残る（非トランザクション）
- **症状**: 並び順の重複・越境破壊がすべて 200 成功で通る
- **修正方針**: グループの全タスク ID と `taskIds` の集合一致を検証（executions.ts:361-364 と同水準以上）→ 不一致は 400。更新はトランザクションで

### A-4. `PUT /routines/:routineId/items/reorder` — A-3 と同型
- **重要度**: A / **確認済み**
- **根拠**: packages/api/src/routes/routine-items.ts:48-58 — routineId 未使用、itemIds 未検証、非原子。空振り update も 200
- **発火条件/症状/修正方針**: A-3 に同じ（対象が routine_items）

### A-5. shared の `TaskStatus` 型が DB 実態と乖離 — 契約が嘘をついている
- **重要度**: A / **確認済み**
- **根拠**: packages/shared/src/types.ts:3 は `'completed' | 'skipped' | 'auto-skipped (day)' | 'auto-skipped (cost)'`。しかし API が実際に書くのは `'pending'`（executions.ts:110）と `'auto-skipped'`（:112,114）で、`'auto-skipped (day)'` / `'auto-skipped (cost)'` は**どこにも書かれない**。schema.ts:84 のコメントも同じ嘘。集計側も `startsWith('auto-skipped')`（executions.ts:179）と `!== 'auto-skipped'`（:266）で表記が揺れている（現状の格納値では偶然同値）
- **発火条件**: shared 型を信じてフロント/集計を書いた瞬間（`'pending'` が型に無いので網羅 switch が壊れる）
- **症状**: 型チェックは通るのに実データと不一致。将来 `'auto-skipped (day)'` を格納し始めたら :266 の `!==` 比較が静かに壊れる
- **修正方針**: TaskStatus を実態（`pending | completed | skipped | auto-skipped`。day/cost を区別したいなら reason カラム分離）に合わせ、API も shared 型を import して使う。比較は必ず同一のヘルパ経由に

### A-6. API が shared/domain.ts を一切使わず同ロジックを再実装 — 既に挙動が乖離
- **重要度**: A / **確認済み**（乖離ケースはコード机上）
- **根拠**: executions.ts:59-91 がコストレベル適用・曜日フィルタを独自実装。shared/src/domain.ts の `getEffectiveDuration`/`shouldSkipByCost`/`shouldSkipByDay` と同じ意図の重複。乖離の実例: `durationSec=0`（medium）のタスクは shared では `shouldSkipByCost` → スキップ対象（domain.ts:21-23）だが、API では :113 の条件 `plannedDurationSec === 0 && baseDurationSec > 0` が false → **0 秒の pending タスク**として実行列に入る。さらに vitest（shared/src/__tests__/domain.test.ts）は**本番 API が通らないコードだけをテストしている**
- **発火条件**: durationSec=0 のタスク作成（バリデーション無いので可能、B-4）。またはどちらか片方だけ仕様変更した時
- **症状**: 見積り・スキップ判定がフロント（shared 利用側）と API で食い違う。テストの安心感が虚偽
- **修正方針**: 実行展開ロジックを shared の純関数に寄せ、API はデータ取得+永続化だけ担当。テスト対象=本番経路に一致させる

### B-1. complete/skip が「execution と taskResult の紐付け」を検証しない → 完了判定が別 execution に走る
- **重要度**: B / **確認済み**（コード因果）
- **根拠**: executions.ts:271-289（complete）, :293-311（skip）— `taskId` の存在だけ確認（:275-278）し、URL の `:id` は :287 `checkExecutionCompletion(id)` にのみ使用。taskResult.executionId と `:id` の一致チェックなし
- **発火条件**: クライアントが execId と taskId の組を取り違えて送る（実 web は正しく送るが、API 契約としては無防備）
- **症状**: タスク自体は正しく completed になるが、完了判定は**無関係な execution** に対して実行。本来完了すべき execution が in_progress のまま取り残される（Execution not found でもエラーにならない — checkExecutionCompletion は空結果なら「pending なし」扱いで**その別 execution を completed に書き換える**::387-393）
- **修正方針**: `result.executionId !== id` なら 404/400。checkExecutionCompletion は結果 0 件なら何もしない

### B-2. 実行中 reorder — 部分リスト許容で sortOrder 重複が作れる
- **重要度**: B / **確認済み**（コード机上）
- **根拠**: executions.ts:357-376 — `taskIds` が「全 pending の並べ替え」であることを検証しない（pending に含まれるかだけ :362-364）。渡されなかった pending タスクは旧 sortOrder のまま残り、`nonPendingMax+1+i`（:374）と衝突しうる。さらに taskIds 内の重複も素通し（Set 判定のため）
- **発火条件**: pending 5 件中 2 件だけ送る、同一 ID を 2 回送る等
- **症状**: sortOrder 重複 → `results.findIndex(r => r.status === 'pending')`（:256）の「現在のタスク」が意図しない方になる。並びが非決定的（同値時は挿入順依存）
- **修正方針**: 「taskIds は pending 全件と集合一致」を要求して 400。更新はトランザクション（途中失敗で半端な並びが残る点も A-3 同様）

### B-3. `PUT /routines/:id` / `PUT /groups/:id` の mass assignment — body 丸ごと set（id・createdAt 上書き可）
- **重要度**: B / **疑い**（Drizzle が set() の余剰キー/既知カラムをどう扱うかはライブラリ仕様・要裏取り。id が set に通る前提の机上）
- **根拠**: routines.ts:99-104 `set({ ...body, updatedAt })`、groups.ts:66-69 同型。TypeScript の型注釈はランタイムでは何も守らない
- **発火条件**: `{"id":"x"}` や `{"createdAt":"garbage"}` を含む PUT（curl 一発）
- **症状**: 主キー変更 → routine_items.routineId の FK（ON UPDATE no action、FK 有効実測済み）により子持ちなら 500、子無しなら**主キーが静かに変わる**。createdAt 汚染も自由
- **修正方針**: tasks.ts:87-106 のようなフィールド明示コピー（既にあるパターンに統一）か zod でホワイトリスト化

### B-4. 入力バリデーション全般欠如 — 欠損で 500、型違いで DB 汚染
- **重要度**: B / **確認済み**（500 経路はコード因果。SQLite の型親和性による TEXT 混入は標準仕様だが実測はしていない → その部分のみ疑い）
- **根拠**（代表例）:
  - executions.ts:11-14,100 — `costLevel` 未検証。`"banana"` でも 201、DB に任意文字列が入る（'low'/'high' 以外は medium 扱い :78-79）。欠損なら NOT NULL 違反で 500
  - executions.ts:273,282 — `actualDurationSec` 未検証。負数・文字列も素通し。文字列が入ると `reduce((sum,r)=>sum+r.actualDurationSec)`（:180, history.ts:28）が**文字列連結になり集計が壊れる**（テーブルは STRICT でないため INTEGER カラムに TEXT が格納可能 — SQLite 型親和性仕様）
  - tasks.ts:42-43 — `name`/`durationSec` 欠損で NOT NULL 違反 500。負値・0 も素通し（0 は A-6 の乖離を踏む）
  - routines.ts:69 — `name` 欠損で 500
  - routine-items.ts:11-17,34 — `itemType` 任意文字列可、`itemType:'task'` なのに taskId なし等の不整合も 201（B-7 に接続）。存在しない taskId/groupId は FK 違反 500（FK ON 実測済み）
  - tasks.ts:47 / :96-98 — `scheduledDays` の要素・型未検証。何を入れても JSON.stringify されて格納
- **発火条件**: web UI 以外からの呼び出し、UI バグ、curl
- **症状**: 500（生 HTML テキスト、B-5）or DB 汚染（後から集計・実行展開が壊れる）
- **修正方針**: `@hono/zod-validator` で全 body/param をスキーマ検証 → 400 + JSON エラー。Simple 志向に合う最小導入（各ルート 5〜10 行）

### B-5. エラーハンドリング不統一 — 不正 JSON は 500 テキスト、skip だけ .catch、onError なし
- **重要度**: B / **確認済み**
- **根拠**: `app.onError` 未定義（index.ts 全体）。`c.req.json()` は skip のみ `.catch(() => ({}))`（executions.ts:295）で、complete（:273）・start（:11）・他全 POST/PUT は不正 JSON で例外 → Hono 既定の 500 `Internal Server Error`（text/plain）。正常系エラーは `{error: string}` JSON、成功は `{ok:true}` と routines の「更新後エンティティ返却」（routines.ts:110）が混在
- **発火条件**: Content-Type 忘れ・壊れた JSON・DB 例外全般
- **症状**: クライアントはステータスコードしか得られない（useApi.ts:8-9 はどのみち message を読まないが、契約として不統一）
- **修正方針**: `app.onError` で `{error, code}` JSON に統一。HTTPException 使用。成功レスポンス形も「更新後エンティティを返す」に統一

### B-6. abandoned な execution が complete/skip 経由で completed に化ける
- **重要度**: B / **確認済み**（コード因果）
- **根拠**: abandon はタスク側 status を変えない（executions.ts:314-323）ので pending が残る。その後 complete/skip は execution の status を見ずに受け付け（:271-311）、全 pending が消えた時点で checkExecutionCompletion（:387-393）が **status='abandoned' を無条件に 'completed' へ上書き**、completedAt も書き換え
- **発火条件**: 中断後に古い画面・再送でタスク操作が届く
- **症状**: 「中断した」という履歴事実が消える（統計の完遂率が嘘になる）
- **修正方針**: complete/skip/reorder は `execution.status === 'in_progress'` を要求（reorder には既にある :349 — これを横展開）。checkExecutionCompletion も in_progress のみ対象に

### B-7. `itemType:'task'` のルーチンアイテムは実行時に黙って無視される
- **重要度**: B / **確認済み**
- **根拠**: routine-items.ts:12 と schema.ts:53-54 は `'task'` を受け付け、routines.ts:43-48 は GET で展開までする。しかし実行展開は executions.ts:43 `if (item.itemType !== 'group_ref' || !item.groupId) continue` で**単体タスクアイテムを無条件スキップ**
- **発火条件**: API 直叩き or 将来 UI が単体タスク追加に対応した時（web は現状 group_ref のみ生成 — useApi.ts:76-77）
- **症状**: 追加は 201 成功・詳細画面にも出るのに、開始すると存在しないかのように消える（サイレント失敗の亜種）
- **修正方針**: 再設計で「itemType を廃止して group_ref に一本化」か「実行展開で task を処理」のどちらかに倒す。中途半端な予約実装を残さない

### B-8. エクスポート/履歴の日付が UTC 基準 — JST 朝 9 時前の実行が前日扱い
- **重要度**: B / **確認済み**
- **根拠**: startedAt は `new Date().toISOString()`（UTC、executions.ts:95）。エクスポートの `date` は `exec.startedAt.split('T')[0]`（:209、history.ts:72 も同じ）= **UTC の日付**。from/to フィルタも `to + 'T23:59:59.999Z'`（:197）と UTC 境界。一方、曜日判定だけは JST（:28-30）で、アプリ内のタイムゾーン基準が割れている
- **発火条件**: JST 00:00〜08:59 の実行（朝ルーチンはど真ん中）
- **症状**: 朝 6 時の朝ルーチンが CSV 上「前日」の行になる。from=2026-07-09 で 7/9 朝の実行が漏れる
- **修正方針**: 保存は UTC のまま、**表示・集計境界（export の date 算出と from/to）だけ JST 変換を明示**。tz をクエリパラメータ化してもよい

### B-9. タスクのグループ移動（PUT groupId）— 移動先の存在チェックなし・sortOrder 未調整
- **重要度**: B / **確認済み**（FK ON は実測済み）
- **根拠**: tasks.ts:90（groupId 素通し）→ :108 update。存在しない groupId は FK 違反で 500（400 が適切）。移動先での sortOrder 再採番なし → 移動先グループ内で sortOrder 衝突（useApi.ts:72-73 `moveTask` はまさにこの経路）
- **発火条件**: グループ間移動全般
- **症状**: 移動先で並び順が非決定的に割り込む
- **修正方針**: 移動先グループの存在確認 + `max(sortOrder)+1` 付与をセットで

### C-1. executions.ts の csvEscape が改行未対応（history.ts 版との複製ドリフト）
- **重要度**: C / **確認済み**
- **根拠**: executions.ts:226 は `,` と `"` のみ。history.ts:105-110 は `\n` も対応。同じ機能の 2 コピーが既に食い違っている（history.ts は index.ts:11 のコメント通り dead code）
- **症状**: タスク名に改行があると CSV の行構造が壊れる
- **修正方針**: history.ts を削除し、csvEscape に `\n` 判定を追加（D-6）

### C-2. sortOrder 採番の並行競合（read-modify-write）
- **重要度**: C / **疑い**（単一ユーザーでの実害は未確認）
- **根拠**: tasks.ts:33-36, routine-items.ts:26-29 — JS 側で max を計算してから insert。並行 2 リクエストで同値採番
- **修正方針**: 個人用なら許容範囲。再設計時に「並べ替えは全置換トランザクション」（D-8）に寄せれば自然解消

### C-3. taskResults.startedAt がどこからも書かれない死カラム
- **重要度**: C / **確認済み**
- **根拠**: schema.ts:85 定義、executions.ts:126 で null 固定のまま、complete/skip も completedAt しか書かない（:280-284, :302-306）
- **症状**: 実所要時間の検証（completedAt−startedAt vs actualDurationSec）が不可能
- **修正方針**: 「タスク開始」イベントを記録するか、カラムを消す。中途半端が一番悪い

### C-4. boolean/デフォルト系カラムが nullable
- **重要度**: C / **確認済み**
- **根拠**: schema.ts:10-11, 21, 40-41, 56 — `default()` のみで `.notNull()` なし。routineItems.isEnabled が null だと executions.ts:46-47 `?? item.isEnabled` → `!null` → **グループが黙ってスキップ**される経路が理論上ある（現行の挿入経路では null にならないため実害未確認）
- **修正方針**: 3 値になる理由がない列は `.notNull().default(...)` に

### C-5. status / costLevel / itemType に CHECK 制約なし
- **重要度**: C / **確認済み**
- **根拠**: schema.ts:53, 67, 70, 84 — 全部コメントによる紳士協定のみ。B-4 の汚染を DB が最後に止める層がない
- **修正方針**: SQLite の CHECK（`text({ enum: [...] })` で Drizzle が生成可能 — ライブラリ仕様・要裏取り）を付与

### C-6. JST 曜日計算が toLocaleString パースハック
- **重要度**: C / **確認済み**（現 Node/ICU では動作）
- **根拠**: executions.ts:29、shared/src/domain.ts:70 — `new Date(date.toLocaleString('en-US', {timeZone}))` は文字列表現経由の再パースで、ロケール/ICU 実装依存
- **修正方針**: `Intl.DateTimeFormat('en-US', {timeZone, weekday:'short'})` で曜日を直接取る

### C-7. DB_PATH 既定が相対パス（CWD 依存）
- **重要度**: C / **確認済み**
- **根拠**: db/index.ts:5 `file:./data/routine-jikan.db`、drizzle.config.ts:8 も相対。起動ディレクトリ次第で**別の空 DB が黙って作られる**（migrate が走るので気づきにくい）
- **修正方針**: コンテナ内は絶対パス既定（`file:/app/data/...`）に

### C-8. AUTH_TOKEN のクエリパラメータ受け付け
- **重要度**: C / **確認済み**（認証設計自体は仕様外、有効化した場合の事実指摘）
- **根拠**: index.ts:29 `?? c.req.query('token')` — トークンが URL に乗り、アクセスログ・ブラウザ履歴・Referer に残る
- **修正方針**: ヘッダのみに。`replace('Bearer ', '')` も `Bearer` 無しの生値を素通しする緩さ（実害小）

### C-9. reorder の taskIds 重複素通し
- **重要度**: C / **確認済み**
- **根拠**: executions.ts:362-364 — Set 包含チェックのみで重複検知なし。同一 ID を 2 回送ると後の順番で確定し、送っていない pending との整合が崩れる（B-2 と同根）
- **修正方針**: `new Set(taskIds).size === taskIds.length` チェック（B-2 の集合一致検証に含まれる）

---

## 3. 設計指摘一覧（再設計 ADR 素材）

### D-1. バリデーション層の欠如（B-4 の根本）
- **重要度**: A / 確認済み / 根拠: 全ルートで `c.req.json<T>()` の型注釈のみ（例 executions.ts:11-14, tasks.ts:11-24）
- **再設計方向**: `zod` + `@hono/zod-validator` を全ルートに。スキーマは packages/shared に置いて web と共有すれば「API との契約」が実行時に強制される。Simple 志向に合致（各ルート数行、魔法なし）

### D-2. 「事前 select → update/delete」二度手間 + 結果行数無視の混在（S-A1〜A4 の根本）
- **重要度**: A / 確認済み / 根拠: セクション 1 の全数チェック表
- **再設計方向**: `const r = await db.update(...).where(...); if (r.rowsAffected === 0) return 404`（libsql の ResultSet.rowsAffected — ライブラリ仕様・要裏取り）を全 update/delete の標準形に。1 クエリで TOCTOU も消える

### D-3. トランザクション境界ゼロ（S-1, A-3/4, B-2 の根本）
- **重要度**: S / 確認済み / 根拠: `git grep transaction packages/api/src` 0 件相当（全ルート目視で不使用）
- **再設計方向**: 「複数行を書く操作は必ず `db.transaction()`」を規約に。対象は start / 全 reorder / seed の 5 箇所だけなので軽い

### D-4. ドメインロジックの二重実装（A-6 の根本）
- **重要度**: A / 確認済み
- **再設計方向**: 実行展開（コスト適用・曜日スキップ・0 秒スキップ）を shared の純関数 `expandRoutine(items, groups, tasks, costLevel, today)` に統合し、API はそれを呼ぶだけに。テストは shared 側 1 箇所で済み、web のプレビュー計算とも一致する

### D-5. status 値の設計（A-5 の根本）
- **重要度**: B / 確認済み
- **再設計方向**: `status: 'pending'|'completed'|'skipped'|'auto-skipped'` + `skipReason: 'day'|'cost'|null` に分離し、shared の型 = DB の CHECK = API の zod を単一定義から生成

### D-6. history.ts が dead code なのにリポジトリに残存
- **重要度**: C / 確認済み / 根拠: index.ts:11 コメント「historyRouter は executionsRouter に統合済み」、routes/history.ts:1-126 全体が未マウント。既に C-1 のドリフトが発生
- **再設計方向**: 削除。CSV 生成は 1 モジュールに

### D-7. taskResults のスナップショット設計は良い、ただし routineId の扱いと片方向
- **重要度**: C / 確認済み / 根拠: taskName/groupName/秒数をコピーして保持（schema.ts:76-88）は履歴の独立性として正しい判断（routine 削除で SET NULL、:66 も整合）。一方 execution 側は routine 名をスナップショットせず JOIN 頼み（executions.ts:176 で '(削除済み)' フォールバック）
- **再設計方向**: `routineName` も execution にスナップショットすれば履歴表示が自己完結し N+1（C 級だが :164-183, :200-206 のループ select）も減る

### D-8. sortOrder 管理方式の統一
- **重要度**: B / 確認済み（A-3/4, B-2, B-9, C-2 の総括）
- **再設計方向**: 「並び替え = 対象集合の全 ID を受け取り、集合一致を検証し、トランザクションで 0..n-1 に全置換」を唯一のパターンに。挿入時採番は `max+1`（トランザクション内）。fractional index 等の重厚な仕組みは不要

### D-9. ネットワーク露出（認証なしは仕様、露出との組み合わせの事実指摘）
- **重要度**: S（組み合わせ時の影響として）/ 確認済み
- **根拠**: docker-compose.yml:4-5 `"3001:3001"`（`docker compose ps` 実測で `0.0.0.0:3001->3001`）+ index.ts:20 `cors()`（全オリジン許可）+ .env.example:10-11（AUTH_TOKEN 既定コメントアウト）。一方 web は vite.config.ts:11-14 で `/api` → `http://api:3001` をプロキシ済みなので、**API ポートのホスト公開自体が不要**
- **事実**: 同一 LAN の任意端末、および CORS 全開のため LAN 内ユーザーが開いた任意の Web ページの JS からも、無認証で全 DELETE/PUT が叩ける（`DELETE /api/routines/:id` 等）
- **再設計方向**: compose の api を `ports` なし（web からは compose 内部ネットワークで到達可）か `127.0.0.1:3001:3001` に。これだけで認証なし仕様のまま露出が消える。CORS も web オリジンに絞る
- **補足（FK）**: libsql の FK 既定 ON に暗黙依存している。接続初期化で `PRAGMA foreign_keys=ON` を明示するか README に記す（ドライバ変更時の保険）

---

## 4. 対象外で気づいた問題（担当外・記録のみ）

1. **web の fetchJson がエラーボディを捨てる**（packages/web/src/hooks/useApi.ts:8-10）— API 側でエラー形式を統一（B-5）しても表示されない。フロント班に共有推奨
2. **web の completeTask は常に actualDurationSec を送る**（useApi.ts:31-35）ため B-4 の actualDurationSec 汚染は現 UI からは発火しない（潜在）
3. **docker-compose の api-data volume は `docker compose down -v` で消える** — バックアップ手段（sqlite ファイルの定期コピー等）が無い。運用班/オーナー判断事項
4. web コンテナが 8 週間前ビルドのまま 11 日連続稼働（`docker compose ps` 実測）— レビュー中の挙動確認はコード基準で行った
5. tasksRouter が `/api` 直下マウント（index.ts:45）で `/api/tasks/:id` と `/api/groups/:groupId/tasks` が同居 — 動くが、ルーター分割の意図（リソース単位）と一致していない。再設計時にパス設計ごと整理を

---

## 検証方法の記録

- 全対象ファイルを Read で通読（executions/tasks/routines/history/routine-items/groups/schema/index/migrate/seed/drizzle.config/domain/types/domain.test/docker-compose/.env.example + 参照として useApi.ts, vite.config.ts, drizzle/*.sql）
- FK 既定値: 稼働中 api コンテナで `PRAGMA foreign_keys` → 1 を実測（読み取りのみ、書き込みは一切していない）
- 「ライブラリ仕様(要裏取り)」と明記した項目: D-2 の rowsAffected、B-3 の Drizzle set() 余剰キー挙動、C-5 の enum→CHECK 生成。いずれも修正方針の妥当性には影響するが、バグ指摘自体の根拠はコード側にある
