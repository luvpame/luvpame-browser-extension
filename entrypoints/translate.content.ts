import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { watchFeatures } from "../lib/features";
import { isRecord } from "../lib/copy-protocol";
import { createTranslationController, extractArticle } from "../features/translate/content";
import {
  ARTICLE_REQUEST,
  PAGE_TRANSLATION,
  TRANSLATION_PROGRESS,
} from "../features/translate/shared";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main(ctx) {
    const controller = createTranslationController();
    let enabled = false;
    const ready = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
      const stop = watchFeatures(
        (settings) => {
          enabled = settings.translationEnabled;
          controller.setEnabled(enabled);
          resolve({ ok: true });
        },
        (error) =>
          resolve({
            ok: false,
            error: error instanceof Error ? error.message : "設定を読み込めませんでした。",
          }),
      );
      ctx.onInvalidated(stop);
    });
    const onMessage = (
      message: unknown,
      sender: { id?: string; tab?: unknown },
      respond: (response: unknown) => void,
    ) => {
      if (sender.id !== browser.runtime.id || sender.tab || !isRecord(message)) return;
      if (message.type === PAGE_TRANSLATION || message.type === ARTICLE_REQUEST) {
        void ready.then((result) => {
          if (ctx.isInvalid) return;
          if (!result.ok) {
            respond(result);
            return;
          }
          if (message.type === PAGE_TRANSLATION) {
            respond(controller.toggle());
            return;
          }
          if (!enabled) {
            respond({ ok: false, error: "翻訳はOFFです。" });
            return;
          }
          void extractArticle().then(respond, (error: unknown) =>
            respond({
              ok: false,
              error: error instanceof Error ? error.message : "本文を取得できませんでした。",
            }),
          );
        });
        return true;
      }
      if (
        message.type === TRANSLATION_PROGRESS &&
        typeof message.sessionId === "string" &&
        typeof message.message === "string"
      )
        controller.progress(message.sessionId, message.message);
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.addEventListener(window, "wxt:locationchange", () => controller.reset());
    ctx.addEventListener(window, "pagehide", () => controller.reset());
    ctx.onInvalidated(() => {
      controller.dispose();
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
