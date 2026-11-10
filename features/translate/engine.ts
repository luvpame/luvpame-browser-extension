import { Wllama, type RawCompletionParams, type RawCompletionChunk } from "@wllama/wllama";
import { browser } from "wxt/browser";
import type {
  TargetLanguage,
  TranslationDevice,
  TranslationModel,
  TranslationOptions,
} from "./shared";
import { translationPrompt, TRANSLATION_STOP } from "./prompt";
import { scheduleTranslation, translationCache, translationCacheKey } from "./scheduler";

type LoadedModel = { runtime: Wllama; model: TranslationModel; device: TranslationDevice };

let loadedModel: LoadedModel | undefined;
type BrowserTranslation = { text: string; device: TranslationDevice };
type InFlightTranslation = {
  controller: AbortController;
  subscribers: Set<TranslationOptions>;
  promise: Promise<BrowserTranslation>;
  progress?: string;
  text?: string;
};
const inFlight = new Map<string, InFlightTranslation>();

const modelUrl = (model: TranslationModel) =>
  `https://huggingface.co/pfnet/plamo-3-translate-${model}-GGUF/resolve/main/plamo-3-translate-${model}-Q4_K_M.gguf`;

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

async function loadModel(
  model: TranslationModel,
  options: TranslationOptions,
): Promise<LoadedModel> {
  if (loadedModel?.model === model) return loadedModel;
  if (loadedModel) {
    const previous = loadedModel;
    loadedModel = undefined;
    await previous.runtime.exit();
  }
  options.signal.throwIfAborted();
  let device: TranslationDevice = (await canUseGpu()) ? "gpu" : "cpu";
  options.signal.throwIfAborted();
  for (;;) {
    let collectingLogs = true;
    let nativeDevice: TranslationDevice | undefined;
    let offloadedDevice: TranslationDevice | undefined;
    const captureLog = (...args: unknown[]) => {
      if (!collectingLogs) return;
      for (const message of args) {
        if (typeof message !== "string") continue;
        const offloaded = /offloaded (\d+)\/\d+ layers to GPU/i.exec(message);
        if (offloaded) offloadedDevice = Number(offloaded[1]) > 0 ? "gpu" : "cpu";
        if (/ggml_webgpu: Failed to get (?:an adapter|a device):/i.test(message)) {
          nativeDevice = "cpu";
        } else if (/using device WebGPU/i.test(message)) {
          nativeDevice = "gpu";
        }
      }
    };
    const runtime = new Wllama(
      { default: new URL("vendor/wllama.wasm", browser.runtime.getURL("/")).href },
      {
        allowOffline: true,
        suppressNativeLog: false,
        logger: { debug: captureLog, log: captureLog, warn: captureLog, error: captureLog },
      },
    );
    runtime.setCompat({
      worker: new URL("vendor/wllama-compat-worker.js", browser.runtime.getURL("/")).href,
      wasm: new URL("vendor/wllama-compat.wasm", browser.runtime.getURL("/")).href,
    });
    options.onProgress("翻訳の準備をしています…");
    try {
      await runtime.loadModelFromUrl(modelUrl(model), {
        n_ctx: device === "gpu" ? 8192 : 4096,
        n_parallel: device === "gpu" ? 2 : 1,
        kv_unified: false,
        swa_full: true,
        ...(device === "gpu" ? { cont_batching: true } : {}),
        n_gpu_layers: device === "gpu" ? 999 : 0,
        n_threads: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
        cache_idle_slots: false,
        ctx_shift: false,
        signal: options.signal,
        progressCallback: ({ loaded, total }) => {
          if (!options.signal.aborted) {
            const percent =
              total > 0 ? ` ${Math.min(100, Math.floor((loaded / total) * 100))}%` : "";
            options.onProgress(`翻訳モデルをダウンロードしています…${percent}`);
          }
        },
      });
      options.signal.throwIfAborted();
      loadedModel = { runtime, model, device: offloadedDevice ?? nativeDevice ?? device };
      return loadedModel;
    } catch (error) {
      await runtime.exit();
      options.signal.throwIfAborted();
      if (device === "cpu") throw error;
      options.onProgress("翻訳の準備を続けています…");
      device = "cpu";
    } finally {
      collectingLogs = false;
    }
  }
}

