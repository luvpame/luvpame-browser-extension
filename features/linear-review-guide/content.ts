import { browser } from "wxt/browser";
import { isRecord } from "../../lib/copy-protocol";
import { createTranslationController } from "../translate/content";
import { TRANSLATE, TRANSLATE_BATCH } from "../translate/shared";

export function createLinearReviewGuideController({
  doc = document,
  send = (message) => browser.runtime.sendMessage(message),
}: {
  doc?: Document;
  send?: (message: unknown) => Promise<unknown>;
} = {}) {
  const controller = createTranslationController({
    doc,
    scope: {
      roots: "[data-guide-section-text] [data-guide-overview]",
      blocks:
        'p,[data-as="p"],li,blockquote,td,th,dt,dd,figcaption,[data-guide-overview] div > span',
      textUnit: "inline",
    },
    send: (message) =>
      send(
        isRecord(message) && (message.type === TRANSLATE || message.type === TRANSLATE_BATCH)
          ? { ...message, feature: "linear-review-guide" }
          : message,
      ),
  });
  controller.setEnabled(true);
  let enabled = false;
  let activePath: string | undefined;
  const refresh = () => {
    const pathname = doc.location.pathname;
    const nextPath =
      enabled && /^\/[^/]+\/review\/[^/]+\/review\/?$/.test(pathname) ? pathname : undefined;
    if (nextPath === activePath) return;
    controller.reset();
    activePath = nextPath;
    if (nextPath) controller.toggle("replace", "ja");
  };
  return {
    setEnabled(value: boolean) {
      enabled = value;
      refresh();
    },
    refresh,
    progress: controller.progress,
    reset() {
      activePath = undefined;
      controller.reset();
    },
    dispose: controller.dispose,
  };
}
