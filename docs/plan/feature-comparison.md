# 統合対象の機能比較

2026-09-18 調査。採用範囲の合意は下記の判断チケットの「解決記録」を正本とする。
対象: [統合後に残す機能と重複の扱いを決める](issues/01-feature-scope.md)。

## 確認した移行元

既存9リポジトリは `git ls-remote` で GitHub main とローカル HEAD の一致を確認した。
残り2リポジトリは `sources/` に読み取り調査用として default branch を shallow clone した。
以下のHEADと保存済み差分を移行元の基準とする。Geminiは比較記録のみで移行対象外。
`.DS_Store` は機能コードではない。

| 元リポジトリ                    | 調査した HEAD                              |
| ------------------------------- | ------------------------------------------ |
| fast-lgtm                       | `d88fc6532fe6a70b35d0cec3192467c56b5aa615` |
| textarea-vim                    | `f9db39ec248f4eb98c434cebaea46da06557dd9c` |
| github-markdown-table-inserter  | `60b0560b944ca0b02af47edb546df6577061e305` |
| github-enhancer                 | `eb171fd975d164cb6a7e475a62304774f0b27cfa` |
| github-pr-copy                  | `0d7e159737ad23f100a02aa24e87f05a37ef1265` |
| repo-redirect-for-devin         | `82d08fcc125698af6dc9177eeac17abff5a87100` |
| devin-review-merge-guard        | `03294b8803d4bb4c8208c308ded6e51222cad302` |
| notion-enhancer                 | `052860174c9af34b52fd475551e745172713517b` |
| page-to-markdown                | `0446784dbbca86cc637145611d2c553b0bb28a83` |
| copy-url-as-markdown            | `b815ba342093a141149078501241fc54623d4119` |
| gemini-shift-tab-model-switcher | `3dad10c3d79643f563921d7a63be65f28b37bc5a` |

## 機能対応表

| 元リポジトリ                    | 実装上の動作                                                                                          | 統合時の論点                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| fast-lgtm                       | PRのレビュー画面でApprove選択・テンプレート挿入・カーソル配置。自動送信はしない                       | テンプレート設定を残す。Vim編集との共存確認が必要           |
| textarea-vim                    | 複数行textareaにCodeMirror/Vimを重ねる。NORMAL開始、Esc/jj、:w/:wq/:q、URL許可・除外設定              | GitHub表挿入・LGTMとの共存を後続チケットで決める            |
| github-markdown-table-inserter  | GitHub Markdown欄へTableボタン。6×6のグリッドで列数と本文行数を選択し、ヘッダー付き表で選択範囲を置換 | READMEの数値入力説明と異なり、現行UIはグリッド方式          |
| github-enhancer                 | PRのTitle/Url/Textlinkコピー、PR内HTMLプレビュー、Devin系リンク。3機能の切替                          | PRコピーとDevin系リンクの統合先                             |
| github-pr-copy                  | PRのTitle/Url/Textlinkコピー                                                                          | github-enhancerへ一本化                                     |
| repo-redirect-for-devin         | 右下の折り畳みメニュー。公開repoはDeepWiki、非公開repoはDevin Wiki、PRはDevin Reviewも表示            | github-enhancerへ一本化。見た目とページ判定に差がある       |
| devin-review-merge-guard        | Devin Reviewの `button[data-testid="merge-button"]` をDOMから削除し、再描画にも追従                   | マージ自体を禁止する機能ではない。OFF時の復元方法は後続設計 |
| notion-enhancer                 | Notion本文Markdownコピー、タイトルホバー時のタイトル/リンクコピー、見出しマーカー                     | 汎用本文コピーと変換方式が違う。Notion専用抽出を維持        |
| page-to-markdown                | 現在ページのHTMLをDefuddleで本文抽出し、Markdownコピー。タイトル等を前置しない                        | 共通メニューから実行する。Notionでは専用変換を使う          |
| copy-url-as-markdown            | タブのタイトルとURLをMarkdownリンクにする。ショートカット、通知、成功/失敗バッジ                      | ページ内リンクコピーとはタイトルの取得元と文字変換が違う    |
| gemini-shift-tab-model-switcher | GeminiでShift+Tabにより次のモデルへ循環。Shift中はメニュー維持とフォーカス復元                        | ユーザー判断により移行対象外                                |

## 重複の実装差

### PRコピー

両者の `lib/github-pr-copy.ts` を比較。Title/Url/Textlinkの文字列生成、タイトル検出、コピー成功表示は同じ。
統合版はDOM用クラス名を変更し、設定OFF用の削除関数を追加している。
採用方針は判断チケットの解決記録を参照。

### Devin系リンク

両者とも公開/非公開repoとPR番号によるリンク先の選び方は同じ。
`github-enhancer` は `/settings/...` を除外し、独自画像アイコン、簡素なボタンを使う。
単独版はSVGアイコンとツールチップを使う。イベント追従方法も異なる。
採用方針は判断チケットの解決記録を参照。

### Notion本文コピーと汎用本文コピー

Notion版はNotionのページDOMを選び、非表示要素を除去し、箇条書き・番号リスト・チェックボックスを正規化してEuropaで変換する。
汎用版はHTML全体を取得し、offscreen document上のDefuddleで読み取り可能な本文を抽出する。
同じ出力とは扱えない。共通メニューとページ内ボタンの採用方針は判断チケットの解決記録を参照。

### Markdownリンク

共通メニュー候補はタブのタイトル/URLをそのまま取得する。
PRページ内はPR見出しを使い、`[]()` を全角にする。
汎用URLコピーは `[]` を全角にし、バックスラッシュをエスケープし、丸括弧は維持する。
Notionタイトルホバーはページ見出しを使い、サイドピークの `p` パラメータを単体ページ `/p/{id}` に変換し、通常ページではquery/hashを外す。
全てを同じ実装へ置き換えるとコピー結果が変わるため、取得対象と文字変換の採用方針は判断チケットの解決記録を参照。

## 未コミット変更

- `github-enhancer/entrypoints/github.content.ts` と `tests/github-content.spec.ts`: 拡張コンテキスト無効化後の設定適用を停止し、終了時の無効化エラーを扱う変更と2テスト。統合時に維持する対象。
- `repo-redirect-for-devin/wxt.config.ts`: Firefox向け `data_collection_permissions.required: ['none']`。Chromeでは空設定を返す。Firefox対応の判断と合わせて扱い、黙って除外しない。

元ファイルは変更していない。上記差分は調査時点のコピーを `source-patches/` に保存した。

## 後続の判断と検証

機能別ON/OFFの単位・初期値、保存済み設定の移行、対象ブラウザ、実ブラウザ検証と削除条件は後続判断チケットの範囲。
ソース比較のみであり、機能テスト・実ブラウザ検証は未実施。
