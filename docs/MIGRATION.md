# 移行記録

採用したコミットは [機能比較表](plan/feature-comparison.md) を参照してください。Gitの履歴は統合せず、ファイルと必要な機能だけを移しました。

| 元repo                         | 統合先                                                            |
| ------------------------------ | ----------------------------------------------------------------- |
| fast-lgtm                      | features/lgtm                                                     |
| textarea-vim                   | features/vim                                                      |
| github-markdown-table-inserter | features/table                                                    |
| github-enhancer                | entrypoints/github.content.ts、lib/github-\*                      |
| github-pr-copy                 | github-enhancer版へ一本化                                         |
| repo-redirect-for-devin        | github-enhancer版へ一本化                                         |
| devin-review-merge-guard       | entrypoints/devin.content.ts、lib/merge-guard.ts                  |
| notion-enhancer                | entrypoints/notion.content.ts、lib/notion                         |
| page-to-markdown               | lib/copy-service.ts、lib/offscreen-copy.ts、entrypoints/offscreen |
| copy-url-as-markdown           | lib/markdown-link.ts、共通メニュー・ショートカット                |

Gemini切替、jobcan-flex、boxil_prod_warning、browser-extension-templateは対象外です。
`github-enhancer` の未コミット修正（終了したcontent scriptへの適用停止）を取り込みました。元差分は [保存パッチ](plan/source-patches/github-enhancer.patch) に残しています。
`repo-redirect-for-devin` の未コミットFirefox設定は [保存パッチ](plan/source-patches/repo-redirect-for-devin.patch) に保管しました。Chrome限定のためManifestには適用していません。
Fast LGTMのMITライセンスは [licenses/fast-lgtm-MIT.txt](../licenses/fast-lgtm-MIT.txt) に保存しています。同梱する依存パッケージのライセンスは `public/THIRD_PARTY_NOTICES.txt` にまとめ、distにも含めています。依存を更新した場合はこの一覧も更新してください。

## 移行前のGitHub情報

2026-09-18時点で対象10repoには未解決Issue/PR、Release、GitHub Pagesはありませんでした。
`github-enhancer` の [PR #1「Test HTML preview」](https://github.com/luvpame/github-enhancer/pull/1) はマージ済みです。
説明は「Test PR for Github Enhancer HTML preview.」。Issueコメント・レビュー・行コメントは0件でした。HTML fixtureは `fixtures/html-preview-test.html` に残しています。
配布は自分用だけなので、ストア掲載資料・販促画像は移植していません。

## 切替

1. 旧LGTM設定のテンプレート、旧Vim設定のURL許可/除外方式とパターンを控えます。
2. 統合拡張を読み込み、「設定」に手動で貼り付けて保存します。機能のON/OFFは指定し直します。
3. 旧拡張を無効にし、対象ページを再読み込みします。動作確認までは旧拡張をアンインストールしません。
4. 共通メニューのURLコピー・本文コピーを実際に貼り付けて確認します。
5. 問題時は統合拡張を無効にして旧拡張を再び有効にし、対象ページを再読み込みします。

## 公開・削除前の確認

公開後に新規cloneし、保存済みdistからの読み込みと、固定lockfileからの再ビルド一致を確認します。
元repoの削除前にはHEAD、ローカル差分、Issue/PR/Releaseを再確認し、公開先・検証結果・対象10repoを提示して明示確認を得ます。
この実装に元repoの自動削除は含めていません。ローカル作業コピーも残します。
