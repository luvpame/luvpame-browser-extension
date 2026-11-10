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

1. `Option+A`、popup、右クリックの「原文下の日本語訳を開始／解除」で、記事本文の段落や見出しの下に和訳を表示します。図・デモ・操作UI・本文外の領域は対象から外します。同じ操作で停止して訳文を消せます。有効中は本文に追加された文章も翻訳します。
2. popupまたは右クリックの「本文をやさしい日本語で読む」で、本文全体をChromeのサイドパネルに表示します。要約はしません。
3. テキストを選択すると現れる翻訳アイコンを押すと、その位置付近に日本語訳を表示します。

右クリックメニューはHTTP/HTTPSのページで、本文・リンク・画像・入力欄上から利用できます。

実行方法とモデルは設定画面で変更します。3機能共通で、初期値はブラウザ実行の2Bです。0.8Bは約573MB、2Bは約1.81GBを初回利用時にダウンロードし、端末に保存します。モデルの利用条件は[PLaMo Community License](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF#license)を参照してください。

ブラウザ実行では、翻訳する文章は外部に送信しません。WebGPUが利用できない場合は同じモデルをCPUで処理し、サイドパネルに案内を表示します。実行方法やモデルの自動切替はしません。

Ollamaも選べます。Ollamaを起動し、`ollama pull hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` でモデルを取得して、そのモデル名を設定画面に保存してください。導入済みの `plamo3-translate-ja:latest` や別名のローカルPLaMo Translate GGUFモデルも指定できます。拡張はモデル情報を確認してから、文章をこの端末の `http://localhost:11434` に送ります。クラウドモデルは使えません。OllamaのGPU/CPU使用状況は拡張では判定しません。

接続できない場合は、Ollamaが起動しているか確認してください。403エラーの場合も含め、表示された案内にある `chrome-extension://...` を `OLLAMA_ORIGINS` に設定し、Ollamaを起動し直します。拡張のIDは `chrome://extensions` で確認できます。macOSのアプリ版は `launchctl setenv OLLAMA_ORIGINS "chrome-extension://拡張ID"` を実行後、Ollamaを終了して開き直します。CLI版はOllamaを終了後、`OLLAMA_ORIGINS="chrome-extension://拡張ID" ollama serve` で起動します。全originを許可する必要はありません。

3機能とも生成途中の訳文を表示します。ページ翻訳は、次の段落を選ぶたびに画面内の段落を優先します。選択翻訳は待機中の他の翻訳より先に処理し、実行中の段落は最後まで処理します。

ブラウザのGPU実行では、モデルのロード後は最初の1件を終えてから、同じモデルの最大2件をまとめて開始します。その組がすべて完了してから次の組を開始し、生成中に別の文章の前処理が割り込むのを避けます。CPUとOllamaでは1件ずつ処理します。

同じ文章の再翻訳を減らすため、成功した結果だけを拡張のメモリに最大100件・原文と訳文などの合計20万文字まで保持します。再利用できる期間はブラウザ実行で最大5分、Ollamaで最大30秒です。キャッシュは拡張の再読み込みで破棄されます。本文や訳文をストレージには保存しません。翻訳中は小さなインジケーターを表示し、OSで動きを減らす設定を有効にしている場合は静止表示にします。

Chromeの内部ページ、PDF、画像内の文字、動画字幕は対象外です。ショートカットが他の拡張と競合する場合は `chrome://extensions/shortcuts` で変更してください。

### 保存と権限

機能のON/OFFはブラウザのローカルストレージへ保存します。LGTMテンプレートはブラウザの同期ストレージへ保存します。
翻訳のため全サイトでcontent scriptを動かします。機能OFFは動作の停止であり、アクセス権限は自動解除しません。翻訳モデルの取得時はHugging Faceへ接続します。ブラウザ実行では翻訳モデルとWASMの推論処理がブラウザ内で動作します。Ollama実行ではlocalhostへのアクセス権限を使い、この端末のOllamaへ文章を送ります。
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

翻訳エンジンのWASMは、Sakutto由来の最適化をwllama 3.13.0へ移植した独自ビルドです。通常版と互換版の生成JS・WASMを `vendor/wllama/` に保存し、通常の開発・ビルドではこれらを使います。生成物・パッチ・ビルド手順のハッシュが記録と一致しない場合はビルドを停止します。

WASM本体を変更するときはDockerを起動し、`bun run build:wasm`、`bun run check` の順に実行します。前者は固定したソースとEmscriptenから通常版・互換版を再生成します。初回はビルド用イメージを取得します。生成物と `vendor/wllama/build.json` も変更と一緒に含めてください。変更内容と実機検証は [WASM最適化の記録](docs/research/translation-wasm-performance.md) を参照してください。

移行元と切替・復旧の手順は [移行記録](docs/MIGRATION.md)、統合時点の仕様と判断の履歴は [計画](docs/plan/map.md) を参照してください。計画には現在削除済みのTextareaVim、表挿入、HTMLプレビューも含まれます。
