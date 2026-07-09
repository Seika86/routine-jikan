# バグ台帳 (Bug Ledger)

2026-07-09 の4班並列レビューで発見した潜在バグ・設計問題の統合台帳。詳細（発火条件・症状・修正方針）は「詳細」列の出典レポート該当項を参照。

- **出典レポート:** [design-audit](review/2026-07-09/design-audit.md) / [bug-hunt-web](review/2026-07-09/bug-hunt-web.md) / [state-model](review/2026-07-09/state-model.md) / [api-data](review/2026-07-09/api-data.md)
- **レビュー時点:** develop `d84ad5e`。ベースライン: tsc エラー1件（= RJ-A10）、テスト 22/22 pass（shared のみ）
- **重要度:** S(データ損失・停止) / A(機能が正しく動かない) / B(特定条件で誤動作) / C(軽微・理論上)
- **運用:** 修正したら「状態」を `修正済 (コミットID)` に更新。新規発見は各重要度の末尾に追記。再設計の方向性は [ADR-001](adr/0001-product-redesign.md)

## S — データ損失・停止 (3件)

| ID | 領域 | タイトル | 根拠 | 詳細 | 状態 |
|----|------|---------|------|------|------|
| RJ-S01 | api | ルーチン開始が非トランザクション — 途中失敗で「タスク欠落の in_progress」が永続 | executions.ts:97-134 | api S-1 | 未着手 |
| RJ-S02 | api | seed が無条件全削除 + 失敗しても exit 0 | seed.ts:61-66,183 | api S-2 | 未着手 |
| RJ-S03 | infra | API が LAN 露出（0.0.0.0:3001 + CORS 全開 + 認証なし）。web は proxy 済でポート公開自体が不要 | docker-compose.yml:4-5, index.ts:20 | api D-9 | 未着手 |

## A — 機能が正しく動かない (12件)

| ID | 領域 | タイトル | 根拠 | 詳細 | 状態 |
|----|------|---------|------|------|------|
| RJ-A01 | web | timerOverrun='auto-next'（自動スキップ）が完全未実装 — 設定しても黙って無視 | TaskEditModal.tsx:30,44 / TimerPage 参照0件 | bug-hunt A-1 | 未着手 |
| RJ-A02 | web | 読み上げ閾値が完全一致(===)判定 — 秒が飛ぶと読み上げ永久欠落 | TimerPage.tsx:219,249 | bug-hunt A-2 | 未着手 |
| RJ-A03 | web | スキップ時に実測時間を送らず履歴の実時間が 0 に | TimerPage.tsx:385, useApi.ts:36-40 | bug-hunt A-3 | 未着手 |
| RJ-A04 | api | abandon がサイレント成功（存在チェックなし）+ 完了済み履歴を abandoned に上書き可 | executions.ts:314-323 | api A-1 | 未着手 |
| RJ-A05 | api | item DELETE がサイレント成功 + routineId 未使用で越境削除可 | routine-items.ts:85-92 | api A-2 | 未着手 |
| RJ-A06 | api | tasks reorder: groupId 完全無視・ID 未検証・非原子 — 越境更新可 | tasks.ts:132-142 | api A-3 | 未着手 |
| RJ-A07 | api | items reorder: RJ-A06 と同型 | routine-items.ts:48-58 | api A-4 | 未着手 |
| RJ-A08 | arch | shared パッケージ完全未使用 — ドメインロジック3重実装・既に挙動乖離・テストは死蔵コードのみ検証 | import 0件 / executions.ts:59-91 / StartPage.tsx:40-49 | design S-1, api A-6 | 未着手 |
| RJ-A09 | arch | TaskStatus 型・schema コメント・実装の書き込み値が三者不一致 | types.ts:3 vs executions.ts:110-114 | design A-5, api A-5 | 未着手 |
| RJ-A10 | infra | vite-env.d.ts 不在で `tsc --noEmit` が恒常赤（ImportMeta.env） | App.tsx:22, web に .d.ts 0件 | design A-3 | 未着手 |
| RJ-A11 | infra | pnpm-lock.yaml 不在 + Docker が workspace 無視 — ビルド再現性ゼロ | 全リポ lockfile 0件 / 各 Dockerfile | design A-4 | 未着手 |
| RJ-A12 | arch | AUTH_TOKEN が API のみ実装 — 有効化すると web が全滅する半実装 | index.ts:23-36 vs useApi.ts:3-12 | design A-6 | 未着手 |

## B — 特定条件で誤動作 (29件)

