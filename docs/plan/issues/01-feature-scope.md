# 統合後に残す機能と重複の扱いを決める

Parent: ../map.md
Labels: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: Codex
Blocked by:

## Question

対象11 repo のどの動作を統合拡張へ残し、重複する動作の差をどう扱うか。
実装を比較した機能対応表を作り、仕様差がある箇所をユーザーと決める。

### 対象候補

2026-09-18 に GitHub の一覧、ローカル設定、README から確認した候補。
候補調査時点の一覧。採用範囲と移行元は末尾の解決記録を正本とする。

| 元リポジトリ                                                                                  | 確認した主な役割                               |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| [fast-lgtm](https://github.com/luvpame/fast-lgtm)                                             | 保存した LGTM テンプレートで PR レビューを準備 |
| [textarea-vim](https://github.com/luvpame/textarea-vim)                                       | textarea で Vim 操作                           |
| [github-markdown-table-inserter](https://github.com/luvpame/github-markdown-table-inserter)   | GitHub の Markdown 編集欄へ表を挿入            |
| [github-enhancer](https://github.com/luvpame/github-enhancer)                                 | PR コピー、HTML プレビュー、Devin 系リンク     |
| [github-pr-copy](https://github.com/luvpame/github-pr-copy)                                   | PR コピー                                      |
| [repo-redirect-for-devin](https://github.com/luvpame/repo-redirect-for-devin)                 | Devin 系リンク                                 |
| [devin-review-merge-guard](https://github.com/luvpame/devin-review-merge-guard)               | Devin Review のマージボタンを非表示にする      |
| [notion-enhancer](https://github.com/luvpame/notion-enhancer)                                 | Notion の Markdown コピーと表示補助            |
| [page-to-markdown](https://github.com/luvpame/page-to-markdown)                               | ページ本文を Markdown でコピー                 |
| [copy-url-as-markdown](https://github.com/luvpame/copy-url-as-markdown)                       | 現在タブのリンクを Markdown でコピー           |
| [gemini-shift-tab-model-switcher](https://github.com/luvpame/gemini-shift-tab-model-switcher) | Gemini のモデル切替                            |

### 調べる点

- PR コピーと Devin 系リンクの実装差を比較する。見た目が似ているだけで同じ仕様と判断しない。
- Notion 専用コピーと汎用本文コピーの役割を整理する。
- 取得対象の GitHub 状態とローカルの変更を比較し、移行元を固定する。ローカルの内容が最新とは限らない。
- `github-enhancer` の entrypoints/github.content.ts と tests/github-content.spec.ts、`repo-redirect-for-devin` の wxt.config.ts に未コミット変更がある。これらを取り込む。後者の変更は Firefox 向け設定なので、対象ブラウザの判断とも整合させる。
- `textarea-vim` と `github-markdown-table-inserter` は、この作業ディレクトリにない。読み取り用に取得して比較する。

### 解決条件

元の機能と統合後の機能を対応付け、残す動作と意図的に変える動作についてユーザーと合意する。

## 調査資料

[元実装の機能比較](../feature-comparison.md) に調査時点のHEAD、機能対応、未コミット差分を記録した。

## 解決記録 — 2026-09-18

ユーザー回答「Gemini 切り替えはいらない。それ以外は問題なし」により、提示した4項目の推奨案を次の修正込みで合意した。

1. `gemini-shift-tab-model-switcher` の機能は統合しない。それ以外の10リポジトリの固有機能は残す。LGTMは自動送信せず、VimのURL設定、表挿入、HTMLプレビュー、Devin Reviewのマージボタン非表示、Notionの補助機能も維持する。
2. PRコピーとDevin系リンクは `github-enhancer` 版へ一本化する。Devin系リンクの見た目も同版を採用し、単独版の重複実装は移植しない。
3. 共通メニューの本文コピーは、Notionで専用変換、それ以外で汎用変換を使う。Notionページ内のコピーボタンも残す。
4. リンクコピーの取得対象と文字変換は既存どおり残す。PR見出し、タブタイトル、Notionサイドピークの単体URLをそれぞれ維持する。

移行元の基準は比較表のHEADと保存済み `source-patches/` の差分とする。新しいコミットを黙って混ぜず、変更が必要なら差分を確認する。
`repo-redirect-for-devin` のFirefox設定差分は保存済みであり、対象ブラウザを決める後続チケットで適用方針を明記する。
Geminiの除外は機能の移行対象からの除外であり、元リポジトリの削除許可を意味しない。

設定単位・初期値・旧設定移行は「共通メニューと機能設定の動作を決める」、内部構成・対象ブラウザ・機能共存は「一つの拡張として動かす内部構成を決める」、検証・削除条件は「移行完了の確認方法と元repoの削除条件を決める」で扱う。
今回の範囲は判断の確定まで。統合実装、公開、元repo削除は行っていない。
