import { Wllama } from "@wllama/wllama";
import { browser } from "wxt/browser";
import type { TargetLanguage, TranslationDevice, TranslationModel } from "./shared";

type TranslationOptions = {
  signal: AbortSignal;
  onProgress: (message: string) => void;
};
type LoadedModel = { runtime: Wllama; model: TranslationModel; device: TranslationDevice };

let loadedModel: LoadedModel | undefined;
let queue: Promise<unknown> = Promise.resolve();

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
  let runtime = new Wllama(
    { default: new URL("vendor/wllama.wasm", browser.runtime.getURL("/")).href },
    { allowOffline: true, suppressNativeLog: true },
  );
  for (;;) {
    options.onProgress(`${device === "gpu" ? "GPU" : "CPU"} で PLaMo ${model} を準備中…`);
    try {
      await runtime.loadModelFromUrl(modelUrl(model), {
        n_ctx: 4096,
        n_parallel: 1,
        n_gpu_layers: device === "gpu" ? 999 : 0,
        n_threads: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
        cache_idle_slots: false,
        ctx_shift: false,
        signal: options.signal,
        progressCallback: ({ loaded, total }) => {
          if (!options.signal.aborted) {
            const percent =
              total > 0 ? ` ${Math.min(100, Math.floor((loaded / total) * 100))}%` : "";
            options.onProgress(`PLaMo ${model} ダウンロード${percent}（${device.toUpperCase()}）`);
          }
        },
      });
      options.signal.throwIfAborted();
      loadedModel = { runtime, model, device };
      return loadedModel;
    } catch (error) {
      await runtime.exit();
      options.signal.throwIfAborted();
      if (device === "cpu") throw error;
      options.onProgress("GPU を利用できないため、同じモデルを CPU で読み込みます…");
      runtime = new Wllama(
        { default: new URL("vendor/wllama.wasm", browser.runtime.getURL("/")).href },
        { allowOffline: true, suppressNativeLog: true },
      );
      device = "cpu";
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
  options.onProgress(`${loaded.device.toUpperCase()} で翻訳中…`);
  const safeText = text.replaceAll("<|", "<\u200b|");
  const prompt =
    "<|plamo:tag|>dataset<|plamo:msg|>translation" +
    "<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>" +
    safeText +
    `<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>${target}<|plamo:msg|>`;
  let translated = "";
  let finishReason: string | null = null;
  await loaded.runtime.createCompletion({
    prompt,
    max_tokens: 2048,
    temperature: 0,
    stop: ["<|plamo:tag|>", "<|plamo:bos|>"],
    abortSignal: options.signal,
    stream: true,
    onData: (chunk) => {
      options.signal.throwIfAborted();
      for (const choice of chunk.choices) {
        translated += choice.text;
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
    },
  });
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
  options.onProgress("翻訳の順番を待っています…");
  const work = queue.then(() => runTranslation(text, target, model, options));
  queue = work.catch(() => {});
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(options.signal.reason);
    options.signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => options.signal.removeEventListener("abort", onAbort));
    if (options.signal.aborted) onAbort();
  });
}
