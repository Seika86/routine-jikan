# バグ台帳 — バグ探索班（フロントエンド担当）

対象: `packages/web/src/` 配下全 .ts/.tsx（全16ファイル読了）
参照のみ: `packages/api/src/routes/executions.ts`, `tasks.ts`, `db/schema.ts`, `db/seed.ts`, `shared/src/types.ts`
日付: 2026-07-09 / 修正は一切行っていない（発見と記録のみ）

---

## 1. サマリ

| 重要度 | 件数 | 内訳 |
|--------|------|------|
| S | 0 | — |
| A | 3 | うち確認済み 3 |
| B | 17 | うち確認済み 16、疑い 1 |
| C | 13 | うち確認済み 10、疑い 3 |
| **計** | **33** | 確認済み 29 / 疑い 4 |

ハイライト:
- **A-1**: タスク設定「タイマー超過時: 自動スキップ (auto-next)」がUIで設定できるのに**実行系のどこにも実装がない**（完全なサイレント無効設定）
- **B-4**: 2026-04-09 修正と同型の「明示リセット漏れ」が並べ替え/繰り上げ経路に現存（`spokenTimeUp` だけリセットされない）。タスク切り替え useEffect (TimerPage:200-209) は全経路で prevTaskId が先行設定されるため**実質デッドコード**で、リセットロジックが5箇所に重複コピーされている構造がそのまま温床になっている
- **音声系（B-5〜B-10）**: TTSに「キュー」は存在せず（latest-wins ですらない）、並行 fetch の順序逆転・二重再生・ダッキングのゲイン汚染が机上で再現確認できた

---

## 2. バグ一覧（重要度順）

### A-1. timerOverrun='auto-next'（自動スキップ）が完全に未実装
- **重要度**: A / **確認済み**
- **根拠**:
  - UIで設定可能: `packages/web/src/components/TaskEditModal.tsx:30,44,134-152`（「自動スキップ」ボタン）
  - 実行時参照ゼロ: `packages/web/src/pages/TimerPage.tsx` 全676行に `timerOverrun` の参照が1箇所もない
  - 実行時に判定不能: `packages/web/src/hooks/useApi.ts:157-167` `TaskResult` 型に `timerOverrun` フィールドが無い（API 側も taskResults へ保存していない — 参照: `api/src/routes/executions.ts:117-129`）
  - seed データも使用: `api/src/db/seed.ts:104,132`（歯磨き = auto-next）
- **発火条件**: タスクに「自動スキップ」を設定してタイマーを回す
- **症状**: 予定時間到達後も何も起きず、カウントアップ（'continue' と同一挙動）。設定が黙って無視される
- **修正方針**: `TaskResult` に timerOverrun を載せ、TimerPage の残り0到達 effect（228-240行）で auto-next なら `handleSkip`（または complete）を自動発火する

### A-2. 読み上げしきい値が「厳密一致 (===)」判定 — 秒が飛ぶと読み上げが永久に欠落
- **重要度**: A / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:219`（`remaining === t`）、`:249`（`overtime === t`）。`elapsedSec` は wall-clock からの floor 計算（`lib/timerState.ts:72-75`）で、tick は `setInterval(,1000)`（TimerPage:181）
- **発火条件**: (a) タブ非表示中に setInterval がスロットリングされ、`visibilitychange` 復帰時（TimerPage:185-190）に elapsedSec が数秒〜数分ジャンプする（例: remaining 75→12 で 60/30 を跨ぐ）。(b) フォアグラウンドでも負荷で tick が1秒超遅延し floor 値が2進む
- **症状**: 「残り60秒/30秒/10秒」「1分/5分/10分経ったよ」がその回だけでなく**そのしきい値ごと永久にスキップ**される（lastSpoken ガードは通過済み扱いにならないが、一致する瞬間が二度と来ない）。対照的に残り0判定（:233）は `<= 0` で頑健
- **修正方針**: 「前回値としきい値の跨ぎ検出」（prev > t && current <= t）に変える

### A-3. スキップ時に実測時間を送信せず、履歴の実時間が欠落
- **重要度**: A / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:385` は `api.skipTask(execId, taskId)` のみ。`hooks/useApi.ts:36-40` は body `{}` 固定。API 側は `actualDurationSec` をオプション受理し未指定なら 0 記録（参照: `api/src/routes/executions.ts:295,304`）
- **発火条件**: タスクを数分やってから「⏭️ スキップ」
- **症状**: 履歴の `totalActualSec`・CSVエクスポートの actual_sec が 0 になり、実際に費やした時間がデータとして消失。完了画面の `totalElapsedSec`（画面側集計、TimerPage:106-110 は skipped の actualDurationSec を加算する設計）とも不整合
- **修正方針**: `api.skipTask(execId, taskId, elapsedSec)` に elapsed を渡す（API は既に受理する）

