import { browser } from "wxt/browser";
import { isRecord } from "../../lib/copy-protocol";
import { translationPrompt, TRANSLATION_STOP } from "./prompt";
import { scheduleTranslation, translationCache, translationCacheKey } from "./scheduler";
import type { TargetLanguage, TranslationOptions } from "./shared";

const OLLAMA_URL = "http://localhost:11434";
const connectionHelp = () =>
  `Ollamaに接続できません。Ollamaを起動してください。起動済みの場合はOllamaを終了し、OLLAMA_ORIGINS="${browser.runtime.getURL("/").replace(/\/$/, "")}" を環境変数に設定して起動し直してください。`;

async function ollamaFetch(path: string, body: unknown, signal: AbortSignal): Promise<Response> {
  signal.throwIfAborted();
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
      redirect: "error",
    });
  } catch {
    signal.throwIfAborted();
    throw new Error(connectionHelp());
  }
  if (response.status === 403) throw new Error(connectionHelp());
  if (response.status === 404)
    throw new Error(
      "Ollamaにモデルが見つかりません。設定したPLaMoモデルをollama pullで取得するか、導入済みのモデル名に変更してください。",
    );
  if (!response.ok) throw new Error(`Ollamaでエラーが発生しました（HTTP ${response.status}）。`);
  return response;
}

async function verifyLocalModel(model: string, signal: AbortSignal): Promise<void> {
  const response = await ollamaFetch("/api/show", { model }, signal);
  const info: unknown = await response.json();
  signal.throwIfAborted();
  if (
    !isRecord(info) ||
    info.remote_host ||
    info.remote_model ||
    !isRecord(info.details) ||
    info.details.format !== "gguf" ||
    !isRecord(info.model_info) ||
    info.model_info["general.architecture"] !== "plamo3" ||
    ![
      info.model_info["general.name"],
      info.model_info["general.base_model.0.name"],
      info.model_info["general.repo_url"],
    ].some((value) => typeof value === "string" && /plamo[ -]?3[ -]translate/i.test(value))
  )
    throw new Error(
      "端末内のPLaMo Translate GGUFモデルを指定してください。クラウドモデルには文章を送信しません。",
    );
}

export async function readOllamaTranslation(
  body: ReadableStream<Uint8Array>,
  options: Pick<TranslationOptions, "signal" | "onText">,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let text = "";
  let finished = false;
  const onAbort = () => {
    void reader.cancel().catch(() => {});
  };
  options.signal.addEventListener("abort", onAbort, { once: true });
  const line = (value: string) => {
    if (!value.trim()) return;
    const row: unknown = JSON.parse(value);
    if (isRecord(row) && typeof row.error === "string") throw new Error(`Ollama: ${row.error}`);
    if (!isRecord(row) || typeof row.response !== "string" || typeof row.done !== "boolean")
      throw new Error("Ollamaの応答を読み取れませんでした。");
    text += row.response;
    if (text.length > 100_000)
      throw new Error("Ollamaの翻訳結果が長すぎます。文章を短くしてください。");
    options.onText?.(text);
    if (row.done) {
      if (row.done_reason !== "stop")
        throw new Error("翻訳が最後まで完了しませんでした。文章を短くして再試行してください。");
      if (!text.trim()) throw new Error("翻訳結果が空でした。再試行してください。");
      finished = true;
    }
  };
  try {
    options.signal.throwIfAborted();
    while (!finished) {
      const chunk = await reader.read();
      options.signal.throwIfAborted();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      if (buffer.length > 200_000) throw new Error("Ollamaの応答が長すぎます。");
      let end: number;
      while (!finished && (end = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
      if (chunk.done) {
        if (!finished && buffer.trim()) line(buffer);
        break;
      }
    }
    options.signal.throwIfAborted();
    if (!finished)
      throw new Error("Ollamaとの接続が翻訳の途中で終了しました。再試行してください。");
    return text.trim();
  } finally {
    options.signal.removeEventListener("abort", onAbort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function translateWithOllama(
  text: string,
  target: TargetLanguage,
  model: string,
  options: TranslationOptions,
) {
  return scheduleTranslation(options, async () => {
    await verifyLocalModel(model, options.signal);
    const key = translationCacheKey({ kind: "ollama", model }, target, text);
    const cached = translationCache.get(key);
    if (cached?.device === "unknown")
      return { text: cached.text, device: "unknown" as const, provider: "ollama" as const };
    options.onProgress("この端末のOllamaで訳しています…");
    const response = await ollamaFetch(
      "/api/generate",
      {
        model,
        prompt: translationPrompt(text, target),
        raw: true,
        stream: true,
        keep_alive: "5m",
        options: { num_ctx: 4096, num_predict: 2048, temperature: 0, stop: TRANSLATION_STOP },
      },
      options.signal,
    );
    if (!response.body) throw new Error("Ollamaの応答を受け取れませんでした。");
    const translated = await readOllamaTranslation(response.body, options);
    const result = { text: translated, device: "unknown" as const, provider: "ollama" as const };
    options.signal.throwIfAborted();
    // 同じタグのモデルを差し替えた場合も、古い訳を長く残さない。
    translationCache.set(key, result, 30_000);
    return result;
  });
}
