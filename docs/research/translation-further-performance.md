# PLaMoのブラウザ内翻訳をさらに高速化するための調査

2026-11-10。PLaMoをブラウザ内で実行する条件を維持し、次に検証する高速化策を選ぶための調査である。現行コードの基準は `08a37fc2e0c743ddc1c4a899c69f835cc77b7da0`。

この調査後の実装と比較結果は、[翻訳要求の長さを揃える変更と実機測定](translation-browser-performance.md)に記録した。以下は実装前の調査であり、候補の採否は実測記録を参照する。

最初に試す案はGPUの4枠化と段階的な起動、短いラベルの結合である。生成そのものを速くする案としては量子化形式とGPUカーネルの組合せ、GPU内での次トークン選択、2B向けの投機的デコードを検証候補とする。効果の順位は未測定であり、この順序は変更範囲と実現条件からの提案である。

1. 現行版はすでに0.8Bを既定とし、分割片の並列処理、同文の推論共有、結果キャッシュを備える。これらを追加の高速化として数えない。
2. Sakuttoから参考にできるのは、GPUに応じた枠数の選択、段階起動、短文結合と失敗時の復旧を組み合わせた設計である。16枠という設定値だけを移さない。
3. 0.8Bと2Bの公式tokenizer関連ファイルは一致する。wllamaにも補助モデル用の設定があるため、投機的デコードは互換性の確認から実装経路の検証へ進められる。
4. 以前候補に挙がった上流のWebGPU最適化には、固定版llama.cppに含まれるものがある。バージョン更新や同じパッチの再適用を高速化策とは扱わない。

[前回の調査](translation-next-performance.md)の実装反映欄を引き継ぎ、本文に残る実装前の記述は現在のコードと照合した。今回は製品コードを変更せず、新しい速度測定も行っていない。

## 待ち時間と処理量を分けて評価する

利用者が読むまでの時間と、ページ全体の翻訳完了時間では、有利な設定が異なる。まず操作から最初の訳文、最初の段落完成、画面内の翻訳完了までを測る。全ページの完了時間と生成速度も併記する。

```mermaid
flowchart LR
    A[翻訳操作] --> B[本文抽出と分割]
    B --> C[結果キャッシュと同文共有]
    C --> D[優先度付き待ち行列]
    D --> E[モデル準備]
    E --> F[入力の処理]
    F --> G[訳文の生成]
    G --> H[拡張内通信とDOM更新]
    H --> I[画面内の訳文完成]
```

図は一つの要求の経路を表す。モデル準備はロード済みなら省かれ、結果キャッシュにヒットすれば推論も省かれる。複数段落では処理が重なるため、各段階の時間を全件分足してもページの経過時間にはならない。[engine.ts](../../features/translate/engine.ts)、[background.ts](../../features/translate/background.ts)、[offscreen/main.ts](../../entrypoints/offscreen/main.ts)。