---

### B-4. 並べ替え/繰り上げ経路で `spokenTimeUp` のリセット漏れ（2026-04-09 と同型）
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:437-444`（handleTaskDragEnd）と `:469-475`（handlePromoteTask）は `lastSpokenRemaining`/`lastSpokenOvertime` をリセットするが **`spokenTimeUp.current` をリセットしない**。両経路とも `prevTaskId.current` を先に設定する（:440, :471）ため、タスク切り替え useEffect（:200-209、ここには spokenTimeUp リセットあり）は早期 return して発火しない
- **発火条件**: 現在タスクが予定時間を超過（残り0の読み上げ済み = spokenTimeUp true）した状態で、タスク一覧から別タスクをドラッグ先頭化 or ▶ 繰り上げして現在タスクが切り替わる
- **症状**: 新タスクが残り0に達しても「〇〇終了！次は××」が読まれず（:230 で早期return）、さらに完了ボタンを押しても `alreadySpoken=true`（:352,:384）扱いで speakTaskEnd がスキップ → **そのタスクの終了通知が完全沈黙**
- **修正方針**: 両経路に `spokenTimeUp.current = false` を追加。構造面: リセットロジックが init/complete/skip/drag/promote の5箇所に重複しており（:134-141, :358-362, :390-394, :440-443, :471-474）、:200-209 の effect は現状**全経路で発火しないデッドコード**。リセットを1関数に集約すべき（設計班に引き継ぎ）

### B-5. TTS に排他制御が無く、並行 fetch で順序逆転・二重再生
- **重要度**: B / **確認済み（レース）**
- **根拠**: `packages/web/src/lib/tts.ts:169-216`（speakVoicevox）/`:220-249`（speakOpenAI）は関数冒頭で `cancelCurrentAudio()`（:171,:222）するのみで世代トークンが無い。`playBlob`（:265-326）は到着順に無条件で `source.start(0)`（:290）。発話AがTTSサーバー合成中（まだ再生前 = cancel対象が無い）に発話Bが開始すると、Bが先に再生開始 → 遅れて届いたAのblobが**Bと同時に重ねて再生**される。この時 `currentSource` はAで上書きされ（:289）、Bのソースは追跡不能（キャンセル不能）になる
- **発火条件**: 合成レイテンシ（数百ms〜）内の連続発話。例: 「残り10秒」読み上げ直後に完了タップ、B-12 の連打、残り0読み上げと完了タップの交錯
- **症状**: 読み上げの同時重畳・順序逆転（「次は××」の後に「残り10秒」が鳴る等）
- **修正方針**: speak 呼び出しごとに世代IDを採番し、playBlob 直前に「自分が最新でなければ破棄」を判定（latest-wins の実装）

### B-6. ダッキングの preDuckGain 汚染 — 連続発話後に環境音が恒久的に小さくなる
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/lib/ambient.ts:215-221`（duckDown が `preDuckGain = gainNode.gain.value` を無条件記録）+ `lib/tts.ts:254-263`（cancelCurrentAudio の `source.stop()` → onended（:284-288）が**非同期に後から** `onSpeakEnd`=duckUp を発火）
- **発火条件**: 発話Aのダッキング中（gain≈0.2）に発話Bが開始。B の duckDown が preDuckGain=0.2 を記録 → A の onended による duckUp も B 終了時の duckUp も 0.2 までしか戻さない
- **症状**: 環境音が発話のたびに段階的に小さくなり戻らない（次の `play()` まで）。`play()` 内のコメント「前回のduckUp漏れ対策」（ambient.ts:175）は本症状の既知痕跡
- **修正方針**: ducking を参照カウント化し、preDuckGain は「非ダッキング時のみ」更新する

