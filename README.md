# Luvpame Browser Extension

GitHub・Notionの編集補助、Markdownコピーをまとめた自分用のChrome MV3拡張です。

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

popupと設定画面のどちらでも10機能を個別にON/OFFできます。初期値はすべてONで、開いているタブにも反映されます。

| 対象         | 機能                                                         |
| ------------ | ------------------------------------------------------------ |
| 共通         | URLコピー、本文コピー、PLaMo翻訳                             |
| GitHub       | LGTM、PRコピー、Devin Reviewリンク                           |
| Notion       | ページ内本文コピーボタン、タイトルホバー操作、見出しマーカー |
| Devin Review | マージボタン非表示                                           |

Notionのページ内ボタンをOFFにしても、共通メニューの本文コピーは利用できます。
LGTMはApproveの選択と本文テンプレートの挿入までで、レビューを自動送信しません。既存のレビュー本文は置き換えます。
Devin Reviewのマージボタン非表示はUI上の補助であり、マージの権限を制限するものではありません。

### PLaMo翻訳

Chrome 137以降で、英語のWebページを端末内のPLaMo 3 Translateで翻訳します。

1. `Option+A`、popup、右クリックの「原文下の日本語訳を開始／解除」で、段落の下に和訳を表示します。同じ操作で停止して訳文を消せます。有効中は追加された文章も翻訳します。
2. popupまたは右クリックの「本文をやさしい日本語で読む」で、本文全体をChromeのサイドパネルに表示します。要約はしません。
3. テキストを選択すると現れる翻訳アイコンを押すと、その位置付近に日本語訳を表示します。

モデルは設定画面だけで変更します。3機能共通で2Bが初期値です。0.8Bは約573MB、2Bは約1.81GBを初回利用時にダウンロードし、端末に保存します。モデルの利用条件は[PLaMo Community License](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF#license)を参照してください。

翻訳する文章は外部に送信しません。WebGPUが利用できない場合は同じモデルをCPUで処理し、その状態を画面に表示します。モデルを自動で変更することはありません。翻訳結果はページ内だけで保持し、ページを閉じるか再読み込みすると破棄します。

Chromeの内部ページ、PDF、画像内の文字、動画字幕は対象外です。ショートカットが他の拡張と競合する場合は `chrome://extensions/shortcuts` で変更してください。

### 保存と権限

機能のON/OFFはブラウザのローカルストレージへ保存します。LGTMテンプレートはブラウザの同期ストレージへ保存します。
翻訳のため全サイトでcontent scriptを動かします。機能OFFは動作の停止であり、アクセス権限は自動解除しません。翻訳モデルの取得時はHugging Faceへ接続します。翻訳モデルとWASMの推論処理はブラウザ内で動作します。
コピーしたページ内容を外部の変換サーバーへ送る処理はありません。

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

移行元と切替・復旧の手順は [移行記録](docs/MIGRATION.md)、統合時点の仕様と判断の履歴は [計画](docs/plan/map.md) を参照してください。計画には現在削除済みのTextareaVim、表挿入、HTMLプレビューも含まれます。
