# Ollama 経由の PLaMo 翻訳に関する調査

調査日・計測日 2026-11-09。一次資料は Yab で閲覧した。

## 結論

Ollama は Apple GPU の Metal を利用できる。この端末の既存 PLaMo 3 Translate 2B モデルも、実際に `100% GPU` で短文を翻訳できた。ウォーム状態の異なる英文5件は、HTTP要求開始から翻訳完了まで中央値 **0.192秒**、範囲 **0.181〜0.228秒**だった。ただし Chrome 拡張の wllama 経路は計測していないため、現状より速いという比較結論や速度倍率は出せない。[Ollama Hardware support](https://docs.ollama.com/gpu)、後述の実機計測。

Ollama を追加する場合は、現行の PFML3 プロンプトを `/api/generate` の `raw: true` に渡す構成が小さい。PLaMo 配布元もアプリへの組み込みでは PFML3 を直接組み立てる方法を推奨している。[PLaMo公式モデルカード](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF)、[Generate API](https://docs.ollama.com/api/generate)。

## 公式資料から確認できること

| 項目                 | 確認結果                                                                                                                                                                                                                  | 一次資料                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Apple Silicon        | Ollama は Metal による Apple GPU 加速に対応。llama.cpp も Apple Silicon を ARM NEON、Accelerate、Metal で最適化している。                                                                                                 | [Ollama GPU](https://docs.ollama.com/gpu)、[llama.cpp](https://github.com/ggml-org/llama.cpp)                                |
| GGUF                 | `FROM /path/to/file.gguf` の Modelfile と `ollama create` で取り込める。GGUFの取り込み時に再量子化はしない。                                                                                                              | [Ollama Import](https://docs.ollama.com/import)                                                                              |
| PLaMoの形式          | PFN の GGUF は llama.cpp 向けに量子化された公式配布。Q4_K_M は推奨される既定候補。                                                                                                                                        | [モデルカード](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF)                                                       |
| アーキテクチャ互換性 | GGUFを読めることだけでは個別モデルの対応を保証しない。この端末では Ollama 0.40.15 が `family=plamo3`、`runner=llamacpp` の既存モデルを生成まで実行できた。古いOllamaや別のGGUFリビジョンへの保証にはならない。            | 後述の `/api/show`、生成、`/api/ps` の実測                                                                                   |
| プロンプト           | `raw: true` は追加テンプレートを適用しない。PFML3 のdatasetをtranslationにし、outputの末尾を `<\|plamo:msg\|>` とする。停止文字列は `<\|plamo:tag\|>` と `<\|plamo:bos\|>`。llama.cpp がBOSを付けるので手書きで重ねない。 | [Generate API](https://docs.ollama.com/api/generate)、[モデルカード](https://huggingface.co/pfnet/plamo-3-translate-2b-GGUF) |
| ストリーム           | `stream` の既定値はtrue。途中出力を表示すれば最初の表示を早められるが、生成完了そのものの高速化を保証しない。                                                                                                             | [Generate API](https://docs.ollama.com/api/generate)                                                                         |
| 常駐                 | `keep_alive` で要求後のモデル保持時間を指定できる。`0` は即時アンロード。常駐させると次回ロードを回避できるがメモリを使用する。                                                                                           | [Generate API](https://docs.ollama.com/api/generate)                                                                         |
| 計測                 | `load_duration`、`prompt_eval_duration`、`eval_duration`、`total_duration` はナノ秒。生成速度は `eval_count / eval_duration × 1e9`。                                                                                      | [Generate API](https://docs.ollama.com/api/generate)                                                                         |

## Chrome 拡張から接続する際の条件

現行 `wxt.config.ts` のhost permissionsはGitHubとHugging Faceだけなので、例えば `http://localhost/*` を追加する必要がある。`127.0.0.1` も利用するなら別のホストとして宣言する。ポート11434への送信先は実装で固定する。content script はホスト権限を持っていてもページ側の同一生成元制約を受けるため、接続は拡張のservice workerまたは拡張ページ側が担う。[Chrome network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)。

Ollama公式は、拡張のOriginを `OLLAMA_ORIGINS` に明示的に許可するよう案内している。全拡張を許可する `chrome-extension://*` より、対象の拡張IDのOriginだけに限定する。ホスト権限とサーバーのOrigin判定はそれぞれ確認する。実際の送出OriginやCORSの成否はChrome拡張から検証する必要があり、今回のPython計測では確認していない。[Ollama FAQ](https://docs.ollama.com/faq)。

Ollama は既定で127.0.0.1:11434にバインドする。拡張から接続するだけなら外部公開する必要はない。ローカルモデルの実行ではプロンプトはOllama社へ送られないが、拡張からローカルの別プロセスへ原文を渡す設計になるため、その条件は設定画面や説明に反映する。[Ollama FAQ](https://docs.ollama.com/faq)。

## 実機での参考計測

この計測の主張は「この端末の既存Ollamaモデルが、現在の拡張と同じ形式のPFML入力をGPUで翻訳でき、その短文の完了時間を確認した」に限定する。製品間の比較、性能の上限、長文やページ全体の所要時間は測っていない。

- 環境はmacOS arm64、CPUコア数14、Ollama 0.40.15。開始時load averagesは6.95 / 6.25 / 5.87。`sysctl` と `ps` はsandboxで拒否され、CPU型番と負荷の内訳は取得できなかった。共有端末のため負荷は制御していない。
- 既存モデルは `plamo3-translate-ja:latest`。`/api/show` ではparentが `hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M`、familyがplamo3、parameter_sizeが2.88B、量子化がQ4_K_M、runnerがllamacppだった。
- モデルdigestは `9e142ec824ba67c7c55c58d5e2f5f9058063872c1a12e6d9e1296881c78f8a89`。GGUFのblobは `2c288ecc7ebfe60c3561726580da3583767f3c41ca3ef5c6825bf6c4cc060787`。リモート配布の更新後に同じ内容とは限らない。
- Modelfileには `num_ctx 8192`、`repeat_penalty 1`、`temperature 0`、2つのstop文字列があった。今回の要求は `num_ctx 4096` を明示して上書きした。
- 現行 `features/translate/engine.ts` と同じ英語→日本語のPFML、temperature0、停止文字列2つ、最大生成2048を使用した。Ollamaでは追加で `raw: true`、`stream: true`、`keep_alive: "5m"` を指定。`num_thread` など他のランタイム条件は揃えていないため比較には利用できない。
- 計測前の `/api/ps` は空。初回ロード1回、異なる短文5回、最後の同文5回を直列実行した。モデルを停止・削除したり、サービス設定を変更したりしていない。OSのファイルキャッシュは消していないので、初回は完全なコールド起動ではない。
- 計測後 `ollama ps` は `100% GPU`、context4096、runner llamacpp。`/api/ps` ではsizeとsize_vramがともに1,624,778,997バイト。Metalの利用はApple GPU対応の公式仕様とGPU配置を併せた判断であり、GPUトレースは取得していない。
- 全11回がHTTP成功、非空の日本語、`done_reason=stop`。入力と訳文を目視確認し、時刻・施設・依頼内容が残ることを確認した。品質ベンチマークではない。

| 状態                 | 回数 | 完了までの中央値 |           範囲 | 最初の出力の中央値 | 出力tokens/sの中央値 |
| -------------------- | ---: | ---------------: | -------------: | -----------------: | -------------------: |
| 初回ロード           |    1 |          2.757秒 |           単発 |            2.611秒 |                 95.8 |
| ウォーム・異なる短文 |    5 |          0.192秒 | 0.181〜0.228秒 |            0.060秒 |                106.1 |
| ウォーム・同一短文   |    5 |          0.194秒 | 0.174〜0.204秒 |           0.0375秒 |                 95.5 |

初回のload_durationは2.542秒。異文のprompt_eval_cached_countは0、同文は全て27だった。各入力は31〜32トークン、出力は13〜15トークン。同文再利用で初回出力は早まっているが、文も出力長も異なる群なので生成全体の改善率は算出しない。ウォーム状態では生成部分が約0.116〜0.171秒で主な時間を占めるが、GPU内部の計算律速・メモリ律速は未特定。

再実行は `python3 scripts/bench-ollama-translation.py`。既存モデルだけを使い、NDJSONの最終応答のメトリクスを出力する。計時区間はHTTP送信からストリームの読み切りまでで、最初の非空response受信も別に記録する。assertで完了理由と日本語出力を確認する。モデルの追加ダウンロードは行わない。

### 入力と出力

入力は今回の計測用に作った公開可能な短文。ユーザーの翻訳履歴やブラウザ内の文章は利用していない。

| 試行  | 入力                                                                             | 出力                                                                   |
| ----- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 1     | The library opens at nine in the morning. Please return the books by Friday.     | 図書館は午前9時に開館します。本は金曜日までに返却してください。        |
| 2     | The museum opens at ten in the morning. Please buy your tickets at the entrance. | 博物館は午前10時に開館します。入口でチケットをご購入ください。         |
| 3     | The train leaves at eight in the morning. Please arrive at the station on time.  | 列車は午前8時に出発します。時間通りに駅にお越しください。              |
| 4     | The office opens at nine in the morning. Please bring your documents on Monday.  | 事務所は午前9時に開きます。月曜日に書類をお持ちください。              |
| 5     | The garden opens at seven in the morning. Please keep the paths clean.           | 庭園は午前7時に開園します。通路はきれいに保ってください。              |
| 6〜11 | The meeting starts at ten in the morning. Please read the report before Tuesday. | 会議は午前10時に始まります。火曜日までに報告書を読んでおいてください。 |

### 全試行の数値

時間は秒。cachedはprompt_eval_cached_count。evalはeval_count。

| 試行 |     wall |     TTFT |     load | prompt_eval | eval_duration | cached | eval |
| ---- | -------: | -------: | -------: | ----------: | ------------: | -----: | ---: |
| 1    | 2.756780 | 2.610720 | 2.542005 |    0.065211 |      0.146080 |      0 |   14 |
| 2    | 0.228225 | 0.070680 | 0.001125 |    0.064171 |      0.157430 |      0 |   15 |
| 3    | 0.180850 | 0.064869 | 0.000976 |    0.060253 |      0.115807 |      0 |   13 |
| 4    | 0.180615 | 0.060291 | 0.000674 |    0.055512 |      0.118812 |      0 |   13 |
| 5    | 0.192471 | 0.060183 | 0.000823 |    0.056133 |      0.131908 |      0 |   14 |
| 6    | 0.197862 | 0.054350 | 0.000827 |    0.049956 |      0.143324 |      0 |   15 |
| 7    | 0.174007 | 0.040508 | 0.000784 |    0.036369 |      0.133583 |     27 |   15 |
| 8    | 0.194132 | 0.034983 | 0.000882 |    0.030751 |      0.159206 |     27 |   15 |
| 9    | 0.204018 | 0.034942 | 0.000788 |    0.028627 |      0.171187 |     27 |   15 |
| 10   | 0.196783 | 0.039416 | 0.000811 |    0.035272 |      0.157148 |     27 |   15 |
| 11   | 0.189485 | 0.037500 | 0.000708 |    0.033975 |      0.151188 |     27 |   15 |

## 高速化を保証できない条件

Ollamaを使ってもGPU配置に失敗した場合、メモリ不足、他アプリのGPU負荷、モデルの頻繁な入れ替え、長い入力、長い生成、複数リクエストの待ちがあれば時間が延びる。keep_aliveもメモリ常駐を保証するものではない。今回の測定は直列の短文のみで、並列化の効果は未検証。[Ollama FAQ](https://docs.ollama.com/faq)。

現在のwllamaもWebGPUを要求し、失敗時にCPUへフォールバックする。現状がCPU処理ならネイティブGPUへ移す効果を期待できるが、すでにWebGPUで動いている場合の差は同条件の測定が必要。これは既存コードからの仮説であり、今回の比較結果ではない。

採用判断には、Chromeから同じ入力を送った場合の完了時間、最初の表示時間、キャンセル、サービス停止時の案内、長文での完了率を確認する。wllamaと比較する際は同じGGUFのハッシュ・入力・ctx・生成上限・GPU配置を確認し、異文と同文キャッシュを分け、両経路を交互に測る必要がある。

リポジトリの説明と現在のコードについて、この調査範囲で不整合は見つからなかった。将来Ollamaを追加する場合、READMEの「翻訳する文章は外部に送信しません」はローカルサーバーへ渡す条件を明示する必要がある。