### B-7. duckUp がミュート状態を無視 — ミュート中に環境音が復活
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/lib/ambient.ts:224-229` — duckUp は `state.muted` を見ずに `gainNode.gain` を preDuckGain（非0）へ戻す。TimerPage:629 のミュートボタンは `toggleMute()`（:202-208）で gain=0 にするだけ
- **発火条件**: TTS 読み上げ中（ducked）に 🔊 ボタンでミュート → 読み上げ終了
- **症状**: アイコンは 🔇 のまま環境音が鳴り出す
- **修正方針**: duckUp/duckDown で `getNormalizedVolume()` 基準の値を使う（muted なら 0）

### B-8. ミュート解除で音量が二重適用され実効音量が下がる
- **重要度**: B / **確認済み**
- **根拠**: マスター `gainNode` は `play()` で 1.0 に設定され（`ambient.ts:175-179`）、各ソースのゲインに既に `getNormalizedVolume()` が織り込み済み（:98, :125, :153, tick は :75）。しかし `toggleMute()`（:202-208）と `setVolume()`（:195-200）はマスターを `getNormalizedVolume()`（= volume/100）に設定する
- **発火条件**: volume<100 のルーチンでミュート → ミュート解除（TimerPage:629 から到達可能。setVolume は現状 UI から未使用のため潜在）
- **症状**: 解除後の実効音量が (volume/100)² になる。例: volume=50 → 解除のたびに本来の半分の音量
- **修正方針**: マスターは mute 専用（0 or 1）にし、音量はソース側ゲインに一本化する

### B-9. TTSフォーマット誤検出が localStorage に永続化され、復旧経路が無い
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/lib/tts.ts:134-152` — `/speakers` が一時的なネットワーク断・サーバー未起動で失敗しただけで `detectedFormat:'openai'` を `setTTSConfig`（:79-84 で localStorage 保存）。`resetDetectedFormat`（:329-331）の呼び出し元は **web src 内ゼロ**（grep 確認済み）
- **発火条件**: VOICEVOX/AivisSpeech サーバーが落ちている時に一度でも読み上げが走る
- **症状**: 以後サーバーが復活しても永久に `/v1/audio/speech` を叩いて失敗し Web Speech にサイレントフォールバック（console.warn のみ）。ユーザーには「声が変わった」ようにしか見えない
- **修正方針**: openai 判定を「/speakers が 404 等で応答した時」に限定し、ネットワークエラーは unknown のまま保持（永続化しない）

### B-10. リロード復元時に環境音の AudioContext が suspended のまま復帰不能
- **重要度**: B / **疑い（未確認 — autoplay policy のブラウザ実装依存）**
- **根拠**: セッション復元（`App.tsx:25-34,38`）→ TimerPage の effect から `ambient.play()`（`TimerPage.tsx:157-162`）。`ambient.ts:169-173` の `resume()` は fire-and-forget で、ユーザー操作ゼロのページロードでは autoplay policy により拒否されうる。以後 ambient 側の context を resume する経路が無い（`tts.resumeContext`（TimerPage:187）は **ttsContext のみ**、toggleMute も resume しない）
- **発火条件**: タイマー実行中にページリロード（またはブラウザ再起動からの復元）
- **症状**: 環境音が無音のまま、ミュートボタンを押しても復活しない（次のタスクでも再生経路なし）
- **修正方針**: visibilitychange / 任意のユーザー操作（完了ボタン等）で ambient 側 context も resume する

### B-11. 0秒タスク（base=0）が pending になり、開始した瞬間に「終了！」読み上げ + progress NaN
- **重要度**: B / **確認済み**
- **根拠**: TaskEditModal で 0分0秒が保存可能（`TaskEditModal.tsx:41` `durationMin*60+durationSec`、API 側 `tasks.ts:92` はバリデーション無し）。サーバーの auto-skip は `plannedDurationSec===0 && baseDurationSec>0` のみ（参照: `executions.ts:113`）→ base=0 は pending のまま配信。`TimerPage.tsx:343` `progress = Math.min(0/0, 1) = NaN`、`:233` `remaining <= 0` が初回レンダー後の effect で即真
- **発火条件**: durationSec=0 のタスクを含むルーチンを開始し、そのタスクの番が来る
- **症状**: タスク開始と同時に「〇〇終了！次は××」が読まれる（残り読み上げ・超過読み上げの前提も崩れる）、プログレスバー width が NaN%。StartPage の見積り（`StartPage.tsx:46` は 0秒を除外）とも不整合
- **修正方針**: planned=0 は base に関わらずサーバーで auto-skip（API班へ）、フロントは `planned<=0` ガードを追加

