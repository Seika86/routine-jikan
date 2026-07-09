# ADR-001: 製品版再設計の方向性

- **Status:** Proposed（Seika レビュー待ち）
- **Date:** 2026-07-09
- **出典:** 4班並列レビュー（[design-audit](../review/2026-07-09/design-audit.md) / [bug-hunt-web](../review/2026-07-09/bug-hunt-web.md) / [state-model](../review/2026-07-09/state-model.md) / [api-data](../review/2026-07-09/api-data.md)）。個別バグは [バグ台帳](../bug-ledger.md) 参照

## Context

routine-jikan は「改修・学習フェーズ」（2026-04-09 方針）として運用し、潜在バグ・設計問題を蓄積してきた。製品版の前に「綺麗に作り直す or 最適化して進化させる」ための総括がこの ADR。判断基準は一貫して:

- **Easy より Simple** — 書きやすさより読み解きやすさ。状態遷移は別関数/別 useEffect で明示的に
- **最小限・必要十分・柔軟性残し** — 重厚なフレームワーク導入はしない

レビューの結論: **再設計はゼロベースで作り直す必要はなく、「境界の張り直し」で足りる**。timerState.ts・履歴スナップショット方式など核になる良い設計は既にある（後述「維持する設計」）。問題は境界（shared/web/api、状態の層、書き込み検証）が宣言どおりに機能していないこと。

## 決定事項

### D1. pnpm workspace を実際に機能させ、ドメインロジックを shared に一本化する

現状 shared は **web/api のどこからも import されていない**（import 0件）。コスト計算・曜日スキップが shared / API / web に3重実装され、既に挙動が乖離（0秒タスクの扱い）。唯一のテスト22件は本番で実行されないコードだけを検証している。構造的原因は Docker がパッケージ単体ビルドで workspace を無視していること。

→ Docker をルートコンテキスト + `pnpm --filter` ビルドに直し、実行展開ロジック（コスト適用・曜日/コストスキップ）を shared の純関数 `expandRoutine()` に統合。API レスポンス型・status 型も shared を正とする。**テスト対象 = 本番経路** に一致させる。
（台帳: RJ-A08, RJ-A09, RJ-A11 / 出典: design S-1, A-4, A-5 / api A-5, A-6, D-4）

### D2. タスク遷移を単一関数に集約し、useEffect による遷移検知を廃止する

「タスクが切り替わった」時のリセット処理が init/complete/skip/D&D/繰り上げの5箇所に手書きコピーされ、経路ごとにリセット対象の集合が微妙に違う（D&D系は `spokenTimeUp` 漏れ = 2026-04-09 と同型バグが現存）。一方、遷移検知 useEffect は全経路で `prevTaskId` が先行設定されるため**実質デッドコード**（状態モデル班が全数調査で立証）。

→ `transitionToTask(nextTask, {speak})` 1関数に集約し、全ハンドラがそれだけを呼ぶ。useEffect 遷移検知（TimerPage.tsx:200-209）は削除。`paused`（React state）と `pausedAt`（localStorage）の二重管理も、遷移関数が唯一の同期点になる形に寄せる。ライブラリ不要、関数抽出のみ。
（台帳: RJ-B01 / 出典: design A-1 / bug-hunt B-4 / state-model §5）

### D3. TTS は「世代ID付きの現在発話」モデルに、ducking は導出値にする

「latest-wins キュー」と呼んできたが、**キュー構造は存在しない**（fetch 開始時の早勝ちキャンセルのみ）。並行 fetch で二重再生・順序逆転が起き、ducking の開始/終了コールバックは対応が保証されず、環境音が段階的に小さくなる既知症状の根本原因。

→ 発話ごとに世代IDを採番し、再生直前に「自分が最新でなければ破棄」、end 通知は id 一致時のみ発火。ducking は「アクティブ発話が存在するか」の boolean 導出にし、`preDuckGain` の保存/復元をやめる。
（台帳: RJ-B02〜B07 / 出典: design A-2 / bug-hunt B-5〜B-10 / state-model §5-C3,C4）

### D4. status を実態に合わせて再設計し、型=検証=DB制約を単一定義から出す

`TaskStatus` 型・schema コメント・実装の書き込み値が三者三様（型に無い `pending` が実在し、型にある `auto-skipped (day)` はどこにも書かれない）。判定も `startsWith` と `!==` の2流派。

→ `status: 'pending'|'completed'|'skipped'|'auto-skipped'` + `skipReason: 'day'|'cost'|null` に分離。shared の単一定義から TS 型・実行時検証・SQLite CHECK を導出する。
（台帳: RJ-A09 / 出典: design A-5 / api A-5, D-5）

### D5. 書き込み系 API の標準形を決めて全ルートに適用する

「サイレント失敗」（WHERE 空振りでも 200 成功）を4箇所で確認。abandon は存在チェックすら無く、reorder 2本は所有権未検証で越境更新可能。トランザクションはリポ全体で使用 0件で、ルーチン開始の途中失敗は「永遠に in_progress のゴミ」を作る。

