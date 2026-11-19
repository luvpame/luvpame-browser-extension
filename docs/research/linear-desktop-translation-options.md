# Linearデスクトップ版の非改造翻訳の選択肢

この文書は実装前の調査記録です。その後に試した画面内推論のスクリプトは削除しました。ブラウザ版の使い方は[README](../../README.md#linear-review-guide翻訳)を参照してください。以下の未検証表記は調査時点の状態です。

調査日: 2026-11-16。アプリのコピー・改造、起動フラグの変更、ツールの導入、クリップボード内容の取得は行っていない。既存のローカル接続の失敗は、すべての翻訳方式が不可能という意味ではない。

## 結論

元のGuide本文を自動で日本語へ置き換える目的には、ネットワーク接続を使わない「画面内推論」と「クリップボード連携」が追加候補になる。どちらも設計上の候補で、Linear実機での翻訳成功はまだ確認していない。

既製ツールなら、別プロセスで画面をOCRして訳文を重ねるTranScreenが近い。GuideのDOMを書き換える仕組みではない。選択文だけならEasydictとローカルOllamaを組み合わせられる。製品ごとの一次資料と配布上の注意点は[ツール調査](linear-desktop-translation-tools.md)にまとめた。

## 画面内でPLaMoを動かす

既存拡張が使うwllamaは、ブラウザ内で推論し、ローカルファイルのBlob配列を `loadModel()` に渡せる。モデルと実行資材をユーザーがファイル選択で読み込む構成なら、OllamaへのHTTP接続を使わずに済む。したがって、今回確認したloopback接続拒否とは別の経路になる。[wllama公式README](https://github.com/ngxson/wllama/blob/master/README.md)、[公式loadModel実装](https://github.com/ngxson/wllama/blob/master/src/wllama.ts)

このリポジトリのwllama 3.13.0の型定義でも `loadModel(Blob[] | Model, params)` を確認した。既存の拡張向けビルドはワーカーとWASMの読み込み先を拡張内URLへ固定しているため、そのビルドを変更せずそのまま貼り付けることはできない。ファイル・Blobからの読み込みに対応した別の起動部分が必要。

2026-11-16に `https://linear.app` のHTTP応答を確認したところ、`script-src` は `'wasm-unsafe-eval'` と `blob:`、`worker-src` は `blob:` を許可していた。これは公開配信ページの応答であり、デスクトップ画面での実測結果とは区別する。WASM実行を許可するディレクティブの意味は[CSP script-src仕様](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src#unsafe_webassembly_execution)を参照。

未確認事項は、実アプリでのWASMコンパイル、Blobワーカー実行、WASM資材の受け渡し、モデルファイルの読み込み、メモリ量、翻訳速度。wllamaは複数スレッド利用にCOOP/COEPヘッダーを要求するため、必要なヘッダーがない場合は単一スレッド構成を検討する。[wllamaの制約](https://github.com/ngxson/wllama/blob/master/README.md)

## クリップボードを介してOllamaと連携する

想定する経路は、Guide抽出スクリプト → クリップボード → Mac側の補助処理 → Ollama → クリップボード → Guideへの訳文表示。LinearのレンダラーはHTTP接続をしない。これは提案する構成であり、実装済み・動作確認済みの機能ではない。

Linear 1.32.8の `Contents/Resources/app.asar` 内のメイン処理を読み取り、通常画面のローカルネットワーク権限を認証専用ウィンドウへ限定する一方、クリップボードの読み取りとテキスト書き込みは通常のアプリ要求にも許可する実装を確認した。Electronはレンダラーで `navigator.clipboard` を使う方式を案内している。[Electronの変更履歴](https://www.electronjs.org/docs/latest/breaking-changes)、[Clipboard APIの要件](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API)

ただしAPIの存在と、実際の読み書きの成功は別である。フォーカスやユーザー操作の要件、複数形式のクリップボードの保存・復元、ユーザーが途中で別の内容をコピーした場合の競合を解決する必要がある。通常のコピー操作に影響するため、画面内推論より先に推奨できる段階ではない。

## Chromium内蔵Translator API

Chromeには端末内翻訳モデルを使うTranslator APIがある。公式資料は機能検出と `Translator.availability()` の確認を求めている。Chromeで提供されることだけを根拠に、Electron版Linearにも存在すると判断してはいけない。[Chrome公式資料](https://developer.chrome.com/docs/ai/translator-api)

実機でAPIの存在を確認する読み取り専用コードをユーザーへ提示した。存在しても、言語モデルの利用可能性や初回ダウンロードまで別途確認が必要。今回の時点でLinearで利用可能とは断定していない。

## macOS標準の右クリック翻訳

Appleは対応する他社アプリでの選択翻訳を案内しているが、すべてのアプリが対象ではない。[Appleの説明](https://support.apple.com/en-lamr/guide/mac-help/mchldd8b3c15/mac)

手元のLinear 1.32.8の独自コンテキストメニュー実装では、選択テキストのLook UpとCopyは確認したが、翻訳メニューの追加は見つからなかった。実画面の右クリックメニューは今回直接操作していないため、標準翻訳が使えると案内する根拠には不足する。

## 次に確認すること

第一候補は画面内推論。実機でWASMとBlobワーカーが許可されているか確認し、モデルを読み込む前に起動部分だけ検証する。これが難しい場合は、元の本文の置換を求めるか、画面上の訳文オーバーレイで十分かによって、クリップボード連携と既製OCRツールを比較する。

## 既存Ollamaモデルとの互換性

このMacの `plamo3-translate-ja:latest` のモデル定義を読み取り、最終ユーザーメッセージを翻訳元として扱い、対象言語の既定値を日本語にするテンプレートを確認した。ただし、TranScreenなどが送る番号付き文章や独自プロンプトを含む入力で、結果の番号対応や文体が正しくなることは別途確認が必要。Ollama対応だけを根拠に、既存モデルとの完全な互換性を保証しない。

## 実機の追加確認

ユーザーが公式LinearのDevToolsで、8バイトの最小WASMモジュールのコンパイルを実行し、「利用可」と報告した。したがって通常画面でのWASMコンパイルは確認済み。これはモデル推論成功の確認ではない。次はBlobワーカー内でのWASM実行を確認する。

## オフライン試作の検証

ユーザーのLinear実機でBlob Worker内のWASMコンパイルも成功した。その後、同等の制限を設定した専用Chromeページで実モデルの試作を検証した。CSPは `connect-src none`、スクリプトとワーカーはBlobを許可、WASM実行を許可した。COOP/COEPはなく `crossOriginIsolated=false`、グローバルのSharedArrayBufferも未公開の環境だった。

既存のローカルPLaMo 3 Translate 2B GGUFをファイル入力から読み込み、「Review the changes before approving.」を「承認前に変更内容を確認してください。」と翻訳した。コード差分の文字列は保持され、Guideからの離脱で原文復元、再入場での再翻訳を確認した。モデル推論のための外部HTTP接続は行っていない。これは専用Chrome検証ページでの結果であり、公式Linear内の実モデル推論まで確認した結果ではない。

## GPU対応への変更

CPU固定版はユーザーのLinear実機で動作したが、遅いという報告を受けた。ユーザーのGPU利用の依頼に従い、通常WASMの選択を復元し、ブラウザ版と同じGPU優先設定・2並列・訳文キャッシュを適用した。モデルはブラウザ版の既定0.8B Q4_K_Mを用意した。専用Chromeページの非ソフトウェアApple Metalアダプターで、実GPUモデル割り当てと複数説明文の翻訳を確認。速度の倍率は測定していない。その後、ユーザーがLinear実機でもGPU対応版の動作を確認した。
