# 翻訳エンジンのWASM最適化

追記。実験的な「2B＋0.8B補助」は削除した。専用の`0006-enable-draft-speculation.patch`も削除し、現在の配布物は以下の3パッチで作成したWASMに戻している。[追加実装時の記録](translation-additional-implementation.md)は過去の検証記録として残す。

2026-11-10。Sakuttoの最適化を、現在のwllama 3.13.0とllama.cppへ移植した。翻訳モデル、プロンプト、GPUの2枠と合計8192トークン、CPUの1枠と4096トークンは変更していない。

## 取り入れた変更

参照元は [Sakuttoの高速化コミット](https://github.com/jammaru/sakutto/commit/972ff46e4a51ac4533ec4d9e0ecd8b54e9065f14)。現在のソースへ適用できるパッチを [scripts/wllama/patches](../../scripts/wllama/patches/) に保存する。

| パッチ                                | 変更と狙い                                                                                                                                                                                                                                            |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0003-wasm-simd-cpu-kernels.patch`    | Emscriptenのprocessor設定を `wasm32` にし、ggmlのWASM SIMDカーネルをビルドする。通常版・互換版とも、対象のobjectが生成されたことをビルド時に確認する。                                                                                                |
| `0004-webgpu-reuse-bind-groups.patch` | GPUのbind groupを再利用し、演算パラメーターをまとめて転送する。幅の広い平面行列を4列ずつのvector shaderで処理する。現行版のscratch割当は4行を上限としていたため、この経路では全行分を確保する変更も含める。バッファの解放時にはキャッシュを破棄する。 |
| `0005-disable-prompt-cache.patch`     | 翻訳で再利用しない推論状態のRAM保存とコンテキストのチェックポイントを停止する。`cache_prompt: false` の処理が終わったら、その要求のKVセルも解放する。訳文を保持する既存の結果キャッシュとは別の処理。                                                 |

上流の同期処理を全面削除する変更は移植しない。通常の出力読み取りはGPUの完了を待つが、prefill中のキャンセルなど出力を読み取らない経路も `llama_synchronize()` を使うため、その契約を維持する。16枠化とGPUアダプターの別修正も今回の対象に含めない。

## ビルドと配布

固定値は [pins.ts](../../scripts/wllama/pins.ts) に集約する。

- wllama 3.13.0、`6647c1ea3837b2f0205a300c3bf5ff644aaa06bf`。
- llama.cpp、`7d7f0287530bc8981690f361d8c1627dbae1c99a`。
- Emscripten 4.0.20とDawn `v20260317.182325`。DawnアーカイブはSHA-256を固定し、使用したDockerイメージのdigestも記録する。

Dockerを起動し、リポジトリのルートで次を実行する。

```sh
bun run build:wasm
bun run check
```

`build:wasm` は一時ディレクトリへ固定ソースを取得し、パッチを検査・適用する。通常版はmemory64とJSPI、互換版はmemory32とAsyncifyを使う。生成されたJSとWASMを対にして `vendor/wllama/` へ保存し、ソース版・ツール版・パッチ・ビルド手順・4成果物のハッシュを `build.json` に記録する。

SDKはnpmの3.13.0を維持する。[translation-runtime.ts](../../scripts/translation-runtime.ts) は、この生成JSから既存と同じ静的workerを作り、対応するWASMを同梱する。MV3のCSP、通常版と互換版の切替、モデルの端末保存は従来の方式を保つ。ハッシュやnative版が異なる組はビルド時に拒否する。配布するWASMも `check:bundle` で元の記録と照合する。

## 実機検証

CPUの0.8B・短文2件では処理時間を短縮できた。GPUの2B・12段落では、ばらつきを超える差を確認できなかった。この条件でSakuttoの公開値と同じ倍率が出るとは判断しない。

Chrome 154、Apple GPU `metal-3`、論理14コアのMacで測定した。モデルは2B・0.8BともPLaMo 3 Translate Q4_K_M。2Bは既存OllamaのGGUF、0.8BはHugging Faceの公開GGUFを使い、各モデルのバイト数とSHA-256を [実行結果](translation-wasm-results.json) に保存した。

比較対象は `8dea764` の配布WASMと今回の配布WASM。ロード後に同じ短文でウォームアップし、ロード・モデル取得・ウォームアップを計測から除外した。旧版、新版の順に交互に5回ずつ実行した。原文、PFMLプロンプト、生成上限2048、temperature 0、`cache_prompt: false`、スレッド数4を揃え、生成終了と `cached_tokens: 0` を確認した。計測のため最終ストリームにusageを含める設定を両方へ追加している。

| 対象                                          | 旧版の中央値・範囲         | 最適化版の中央値・範囲     | 判定                                                              |
| --------------------------------------------- | -------------------------- | -------------------------- | ----------------------------------------------------------------- |
| CPU・0.8B・2文を直列生成                      | 936.9ms、920.7〜956.3ms    | 696.9ms、688.6〜722.1ms    | 約25.6%短縮。各5回で訳文はすべて一致。                            |
| GPU・2B・12段落を最初1件、以後最大2件ずつ生成 | 5855.5ms、4930.1〜6236.3ms | 5967.1ms、4899.6〜6226.8ms | 変動幅が重なり、明確な改善を判定しない。各5回で訳文はすべて一致。 |

CPU比較は合計20件、GPU比較は合計120件で、失敗は0件。段落ごとのnative timings、出力トークン数、全文を実行結果に含める。GPU比較では最初の文字が出るまでの時間も記録した。これは推論処理の比較であり、実ページの通信・DOM更新まで含む所要時間ではない。

CPUの別プロファイルでは、`ggml_vec_dot_q4_K_q8_K` と `ggml_vec_dot_q6_K_q8_K` が主な処理だった。どちらも今回のSIMDカーネルが変更する内積計算にあたる。プロファイルは時間比較と別に取得し、関数別サンプルの集計を実行結果に保存した。スレッドごとの集計なので、その値の合計をページの経過時間としては扱わない。GPUカーネル単位の帯域や処理上限は特定していない。

通常版・互換版それぞれで、2Bと0.8BのGPU・CPU実行を確認した。GPUでは生成中の1件を取り消しても、もう1件と後続の翻訳が完了した。0.8Bでは、最初の文字が届く前の取消と、その後の翻訳も4モードすべてで成功した。これらの訳文と終了状態も実行結果に含める。

配布engineでも途中表示・キャッシュ再利用・取消後の再実行を確認した。現在のページ翻訳controllerと接続した12段落の表示、やさしい日本語への翻訳、WebGPU APIを使えない状態でモデルを0.8Bへ切り替えた後のCPU翻訳も成功した。この接続はbackgroundとoffscreen間のメッセージ処理を通していない。

測定は専用のMV3拡張で行い、[ブラウザ内の検証コード](translation-wasm-benchmark.js) を保存した。再実行時は、`baseline/vendor/` に `8dea764` の配布vendor、`optimized/vendor/` とルートの `vendor/` に現在の配布vendorを置く。`baseline/wllama.js` は `buildTranslationRuntime().moduleCode` で生成した同じ3.13.0のSDKを使う。COOP・COEPとMV3のCSPを有効にし、モデルをlocalhostの `/model.gguf` と `/model-0.8b.gguf` から配信する。コード中のポートは8768。`prepare()`、`compare()` が2BのGPU比較、`prepareSmall()`、`compareCpu()` が0.8BのCPU比較に対応する。

Apple以外のGPU、長時間の連続実行、ページ全体の所要時間の比較は未検証。GPUの大幅な高速化や、CPUの短縮率が別の入力・モデルでも続くことは保証しない。判断の履歴は [意思決定ログ](translation-wasm-decisions.tsv) に記録する。
