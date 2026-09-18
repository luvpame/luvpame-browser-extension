import { browser } from "wxt/browser";
import { watchFeatures } from "../lib/features";
import { createCopyMarkdownButtonController } from "../lib/notion/copy-markdown-button";
import { createCopyTitleHoverController } from "../lib/notion/title-copy-hover";
import { createHeadingMarkerController } from "../lib/notion/heading-marker";
import { extractPageMarkdown } from "../lib/notion/markdown-extractor";
import { NOTION_REQUEST, isRecord } from "../lib/copy-protocol";

export default defineContentScript({
  matches: ["https://www.notion.so/*", "https://app.notion.com/*", "https://*.notion.site/*"],
  main(ctx) {
    const copy = createCopyMarkdownButtonController();
    const title = createCopyTitleHoverController();
    const heading = createHeadingMarkerController();
    let bodyEnabled = false;
    const stop = watchFeatures((settings) => {
      bodyEnabled = settings.bodyCopyEnabled;
      copy.setEnabled(settings.copyMarkdownButtonEnabled);
      title.setEnabled(settings.copyTitleHoverEnabled);
      heading.setEnabled(settings.headingMarkerEnabled);
    });
    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (
        sender.id !== browser.runtime.id ||
        sender.tab ||
        !isRecord(message) ||
        message.type !== NOTION_REQUEST
      )
        return;
      return Promise.resolve(
        bodyEnabled ? extractPageMarkdown() : { success: false, error: "本文コピーはOFFです。" },
      );
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.addEventListener(window, "wxt:locationchange", () => {
      copy.refresh();
      title.refresh();
    });
    ctx.addEventListener(document, "turbo:load", () => {
      copy.refresh();
      title.refresh();
    });
    ctx.onInvalidated(() => {
      stop();
      copy.dispose();
      title.dispose();
      heading.dispose();
      browser.runtime.onMessage.removeListener(onMessage);
    });
  },
});