| ID | 領域 | タイトル | 根拠 | 詳細 | 状態 |
|----|------|---------|------|------|------|
| RJ-B01 | web | D&D/繰り上げ経路で spokenTimeUp リセット漏れ（2026-04-09 と同型）— 終了通知が完全沈黙 | TimerPage.tsx:437-444,469-475 | bug-hunt B-4 | 未着手 |
| RJ-B02 | web | TTS 排他制御なし — 並行 fetch で順序逆転・二重再生 | tts.ts:169-249 | bug-hunt B-5 | 未着手 |
| RJ-B03 | web | ducking の preDuckGain 汚染 — 環境音が段階的に小さくなり戻らない | ambient.ts:215-221, tts.ts:254-263 | bug-hunt B-6 | 未着手 |
| RJ-B04 | web | duckUp がミュート無視 — ミュート中に環境音が復活 | ambient.ts:224-229 | bug-hunt B-7 | 未着手 |
| RJ-B05 | web | ミュート解除で音量二重適用（volume/100 の2乗） | ambient.ts:175-208 | bug-hunt B-8 | 未着手 |
| RJ-B06 | web | TTS 形式誤検出が localStorage 永続化・復旧経路なし（resetDetectedFormat 呼出0件） | tts.ts:134-152,329-331 | bug-hunt B-9 | 未着手 |
| RJ-B07 | web | リロード復元時に ambient の AudioContext が suspended のまま復帰不能【疑い】 | ambient.ts:169-173, TimerPage.tsx:157-162 | bug-hunt B-10 | 未着手 |
| RJ-B08 | web | 0秒タスク（base=0）が pending になり即「終了！」読み上げ + progress NaN | TimerPage.tsx:343,233 / tasks.ts:92 | bug-hunt B-11 | 未着手 |
| RJ-B09 | web | 完了/スキップ連打ガードなし — stale closure で二重処理・履歴汚損 | TimerPage.tsx:349-410,600-611 | bug-hunt B-12 | 未着手 |
| RJ-B10 | web | 中断しても「🎉 完了おめでとう！」画面 | TimerPage.tsx:412-418,288-333 | bug-hunt B-13 | 未着手 |
| RJ-B11 | web | EditPage の refresh が編集中のフォーム入力を黙って上書き | EditPage.tsx:57-63 | bug-hunt B-14 | 未着手 |
| RJ-B12 | web | モーダル保存失敗で「保存中...」のまま固まる（try/finally なし） | TaskEditModal.tsx:37-48, GroupEditModal.tsx:16-20 | bug-hunt B-15 | 未着手 |
| RJ-B13 | web | 開始失敗で「準備中...」のまま固まる | StartPage.tsx:58-64 | bug-hunt B-16 | 未着手 |
| RJ-B14 | web | 並べ替え永続化の失敗が黙殺 — UI とサーバー順序が乖離 | TimerPage.tsx:454,484 ほか | bug-hunt B-17 | 未着手 |
| RJ-B15 | web | 初期ロード失敗で全ページ無限「読み込み中...」（HistoryPage は素 fetch で r.ok 未確認） | TimerPage.tsx:124-153, HistoryPage.tsx:27-31 ほか | bug-hunt B-18, design B-7 | 未着手 |
| RJ-B16 | web | コスト時間の秒成分が保存のたび切り捨て | TaskEditModal.tsx:28-29,42-43 | bug-hunt B-19 | 未着手 |
| RJ-B17 | web | 並べ替えで現在タスクが変わると旧タスクの経過時間が無言で破棄【仕様か要判断】 | TimerPage.tsx:438-444,469-475 | bug-hunt B-20 | 未着手 |
| RJ-B18 | api | complete/skip が execution と taskResult の紐付けを検証せず、完了判定が別 execution に走る | executions.ts:271-311,387-393 | api B-1 | 未着手 |
| RJ-B19 | api | 実行中 reorder が部分リスト許容 — sortOrder 重複で「現在のタスク」が非決定に | executions.ts:357-376 | api B-2 | 未着手 |
| RJ-B20 | api | PUT routines/groups の mass assignment（id・createdAt 上書き可）【疑い】 | routines.ts:99-104, groups.ts:66-69 | api B-3 | 未着手 |
| RJ-B21 | api | 入力バリデーション全般欠如 — 欠損 500・型違い DB 汚染（文字列連結集計など） | 全ルート `c.req.json<T>()` のみ | api B-4, design B-6 | 未着手 |
| RJ-B22 | api | エラーハンドリング不統一 — onError なし、不正 JSON は 500 テキスト | index.ts 全体, executions.ts:295 | api B-5 | 未着手 |
| RJ-B23 | api | abandoned な execution が complete/skip 経由で completed に化ける | executions.ts:314-323,387-393 | api B-6 | 未着手 |
| RJ-B24 | api | itemType:'task' のアイテムは登録成功するのに実行時に黙って無視 | executions.ts:43, routine-items.ts:12 | api B-7, design B-3 | 未着手 |
| RJ-B25 | api | エクスポート/履歴フィルタの日付が UTC 基準 — JST 朝9時前の実行が前日扱い | executions.ts:197,209 | api B-8 | 未着手 |
| RJ-B26 | api | タスクのグループ移動: 移動先存在チェックなし・sortOrder 未調整で衝突 | tasks.ts:90,108 | api B-9 | 未着手 |
| RJ-B27 | arch | Wake Lock 二重実装（App フック + TimerPage インライン）が同時稼働 | useWakeLock.ts / TimerPage.tsx:46-103 | design B-1 | 未着手 |
| RJ-B28 | arch | dead code: history.ts 未マウント全文複製（既にドリフト）+ tsconfig.base.json 誰も継承せず | index.ts:11, history.ts / 各 tsconfig | design B-2, api D-6 | 未着手 |
| RJ-B29 | arch | 「設定できるのに効かない」機能3系統（タスク個別TTS/環境音・auto-next・itemType:'task'） | schema.ts:37-42 ほか | design B-3 | 未着手 |