### B-12. 完了/スキップボタンに連打ガードが無い（stale closure で二重処理）
- **重要度**: B / **確認済み（レース）**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:349-410` — `handleComplete`/`handleSkip` は複数 await を挟むが、ボタン（:600-611）は処理中も disabled にならない。1回目の await 中は再レンダーされないため、2回目のタップは**同じ closure**（旧 currentTask・旧 elapsedSec・alreadySpoken）で走る
- **発火条件**: 完了（またはスキップ）を素早く2回タップ / 完了→スキップを連続タップ
- **症状**: 同一タスクへ complete API が二重送信（elapsedSec は1回目タップ時の値で上書き）、完了→スキップ交錯では**完了済みタスクが skipped に上書き**（履歴データ汚損）。`startTask` 二重実行、`speakTaskEnd` 二重発話（B-5 と複合して重畳再生）
- **修正方針**: 処理中フラグ（useRef）で入口ガード + ボタン disabled

### B-13. 中断（abandon）しても「🎉 完了おめでとう！」画面が出る
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:412-418` handleAbandon → `setCompleted(true)`、:288-333 の完了画面は文言固定（「完了おめでとう！」）。`refresh()`（:116-119）も `status !== 'in_progress'`（abandoned 含む）で一律 completed=true
- **発火条件**: 「中断する」を確定する（他タブで abandon された場合も同様）
- **症状**: 中断したのに祝福画面・完了統計が表示される
- **修正方針**: `execution.status` で画面を分岐する

### B-14. EditPage の refresh が編集中のルーチン名/予定時刻入力を上書き
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/pages/EditPage.tsx:57-63` — refresh が毎回 `setRoutineName(r.name)` 等でフォーム state をリセット。タスク追加（:99-102）、タスク保存、グループ操作等ほぼ全操作が `await refresh()` を呼ぶ
- **発火条件**: ルーチン名編集モード（editingRoutine=true）で名前や時刻を入力後、保存前にグループの ➕ タスク追加やタスク編集モーダル保存を行う
- **症状**: 入力中の内容がサーバー値に黙って巻き戻る
- **修正方針**: フォーム state の初期化を「編集モード開始時」に移す（refresh から分離）

### B-15. TaskEditModal / GroupEditModal — 保存失敗で「保存中...」のまま固まる
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/components/TaskEditModal.tsx:37-48`、`GroupEditModal.tsx:16-20` — `await onSave(...)` が throw すると `setSaving(false)` に到達しない（try/finally なし）。onSave 実体（`EditPage.tsx:281-285, 332-336`）は `fetchJson`（`useApi.ts:8-10`）が !ok で throw
- **発火条件**: 保存 API がネットワーク断・5xx で失敗
- **症状**: ボタンが「保存中...」で永久 disabled、モーダルも閉じられるが再保存不能。エラーはユーザーに一切見えない（unhandled rejection）
- **修正方針**: try/finally で setSaving(false) + エラー表示

### B-16. StartPage — 開始失敗で「準備中...」のまま固まる
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/pages/StartPage.tsx:58-64` — `setLoading(true)` 後に try/finally が無く、`api.startRoutine` の throw で loading が戻らない
- **発火条件**: /start API が失敗（API 停止・ネットワーク断）
- **症状**: 開始ボタンが「準備中...」で永久 disabled。リロードするしかない
- **修正方針**: try/finally + エラー表示

### B-17. 並べ替え永続化 API の失敗が黙殺され、楽観的UIとサーバー順序が乖離
- **重要度**: B / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:454, 484`、`EditPage.tsx:91`、`components/SortableGroup.tsx:66` — いずれも末尾の `await api.reorder...` に catch が無い
- **発火条件**: ドラッグ/繰り上げ直後に PUT が失敗（オフライン等）。TimerPage では実行完了済み execution への reorder が 400 を返すケース（参照: `executions.ts:349`）もある
- **症状**: UI は新順序のまま、サーバーは旧順序。次の complete 後の `getExecution` で currentTask が想定外のタスクに飛ぶ／巻き戻る。エラー表示なし（unhandled rejection のみ）
- **修正方針**: catch でロールバック（refresh）+ トースト表示

