import { browser } from "wxt/browser";
import { isOffscreenRequest, errorText } from "../../lib/copy-protocol";
import { convertHtml, writeClipboard } from "../../lib/offscreen-copy";
import { isRecord } from "../../lib/copy-protocol";
import {
  TRANSLATE,
  OFFSCREEN_TRANSLATE,
  OFFSCREEN_CANCEL,
  TRANSLATION_PROGRESS,
  isSessionId,
  isTranslationRequest,
  isTranslationProvider,
  type TranslationUpdate,
  type TranslationOptions,
} from "../../features/translate/shared";

const translations = new Map<string, Set<AbortController>>();
browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
  if (sender.id !== browser.runtime.id || sender.tab || !isRecord(message)) return;
  if (message.type === OFFSCREEN_CANCEL && isSessionId(message.sessionId)) {
    for (const controller of translations.get(message.sessionId) ?? []) controller.abort();
    respond({ ok: true });
    return;
  }
  if (message.type !== OFFSCREEN_TRANSLATE) return;
  if (
    !isTranslationRequest({ ...message, type: TRANSLATE }) ||
    !isTranslationProvider(message.provider) ||
    !isSessionId(message.requestId) ||
    !isSessionId(message.sessionId) ||
    typeof message.text !== "string" ||
    (message.target !== "ja" && message.target !== "ja-easy") ||
    (message.priority !== "selection" && message.priority !== "page")
  ) {
    respond({ requestId: message.requestId, ok: false, error: "翻訳リクエストが不正です。" });
    return;
  }
  const { sessionId, text, target, provider, requestId, priority } = message;
  const controller = new AbortController();
  const controllers = translations.get(sessionId) ?? new Set<AbortController>();
  controllers.add(controller);
  translations.set(sessionId, controllers);
  void (async () => {
    try {
      let lastUpdate = 0;
      const sendUpdate = (update: TranslationUpdate) => {
        if (controller.signal.aborted) return;
        const now = Date.now();
        if (update.kind === "text" && now - lastUpdate < 60) return;
        if (update.kind === "text") lastUpdate = now;
        void browser.runtime
          .sendMessage({
            type: TRANSLATION_PROGRESS,
            sessionId,
            requestId,
            update,
          })
          .catch(() => {});
      };
      const options: TranslationOptions = {
        signal: controller.signal,
        priority,
        onProgress: (message: string) => sendUpdate({ kind: "status", message }),
        onText: (text: string) => sendUpdate({ kind: "text", text }),
      };
      const result =
        provider.kind === "browser"
          ? await (
              await import("../../features/translate/engine")
            ).translate(text, target, provider.model, options)
          : await (
              await import("../../features/translate/ollama")
            ).translateWithOllama(text, target, provider.model, options);
      respond({ requestId, ok: true, ...result });
    } catch (error) {
      respond({ requestId, ok: false, error: errorText(error) });
    } finally {
      controllers.delete(controller);
      if (!controllers.size) translations.delete(sessionId);
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
