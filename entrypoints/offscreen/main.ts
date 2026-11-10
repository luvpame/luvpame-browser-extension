import { browser } from "wxt/browser";
import { isOffscreenRequest, errorText } from "../../lib/copy-protocol";
import { convertHtml, writeClipboard } from "../../lib/offscreen-copy";
import { isRecord } from "../../lib/copy-protocol";
import {
  OFFSCREEN_PREPARE_TRANSLATION,
  TRANSLATE,
  TRANSLATE_BATCH,
  REPRIORITIZE_TRANSLATIONS,
  OFFSCREEN_TRANSLATE,
  OFFSCREEN_TRANSLATE_BATCH,
  OFFSCREEN_CANCEL,
  OFFSCREEN_CANCEL_REQUEST,
  OFFSCREEN_REPRIORITIZE,
  TRANSLATION_PROGRESS,
  isSessionId,
  isOffscreenSessionId,
  isTranslationRequest,
  isTranslationBatchRequest,
  isReprioritizeTranslationsRequest,
  isTranslationProvider,
  type TranslationUpdate,
  type TranslationOptions,
} from "../../features/translate/shared";

type TranslationJob = { controller: AbortController; distance: number };
const translations = new Map<string, Map<string, TranslationJob>>();
browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== browser.runtime.id || sender.tab || !isRecord(message)) return;
  if (message.type === OFFSCREEN_PREPARE_TRANSLATION) {
    if (!isTranslationProvider(message.provider) || message.provider.kind !== "browser") {
      respond({ ok: false, error: "ブラウザ内翻訳のモデルが不正です。" });
      return;
    }
    const { model } = message.provider;
    void (async () => {
      try {
        const result = await (
          await import("../../features/translate/engine")
        ).prepareTranslation(model, {
          signal: new AbortController().signal,
          onProgress: () => {},
        });
        respond({ ok: true, ...result });
      } catch (error) {
        respond({ ok: false, error: errorText(error) });
      }
    })();
    return true;
  }
  if (!isOffscreenSessionId(message.sessionId)) return;
  const sessionId = message.sessionId;
  const localSessionId = sessionId.slice(sessionId.indexOf(":") + 1);
  if (message.type === OFFSCREEN_CANCEL) {
    for (const job of translations.get(sessionId)?.values() ?? []) job.controller.abort();
    respond({ ok: true });
    return;
  }
  if (message.type === OFFSCREEN_CANCEL_REQUEST) {
    if (!isSessionId(message.requestId)) return;
    translations.get(sessionId)?.get(message.requestId)?.controller.abort();
    respond({ ok: true });
    return;
  }
  if (message.type === OFFSCREEN_REPRIORITIZE) {
    const request = { ...message, type: REPRIORITIZE_TRANSLATIONS, sessionId: localSessionId };
    if (!isReprioritizeTranslationsRequest(request)) return;
    for (const { requestId, distance } of request.updates) {
      const job = translations.get(sessionId)?.get(requestId);
      if (job) job.distance = distance;
    }
    respond({ ok: true });
    return;
  }
  if (message.type !== OFFSCREEN_TRANSLATE && message.type !== OFFSCREEN_TRANSLATE_BATCH) return;
  const request = {
    ...message,
    type: message.type === OFFSCREEN_TRANSLATE_BATCH ? TRANSLATE_BATCH : TRANSLATE,
    sessionId: localSessionId,
  };
  if (
    (!isTranslationRequest(request) && !isTranslationBatchRequest(request)) ||
    !isTranslationProvider(message.provider)
  ) {
    respond({ requestId: message.requestId, ok: false, error: "翻訳リクエストが不正です。" });
    return;
  }
  const { target, requestId, priority } = request;
  const provider = message.provider;
  const jobs = translations.get(sessionId) ?? new Map<string, TranslationJob>();
  if (jobs.has(requestId)) {
    respond({ requestId, ok: false, error: "同じ翻訳リクエストが処理中です。" });
    return;
  }
  const controller = new AbortController();
  const job = { controller, distance: request.viewportDistance ?? 0 };
  jobs.set(requestId, job);
  translations.set(sessionId, jobs);
  void (async () => {
    try {
      let lastUpdate: number | undefined;
      let lastText: string | undefined;
      const sendUpdate = (update: TranslationUpdate) => {
        if (controller.signal.aborted) return;
        void browser.runtime
          .sendMessage({ type: TRANSLATION_PROGRESS, sessionId, requestId, update })
          .catch(() => {});
      };
      const options: TranslationOptions = {
        signal: controller.signal,
        priority,
        viewportDistance: () => job.distance,
        onProgress: (message: string) => sendUpdate({ kind: "status", message }),
        onText: (text: string) => {
          const now = Date.now();
          if (lastText === undefined && !text.trim()) return;
          if (text === lastText || (lastUpdate !== undefined && now - lastUpdate < 60)) return;
          const update: TranslationUpdate =
            lastText !== undefined && text.startsWith(lastText)
              ? { kind: "append", offset: lastText.length, text: text.slice(lastText.length) }
              : { kind: "text", text };
          lastText = text;
          lastUpdate = now;
          sendUpdate(update);
        },
      };
      const result =
        request.type === TRANSLATE_BATCH
          ? await (
              await import("../../features/translate/batch")
            ).translateBatch(request.texts, target, provider, options)
          : provider.kind === "browser"
            ? await (
                await import("../../features/translate/engine")
              ).translate(request.text, target, provider.model, options)
            : await (
                await import("../../features/translate/ollama")
              ).translateWithOllama(request.text, target, provider.model, options);
      controller.signal.throwIfAborted();
      respond({ requestId, ok: true, ...result });
    } catch (error) {
      controller.abort(error);
      respond({ requestId, ok: false, error: errorText(error) });
    } finally {
      jobs.delete(requestId);
      if (!jobs.size) translations.delete(sessionId);
    }
  })();
  return true;
});

let queue: Promise<void> = Promise.resolve();
browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== browser.runtime.id || sender.tab || !isOffscreenRequest(message)) return;
  queue = queue.then(async () => {
    try {
      const text =
        message.mode === "html" ? await convertHtml(message.text, message.url) : message.text;
      writeClipboard(text);
      respond({ requestId: message.requestId, ok: true });
    } catch (error) {
      respond({ requestId: message.requestId, ok: false, error: errorText(error) });
    }
  });
  return true;
});