### B-18. 初期ロード fetch 失敗で全ページ「読み込み中...」のまま無限待機
- **重要度**: B / **確認済み**
- **根拠**:
  - TimerPage: `init()`（:124-153）と `refresh`（:113-121）に catch 無し → :336-338 の「読み込み中...」固定
  - StartPage: `:25-35` `.then` のみで catch 無し
  - EditPage: `:65` `refresh()` 例外未処理
  - HistoryPage: `:27-31` `fetch().then(r=>r.json())` — **`r.ok` 未チェック**（api モジュールの fetchJson を使っていない唯一の箇所）+ catch 無しで `setLoading(false)` に到達しない
- **発火条件**: 各ページ初回表示時に API がエラー/非JSON応答
- **症状**: エラー表示ゼロで永遠に「読み込み中...」。リトライ手段なし
- **修正方針**: 共通の error state + 再試行ボタン。HistoryPage は fetchJson へ統一

### B-19. コスト時間（★☆☆/★★★）の秒成分が保存のたび切り捨てられる
- **重要度**: B / **確認済み（発火条件は限定的な潜在バグ）**
- **根拠**: `packages/web/src/components/TaskEditModal.tsx:28-29` — `Math.floor(task.costLowSec / 60)` で分のみ state 化、`:42-43` で `Number(costLowMin) * 60` を保存。秒成分の入力欄が無い
- **発火条件**: costLowSec/costHighSec に 60 の倍数でない値が存在する状態でモーダルの保存を押す（現行UIでは分単位しか入らないが、API 直叩き・seed 変更・将来の秒対応で混入しうる。デフォルト時間欄は分+秒の2欄なのに、コスト欄だけ非対称）
- **症状**: コスト欄に触れていなくても保存しただけで 90秒 → 60秒 のように黙って変質
- **修正方針**: コスト欄も分+秒にする、または保存時に「変更が無ければ元値を送る」

### B-20. 並べ替えで現在タスクが変わると、旧現在タスクの経過時間が無言で破棄される
- **重要度**: B / **確認済み（仕様の可能性あり — 要判断）**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:438-444, 469-475` — 現在タスク変更時に `startTask(newCurrentTask.id)` で localStorage を上書き。旧現在タスクは pending に戻るが、それまでの経過時間はどこにも記録されない
- **発火条件**: 現在タスクを数分実行した後、別タスクをドラッグ先頭化 or ▶ 繰り上げ
- **症状**: 後で旧タスクの番が再度来て完了しても、actualDurationSec は「再開後の時間」のみ。合計実時間が実態より小さくなる
- **修正方針**: 中断時の経過を退避してタスク再開時に加算する（または仕様として明文化）

---

### C-21. 履歴からの「▶️ 再開する」が失敗時に無反応（console.error のみ）
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/App.tsx:93-117` — catch が console.error のみ。ルーチン削除済みの実行では `exec.routineId` が無効になり `api.getRoutine` が 404 throw する経路が現実に存在（履歴は「(削除済み)」表示で残る仕様 — 参照: `executions.ts:176`）
- **発火条件**: 元ルーチンを削除した後、in_progress 履歴の再開ボタンを押す
- **症状**: ボタンを押しても何も起きない
- **修正方針**: routine 取得失敗時はデフォルト値で再開を継続 or エラートースト

### C-22. セッション復元チェックが一時的ネットワークエラーでもセッション破棄
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/App.tsx:58-62` — catch で一律 `sessionStorage.removeItem` + ホーム遷移。「終了済み」と「一時的な通信失敗」を区別しない
- **発火条件**: タイマー実行中にリロードし、その瞬間だけ API に届かない
- **症状**: 実行中セッションがホームに落ちる（履歴ページから手動再開は可能）
- **修正方針**: ネットワークエラー時はセッションを保持してリトライ

### C-23. 「+ ルーチンを追加」連打で複数ルーチンが作成される
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/App.tsx:237-242` — async onClick にガード無し
- **発火条件**: ボタンをダブルタップ
- **症状**: 「新しいルーチン」が2つできる（編集画面へは片方だけ遷移）
- **修正方針**: 作成中フラグで disabled