→ 標準形: **(1)** update/delete は `rowsAffected === 0 → 404`、**(2)** 並べ替えは「対象集合の全 ID を受け取り集合一致を検証して 0..n-1 に全置換」、**(3)** 複数行を書く操作（start / reorder / seed）は必ず `db.transaction()`、**(4)** 状態遷移系は `status === 'in_progress'` を前提条件に。対象は5箇所程度なので軽い。
（台帳: RJ-S01, RJ-A04〜A07, RJ-B18, B-19, B-23 / 出典: api S-1, A-1〜A-4, B-1, B-2, B-6, D-2, D-3, D-8）

### D6. API ポートのホスト公開をやめる（即日対応可のクイックウィン）

web は Vite proxy で `/api` → `http://api:3001` を既に持っており、**api の `ports: 3001:3001` はそもそも不要**。現状は LAN 内の任意端末 + CORS 全開経由で無認証の全 DELETE/PUT が叩ける。

→ compose の api から `ports` を削除（または `127.0.0.1:3001:3001`）。認証なし仕様のまま露出だけが消える。CORS も web オリジンに絞る。
（台帳: RJ-S03 / 出典: api D-9）

### D7. dead code / 「設定できるのに効かない」機能を削除する

未マウントの history.ts（125行、既に本体と実装ドリフト）、誰も継承しない tsconfig.base.json、タスク個別 TTS/環境音フィールド5本、`timerOverrun: 'auto-next'`（UI で設定可能だが実装ゼロ）、`itemType: 'task'`（登録できるが実行時に黙って無視）、ambient の `oscillatorNode`（代入箇所ゼロ）、未使用 export 5本。

→ 全て削除。「実装した時に足す」（1in1out の精神）。特に itemType は group_ref 固定にするとデータモデルが一段単純になる。auto-next だけは削除ではなく**実装する**選択肢もある（Seika 判断、台帳 RJ-A01）。
（台帳: RJ-A01, RJ-B24, B-28, B-29 / 出典: design B-2, B-3 / api B-7 / state-model §7）

### D8. lockfile をコミットし、ビルドを再現可能にする

`pnpm-lock.yaml` がリポに1つも無く、ビルドのたびに依存解決が変わり得る（React 19 / Vite / Tailwind 4 と変動リスクの高い層）。D1 の Docker ルートコンテキスト化とセットで解決する。
（台帳: RJ-A11 / 出典: design A-4）

### D9. Wake Lock を useWakeLock 1系統に統合する

App のフックと TimerPage のインライン実装（ログ付き）が同時稼働し、2つの sentinel と 3本の visibilitychange リスナが並走。→ `useWakeLock({ onLog })` に拡張して一本化。「常時取得」も再検討（タイマー中だけで良いはず）。
（台帳: RJ-B27 / 出典: design B-1 / state-model §5-C6）

## 維持する設計（再設計時に壊さないこと）

- **timerState.ts**: 「開始時刻 timestamp を正として毎秒導出」する設計。純粋関数 + localStorage の薄い層。モットーの模範
- **shared/domain.ts の中身**: 純粋関数群 + 22テスト。問題は「未使用」なだけで、製品版の核に据えられる（D1）
- **taskResults のスナップショット方式**: 値コピーで routine 削除に耐える履歴。execution 側にも `routineName` をスナップショットするとさらに自己完結する
- **App.tsx の discriminated union ルーティング**: ルーターライブラリ無しで必要十分
- **ambient.ts の狭い公開 API**: AudioContext 配線の隠蔽は維持（直すのは duck の中身だけ）
- **読み上げの 3 useEffect 分割**（残り/0到達/超過）: 「別 useEffect で明示的に」の実践。直すのはリセット管理（D2）と一致判定（台帳 RJ-A02: `===` → 閾値跨ぎ検出）

## 未決事項（Seika 判断待ち）

1. **入力バリデーションの流儀** — 設計班は「shared に手書き型ガード数本」（依存ゼロ）、API班は「zod + @hono/zod-validator を shared スキーマで」（型=検証の単一定義化、D4 と相性良）を推奨。どちらも Simple の論拠がある。規模的にはどちらでも回る
2. **auto-next の削除 or 実装**（RJ-A01）— 使いたい機能なら実装、不要なら UI ごと削除
3. **並べ替えで現在タスクが変わった時、旧タスクの経過時間を破棄するのは仕様か**（RJ-B17）
4. **エクスポート/履歴フィルタの日付境界**を JST 化する形（RJ-B25）— 朝ルーチンが CSV 上「前日」になる現状は直したい

## Consequences

- 上記 D1〜D9 は全て**追加ライブラリなし〜最小限**で実現でき、「最小限・必要十分」に収まる
- D1（workspace 修復）が他の多く（D4 の単一定義、テストの実効化）の前提になるため、着手順は D6（即日）→ D1/D8 → D5 → D2/D3 → D4/D7/D9 が自然
- バグ台帳の個別修正は「再設計でクラスごと消えるもの」が多い（例: D5 でサイレント失敗系が全滅）。個別パッチより構造で潰す