## C — 軽微・理論上 (24件)

| ID | 領域 | タイトル | 根拠 | 詳細 | 状態 |
|----|------|---------|------|------|------|
| RJ-C01 | web | 履歴からの再開が失敗時に無反応（ルーチン削除済みで現実に発火） | App.tsx:93-117 | bug-hunt C-21 | 未着手 |
| RJ-C02 | web | セッション復元チェックが一時的通信失敗でもセッション破棄 | App.tsx:58-62 | bug-hunt C-22 | 未着手 |
| RJ-C03 | web | 「+ ルーチンを追加」連打で複数作成 | App.tsx:237-242 | bug-hunt C-23 | 未着手 |
| RJ-C04 | web | TimerPage unmount 後も TTS コールバック残留（closure リーク） | TimerPage.tsx:155-156 | bug-hunt C-24 | 未着手 |
| RJ-C05 | web | 履歴削除の失敗でダイアログが固まる | HistoryPage.tsx:33-38 | bug-hunt C-25 | 未着手 |
| RJ-C06 | web | 数値入力の "-" 等で NaN→null が API に送信される【疑い】 | TaskEditModal.tsx:85-124 | bug-hunt C-26 | 未着手 |
| RJ-C07 | web | scheduledDays の JSON.parse に try なし — 不正データで白画面 | TaskEditModal.tsx:32, SortableTask.tsx:74 | bug-hunt C-27 | 未着手 |
| RJ-C08 | web | startKeepAlive が名前と裏腹に no-op（iOS suspend 対策になっていない） | tts.ts:414-421 | bug-hunt C-28 | 未着手 |
| RJ-C09 | web | Web Speech の voices 未ロードで voice 設定が無視される【疑い】 | tts.ts:117-121 | bug-hunt C-29 | 未着手 |
| RJ-C10 | web | Wake Lock: unmount と取得の競合で release 漏れ | TimerPage.tsx:68-103 | bug-hunt C-30 | 未着手 |
| RJ-C11 | web | 完了タップ直後の表示フリッカー | TimerPage.tsx:353-355 | bug-hunt C-31 | 未着手 |
| RJ-C12 | web | SortableGroup 連続ドラッグ × refresh の順序レースで一瞬巻き戻り【疑い】 | SortableGroup.tsx:34-68 | bug-hunt C-32 | 未着手 |
| RJ-C13 | web | 完了時の実測値が tick 粒度（最大約1秒過小） | TimerPage.tsx:353 | bug-hunt C-33 | 未着手 |
| RJ-C14 | api | csvEscape が改行未対応（dead code の history.ts 版と既にドリフト） | executions.ts:226 | api C-1 | 未着手 |
| RJ-C15 | api | sortOrder 採番の並行競合（read-modify-write） | tasks.ts:33-36 ほか | api C-2 | 未着手 |
| RJ-C16 | api | taskResults.startedAt がどこからも書かれない死カラム | schema.ts:85, executions.ts:126 | api C-3 | 未着手 |
| RJ-C17 | api | boolean/デフォルト系カラムが nullable（3値化の理由なし） | schema.ts:10-56 | api C-4 | 未着手 |
| RJ-C18 | api | status/costLevel/itemType に CHECK 制約なし（紳士協定のみ） | schema.ts:53-84 | api C-5 | 未着手 |
| RJ-C19 | api | JST 曜日計算が toLocaleString 再パースハック（ICU 実装依存） | executions.ts:29, domain.ts:70 | api C-6 | 未着手 |
| RJ-C20 | api | DB_PATH 既定が相対パス — CWD 次第で別の空 DB が黙って作られる | db/index.ts:5 | api C-7 | 未着手 |
| RJ-C21 | api | AUTH_TOKEN のクエリパラメータ受け付け（URL にトークンが残る） | index.ts:29 | api C-8 | 未着手 |
| RJ-C22 | api | reorder の taskIds 重複素通し | executions.ts:362-364 | api C-9 | 未着手 |
| RJ-C23 | web | COST_LABELS 等の表示定数が3ファイルに重複定義 | TimerPage.tsx:672-676 ほか | design C-1 | 未着手 |
| RJ-C24 | api | N+1 クエリ（ループ内 await select、inArray import 済み未使用） | executions.ts:164-183 ほか | design C-2 | 未着手 |

---

*作成: 2026-07-09 Fable 資産化スプリント②（4班並列レビュー + 本体検証ゲート済み — 主要指摘12項目をソース突き合わせで抜き打ち確認、全一致）*
