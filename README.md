# Luvpame Browser Extension

GitHub・Notionの編集補助、Markdownコピー、翻訳をまとめた自分用のChrome MV3拡張です。LinearのReview Guide翻訳にも対応しています。

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

popupと設定画面のどちらでも11機能を個別にON/OFFできます。初期値はすべてONで、開いているタブにも反映されます。

| 対象         | 機能                                                         |
| ------------ | ------------------------------------------------------------ |
| 共通         | URLコピー、本文コピー、PLaMo翻訳                             |
| GitHub       | LGTM、PRコピー、Devin Reviewリンク                           |
| Notion       | ページ内本文コピーボタン、タイトルホバー操作、見出しマーカー |
| Devin Review | マージボタン非表示                                           |
| Linear       | Review Guideの説明文を自動翻訳                               |

Notionのページ内ボタンをOFFにしても、共通メニューの本文コピーは利用できます。
LGTMはApproveの選択と本文テンプレートの挿入までで、レビューを自動送信しません。既存のレビュー本文は置き換えます。
Devin Reviewのマージボタン非表示はUI上の補助であり、マージの権限を制限するものではありません。

### Linear Review Guide翻訳

LinearのPRでGuideタブを開くと、英語の説明文だけを日本語に置き換えます。見出し、操作ボタン、コード差分は翻訳しません。後から追加された説明文や、アプリ内の画面遷移にも対応します。

#### ブラウザ版

1. popupまたは設定画面の「Linear: Review Guide翻訳」をONにします。初期値はONです。
2. 翻訳設定で実行方法とモデルを選びます。既存のPLaMo翻訳と共用し、ブラウザ実行では初回にモデルを取得します。
3. LinearのPRでGuideタブを開きます。ボタン操作なしで翻訳が始まり、機能をOFFにすると原文に戻ります。

「PLaMo: ページ・選択翻訳」がOFFでも動作します。ページ翻訳の表示方式にかかわらず、Guideは置き換え表示です。

#### デスクトップ版・macOS

公式Linear.appを変更せず、Guide翻訳だけを使えます。PLaMo 3 Translate 0.8BをLinear内で実行し、GPUを優先します。GPUが使えない場合はCPUに切り替わります。翻訳する文章は外部へ送信しません。Chrome拡張の設定とは独立しています。

