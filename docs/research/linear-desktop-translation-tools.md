# Linear デスクトップを変更せずに読むための翻訳ツール

調査日: 2026-11-16。対象は公式 Linear アプリの Review Guide。アプリへの注入や改造ではなく、macOS の別プロセスで選択文や画面を取得して翻訳する方法を調べた。インストール、権限変更、翻訳実行、Linear の画面取得は行っていない。以下はすべて **Linear 実機未検証**。

画面上で日本語を読む目的には、**OCR と日本語オーバーレイを組み合わせる経路が残る**。外部アプリが取得・翻訳するため、Linear のレンダラー自身に Ollama への接続を要求しない、という構成上の推論である。Linear 内の実際の本文・DOM・保存データを置換するものではない。

## 候補の比較

| 候補                                                                                    | 取得と表示                                         | ローカル Ollama    | Guide 全体の自動翻訳                                             | 現時点の評価                                           |
| --------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------ |
| [TranScreen](https://github.com/scoltzero/TranScreen)                                   | 固定画面領域を OCR し、元画面に訳文を重ねる        | 対応               | 表示中の固定領域を継続更新。画面外の本文を取得する仕組みではない | 目的に最も近い。macOS 15+、配布の注意点あり            |
| [Bob](https://bobtranslate.com/guide/quickstart/translate.html)                         | 選択文、範囲スクリーンショット、画像上への訳文表示 | 公式機能として対応 | 原図翻訳は手動の撮影単位。継続監視は確認できず                   | 既製アプリで画像上翻訳を試す候補                       |
| [Easydict](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md)     | 選択文または範囲 OCR → 別の翻訳ウィンドウ          | 対応               | 選択・撮影した範囲ごと。自動の全文置換は確認できず               | 別ウィンドウでよければ有力                             |
| [macOS 標準翻訳](https://support.apple.com/ja-jp/guide/mac-help/mchldd8b3c15/26/mac/26) | 選択文の右クリック → 翻訳ポップアップ              | 非対応             | 選択部分のみ                                                     | 追加アプリ不要。ただし Linear の右クリック対応は未確認 |

## TranScreen: 表示中の Guide を継続翻訳する案

作者は、Apple Vision OCR、Ollama、翻訳の画面オーバーレイ、最大8か所のリアルタイム領域を公開している。使い方は、翻訳エンジンと言語を設定し、`⌘M` で Guide の表示領域を指定する。単発なら `⌘E`、終了は `Esc`。必要権限は画面収録とアクセシビリティ。[公式 README](https://github.com/scoltzero/TranScreen/blob/faea6f6d7c0ef394da2bd7121e345beb07c15f02/README.md)

Ollama 実装は既定で `http://localhost:11434/api/chat` に認識済みテキストを送る。ローカルモデルとローカル接続先を選べば、翻訳推論に外部サービスは不要という判断ができる。ただしアプリ全体の通信を監査したわけではない。[OllamaEngine.swift](https://github.com/scoltzero/TranScreen/blob/faea6f6d7c0ef394da2bd7121e345beb07c15f02/TranScreen/Translation/Engines/OllamaEngine.swift)

制約: 領域は画面座標に対して指定するため、ウィンドウ移動・スクロール中の追従性、訳文の読みやすさ、表示の遅れ、Linear 操作への影響は実機で確認が必要。画面外の Guide 全文を先読みして書き換える機能とは区別する。

配布資料に不整合がある。README は「リリース準備中、ソースビルド推奨」とする一方、実際には v1.2.3 の `.app` ZIP が公開されている。公式リリース本文は **未署名・未公証** と明記し、別開発者の署名・公証済み版を案内している。後者の署名やバイナリ内容は未検証。[公式 v1.2.3](https://github.com/scoltzero/TranScreen/releases/tag/v1.2.3)、[案内先のリリース](https://github.com/mrtian2016/TranScreen/releases/tag/v1.2.3)

## Bob: 画像の位置関係を保って訳文を見る案

「原图翻译」はショートカットを割り当てて範囲を撮影すると、通常の翻訳ウィンドウを開かず画像上に訳文を表示する。選択文翻訳は `⌥D`、通常のスクリーンショット翻訳は `⌥S`。入力欄を翻訳で置き換える機能は編集可能な領域向けなので、読み取り用 Guide の本文置換には使えない。[公式操作ガイド](https://bobtranslate.com/guide/quickstart/translate.html)

設定の「サービス」→「テキスト翻訳」で Ollama を追加し、既存のモデルを選択できる。公式には Ollama 翻訳をオフラインと説明している。モデルが一覧になければカスタムモデル名を指定できる。[公式 Ollama 設定](https://bobtranslate.com/service/translate/ollama.html)

OCR は「离线文本识别」を選べる。クラウド OCR・翻訳を併用すれば、そのサービスへの送信が発生するため、ローカル運用では有効サービスを確認する必要がある。[公式サービス一覧](https://bobtranslate.com/guide/advance/service.html)

原図翻訳は Beta 機能で、作者は AI 翻訳では応答が遅くなる場合があると説明している。内蔵翻訳サービスに対応するというリリース説明はあるが、**原図翻訳＋Ollama＋日本語をこの環境で組み合わせた結果は未検証**。アプリ内課金や利用条件も導入時の確認が必要。[公式 App Store の更新履歴](https://apps.apple.com/ph/app/bob-%E7%BF%BB%E8%AF%91%E5%92%8C-ocr-%E5%B7%A5%E5%85%B7/id1630034110?mt=12)

## Easydict: 安定した選択・OCR と別ウィンドウを使う案

現在のガイドでは macOS 13+ が必要。`⌥D` で選択文、`⌥S` で画面範囲を翻訳する。選択取得にはアクセシビリティ、画面取得には画面収録権限を使う。選択できないアプリではコピーまたは OCR に切り替えられる。[公式利用ガイド](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md)

Ollama は同じ Mac または任意のサーバー URL に接続できる。設定の Services でローカル Ollama だけを有効にし、各翻訳ウィンドウのサービス選択も合わせる。既定では Youdao、DeepL、Built-in AI が有効なので、インストールしただけではローカル専用にならない。[公式サービス仕様](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/SERVICES.md)

OCR は Apple Vision が既定。ローカル運用では Youdao OCR フォールバックを無効にし、クラウドの画像認識を選ばない。ガイド上の表示先は翻訳ウィンドウで、読み取り用本文を元位置に継続翻訳する機能は確認できなかった。[OCR・サービス設定](https://github.com/tisfeng/Easydict/blob/dev/docs/user-docs/en/GUIDE.md)

## macOS 標準翻訳: 追加アプリなしの範囲翻訳

対応アプリなら、文を選択して Control クリック→「翻訳」→日本語を選べる。Apple は対象を「いくつかの他社製アプリを含む」としており、**Electron 一般や Linear で必ず使えるとはしていない**。Linear のメニューに翻訳が存在するかは未確認。[Apple の操作説明](https://support.apple.com/ja-jp/guide/mac-help/mchldd8b3c15/26/mac/26)

ローカル処理には、システム設定→一般→言語と地域→翻訳言語で英語・日本語をダウンロードし、「オンデバイスモード」を選ぶ。既定のオンライン処理と区別が必要。アプリの言語を日本語にする設定だけで英語の Guide が機械翻訳されるわけではない。本文の「翻訳で置き換え」は入力中のテキスト向け。[Apple の翻訳設定](https://support.apple.com/ja-jp/guide/mac-help/mchldd8b3c15/26/mac/26)

## 調べたが優先候補から外したもの

- **Pot**: 選択翻訳、OCR、クリップボード監視、Ollama に対応するが、公式サイトが保守終了を告知している。Guide を元画面で読む用途に対し、上記候補より強い理由がない。[公式サイト](https://pot-app.com/en/)、[公式 README](https://github.com/pot-app/pot-desktop/blob/master/README_EN.md)
- **DeepL for Mac**: 画面取得を有効にし `⇧⌘2` で範囲を指定すると、抽出文と訳文を DeepL 側に表示する。Guide 本体の書き換えや継続翻訳ではなく、ローカル Ollama の再利用もできない。翻訳は DeepL サービスに送信される前提で、無料・Pro のデータ取り扱いを確認する必要がある。スクリーンショット画像そのものの送信有無は今回の資料だけでは確定しなかった。[公式画面取得ガイド](https://support.deepl.com/hc/en-us/articles/4407878482962-Use-the-screen-capturing-feature)、[公式プライバシーポリシー](https://www.deepl.com/en/privacy)

## 今回確認していないこと

インストールや実動確認は行っていない。Linear 1.32.8 からの選択取得、Guide の OCR 精度、リアルタイム表示、実際の通信、署名・配布バイナリの検証は残る。リポジトリの実装は変更しておらず、この調査内で確認した資料上の不整合は TranScreen の README とリリース状況のみ。
