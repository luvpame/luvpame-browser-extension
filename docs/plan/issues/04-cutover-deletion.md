# 移行完了の確認方法と元repoの削除条件を決める

Parent: ../map.md
Labels: wayfinder:grilling
Type: grilling
Status: resolved
Assignee: Codex
Blocked by: 01, 02, 03

## Question

何を確認すれば、統合拡張を公開して元リポジトリを削除できるか。

### 決める点

- 既存ユニットテストの移植と、設定OFF・入力保持・エラー処理に必要な追加ユニットテスト。ユーザー指定により自動テストはユニットテストのみとし、Playwright/E2Eや新しい統合テスト基盤は対象外。実ブラウザでの移行確認は、自動テストとは分けてこのチケットで扱う。
- 公開 repo を新規取得した環境で、保存済み成果物の読み込みとソースからの再ビルドを確認する方法。
- 旧拡張からの切替、旧拡張との二重動作を防ぐ手順、既存設定の移行、問題が起きた場合の復旧方法。
- 各元 repo の Issue、PR、Release、配布先、参照 URL に残すべき情報があるか。コード以外のデータを調べ、残すものと破棄するものを確定する。
- 削除対象の正確な一覧、公開先の確認方法、削除直前の確認手順。ローカル作業コピーの削除は GitHub repo の削除と別に扱い、暗黙に実施しない。

### 解決条件

実行担当者が順番に実施できる検証条件と切替手順を定め、元 repo を削除できる条件をユーザーと合意する。
このチケットの解決時には実際の repo 削除を行わない。

## 調査記録 — 2026-09-18

GitHub APIで候補10repoのメタデータ、全状態のIssue/PR一覧、Release一覧を確認した。各一覧は100件未満であり次ページ不要。

| 削除候補（GitHub上のみ）               | Issue・PR           | Release | Pages・homepage |
| -------------------------------------- | ------------------- | ------- | --------------- |
| luvpame/fast-lgtm                      | なし                | なし    | なし            |
| luvpame/textarea-vim                   | なし                | なし    | なし            |
| luvpame/github-markdown-table-inserter | なし                | なし    | なし            |
| luvpame/github-enhancer                | マージ済みPR #1のみ | なし    | なし            |
| luvpame/github-pr-copy                 | なし                | なし    | なし            |
| luvpame/repo-redirect-for-devin        | なし                | なし    | なし            |
| luvpame/devin-review-merge-guard       | なし                | なし    | なし            |
| luvpame/notion-enhancer                | なし                | なし    | なし            |
| luvpame/page-to-markdown               | なし                | なし    | なし            |
| luvpame/copy-url-as-markdown           | なし                | なし    | なし            |

[github-enhancerのPR「Test HTML preview」](https://github.com/luvpame/github-enhancer/pull/1) はマージ済み。本文はHTMLプレビュー用のテストPRとの説明。Issueコメント、レビュー、行コメントはすべて0件。fixture `fixtures/html-preview-test.html` は現行ソースに存在する。移行記録にPRのタイトル・説明・状態を残す。

TextareaVimにはストア提出用の掲載文、画像、PRIVACY.mdがあり、旧repoをホーム・問い合わせ・プライバシーURLとして参照する。READMEや設定だけでは提出/公開済みかを判定できない。Chrome Web Storeの名称検索、Firefox Add-onsのluvpame検索では結果なしだったが、未公開・限定配布・検索未掲載を否定する根拠にはしない。

## 解決記録 — 2026-09-18

ユーザー回答「自分用だけ、全部OK」により、完了条件・切替と復旧・元repo削除条件を合意した。
旧拡張は自分用のみ。ストアや他人への配布に伴う告知・掲載情報の移行は今回不要とする。

### 実行順序と完了条件

1. 合意済みの移行元HEADと未コミット差分から統合する。ソース、bun.lock、dist/chrome-mv3/、利用・移行手順、元repo対応表、必要なライセンスを公開先 `luvpame/luvpame-browser-extension` へ保存する。Git履歴は統合しない。既存のHTMLプレビューfixtureと上記PRのタイトル・説明・状態を残す。自分用のため旧ストア掲載資料・販促画像の移植は不要。旧プライバシー説明を統合版へ無修正で流用しない。
2. ユニットテスト、型検査、lint、ビルド、Manifest/バンドル検査を通す。設定OFF・入力保持・エラー処理は機能単位のユニットテストで確認する。Playwright/E2E・新しい統合テスト基盤は追加しない。
3. 公開先を新規cloneし、固定lockfileで依存を導入して再ビルドする。保存済みdistとの一致を、追跡済み・未追跡・削除を含めて確認する。保存済みdistからChromeへ拡張を読み込めることを確認する。
4. 旧拡張のLGTMテンプレート・Vim URL設定を旧設定画面から手動コピーし、ON/OFFを設定し直す。旧拡張を無効にして統合拡張へ切り替え、共通メニューのURLコピー・本文コピーの2操作を手動確認する。旧拡張との二重動作を避ける。これは移行時の手動確認であり、自動E2Eの導入ではない。
5. 確認が完了するまで旧拡張をアンインストールしない。問題時は統合拡張を無効にし、旧拡張を再度有効にする。元repo削除は以下の条件を満たしてから、別の実行操作として行う。

### 削除条件と対象

- 削除候補は調査表のGitHub上の10repoに限定する。
- 公開先にソース・成果物・必要な移行記録が揃い、新規clone、検査、再ビルド一致、手動コピー確認、設定移行を完了していること。
- 削除直前に元repoのHEAD、未コミット差分、Issue・PR・Releaseの変化を再確認する。新しい差分や保存すべき情報があれば先に取り込むか扱いを確認し、黙って破棄しない。
- 削除対象の正確な10repo名と検証結果をユーザーへ提示し、削除操作について明示確認を得る。この計画への「全部OK」は削除操作の実行承認ではない。
- ローカル作業コピーは削除しない。Gemini、jobcan-flex、boxil_prod_warning、browser-extension-templateも削除対象外。

今回は計画の確定のみ。統合コードの実装・公開、元repoの削除、旧拡張の無効化は行っていない。
