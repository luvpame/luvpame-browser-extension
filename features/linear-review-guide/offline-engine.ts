import { Wllama, type RawCompletionChunk, type RawCompletionParams } from "@wllama/wllama";
import { compatNativeCode } from "offline-plamo-native";
import { TranslationCache } from "../translate/scheduler";
import type { TranslationDevice } from "../translate/shared";
import { TRANSLATION_STOP, translationPrompt } from "../translate/prompt";

export type OfflineTranslationOptions = {
  signal: AbortSignal;
  onText?: (text: string) => void;
};

async function canUseGpu(): Promise<boolean> {
  if (!("gpu" in navigator)) return false;
  const gpu = navigator.gpu;
  if (
    typeof gpu !== "object" ||
    gpu === null ||
    !("requestAdapter" in gpu) ||
    typeof gpu.requestAdapter !== "function"
  )
    return false;
  try {
    return Boolean(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

export async function createOfflinePlamo(model: Blob, status?: (message: string) => void) {
  if (new TextDecoder().decode(await model.slice(0, 4).arrayBuffer()) !== "GGUF")
    throw new Error("PLaMo TranslateのGGUFファイルを選んでください。");
  const wasmPath = new URL("offline-plamo.wasm", location.href).href;
  let device: TranslationDevice = (await canUseGpu()) ? "gpu" : "cpu";
  let runtime: Wllama;
  for (;;) {
    let collectingLogs = true;
    let offloadedDevice: TranslationDevice | undefined;
    const captureLog = (...args: unknown[]) => {
      if (!collectingLogs) return;
      for (const message of args) {
        if (typeof message !== "string") continue;
        const offloaded = /offloaded (\d+)\/\d+ layers to GPU/i.exec(message);
        if (offloaded) offloadedDevice = Number(offloaded[1]) > 0 ? "gpu" : "cpu";
      }
    };
    runtime = new Wllama(
      { default: wasmPath },
      {
        allowOffline: true,
        suppressNativeLog: false,
        logger: { debug: captureLog, log: captureLog, warn: captureLog, error: captureLog },
      },
    );
    runtime.setCompat({ worker: { code: compatNativeCode }, wasm: wasmPath });
    try {
      status?.(`翻訳モデルを${device === "gpu" ? "GPU" : "CPU"}に読み込んでいます…`);
      await runtime.loadModel([model], {
        n_ctx: device === "gpu" ? 8192 : 4096,
        n_parallel: device === "gpu" ? 2 : 1,
        n_gpu_layers: device === "gpu" ? 999 : 0,
        n_threads: Math.max(
          1,
          Math.min(device === "gpu" ? 4 : 8, Math.floor((navigator.hardwareConcurrency || 2) / 2)),
        ),
        ...(device === "gpu" ? { cont_batching: true } : {}),
        kv_unified: false,
        swa_full: true,
        warmup: true,
        cache_idle_slots: false,
        ctx_shift: false,
      });
      if (device === "gpu" && offloadedDevice !== "gpu")
        throw new Error("GPUへのモデル配置を確認できませんでした。");
      break;
    } catch (error) {
      await runtime.exit();
      if (device === "cpu") throw error;
      status?.("GPUを利用できないためCPUで準備を続けています…");
      device = "cpu";
    } finally {
      collectingLogs = false;
    }
  }
  let modelName = "PLaMo 3 Translate";
  try {
    const metadata = runtime.getModelMetadata().meta;
    if (
      metadata["general.architecture"] !== "plamo3" ||
      ![
        metadata["general.name"],
        metadata["general.base_model.0.name"],
        metadata["general.repo_url"],
      ].some((value) => typeof value === "string" && /plamo[ -]?3[ -]translate/i.test(value))
    )
      throw new Error("PLaMo 3 TranslateのGGUFファイルを選んでください。");
    if (typeof metadata["general.name"] === "string" && metadata["general.name"].trim())
      modelName = metadata["general.name"].trim();
    status?.(
      device === "gpu"
        ? "翻訳の準備ができました。GPUを使用します。"
        : "翻訳の準備ができました。GPUを利用できないためCPUを使用します。",
    );
  } catch (error) {
    await runtime.exit();
    throw error;
  }

  const cache = new TranslationCache();
  let disposed = false;
  return {
    device,
    modelName,
    async translate(text: string, options: OfflineTranslationOptions): Promise<string> {
      options.signal.throwIfAborted();
      if (disposed) throw new Error("翻訳モデルは終了しています。");
      const cached = cache.get(text);
      if (cached) return cached.text;
      let translated = "";
      let finishReason: string | null = null;
      const completion = {
        prompt: translationPrompt(text, "ja"),
        max_tokens: 2048,
        temperature: 0,
        cache_prompt: device === "cpu",
        stop: TRANSLATION_STOP,
        abortSignal: options.signal,
        stream: true,
        onData: (chunk: RawCompletionChunk) => {
          options.signal.throwIfAborted();
          for (const choice of chunk.choices) {
            translated += choice.text;
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }
          options.onText?.(translated);
        },
      } satisfies RawCompletionParams & {
        stream: true;
        cache_prompt: boolean;
        onData: (chunk: RawCompletionChunk) => void;
      };
      await runtime.createCompletion(completion);
      options.signal.throwIfAborted();
      if (finishReason !== "stop")
        throw new Error("翻訳が最後まで完了しませんでした。文章を短くしてください。");
      if (!translated.trim()) throw new Error("翻訳結果が空でした。");
      const result = translated.trim();
      cache.set(text, { text: result, device });
      return result;
    },
    async dispose(): Promise<void> {
      disposed = true;
      await runtime.exit();
    },
  };
}
