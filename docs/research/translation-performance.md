# PLaMo翻訳の高速化調査

## WASM本体への反映

設定・投入順の変更に続き、SIMDカーネルの有効化、GPUのbind group再利用とパラメーターの一括転送、行列演算の変更、不要な推論状態の保存停止を独自WASMへ反映した。ビルド方法と検証結果は [WASM最適化の記録](translation-wasm-performance.md) を参照する。

## 2026-11-10の設定・投入順への反映

以下は `8dea764` 時点の記録。独自WASMが未移植という記述は、この段階の状態を示す。

Sakuttoの[全文Attentionキャッシュ設定の変更 #25](https://github.com/jammaru/sakutto/commit/d08e56afe159d793504ea806097228fe3773ac76)と、[GPU翻訳のバッチ化 #27](https://github.com/jammaru/sakutto/commit/972ff46e4a51ac4533ec4d9e0ecd8b54e9065f14)を参照し、次を取り入れた。

- `swa_full: true` を指定する。Attentionのキャッシュを全体分確保する設定で、モデルの入力上限を拡張するものではない。
- GPUでは `cont_batching: true` を明示し、モデルのロード後は最初の1件を終えてから最大2件ずつまとめて開始する。その組がすべて完了するまで次の文章を投入しない。
- ページ側は実行2件と次の2件を合わせて最大4段落を先読みする。従来の2段落では、翻訳結果がページへ届く前に次の1件が始まり、その後も1件ずつになる状態を再現した。送信5ms・結果返却10msの結合テストで、最初の1件の後に2件ずつ開始できることを確認する。この模擬時間は速度測定には使わない。
- 待機中にキャンセルされた要求をキューから取り除く。実行中の要求は処理を終えるまで枠を保持し、別モデルのロードと推論が重ならないようにする。

GPUの2枠・合計8192トークン、CPUの1枠・4096トークン、モデル、スレッド数は従来どおり。独自WASMを前提とする16枠化、SIMDカーネル、bind groupの再利用、C++側のキャッシュ解放、[#49のGPUアダプター修正](https://github.com/jammaru/sakutto/commit/56eb8be9798c76d68a60d794c485776fd318822c)は移植していない。設定の追加だけで上流と同じ高速化を得られるとは判断しない。`swa_full` はメモリ使用量を増やす場合があり、処理時間の異なる段落をまとめると、短い段落が終わっても長い段落の完了を待つ。

実機確認にはChrome 154、Apple GPUの `metal-3`、既存のPLaMo 2B Q4_K_Mを使った。検証用MV3拡張で配布ビルドのengineを動かし、最初の1件の完了後に次の2件が開始すること、訳文の一致、途中表示、キャッシュ再利用、片方のキャンセルと残った翻訳の完了を確認した。現在のcontent controllerと同じengineを接続した12段落でも、全段落に日本語訳が表示された。検証用の接続はbackgroundとoffscreen間のメッセージ処理を通していない。実ページ全体の所要時間の比較、0.8B、Apple以外のGPUは未検証で、速度倍率は示さない。

途中表示・画面内優先・メモリキャッシュ・Ollama接続・GPUの2並列は、この更新より前に実装済み。以下は `d80a726` を対象にした2026-11-09の調査記録であり、直列実行や未実装という記述は当時の状態を示す。現在の動作は [README](../../README.md#plamo翻訳) を参照する。

## 2026-11-09の調査記録

調査日 2026-11-09。目的は、翻訳の待ち時間を減らすためにSakuttoから取り入れる処理と、Ollamaを使う価値を判断すること。

このリポジトリは `d80a726a213e62f590072f580556da597a819882`、Sakuttoは [`03c66876d1c692aa848ea6ce9feaa22f9001be8d`](https://github.com/jammaru/sakutto/tree/03c66876d1c692aa848ea6ce9feaa22f9001be8d) を確認した。実装変更は行っていない。

## 推奨する順序

まず生成途中の訳文表示と、画面内の文章を優先する処理を取り入れる。再翻訳には結果キャッシュを使う。同時に、2Bの品質を保って生成速度を上げたい場合の候補としてOllamaを比較する。GPU並列化とwllamaの独自ビルドは、その後に判断する。

これはコードの比較に基づく推奨であり、この拡張の支配的なボトルネックを実測で特定した結果ではない。途中表示と優先順位の変更は、全文の完了時間を短くしなくても、今読んでいる文章の待ち時間を減らせる。

すぐに試せる設定は、拡張の設定画面で2Bから0.8Bへ変更すること。Sakuttoの既定も0.8Bだが、翻訳品質の同等性や、このMacでの速度差は未検証。2Bを維持したい場合には変更不要。

## 現状は生成と表示の両方で待つ

処理は `content → background → offscreen → engine → 完成結果 → content` の順に進む。サイドパネルと選択翻訳も同じengineを使う。

| 確認できた事実                                                                                          | 待ち時間への影響                                                                            |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| [settings.ts](../../features/translate/settings.ts) は未設定時に2Bを選ぶ。                              | Sakuttoの既定0.8Bとの比較ではモデル差が混ざる。                                             |
| [content.ts](../../features/translate/content.ts) は記事全体の候補をMapに入れ、挿入順で処理する。       | ページ途中で開始すると、見えていない上側の文章を先に処理する。                              |
| 同ファイルの `translate` は1200文字以下のchunkを順番に送り、全chunkの結果を結合する。                   | 長い段落では最後のchunkが終わるまで訳文を表示できない。                                     |
| [engine.ts](../../features/translate/engine.ts) は `stream: true` だが、`onData` は文字列に貯めるだけ。 | 生成済みの文字があっても、ユーザーは完成まで待つ。                                          |
| engineの共通Promiseキューと `n_parallel: 1` が全要求を直列化する。                                      | ページ翻訳中の選択翻訳なども待つ。呼出元だけを `Promise.all` にしても推論は並列にならない。 |

すでに、ロード済みモデルの再利用、WebGPUの利用、GPU失敗時のCPU実行、同じDOM要素・本文の二重処理防止、キャンセル処理がある。[engine.ts](../../features/translate/engine.ts)、[content.ts](../../features/translate/content.ts)、[offscreen/main.ts](../../entrypoints/offscreen/main.ts) で確認した。これらを未実装の改善策として追加しない。

## Sakuttoから取り入れられる処理

| 優先 | Sakuttoの実装                                                                                                                                                                                                                                                                                                    | この拡張への取り入れ方                                                                           | 効果と制約                                                                                                                     |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| 1    | [途中の文字を通知](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/in-browser/engine.ts)し、[画面の更新をフレームごとにまとめる](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/dom/session.ts)。                              | engineの生成文字をoffscreenとbackground経由で、要求ID付きで該当する表示へ送る。                  | 最初の訳文が出るまでの待ちを短くする。生成速度自体は変えない。キャンセル後の文字と、別要求の文字を混ぜない必要がある。         |
| 2    | [選択・本文・画面内の優先順位](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/dom/priority.ts)と、[IntersectionObserverによる再整列](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/dom/session.ts)。                                | 直列推論を維持したまま、次の段落を画面内から選ぶ。選択翻訳を共通キューで優先する。               | 読んでいる位置の待ちを減らす。スクロールを反映し、処理中の段落を毎回中断しない。                                               |
| 3    | [結果キャッシュと重複文章の集約](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/cache/caching-engine.ts)。[IndexedDBに保存](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/cache/store.ts)。                           | まず上限付きメモリキャッシュで、同じ原文・モデル・翻訳種別・プロンプト版の成功結果を再利用する。 | 同じ文章の推論を省く。初めて読む文章には効かない。永続化する場合は、訳文を再読み込みで破棄する現在の仕様を変更することになる。 |
| 4    | [GPUを通常4枠、条件付きで16枠にする](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/in-browser/backend.ts)。[最初は1件、その後は波ごとに開始する](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/queue/scheduler.ts)。 | SDK対応を確認し、少数の枠からGPU実機で比較する。共通キューと要求の識別も変更する。               | 全文の処理量を増やす候補。Apple GPUに16枠をそのまま適用する根拠はない。CPUは1枠を維持する。                                    |
| 5    | [短い文章をまとめる](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/text/plan.ts)、[swa_full等のロード設定](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/in-browser/runtime.ts)、wllama本体の修正。                  | まずオプション単独の効果を測る。独自WASMビルドは最後に検討する。                                 | 小さい要求の負担や入力処理を減らす候補。複数段落の改行対応が崩れた場合は個別に再翻訳する仕組みが必要。                         |

Sakuttoの[モデル定義](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/model/catalog.ts)は、この拡張と同じPLaMo 3 Translateの0.8B・2B、Q4_K_Mを使う。高速化の比較ではモデルを揃える必要がある。16枠の許可は、[NVIDIAと整数演算機能の両方を確認した場合](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/shared/capabilities.ts)に限る。

並列化では、各枠が使えるコンテキスト長も確認する。Sakuttoは `n_ctx` を枠数で割り、[1枠あたりの上限としてengineに渡す](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/src/engine/in-browser/lazy-engine.ts)。この拡張の1200文字chunkと最大2048出力トークンを保ったまま、並列数だけを増やす変更は避ける。

### 設定値だけではSakuttoと同じにならない

Sakuttoは[固定したwllama・llama.cpp](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/scripts/wllama/pins.ts)へ、次の変更を適用してビルドしている。

- [WASMのSIMDカーネルを有効にするビルド修正](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/scripts/wllama/patches/0003-wasm-simd-cpu-kernels.patch)。
- [WebGPU bind groupの再利用と、複数列の演算処理の修正](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/scripts/wllama/patches/0004-webgpu-reuse-bind-groups.patch)。
- [推論状態のGPUからの読み戻しと、不要になったKVセルの保持を抑える修正](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/scripts/wllama/patches/0005-disable-prompt-cache.patch)。

この拡張の [translation-runtime.ts](../../scripts/translation-runtime.ts) はnpmのwllama 3.13.0をMV3向けに加工し、配布済みWASMを同梱する。SakuttoのC++修正を含むかどうかは、設定の有無だけでは判断できない。また、現状にも `cache_idle_slots: false` がある。結果キャッシュ、プロンプトの再利用、モデル内部状態の保存は別の処理として扱う。

Sakuttoの[公開ベンチマーク](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/bench/results/pages/pr27-webgpu-review.md)には、同じページと機械でのWebGPU改善結果がある。ただし、このMacやこの拡張を測った数字ではないため、速度倍率の予測には使わない。[ベンチマークの説明](https://github.com/jammaru/sakutto/blob/03c66876d1c692aa848ea6ce9feaa22f9001be8d/bench/README.md)も、モックの数字を翻訳速度と扱わないよう明記している。

## Ollamaは2Bを維持したい場合の比較候補

調査時、このMacではOllama 0.40.15とローカルAPIの稼働を確認した。`/api/tags` にPLaMo 2B Q4_K_Mがすでにあり、新しいモデルのダウンロードは不要だった。公式資料と実機での翻訳結果・計測条件は [Ollama調査](ollama-translation-performance.md) に記載する。

| 案                                      | 利点                                                                | 負担・未確定事項                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| ブラウザ内のwllamaを改善                | 別アプリの起動が不要。既存の配布方法を維持できる。                  | GPUの対応状況とWASMの実装に依存する。独自ビルドを採ると保守が増える。                            |
| 同じMacのOllamaへ接続                   | ブラウザ外のネイティブ推論とMetalを比較できる。既存モデルを使える。 | ローカルサービスが必要。この拡張との同条件比較が済むまで、高速化の倍率は不明。                   |
| llama.cppのネイティブサーバーへ直接接続 | 推論設定とバックエンドを直接制御できる。                            | 別途運用が必要。まず既存Ollamaで検証するほうが作業が少ない。今回はこちらの実機検証をしていない。 |

Ollamaへの接続だけでは、画面外から順番に訳す処理や、完成まで表示しない処理は変わらない。途中表示と優先順位は、推論先にかかわらず改善対象になる。

## 次の実装を判断するための測り方

1. 固定した英語記事で、最初の訳文表示、画面内の翻訳完了、全文の翻訳完了をそれぞれ記録する。
2. 初回ダウンロード、モデルロード、ロード済みの翻訳を別々に測る。実際にGPUへ載ったかも記録する。
3. wllamaとOllamaを同じ2B Q4_K_M、入力、PFMLプロンプト、終了条件で比較する。Ollama側の同文再利用だけを有利にしない。
4. 各条件を交互に最低5回実行し、中央値・範囲・失敗数と訳文を残す。途中で切れた翻訳を成功に数えない。
5. 途中表示・画面内優先を個別に適用して比較する。GPU並列化はその後に少数枠で検証する。

「Explain the Number」の原則を適用し、コードから予想した改善と実測した速度を分けた。現時点では、ブラウザ内推論とOllamaのどちらが何倍速いかは未判定。

## ドキュメントとコードの整合性

確認したREADMEの2B既定、モデルの端末保存、GPUからCPUへのフォールバック、訳文をページ内だけに保持する仕様は、コードと一致していた。今回の対象範囲で明確な不整合は見つからなかった。永続キャッシュやOllama接続を実装する場合は、保存範囲とブラウザ内推論の説明を更新する必要がある。
