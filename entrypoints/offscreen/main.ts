import { browser } from "wxt/browser";
import { isOffscreenRequest, errorText } from "../../lib/copy-protocol";
import { convertHtml, writeClipboard } from "../../lib/offscreen-copy";
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
