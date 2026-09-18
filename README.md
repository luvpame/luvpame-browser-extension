# Luvpame Browser Extension

GitHub・Notionの編集補助、TextareaVim、Markdownコピーをまとめた自分用のChrome MV3拡張です。

## インストール

1. このリポジトリを取得します。
2. Chromeで `chrome://extensions` を開き、デベロッパーモードをONにします。
3. 「パッケージ化されていない拡張機能を読み込む」で **`dist/chrome-mv3/`** を指定します。
4. 旧拡張を無効にし、開いている対象ページを再読み込みします。

保存済みの成果物を使う場合、BunやNode.jsのインストールは不要です。Firefox版は含みません。

## 使い方

拡張アイコンから「URLをMarkdownでコピー」「本文をMarkdownでコピー」「設定」を開けます。
URLコピーのショートカットはmacOSで `Command+Shift+Y`、その他で `Ctrl+Shift+Y`。Chromeのショートカット設定から変更できます。
本文コピーはNotionの対応ページでは専用の変換、それ以外ではDefuddleで本文を抽出します。タイトルなどのメタデータは付けません。
URLコピーはHTTP/HTTPS、汎用本文コピーはHTTP/HTTPSとファイルURLが対象です。ファイルURLでは拡張の詳細画面からアクセスを許可してください。

設定画面では12機能を個別にON/OFFできます。初期値はすべてONで、開いているタブにも反映されます。

| 対象         | 機能                                                         |
| ------------ | ------------------------------------------------------------ |
| 共通         | URLコピー、本文コピー、TextareaVim                           |
| GitHub       | LGTM、表挿入、PRコピー、HTMLプレビュー、Devin系リンク        |
| Notion       | ページ内本文コピーボタン、タイトルホバー操作、見出しマーカー |
| Devin Review | マージボタン非表示                                           |

Notionのページ内ボタンをOFFにしても、共通メニューの本文コピーは利用できます。
LGTMはApproveの選択と本文テンプレートの挿入までで、レビューを自動送信しません。既存のレビュー本文は置き換えます。
Devin Reviewのマージボタン非表示はUI上の補助であり、マージの権限を制限するものではありません。

### Vim

編集可能な複数行textareaにフォーカスするとNORMALモードで開きます。`i`で入力、`Esc`または`jj`でNORMALへ戻ります。
`:w`で保存、`:wq`で保存して終了、`:q`で開始時の内容へ戻して終了します。外側クリックや`Ctrl/Command+Enter`でも保存して終了します。
表挿入とLGTMはVimを一旦保存・終了してから処理し、挿入後のカーソル位置から再開します。VimをOFFにした場合も内容を保存して終了します。

VimのURL設定は「一致するURLを除外」か「一致するURLだけ許可」を選べます。`github.com`などを1行に1つ入力し、不正な行があれば保存しません。

### 保存と権限

機能のON/OFFはブラウザのローカルストレージへ保存します。LGTMテンプレートとVimのURL設定はブラウザの同期ストレージへ保存します。
Vimのため全サイトでcontent scriptを動かします。機能OFFは動作の停止であり、アクセス権限は自動解除しません。
コピーしたページ内容を外部の変換サーバーへ送る処理はありません。HTMLプレビューはGitHubからHTMLを取得し、スクリプト実行を許可しないsandbox内に表示します。HTML内の画像等が外部を参照する場合はその参照が発生し得ます。

## 開発

Bun 1.3.13とNode.js 24.14.1を使用します。Vite+の検査・テストはNode.js、WXTの実行と依存管理はBunです。

```sh
mise install
bun install --frozen-lockfile
bun run dev
```

```sh
bun run typecheck
bun run test
bun run build
bun run check
```

`check`は整形・lint、型検査、ユニットテスト、ビルド、生成物検査を実行します。DOMやブラウザAPIはjsdom・モックを使い、Playwright/E2Eは含みません。
テストを指定する場合は `bun run test tests/copy-service.spec.ts`。`bun test`は別のランナーなので使用しません。
Vite+内蔵VitestをBunで直接実行する実験的方式は一部で動作確認済みですが、WXTの仮想モジュールとモックを維持するため、標準コマンドは `vp test` を使います。

`bun run build`は `dist/chrome-mv3/` を再生成します。ソース変更と成果物を同じコミットに含めてください。CIで再ビルド後の差分と未追跡ファイルを検出します。

移行元と切替・復旧の手順は [移行記録](docs/MIGRATION.md)、合意済みの仕様は [計画](docs/plan/map.md) を参照してください。
