import { defineContentScript } from "#imports";
import { browser } from "wxt/browser";
import { watchFeatures } from "../lib/features";
import { readTranslationMode } from "../features/translate/settings";
import { errorText, isRecord } from "../lib/copy-protocol";
import { createTranslationController } from "../features/translate/content";
import { createXAutoTranslationController } from "../features/x-auto-translation/content";
import {
  PAGE_TRANSLATION,
  TRANSLATION_PROGRESS,
  TRANSLATION_READY,
  isTranslationUpdate,
} from "../features/translate/shared";

export default defineContentScript({
  matches: ["http://*/*", "https://*/*"],
  main(ctx) {
    const controller = createTranslationController();
    const x = /^(?:x|twitter)\.com$/.test(location.hostname)
      ? createXAutoTranslationController()
      : undefined;
    let xEnabled = false;
    let pageActive = false;
    const syncX = () => x?.setEnabled(xEnabled && !pageActive);
    const ready = new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
      const stop = watchFeatures(
        (settings) => {
          controller.setEnabled(settings.translationEnabled);
          pageActive &&= settings.translationEnabled;
          xEnabled = settings.xAutoTranslationEnabled;
          syncX();
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
      if (message.type === TRANSLATION_READY) {
        respond({ ok: true });
        return;
      }
      if (
        message.type === PAGE_TRANSLATION &&
        (message.target === "ja" || message.target === "ja-easy")
      ) {
        const target = message.target;
        void ready.then(async (result) => {
          if (ctx.isInvalid) return;
          if (!result.ok) {
            respond(result);
            return;
          }
          try {
            const mode = await readTranslationMode();
            if (ctx.isInvalid) return;
            x?.setEnabled(false);
            const result = controller.toggle(mode, target);
            pageActive = result.active === true;
            syncX();
            respond(result);
          } catch (error) {
            if (!ctx.isInvalid) respond({ ok: false, error: errorText(error) });
          }
        });
        return true;
      }
      if (
        message.type === TRANSLATION_PROGRESS &&
        typeof message.sessionId === "string" &&
        typeof message.requestId === "string" &&
        isTranslationUpdate(message.update)
      )
        controller.progress(message.sessionId, message.requestId, message.update);
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.addEventListener(window, "wxt:locationchange", () => {
      controller.reset();
      pageActive = false;
      syncX();
    });
    ctx.addEventListener(window, "pagehide", () => {
      controller.reset();
      pageActive = false;
      x?.reset();
      syncX();
    });
    ctx.onInvalidated(() => {
      controller.dispose();
      x?.dispose();
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
