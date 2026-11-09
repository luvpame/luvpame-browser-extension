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
    const stop = watchFeatures((settings) => {
      enabled = settings.translationEnabled;
      controller.setEnabled(enabled);
    });
    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (sender.id !== browser.runtime.id || sender.tab || !isRecord(message)) return;
      if (message.type === PAGE_TRANSLATION) return Promise.resolve(controller.toggle());
      if (message.type === ARTICLE_REQUEST)
        return enabled
          ? extractArticle().catch((error: unknown) => ({
              ok: false,
              error: error instanceof Error ? error.message : "本文を取得できませんでした。",
            }))
          : Promise.resolve({ ok: false, error: "翻訳はOFFです。" });
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
      stop();
      controller.dispose();
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
