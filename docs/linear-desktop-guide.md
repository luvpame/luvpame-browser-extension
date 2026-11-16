# Linearデスクトップ版でのGuide翻訳の検証

2026年11月16日に、このMacのLinear 1.32.8で検証しました。アプリ本体を変更せず、DevToolsからスクリプトを実行してローカルのOllamaで翻訳する方式は動作しませんでした。

## 確認した制限

1. `http://localhost:11434` への直接接続は、LinearのCSPで遮断されます。実機のConsoleでも確認しました。
2. CSPで許可された `http://127.0.0.1:18450` に専用中継を起動し、ローカルモデルが翻訳を返すことを確認しました。
3. Linearの通常画面では `loopback-network` の権限が拒否され、実機で翻訳を開始できませんでした。

インストール済みアプリのメイン処理を読み取り、`loopback-network` と `local-network-access` の権限を認証専用ウィンドウだけに許可する実装を確認しました。通常のLinear画面は対象外です。OllamaのCORS設定を変えても、このアプリ側の権限制御は解決しません。

## 検証後の状態

中継を停止し、動作しない試作用スクリプトと中継コードは削除しました。Linear本体とOllamaの設定は変更していません。既存のブラウザ版向けGuide翻訳は引き続き利用できます。

試作用の表示が残っている場合は、DevToolsのConsoleで `luvpameLinearReviewGuide?.stop()` を実行すると消せます。

## 別の方式の調査

この検証で失敗したのは、Linearの画面からローカルHTTPへ接続する方式です。翻訳全般が不可能という結論ではありません。[非改造方式の追加調査](research/linear-desktop-translation-options.md)に、画面内推論、クリップボード連携、OCRによる訳文表示などを整理しています。