### C-24. TimerPage unmount 後も TTS のコールバック（debugLog / ducking）が残留
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:155-156` で `tts.setDuckingCallbacks` / `tts.setDebugLog(addLog)` を登録するが、cleanup（:165）で解除しない（tts.ts はモジュールグローバル :53-57）
- **発火条件**: タイマー終了後にホームで TTS 設定切替等で speak が走る
- **症状**: unmount 済みコンポーネントの setState 呼び出し（React 18 では no-op）、前セッションの closure がリークし続ける
- **修正方針**: cleanup で null 登録に戻す

### C-25. 履歴削除の失敗でダイアログが固まる
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/pages/HistoryPage.tsx:33-38` — catch 無し。失敗すると `setDeleteTarget(null)` に到達せず unhandled rejection
- **発火条件**: DELETE API 失敗
- **症状**: 確認ダイアログが開いたまま、エラー表示なし（キャンセルでは閉じられる）
- **修正方針**: try/finally + エラー表示

### C-26. 数値入力に "-" 等を入れると NaN が API に送信される
- **重要度**: C / **疑い（送信までは確認済み、サーバー側の受理挙動は未確認=API班スコープ）**
- **根拠**: `packages/web/src/components/TaskEditModal.tsx:85, 94, 110, 124` — `Number(e.target.value)` は "-" や "1e" で NaN。`min="0"` はタイピングを防がない。`JSON.stringify` で NaN は null になり、durationSec:null / costLowSec:null が送信される
- **発火条件**: 分入力欄に "-" だけ入力して保存
- **症状**: durationSec が null で更新される可能性（設定消失）。負数入力（"-5"）は素通りし planned が負になる
- **修正方針**: 保存前に `Number.isFinite` + `>= 0` バリデーション

### C-27. scheduledDays の JSON.parse に try が無く、不正データでページクラッシュ
- **重要度**: C / **確認済み（発火はデータ破損時のみ）**
- **根拠**: `packages/web/src/components/TaskEditModal.tsx:32`、`components/SortableTask.tsx:74` — parse 失敗で例外がレンダー/初期化中に投げられ、Error Boundary が無いため白画面
- **発火条件**: DB の scheduledDays に不正 JSON（手動編集・マイグレーション事故）
- **症状**: EditPage 全体が白画面
- **修正方針**: try-catch で [] フォールバック

### C-28. `startKeepAlive` が名前と裏腹にキープアライブしていない（iOS suspend 対策が no-op）
- **重要度**: C / **確認済み（実装済みスタブ）**
- **根拠**: `packages/web/src/lib/tts.ts:414-421` — 起動時に1回 resume するだけで定期 ping なし（コメントに「現状は resume のみ」と自認）。呼び出し側コメント（`TimerPage.tsx:163`）は「キープアライブ開始（iOS Safari自動suspend対策）」と主張
- **発火条件**: iOS Safari で長時間放置後の読み上げ
- **症状**: AudioContext が suspend し TTS が無音になりうる（visibilitychange resume（TimerPage:187）で部分補完されるが、画面表示のまま suspend するケースは非対応）
- **修正方針**: setInterval での定期 state チェック+resume を実装するか、コメント/関数名を実態に合わせる

### C-29. Web Speech の音声一覧が未ロードだと voice 設定が黙って無視される
- **重要度**: C / **疑い（getVoices の非同期ロードはブラウザ実装依存）**
- **根拠**: `packages/web/src/lib/tts.ts:117-121` — `getVoices()` がロード前は空配列を返す環境（Chrome 初回）では `found` が undefined になりデフォルト音声で発話。`voiceschanged` リスナー無し
- **発火条件**: ページロード直後の初回発話（web-speech プロバイダ時）
- **症状**: 最初の数発話だけ声が違う
- **修正方針**: voiceschanged を待つ or 発話時に再解決