async function runTranslation(
  text: string,
  target: TargetLanguage,
  model: TranslationModel,
  options: TranslationOptions,
): Promise<{ text: string; device: TranslationDevice }> {
  options.signal.throwIfAborted();
  const loaded = await loadModel(model, options);
  options.signal.throwIfAborted();
  options.onProgress(
    target === "ja-easy" ? "やさしい日本語に訳しています…" : "日本語に訳しています…",
  );
  const prompt = translationPrompt(text, target);
  let translated = "";
  let finishReason: string | null = null;
  const completion = {
    prompt,
    max_tokens: 2048,
    temperature: 0,
    cache_prompt: false,
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
  await loaded.runtime.createCompletion(completion);
  options.signal.throwIfAborted();
  if (finishReason !== "stop") {
    throw new Error("翻訳が最後まで完了しませんでした。文章を短くして再試行してください。");
  }
  if (!translated.trim()) throw new Error("翻訳結果が空でした。再試行してください。");
  return { text: translated.trim(), device: loaded.device };
}

export async function translate(
  text: string,
  target: TargetLanguage,
  model: TranslationModel,
  options: TranslationOptions,
): Promise<{ text: string; device: TranslationDevice }> {
  options.signal.throwIfAborted();
  const key = translationCacheKey({ kind: "browser", model }, target, text);
  const cached = translationCache.get(key);
  if (cached && (cached.device === "gpu" || cached.device === "cpu"))
    return { text: cached.text, device: cached.device };

  let entry = inFlight.get(key);
  if (!entry) {
    const controller = new AbortController();
    const subscribers = new Set<TranslationOptions>();
    const sharedOptions: TranslationOptions = {
      signal: controller.signal,
      priority: options.priority,
      onProgress: (message) => {
        shared.progress = message;
        for (const subscriber of subscribers) subscriber.onProgress(message);
      },
      onText: (value) => {
        shared.text = value;
        for (const subscriber of subscribers) subscriber.onText?.(value);
      },
    };
    const shared: InFlightTranslation = {
      controller,
      subscribers,
      promise: Promise.resolve()
        .then(() =>
          scheduleTranslation(
            sharedOptions,
            async () => {
              const result = await runTranslation(text, target, model, sharedOptions);
              controller.signal.throwIfAborted();
              translationCache.set(key, result);
              return result;
            },
            {
              group: `browser:${model}`,
              capacity: () =>
                loadedModel?.model === model && loadedModel.device === "gpu" ? 2 : 1,
            },
          ),
        )
        .finally(() => {
          if (inFlight.get(key) === shared) inFlight.delete(key);
        }),
    };
    entry = shared;
    inFlight.set(key, entry);
  }
  const shared = entry;
  const subscriber = { ...options };
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      shared.subscribers.delete(subscriber);
      options.signal.removeEventListener("abort", onAbort);
      if (!shared.subscribers.size) {
        if (inFlight.get(key) === shared) inFlight.delete(key);
        shared.controller.abort(options.signal.reason);
      }
      reject(options.signal.reason);
    };
    shared.subscribers.add(subscriber);
    options.signal.addEventListener("abort", onAbort, { once: true });
    const unsubscribe = () => {
      shared.subscribers.delete(subscriber);
      options.signal.removeEventListener("abort", onAbort);
    };
    shared.promise.then(
      (result) => {
        unsubscribe();
        resolve(result);
      },
      (error: unknown) => {
        unsubscribe();
        reject(error);
      },
    );
    if (shared.progress !== undefined) subscriber.onProgress(shared.progress);
    if (shared.text !== undefined) subscriber.onText?.(shared.text);
  });
}
