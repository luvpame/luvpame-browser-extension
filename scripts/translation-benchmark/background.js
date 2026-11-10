import { registerTranslationBackground } from "../../features/translate/background";

registerTranslationBackground();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message.type === "bench:reset" && sender.tab) {
    (async () => {
      if (await chrome.offscreen.hasDocument()) await chrome.offscreen.closeDocument();
      await chrome.storage.local.set({
        translationEnabled: true,
        translationBackend: "browser",
        translationModel: BENCH_MODEL,
      });
      respond({ ok: true });
    })().catch((error) => respond({ ok: false, error: String(error) }));
    return true;
  }
  if (message.type === "bench:telemetry" && !sender.tab) {
    chrome.tabs
      .query({ url: "http://127.0.0.1:8817/*" })
      .then(async (tabs) => {
        await Promise.all(
          tabs.map((tab) => chrome.tabs.sendMessage(tab.id, message).catch(() => {})),
        );
        respond({ ok: true });
      })
      .catch((error) => respond({ ok: false, error: String(error) }));
    return true;
  }
});
