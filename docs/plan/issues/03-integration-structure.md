# 一つの拡張として動かす内部構成を決める

Parent: ../map.md
Labels: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: Codex
Blocked by: 01, 02

## Question

合意した機能と操作を、一つの Manifest、background、共通メニューで実現する最小の構成は何か。
既存コードを比較し、技術的な事実はエージェントが調べたうえで、利用者向けの動作に影響する選択をユーザーと決める。

### 決める点

- 基盤にする実装、WXT の版、パッケージマネージャーと検証コマンド。現在は pnpm、Bun、npm の構成が混在している。
- content script、background、offscreen document、メッセージ、storage キーの統合方法と衝突防止。
- 機能同士が同じページやキー入力を扱う際の共存方法。特に GitHub の編集補助と Vim 入力を確認する。
- Manifest の権限、対象ブラウザ、既存の安全対策を維持する方法。Firefox 対応を維持するかも明示する。
- Git に保存する成果物の場所、再生成手順、ソースと成果物の一致を保証する方法。現時点の配置案は `dist/chrome-mv3/`。

### 解決条件

機能の追加実装に入れる構成とコマンドを確定し、採用理由と既存検証への影響を記録する。

## 調査記録 — 2026-09-18

### 確認した事実

- github-enhancer / notion-enhancer / page-to-markdown はWXT 0.20系・pnpm 10.18.0・vite-plusを使用。fast-lgtmのlockfileにはWXT 0.21.4、TypeScript 5.9.3、Vitest 4.1.11が固定されている。TextareaVimはWXT 0.21.4を指定し、TypeScript 7、Vitest、Playwrightと独自の生成物検査を使用している。
- TextareaVimは元textareaを非表示にし、input/changeで外部更新を取り込む。表挿入はfocusしてから値と選択範囲を更新する。LGTMは表示中のtextareaのみを探し、focus後にカーソルを設定する。この順序ではVimの起動・非表示と競合するため、単に既存entrypointを並べるだけでは十分でない。
- Devin Reviewの現実装はマージボタンをDOMから削除する。OFF時の即時復元には、削除ではなく取り外せるCSSで非表示にする方法が使える。
- github-enhancerのHTMLプレビューは空のsandbox属性のiframeを使い、OFF時にプレビューを除去して元の差分表示を復元する。非同期取得がOFF後に表示を戻さない検証が必要。
- 汎用本文コピーはoffscreen document上でDefuddleを使う。Chrome公式はoffscreenをChrome 109以降のMV3 APIとして説明している: https://developer.chrome.com/docs/extensions/reference/api/offscreen
- activeTabはアイコン操作等によって現在タブへの一時アクセスを与える。URL/本文コピーは明示操作を入口にする: https://developer.chrome.com/docs/extensions/develop/concepts/activeTab

## 解決記録 — 2026-09-18

ユーザーはChrome限定、Vim連携、OFF時の復元、dist保存の4項目を承認した。開発環境は「Vite+を使えそうなら採用し、ランタイムもBunにできそうならBun」と修正した。以下は既存実装と独立した互換性検証の結果を踏まえた構成。

### 採用構成

- Chrome/Chromium MV3を対象とし、Firefoxは今回の成果物に含めない。保存済みFirefox設定差分は移行調査記録として保持し、ChromeのManifestには適用しない。
- github-enhancerのWXT/React/Vite+構成を基に、Vite+ 0.1.21、WXT 0.21.4、TypeScript 5.9.3を採用する。Bun 1.3.13で依存管理とWXTの実行を行い、Vite+の検査・テストにはNode.js 24も用意する。Bunだけで全工程が動くとはしない。実際に検証したNodeは24.14.1。bun.lockを保存し、CIはbun install --frozen-lockfileを使用する。Viteをnpm:@voidzero-dev/vite-plus-core@0.1.21へ揃える。全機能の型互換性は実装時に検証する。
- Manifest、background、popup、設定画面を各1つ、content scriptはGitHub / Notion / Devin Review / 全サイトVimに分ける。GitHub内ではLGTM・表挿入とVimの操作前後を連携する。汎用プラグイン機構は作らない。
- backgroundが共通メニューとショートカットのコピー要求を受け、Notionは専用content script、それ以外は明示操作時のHTML取得とDefuddleで処理する。offscreen documentを1つ共有する。要求の種別・IDと送信元、データ型を検証し、同時コピーの結果を混同しない。
- storageはlocalの機能設定とsyncのLGTMテンプレート・Vim URL設定に分け、衝突しないキーを定義する。既存の汎用名extensionEnabledはVim専用の設定へ置き換える。ページのON/OFF監視は維持する。
- 権限案はstorage / activeTab / scripting / clipboardWrite / notifications / offscreen。常駐スクリプトは既存対象サイトとVimの全サイト設定を維持する。tabs、clipboardRead、cookiesなどを一括追加しない。最終Manifestの対象範囲とAPI使用箇所を検査する。
- LGTMの自動送信禁止、HTMLプレビューのsandbox、VimのIME対応・URL入力検証を維持する。実行コードは同梱する。
- Vim編集中の表挿入・LGTM操作では保存して一旦終了し、操作後に最終カーソル位置からVimを再開する。表挿入は選択範囲を置換、LGTMは既存どおりレビュー本文をテンプレートで置換する。レビューは送信しない。
- 機能OFFで注入UIを除去・元表示を復元し、不要な監視を止める。DevinのマージボタンはCSSで非表示にし、OFFなら元表示に戻す。HTMLプレビューも閉じて元差分を戻す。
- bun run dev / typecheck / test / build / checkを入口にする。dev/buildはbun --bunでWXTを実行する。testはVite+のvp test、format/lintはvp checkを利用し、既存のvite-plus/testテストを維持する。単独Vitestテストも同じランナーへ集約し、別系統のVitestを混在させない。typecheckは明示的にwxt prepareとtsc --noEmitを実行する。checkはformat/lint・型検査・テスト・ビルド・バンドル検査をまとめる。vp check単独で型検査やテストを実行したと扱わない。自動テストはユニットテスト（jsdomによるDOM操作とAPIモックを含む）に限定し、Playwright/E2Eは移植しない。Vimのバンドル検査は維持する。外部URL文字列の一律禁止はDevinリンク等まで禁止しないよう調整し、eval等の検査を維持する。
- dist/chrome-mv3/をGitへ保存する。bun run buildで生成し、CIはlockfile固定インストール・checkの後、再生成されたdistを追跡済み/未追跡/削除も含めて比較し、差分があれば失敗させる。ソースマップや個人用ブラウザ設定は成果物に含めない。