LLMは入力をまとめて処理するprefillの後、訳文をトークン単位で生成するdecodeへ進む。通常の自己回帰生成では、次のトークンがそれまでの出力に依存する。並列要求を増やすと処理量が増える可能性はあるが、一文の生成時間も短くなるとは限らない。[投機的デコードの原論文](https://arxiv.org/abs/2211.17192)。

前回のWASM比較では、CPUの短文処理は短縮した一方、GPUの2B・12段落では改善と判定できなかった。対象端末、入力、反復数、ばらつきは[既存の実測記録](translation-wasm-performance.md#実機検証)を参照する。この結果は新候補の効果を示さず、カーネルを変更しても利用時の待ち時間が短くなるとは限らないことを示す。

## 現行版にある処理

| 対象   | 現在の動作                                                                | 次の調査での扱い                                         |
| ------ | ------------------------------------------------------------------------- | -------------------------------------------------------- |
| モデル | 既定0.8B、2Bも選択可能。ともにQ4_K_M                                      | 0.8Bへの変更を新規案にしない。モデルごとに設定を比較する |
| GPU    | 2枠、合計context 8192、全層GPU配置を要求                                  | 4枠化を比較する。実際の配置と要求ごとの容量を確認する    |
| CPU    | 1枠、context 4096、最大4スレッド                                          | スレッド数と入力バッチを別々に比較する                   |
| キュー | モデル未ロード時は1件、GPUロード後は最大2件の組で実行。組の全件終了を待つ | 短文だけ先に終了したときの空き枠を測る                   |
| 再利用 | 推論前の結果キャッシュ確認と同文の実行中要求の共有                        | 初めて読む異なる文章の高速化と分ける                     |

長段落は最大2片を並列処理し、原文順に表示する。途中通知は60ms間隔に制限する。WASM SIMD、WebGPUのbind group再利用、不要な推論状態保存の停止も移植済みである。[README](../../README.md#plamo翻訳)、[engine.ts](../../features/translate/engine.ts)、[scheduler.ts](../../features/translate/scheduler.ts)、[WASM最適化](translation-wasm-performance.md)。

## Sakuttoから取り入れる設計

### GPU枠数と段階起動

Sakuttoの公開ソースでは、通常のGPUは4枠、対応するNVIDIAの整数内積経路は16枠とする。各枠のcontextは1024である。[backend設定](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/in-browser/backend.ts)。待機状態からの開始時は1件、次は最大4件、その後は最大枠数まで増やす。idleになると段階をリセットする。[scheduler](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/queue/scheduler.ts)。本拡張はGPUロード済みなら直ちに最大2件を開始し、この段階リセットは持たない。

本拡張ではまず2枠と4枠を比較する案を推す。現在の非unified設定で合計8192を4枠に分けると、各枠は2048になる。生成上限の2048だけで容量を使い切り、入力分が残らない。現在と同じ4096/枠を保つ比較は合計16384にし、メモリ増加を測る。画面内の段落と選択翻訳を優先する動作も維持する。

次に、短い要求が終わったら新しい要求を補充する方式を比較する。現在は `cont_batching: true` でも、アプリ側のwaveが全件終了を待つ。補充時のprefillが進行中のdecodeを遅らせる可能性があるため、常時補充を既定とは決めない。似た長さの段落を組にする案も比較対象にする。[scheduler.ts](../../features/translate/scheduler.ts)。

### 短文の結合とDOMへの対応

短いラベルを一つずつ訳すと、短い訳文ごとに固定プロンプトの処理を繰り返す。Sakuttoは短い入力を限定して結合し、出力の行と元の要素が対応しないときは個別翻訳へ戻す。[入力計画](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/text/plan.ts)、[ブラウザ推論](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/in-browser/engine.ts)。

提案は先頭の段落、見出し、選択翻訳を単独で処理し、短いラベルだけを小さくまとめることだ。Sakuttoは各48推定トークン以下、合計160以下、最大8項目を上限とする。これは参照元の値であり、本拡張でも最適とは決めない。まず結合数と推定トークン数を制限する。訳文の行数、空行、数字、リンクの対応を検査し、対応が確定しない組は全件を個別に訳し直す。行数が一致しても意味の対応は別に評価する。先頭だけ正しいと仮定して残すと、別の要素に訳文を表示するおそれがある。

短文結合はモデルへの入力を変えるため、訳文も変わり得る。一方、独立した要求をGPUで同時処理するバッチは、原文の区切りを維持できる。この二つを同じ実験に混ぜない。

置換表示はTextノードごとに要求を作るため、段落内のリンクや強調の前後が別々の入力になる。二段表示との差を要求数で確認し、必要なら一つの文章として訳す範囲を調整する。元のDOMへの対応と原文復元は維持する。[content.ts](../../features/translate/content.ts)。

### スクロール後の優先度と長さによる組み合わせ

Firefoxの翻訳実装はスクロール後の優先度更新と、待たされ続ける処理を進める制御を持つ。[公式ソース](https://github.com/mozilla-firefox/firefox/blob/7d1680b9a0d4a02087c52c3a9f050e88df389eae/toolkit/components/translations/content/translations-document.sys.mjs)。本拡張も次の段落を選ぶ際に画面内を優先するが、投入済みの待機要求をスクロール時に並べ直す仕組みは別に検討できる。選択翻訳と画面内を優先しつつ、古い要求が待ち続けない条件を設ける案である。

旧Bergamotはトークン長の近い文をまとめてバッチを作る。[長さ別のバッチ処理](https://github.com/mozilla/bergamot-translator/blob/5ae1b1ebb3fa9a3eabed8a64ca6798154bd486eb/src/translator/batching_pool.cpp)。PLaMoでも、同じ優先度の範囲で長さの近い入力をwaveへ組み合わせる案は試せる。長さをそろえるために短い要求を待たせすぎないよう、待機上限も比較する。

### キャッシュの使い分け

結果キャッシュ、同文の推論共有、共通プロンプトのKV再利用は別の処理である。前二つは実装済みだが、初めて読む異なる文章のdecodeは省略できない。

共通prefixのKV再利用はCPUの1枠から検証する案とする。現在の独自パッチは再利用しない推論状態の保存を停止し、`cache_prompt: false` の要求終了時にKVを解放する。複数枠でキャッシュを有効にするには、再利用するprefix、枠への割当、保存・復元のコストを含めて設計する必要がある。[patch 0005](../../scripts/wllama/patches/0005-disable-prompt-cache.patch)、[Sakutto backend](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/in-browser/backend.ts)。

本文と訳文の永続キャッシュは、再訪時には役立つ候補である。ただし、現在の「本文や訳文をストレージへ保存しない」という方針が変わる。初回翻訳の改善とは別に判断する。[保存方針](../../README.md#plamo翻訳)。

## 他の拡張とランタイムから参考にする範囲

| 参照対象                       | 参考にする処理                                         | PLaMoを維持するための条件                                     |
| ------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------- |
| Firefox Translations・Bergamot | 文章分割、長さを考慮したバッチ、訳文の表示対象との対応 | 翻訳モデルは置き換えず、入力と表示の設計だけを参考にする      |
| Immersive Translate            | 本文選択、除外規則、まとめる文章量の調整               | クラウドAPI向け送信制御を、そのままGPU並列数の根拠にしない    |
| CTranslate2                    | 長さによるバッチ、量子化と実行環境の組合せ             | ネイティブ向けエンジンへの移行は今回の条件に含めない          |
| WebLLM・MLC                    | WebGPU向けのモデルコンパイルとカーネル最適化           | PLaMoの構造、重み変換、tokenizer、PFML、SWAの対応が必要       |
| ONNX Runtime Web               | WebGPU上でのグラフ実行                                 | PLaMoの変換と演算対応、KV更新、生成ループを検証する必要がある |

参照は[Firefoxの翻訳実装資料](https://firefox-source-docs.mozilla.org/toolkit/components/translations/resources/03_bergamot.html)、[Bergamot](https://github.com/browsermt/bergamot-translator)、[Immersive Translate詳細設定](https://immersivetranslate.com/docs/advanced/)。量子化やランタイムの資料は[CTranslate2性能設定](https://opennmt.net/CTranslate2/performance.html)、[WebLLM](https://github.com/mlc-ai/web-llm)、[ONNX Runtime WebGPU](https://onnxruntime.ai/docs/tutorials/web/ep-webgpu.html)。他モデルでの実績だけを理由にPLaMoの移行先には選ばない。Chrome Translator APIも使用モデルをPLaMoに固定する経路としては採用しない。[Translator API](https://developer.chrome.com/docs/ai/translator-api)。

## モデル構造と推論基盤の検討

### GQAとSWAはすでにモデルに組み込まれている

| 構造                     | PLaMo 0.8B  | PLaMo 2B    | 高速化を考える際の意味                         |
| ------------------------ | ----------- | ----------- | ---------------------------------------------- |
| 層数                     | 16          | 24          | 層の削除はモデルの計算を変える                 |
| Query・KVヘッド          | 16・1       | 24・4       | 0.8BはMQA、2BはGQAを採用済み                   |
| Sliding Window Attention | window 2048 | window 2048 | 局所attentionとglobal attentionを併用する      |
| 語彙数                   | 107520      | 107520      | 出力射影と次トークン選択の処理も調査対象になる |
| 入出力の埋め込み共有     | なし        | なし        | tokenizerが同じでも重みは別である              |

出典は公式の[0.8B config](https://huggingface.co/pfnet/plamo-3-translate-0.8b/blob/8b4d42855622093e610ba9b90c2d2b59f8d5c15d/config.json)と[2B config](https://huggingface.co/pfnet/plamo-3-translate-2b/blob/cf66d22fbe6202c56b8e5d283691aa1da53d05af/config.json)。MQAとGQAは、attentionで保存するKey・Valueを複数のQueryヘッドで共有する方式である。拡張の設定だけで共有数を増やしたり、層を省いたりすると、配布モデルと同じ計算にはならない。

現行の `swa_full: true` はKVキャッシュの確保方法に関わる。これを変える案はメモリ節約の候補として比較する。モデルが参照すべき範囲やglobal attentionを変更する案と区別し、長文とキャンセル後の継続を検証する。

### 量子化はファイルサイズとカーネルを組で選ぶ

Q4_K_MからQ4_0、Q3_K_Mなどへの変更は重みの転送量を減らす候補である。復元処理や行列演算の実装が異なるため、より低いビット数が必ず速いとは言えない。量子化は計算精度も変えるので、同じモデルサイズで訳抜け、数字、否定、固有名詞の品質を比較する。[llama.cppの量子化資料](https://github.com/ggml-org/llama.cpp/blob/master/tools/quantize/README.md)。

特にQ4_K_Mには、すべて同じ形式のテンソルが入るわけではない。実際のテンソル形式と、decodeの行列ベクトル積、prefillの行列積に選ばれるカーネルを対応づける。ファイル名だけを比較軸にしない。

上流の[k-quantsのprefill最適化 #24225](https://github.com/ggml-org/llama.cpp/pull/24225)と[MMVQの量子化形式の追加 #29483](https://github.com/ggml-org/llama.cpp/pull/29483)は、現行で固定したllama.cpp commitに含まれる。これらの再移植は候補から外す。追加変更は、固定版との差分があり、PLaMoの実際の演算経路へ到達するものに絞る。[固定値](../../scripts/wllama/pins.ts)。

### FlashAttentionとKV量子化

FlashAttentionはattentionのメモリ読み書きを減らす手法である。PLaMoの短い翻訳で全体の時間が短縮するかは、attentionが占める割合による。[原論文](https://arxiv.org/abs/2205.14135)。

wllama 3.13.0には `flash_attn`、`cache_type_k`、`cache_type_v`、`n_batch`、`n_ubatch` がある。ただし `flash_attn: true` は自動選択を意味するため、指定だけで有効化を確認したことにはならない。起動ログと実行カーネルを記録する。[固定版の型定義](https://github.com/ngxson/wllama/blob/6647c1ea3837b2f0205a300c3bf5ff644aaa06bf/src/types/types.ts)。

入力処理が長ければ `n_batch` と `n_ubatch` を比較する。KV容量が制約なら、まずcontext容量とSWAの確保方法を確認し、その後にKV量子化を比較する。KV量子化にも品質差と未対応経路があり、メモリ削減と高速化は別々に判定する。

現在の入力分割は最大1200文字を基準とし、正確なトークン数を使っていない。トークン数による分割なら入力と出力の容量を管理しやすいが、固定版Wllamaの公開クラスにはtokenize APIが見当たらない。まず既存completionのusageとtimingsで入力長の分布を調べ、境界APIの追加が必要か判断する。古いwllamaのAPIがそのまま使えるとは扱わない。[現行の分割処理](../../features/translate/content.ts)、[固定版Wllama](https://github.com/ngxson/wllama/blob/6647c1ea3837b2f0205a300c3bf5ff644aaa06bf/src/wllama.ts)。

### GPU内で次トークンを選ぶ

通常の生成では語彙ごとのスコアから次のトークンを選ぶ。GPUでスコアを計算してCPU側へ読み戻す経路が時間を使っているなら、GPU内での選択が候補になる。これは計測で確かめる仮説であり、本拡張の主要な遅延原因とはまだ判断していない。

llama.cppには[WebGPU backend samplingの実装 #18880](https://github.com/ggml-org/llama.cpp/pull/18880)がある。現行wllamaからの有効化経路、PLaMoでの適用条件、使用中のsamplerがGPUで完結するかは追加確認が必要である。temperature 0のgreedy生成でも、同点処理やその他のsampler設定を含めて出力を照合する。

語彙を日本語だけに減らす案は固有名詞、数式、コード、英語表記を制限する。多言語モデルの出力を変えるため、今回の短期案には含めない。

### 2Bの投機的デコード

0.8Bが先に複数トークンを提案し、2Bがまとめて検証する方式を実験候補とする。正しい検証・サンプリングを実装すれば、対象モデルの出力分布を保てる。高速化には、提案の採用率と検証コストが見合う必要がある。[原論文](https://arxiv.org/abs/2211.17192)、[llama.cppの方式](https://github.com/ggml-org/llama.cpp/blob/master/docs/speculative.md)。

今回、公式の0.8Bと2Bの `tokenizer.jsonl`、`tokenizer_config.json`、`special_tokens_map.json` を取得し、対応するファイルのSHA-256が一致することを確認した。[0.8Bの配布revision](https://huggingface.co/pfnet/plamo-3-translate-0.8b/tree/8b4d42855622093e610ba9b90c2d2b59f8d5c15d)、[2Bの配布revision](https://huggingface.co/pfnet/plamo-3-translate-2b/tree/cf66d22fbe6202c56b8e5d283691aa1da53d05af)。ただし、実際に使うGGUFのtoken IDと特殊トークンも照合する。

| ファイル                | 両モデルで一致したSHA-256                                          |
| ----------------------- | ------------------------------------------------------------------ |
| tokenizer.jsonl         | `bdce9e430e65931b28c56de2054f52b4cf8ed59b322db125e016d724d06dbb0e` |
| tokenizer_config.json   | `5468ed5c68b5cf4cf971bcb34be6bfbfd749fe30cc5bc65ace5835ae3bff65b3` |
| special_tokens_map.json | `1004b03ad5c184693765d25d8d682e831727b43b84e321fc9dc14d9ef3d1466a` |

wllamaの固定版には `spec_draft_model`、`spec_draft_ngl`、提案数などの設定があり、C++側へ渡す実装もある。[型定義](https://github.com/ngxson/wllama/blob/6647c1ea3837b2f0205a300c3bf5ff644aaa06bf/src/types/types.ts)、[C++側の転送](https://github.com/ngxson/wllama/blob/6647c1ea3837b2f0205a300c3bf5ff644aaa06bf/cpp/wllama-context.h)。ただし、通常のloaderは非mmprojのBlobを主モデルの分割ファイルとして扱う。追加URLだけで独立した補助モデルになるとは判断できない。WASM側のファイルシステムへ別ファイルとして配置するために、SDKやworkerの最小拡張が必要かを確認する。

最初は2Bを主モデル、0.8Bを補助モデルとする1要求だけで検証する。採用率、提案数、入力処理時間、生成時間、総メモリを記録する。SWAの状態を巻き戻せること、取消後に次の翻訳が成功することも確認する。2モデルの常駐とGPU競合により遅くなる可能性があり、既定の0.8Bだけを速くする案とは区別する。

| 方式                           | 追加学習           | PLaMoへ適用する条件                                          |
| ------------------------------ | ------------------ | ------------------------------------------------------------ |
| 0.8Bを使うdraft・n-gram        | 不要               | 主モデルの検証、SWAの巻戻し、採用率の測定が必要              |
| Draft & Verify型の層を省く提案 | 原論文では不要     | 省く層の選択、GPUグラフとKV再利用をPLaMoへ実装する           |
| LayerSkip型のearly exit        | 通常は必要         | 学習済みモデルと、主モデルが検証する経路を用意する           |
| Medusa・EAGLEなどの追加head    | 通常は必要         | PLaMo用の補助重みとランタイム対応を用意する                  |
| MTP                            | 対応する重みが必要 | 公開PLaMoの通常lm_headに加え、複数トークン予測の対応を要する |

出典は[Draft & Verify著者実装](https://github.com/dilab-zju/self-speculative-decoding)、[LayerSkip原論文](https://arxiv.org/abs/2404.16710)、[固定版の投機的デコード資料](https://github.com/ggml-org/llama.cpp/blob/7d7f0287530bc8981690f361d8c1627dbae1c99a/docs/speculative.md)。主モデルで正しく検証する方式と、途中の出力をそのまま確定する方式では、出力分布を保てる条件が異なる。これらは中長期の研究候補とする。英日翻訳では語順と文字体系が変わるため、原文を利用するn-gram方式も採用率を測るまで推奨しない。

### 新しいWebGPU研究

[Llamas on the Web](https://arxiv.org/abs/2605.20706)は、llama.cppのWebGPU backendでメモリ計画、モデル読込、量子化カーネルを扱う研究である。別の高速エンジンへの移行案とせず、固定版との差分を確認する資料として使う。

[GPU Goldmines](https://arxiv.org/abs/2610.17321)は、行列演算やattentionの設定を形状・GPU・ブラウザに合わせる研究である。PLaMoの層・ヘッド・行列形状に合わせたカーネル調整は追加候補になる。LlamaやQwenでの改善率をPLaMoへ転用せず、対象カーネルと翻訳全体の時間を別々に測る。

## 起動時間と表示処理の候補

| 対象       | 提案                                                                             | 効果を判定する条件                                            |
| ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| モデル準備 | 利用者の操作で先にロードし、ロード済み状態を再利用する                           | ダウンロード、端末保存からの読込、GPU転送、初回実行を分離する |
| GPU利用    | 実際の配置と起動失敗の理由を記録する                                             | 全層GPU配置か、CPUへ移行したかを判別する                      |
| 通信とDOM  | 累積全文の転送量と書換回数を測り、必要なら差分通知とフレーム単位の更新を比較する | 既存60ms制限後にも負荷が残る場合に限る                        |
| 翻訳対象   | 画面内優先を保ち、更新で無効になった要求を止める                                 | 有効な原文を翻訳対象から除外せず、取消前の訳文を表示しない    |
| CPU経路    | 2・4・8スレッドと入力バッチを比較する                                            | 発熱、他タブの応答性、長時間実行も含めて判断する              |

起動を先に済ませる処理は利用時の待ち時間を移す案であり、同じ翻訳の計算量を減らすものではない。非表示タブを止める案もバックグラウンドで全文を訳す動作を変える。利用者が選べる動作として別に判断する。

`shader-f16`、subgroup、整数内積などはGPUカーネルの実装に関わる。ブラウザがAPIを提供していても、現在のカーネルが利用しなければ性能は変わらない。[ChromeのWebGPU解説](https://developer.chrome.com/blog/io24-webassembly-webgpu-2)。JSPI版とAsyncify互換版の差も、同じ端末・モデルで別々に記録する。[ビルド構成](translation-wasm-performance.md#ビルドと配布)。

## 実装候補と検証順序

変更を一つずつ比較し、採用した変更を次の基準にする。次の五つは実装順序の提案であり、効果の大きさを測定した順位ではない。

| 順序 | 検証する変更                                       | 主な変更先                                  | 採用を見送る条件                                         |
| ---- | -------------------------------------------------- | ------------------------------------------- | -------------------------------------------------------- |
| 1    | 実際の拡張通信を通す計測。2枠と4枠、段階起動を比較 | engine、scheduler、offscreen、既存benchmark | 画面内完了が短縮しない、選択翻訳が遅れる、容量不足になる |
| 2    | 短ラベルの結合と対応不一致時の全件再翻訳           | contentの入力計画、background、関連テスト   | 別要素への訳文表示、訳抜け、再翻訳の増加がある           |
| 3    | 量子化形式と実行カーネル、入力バッチを比較         | モデルURLと設定、WASM検証                   | 品質低下、未対応カーネルへの移行、初回取得の悪化がある   |
| 4    | FA・KV・GPU sampling・CPU prefixを個別検証         | engine、必要ならwllama側                    | 対象処理の割合が小さい、保存や復元の方が長い             |
| 5    | 2B＋0.8Bの投機的デコードを1要求で検証              | 補助モデル読込、engine、WASM側設定          | 採用率が低い、メモリ不足、SWAや取消が正しく動かない      |

短文結合はまず上限付きの入力と出力対応を検証できる小さな実装にする。移行先ランタイムの全面開発や、複数モデルの自動切替はこの比較へ含めない。

## 測定方法と採用条件

既存の[ブラウザbenchmark](translation-wasm-benchmark.js)を基に、content、background、offscreenをすべて通す。以前の検証にはbackgroundとoffscreen間の通信を含まないものがあるため、推論だけの記録と実ページの記録を混ぜない。

1. 同じブラウザ、GPU、電源状態、GGUFハッシュ、プロンプト、画面位置を固定する。0.8Bと2Bは別々に測る。
2. 初回取得、端末保存済みのロード、ロード済み推論、結果キャッシュ利用を分ける。異なる原文の処理を主な比較対象にする。
3. 短いラベル、長さがそろう段落、長短混在、長段落、リンク付き文章、やさしい日本語で比較する。
4. 条件を交互に少なくとも5回測り、中央値、範囲、失敗数を残す。p95の判断には別途試行数を増やす。
5. 訳抜け、数字、否定、固有名詞、リンク、終了理由を点検する。取消、選択翻訳の割込み、DOM更新、長時間利用も確認する。

操作から表示までの時刻に加え、キュー待ち、モデル準備、prefill、decodeの時間を記録する。出力トークン数、通知回数、転送文字数も残す。GPUの演算時間や同期が疑わしい場合は、利用可能な計測機能で実行経路を調べる。

採用条件は画面内の翻訳完了までの時間が測定のばらつきを超えて短縮し、重大な品質・操作上の不具合がなく、端末のメモリ制約内で動くこととする。中断や出力上限による短い訳文を成功として集計しない。並列実行中の要求ごとのtokens/sは、ページ全体の処理量と区別する。

短縮率の数値目標はこの基準測定の後に決める。原論文、別の拡張、別のGPUの倍率を本拡張の見込み値として使わない。

## 調査の限界と資料の時点

今回確認したのは、公開ソース、モデルの設定・tokenizer関連ファイル、公式資料、既存の測定記録である。新候補の速度、品質、GPUメモリ使用量は測定していない。PLaMoのブラウザ内投機的デコードと、別ランタイムでの互換実行も検証していない。

Sakuttoは `c50f20fe480103e6279edec4145459219f60b360`、wllamaは `6647c1ea3837b2f0205a300c3bf5ff644aaa06bf`、llama.cppは `7d7f0287530bc8981690f361d8c1627dbae1c99a` を基準に確認した。公式モデルのmainや上流masterへのリンクは更新され得るため、実験時には使用ファイルのrevisionとハッシュを固定する。

文書と現在のコードに次の食い違いがある。

| 文書                                                                                                                                      | 残っている記述                                        | 現在のコード                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Ollama調査](ollama-translation-performance.md)                                                                                           | localhost権限の追加とOllama導入を将来の作業として扱う | localhost権限と接続処理は実装済み。今回はブラウザ実行だけを対象とする                             |
| [SakuttoのSWAコメント](https://github.com/jammaru/sakutto/blob/c50f20fe480103e6279edec4145459219f60b360/src/engine/in-browser/runtime.ts) | 現在のtierを4096 context・2枠として説明する           | 同commitのbackendは通常4枠、条件を満たすGPUは16枠。コメントの測定条件を現行既定値として引用しない |

前回の調査には実装前の本文が残るが、冒頭でその時点を明示しているため履歴として扱う。過去commitを対象とすると明示した測定結果も、現在と異なるだけでは不整合に数えない。実装の判断は現行コードとREADMEに従った。

次の着手点として、実際の拡張通信を通す基準測定と、2枠・4枠の比較を提案する。ここで入力処理、生成、待ち行列のどれが長いかを確かめ、その処理を短縮する候補へ進む。