### C-30. Wake Lock: unmount と取得リクエストの競合で release 漏れ
- **重要度**: C / **確認済み（狭い競合窓）**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:68-103` — `requestWakeLock` の `await navigator.wakeLock.request()` が in-flight のまま unmount すると、cleanup（:100）後に `wakeLockRef.current` へ代入され release されない。`hooks/useWakeLock.ts:9-15` も同型（こちらは App 常駐なので実害ほぼ無し）
- **発火条件**: visibilitychange 復帰による再取得中にタイマー終了
- **症状**: 画面スリープ防止が意図せず生き残る（App 側の useWakeLock も常時取得しているため実害は薄い — そもそも二重取得構造）
- **修正方針**: cancelled フラグで代入前チェック、取得したら即 release

### C-31. 完了タップ直後の表示フリッカー（elapsed=0 と旧タスクの混在）
- **重要度**: C / **確認済み（表示のみ）**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:353-355` — `setElapsedSec(0)` が `await api.getExecution` の前にあり、旧 currentTask のまま一度 flush される（残り時間が満タン表示に一瞬戻る）。さらにその待機中に interval tick（:173-179、timerStateRef は旧タスクのまま）が走ると旧 elapsed が書き戻る
- **発火条件**: 完了/スキップタップ（getExecution のレイテンシ分だけ見える）
- **症状**: タイマー表示が「満タン→旧値→新タスク0」と一瞬揺れる
- **修正方針**: setElapsedSec(0) を nextState 取得後の状態更新バッチへ移動

### C-32. SortableGroup: 連続ドラッグ × onRefresh の順序レースで一瞬巻き戻る
- **重要度**: C / **疑い（未確認 — タイミング依存で机上では順序保証を追い切れず）**
- **根拠**: `packages/web/src/components/SortableGroup.tsx:54-68`（楽観更新→PUT→onRefresh）+ `:34-38`（props からの再同期 useEffect）。1回目のドラッグの refresh 結果が2回目の楽観更新後に届くと、useEffect [item] が古い順序で local `tasks` を上書きする可能性
- **発火条件**: 同一グループ内で素早く2回ドラッグ
- **症状**: 並び順が一瞬巻き戻って見える（最終的には2回目の refresh で収束するはず）
- **修正方針**: refresh の世代管理 or 楽観更新中は同期 effect を抑止

### C-33. 完了時の実測値が tick 粒度の state（最大約1秒古い）
- **重要度**: C / **確認済み**
- **根拠**: `packages/web/src/pages/TimerPage.tsx:353` — `api.completeTask(..., elapsedSec)` は interval 更新の state を送る。`calcTaskElapsedSec(timerStateRef.current)` でタップ時点を再計算しない
- **発火条件**: 常時（tick 間のタップ位置に依存）
- **症状**: actualDurationSec が最大約1秒過小
- **修正方針**: 送信直前に calcTaskElapsedSec で再計算

---

## 3. 対象外で気づいた問題（深掘り・指摘対象外、他班への引き継ぎメモ）

- **API: abandon が pending タスクを skip にしない** — `executions.ts:314-323` は execution.status のみ更新。TimerPage の中断ダイアログ文言「残りのタスクはスキップされます」（TimerPage.tsx:649）と不一致。履歴の completedCount/totalCount 表示にも影響
- **API: reorder の逐次 UPDATE が非トランザクション**（`executions.ts:372-376`）— 途中失敗で sortOrder が中途半端な状態になりうる
- **shared 型と実装の不一致**: `shared/src/types.ts:3` は `'auto-skipped (day)' | 'auto-skipped (cost)'` だが実装は `'auto-skipped'` のみ（`executions.ts:112-114`）。web 側の `startsWith('auto-skipped')` 判定はどちらでも動くが型が嘘をついている
- **API: complete/skip がタスクの現ステータス・所属 execution を検証しない**（`executions.ts:271-311`）— B-12 の二重送信・上書きをサーバー側でも防げない
- **同一ブラウザで複数 execution を並行実行すると localStorage のタイマー状態（単一スロット、`timerState.ts:8`）が相互に上書きされる** — 現状は taskId 不一致で「リスタート」に落ちるだけだが、経過時間は消える
- **構造メモ（設計班向け）**: TimerPage の読み上げ状態リセットが5箇所に重複し、ガード付き useEffect（:200-209）が実質デッドコード化している件は B-4 参照。「タスク切り替え」を単一の関数/リデューサに集約するのが再設計の要点
