import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { watchFeatures } from "../lib/features";
import { isRecord } from "../lib/copy-protocol";
import { createLinearReviewGuideController } from "../features/linear-review-guide/content";
import { TRANSLATION_PROGRESS, isTranslationUpdate } from "../features/translate/shared";

export default defineContentScript({
  matches: ["https://linear.app/*"],
  main(ctx) {
    const controller = createLinearReviewGuideController();
    const stop = watchFeatures((settings) => {
      controller.setEnabled(settings.linearReviewGuideTranslationEnabled);
    });
    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab ||
        !isRecord(message) ||
        message.type !== TRANSLATION_PROGRESS ||
        typeof message.sessionId !== "string" ||
        typeof message.requestId !== "string" ||
        !isTranslationUpdate(message.update)
      )
        return;
      controller.progress(message.sessionId, message.requestId, message.update);
    };
    browser.runtime.onMessage.addListener(onMessage);
    if ("navigation" in window && window.navigation instanceof EventTarget) {
      // navigate通知はURL確定前に届くため、コミット後に翻訳を開始する。
      ctx.addEventListener(window.navigation, "currententrychange", () => controller.refresh());
    } else {
      ctx.addEventListener(window, "wxt:locationchange", () => controller.refresh());
    }
    ctx.addEventListener(window, "pagehide", () => controller.reset());
    ctx.addEventListener(window, "pageshow", () => controller.refresh());
    ctx.onInvalidated(() => {
      stop();
      controller.dispose();
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