### 互換性検証と実装時の対応

検証用コピーは `../toolchain-probe/`。github-enhancerの現行ソースと未コミット修正をコピーし、元repoと統合先repoのコードは変更していない。

- Bun 1.3.13による依存インストール成功。WXT 0.21.4とVite+ core 0.1.21を使い、`bun --bun node_modules/wxt/bin/wxt.mjs build` 成功。
- `bun --bun node_modules/vite-plus/bin/vp test` で既存9ファイル58テスト成功。ただし追加の実行環境確認テストは「Bunである」という期待に失敗し、テストworkerはNode.js 25.8.0だった。Bun起動をBunランタイムでのテスト成功と混同しない。
- Node.jsを24.14.1へ固定し、実行環境確認もNode 24を期待する形に変更。`node node_modules/vite-plus/bin/vp test` で10ファイル59テスト成功（既存58件＋環境確認1件）。
- Vite+のcheckは検証用package.jsonと追加テストの整形後に成功。型検査はBun/Node双方で同じ2件に失敗。`github-devin-redirect.ts` のruntime.getURLへ渡す画像パスをWXT 0.21のPublicPath型に合わせること、クリックコールバック内のbuttonのnull可能性を解消することが実装時に必要。型検査が通過済みとはしない。
- 全機能の型検査、CI上の成果物再現性は未検証であり、統合実装時に検証する。ブラウザ上の統合動作は未検証。後述のユーザー指定によりPlaywright/E2Eは必須検証から除外する。

参考: [Vite+ local CLI](https://viteplus.dev/guide/local-cli) はNodeランタイムを前提とし、[環境管理](https://viteplus.dev/guide/env)ではNodeランタイムとBun等のパッケージマネージャーを区別している。ローカル検証結果もこの区別に沿う。

今回は計画と互換性検証まで。統合実装・公開・元repo削除は行っていない。

### 追加確認 — Bun標準テストランナー

ユーザーの「Bunでテストはできないの？」への確認として、同じ検証用コピーでBun標準ランナーを試した。
既存の `vite-plus/test` importのまま `bun test tests/github-pr-copy.spec.ts` を実行すると、Vitest runner.config未初期化で失敗した。
別の `toolchain-probe/bun-tests/` へPRコピーの4テストをコピーし、importを `bun:test` に変更、jsdomのDOM globalsをpreloadすると全4件成功。`process.versions.bun === '1.3.13'` を確認する追加1件も成功した。
再現コマンドは検証用ディレクトリで `bun test --preload ./bun-tests/setup.ts ./bun-tests/github-pr-copy.spec.ts`。
したがって「Bunでテストできない」は誤りであり、Vite+経由の実行環境とBun標準ランナーは区別する。全既存テスト・WXTの仮想モジュールやモック・ブラウザテストのBun移植は未検証。この追加確認だけで全テストのBun互換性を保証せず、採用構成を変更したとは扱わない。

### 追加確認 — VitestをBunランタイムで実行

Vitest公式リポジトリのdiscussion #9501には `experimental.viteModuleRunner: false`、`experimental.nodeLoader: false`、`pool: 'forks'`、`--configLoader=runner` でのBun実行報告がある。
https://github.com/vitest-dev/vitest/discussions/9501

検証用コピーの `vitest-bun.config.ts` でこの構成を設定し、Vite+同梱Vitestの `vitest.mjs` をBunで直接起動した。
`bun --bun node_modules/@voidzero-dev/vite-plus-test/vitest.mjs run --config vitest-bun.config.ts --configLoader=runner`
PRコピー既存4テスト（vite-plus/test importを維持）と `process.versions.bun === '1.3.13'` の確認1件に成功した。
「VitestではBun上のテストができない」とは言えない。通常のvp testとは別の起動経路・実験的設定で実行できる。
このモードはViteの変換・aliasを無効化するため、WXTの仮想モジュールと既存module mockの互換性、全テストは未確認。公式discussionの実行報告もmodule mockとcoverageの制限を挙げている。Bun標準ランナーへの移行は必須ではない。

### ユーザー指定による検証範囲の更新

「ユニットテストだけで十分」により、自動テストはユニットテストに限定する。純粋な関数に加え、jsdomでDOMを作るテストや、storage・clipboard等をモックする機能単位のテストを含む。
TextareaVimのPlaywright/E2Eと、新たなE2E・複数機能を通した統合テスト基盤は移植・追加しない。上記の当初調査にあるPlaywrightは元実装の事実であり、統合版の要件ではない。
型検査、lint、ビルド、Manifest/バンドル検査、成果物一致確認はテスト種別とは別のチェックとして維持する。実ブラウザでのみ確認できる挙動をユニットテストで確認済みとは扱わない。