初回はmacOS 15以降と[開発環境](#開発)を使い、リポジトリのルートで設定します。

1. 実行ファイルとMac用補助アプリを生成し、モデルを取得して補助を配置します。モデルは約573MBです。既に同じモデルがある場合は、ダウンロードの代わりに `dist/linear-offline/model.gguf` へ配置します。

   ```sh
   bun run build:linear-auto-start
   curl --fail --location --output dist/linear-offline/model.gguf 'https://huggingface.co/pfnet/plamo-3-translate-0.8b-GGUF/resolve/main/plamo-3-translate-0.8b-Q4_K_M.gguf'
   bun run linear:auto-start stage
   ```

2. `pbcopy < dist/linear-offline/setup.js` で初期設定コードをコピーします。LinearのPR画面で `Cmd+Option+I` を押し、DevToolsのConsoleへ貼り付けて実行します。下部バーのファイル選択で `dist/linear-offline/linear-offline.js` と `model.gguf` を選び、保存とモデル準備が終わるまで待ちます。実行ファイルとモデルはLinear内に保存され、次回から選択不要になります。
3. `open "$HOME/Applications/Linear翻訳補助.app"` で補助を開き、システム設定 → プライバシーとセキュリティ → アクセシビリティで「Linear翻訳補助」を許可します。
4. Linearを前面にして、Mac上部の補助メニューから「接続確認」を押します。「実行確認済み」になったら補助メニューで「終了」し、`bun run linear:auto-start enable` を実行します。ログイン時に補助が起動し、Linearの起動を待つ設定になります。
5. Linearを完全終了・再起動し、前面にしたまま60秒ほど待ちます。下部バーが「Guide待機 · GPU」または「翻訳完了 … · GPU」になれば、自動復元できています。CPU環境ではCPUと表示されます。

設定後はLinearを起動してGuideを開くだけです。コードの貼り付け、ファイル選択、補助の手動起動は不要です。復元中は補助がDevToolsを一時的に開くため、Consoleへの入力は待ってください。

翻訳状態はLinear既存の下部ステータスバーに表示します。翻訳中は完了・処理中・待機・失敗の件数を確認でき、マウスを重ねるとモデルやエラー詳細が出ます。「翻訳を停止」で原文に戻り、モデルも終了します。次のLinear起動時には自動復元します。

ログイン時起動を解除する場合は `bun run linear:auto-start disable` を実行し、補助メニューで「終了」します。Linearの更新後は接続確認が必要です。補助の更新後に「権限が必要」のままになる場合は、アクセシビリティ一覧の補助を削除して再追加します。

保存データの削除や復旧は[自動復元の手順](docs/linear-auto-start.md)、手動起動とGPU・CPUの詳細は[通信不要なGuide翻訳](docs/linear-offline-guide.md)を参照してください。Linear 1.32.8でGPU翻訳とLinear再起動後の復元を確認しています。Mac自体の再起動・再ログインは未検証です。[ローカルHTTP接続が使えない理由](docs/linear-desktop-guide.md)も記録しています。

### PLaMo翻訳

Chrome 137以降で、英語のWebページを端末内のPLaMo 3 Translateで翻訳します。

1. 設定画面またはpopupで「原文＋翻訳の二段表示」または「原文を翻訳に置き換え」を選びます。初期設定は二段表示で、変更は次の翻訳から反映します。
2. `Option+A`で通常の日本語訳、`Option+Shift+A`でやさしい日本語訳を開始・解除します。popupと右クリックメニューからも操作できます。同じ言語と表示方式で再実行すると解除し、言語や方式を変えると原文から翻訳し直します。図・デモ・操作UI・本文外の領域は対象から外し、有効中に追加された本文も翻訳します。
3. テキストを選択すると現れる翻訳アイコンを押すと、その位置付近に通常の日本語訳を表示します。ページ翻訳の表示方式や言語には影響されません。

macOS以外では上記の `Option` は `Alt` です。

右クリックメニューはHTTP/HTTPSのページで、本文・リンク・画像・入力欄上から利用できます。

実行方法とモデルは設定画面で変更します。ページ翻訳と選択翻訳に共通で、初期値はブラウザ実行の0.8Bです。未保存のモデルは「モデルを準備」を押したとき、または初回の翻訳時にダウンロードします。0.8Bは約573MB、2Bは約1.81GBで、端末に保存します。モデルの利用条件は[PLaMo Community License](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF#license)を参照してください。

ページ・選択翻訳またはLinear Review Guide翻訳がONでブラウザ実行を選んでいる場合、拡張の起動時と両翻訳機能・実行方法・モデルの設定変更時に、保存済みの0.8Bまたは2Bをメモリへ読み込み、ウォームアップを済ませます。未保存モデルの自動ダウンロードはしません。準備が終わる前に翻訳を開始した場合は、残りの準備時間を待ちます。翻訳操作前からモデルがメモリを使用します。

「モデルを準備」はモデル読込とウォームアップを先に済ませる操作で、設定画面を開くだけではダウンロードしません。

ブラウザ実行では、翻訳する文章は外部に送信しません。WebGPUが利用できない場合は同じモデルをCPUで処理します。実行方法やモデルの自動切替はしません。

Ollamaも選べます。Ollamaを起動し、`ollama pull hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M` でモデルを取得して、そのモデル名を設定画面に保存してください。導入済みの `plamo3-translate-ja:latest` や別名のローカルPLaMo Translate GGUFモデルも指定できます。拡張はモデル情報を確認してから、文章をこの端末の `http://localhost:11434` に送ります。クラウドモデルは使えません。OllamaのGPU/CPU使用状況は拡張では判定しません。

接続できない場合は、Ollamaが起動しているか確認してください。403エラーの場合も含め、表示された案内にある `chrome-extension://...` を `OLLAMA_ORIGINS` に設定し、Ollamaを起動し直します。拡張のIDは `chrome://extensions` で確認できます。macOSのアプリ版は `launchctl setenv OLLAMA_ORIGINS "chrome-extension://拡張ID"` を実行後、Ollamaを終了して開き直します。CLI版はOllamaを終了後、`OLLAMA_ORIGINS="chrome-extension://拡張ID" ollama serve` で起動します。全originを許可する必要はありません。

ページ翻訳と選択翻訳は生成途中の訳文を表示します。長い文章を分割した場合は最大2片を並列で送り、原文の順番に訳文を表示します。ページ翻訳は、次の段落を選ぶたびに画面内の段落を優先します。スクロール後は送信済みの待機要求も並べ替え、15秒以上待った要求を同じ優先度内で救済します。原文が変更・削除された要求は個別に取り消します。選択翻訳は待機中の他の翻訳より先に処理し、実行中の段落は最後まで処理します。同文の要求を共有する場合は、最初の要求の優先度に従います。

短いラベルは、先頭の文章・見出し・リンク断片を除いて最大8件までまとめます。結果の番号・行数・数値が対応しない場合は全件を個別に訳し直します。一括翻訳は検査を終えた結果を表示します。通常の途中出力は差分で転送し、描画をフレーム単位にまとめます。最初の出力と最終結果は待たせません。

通常モデルのGPU実行では、モデルのロード後は最初の1件を終えてから、同じモデルの最大2件をまとめて開始します。各組の先頭は優先度・表示距離・待機順で選び、同じ距離・優先度の範囲で入力の長さが近い要求を組み合わせます。15秒以上待った要求は距離より先に扱います。その組がすべて完了してから次の組を開始し、生成中に別の文章の前処理が割り込むのを避けます。CPU・Ollama・実験用の補助モデル方式は1件ずつ処理します。CPUでは共通プロンプトのKVを再利用し、スレッド数は論理コア数の半分、最大8です。比較条件と結果は[先行する実機測定](docs/research/translation-browser-performance.md)、追加機能は[追加実装の記録](docs/research/translation-additional-implementation.md)を参照してください。

同じ原文・モデル・翻訳先への同時要求は、ブラウザ実行では1回の推論を共有します。各要求のキャンセルは独立しており、全要求がキャンセルされたときに推論を停止します。保存済みの訳文は推論の順番を待たずに返します。同じ文章の再翻訳を減らすため、成功した結果だけを拡張のメモリに最大100件・原文と訳文などの合計20万文字まで保持します。再利用できる期間はブラウザ実行で最大5分、Ollamaで最大30秒です。キャッシュは拡張の再読み込みで破棄されます。本文や訳文をストレージには保存しません。翻訳が完了するまでは、進捗の文言を出さず、二重のリングが回る円形ローダーを表示します。OSで動きを減らす設定が有効な場合は静止します。

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
