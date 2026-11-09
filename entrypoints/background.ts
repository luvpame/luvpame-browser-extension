import { browser } from "wxt/browser";
import { isCopyRequest, type CopyResult } from "../lib/copy-protocol";
import { copyTab } from "../lib/copy-service";
import { registerTranslationBackground } from "../features/translate/background";

export default defineBackground(() => {
  registerTranslationBackground();
  browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (
      sender.id !== browser.runtime.id ||
      sender.tab ||
      sender.url !== browser.runtime.getURL("/popup.html") ||
      !isCopyRequest(message)
    )
      return;
    void copyTab(message.tabId, message.kind).then(respond);
    return true;
  });
  let badgeTimer: ReturnType<typeof setTimeout> | undefined;
  browser.commands.onCommand.addListener((command) => {
    if (command !== "copy-markdown-link") return;
    void (async () => {
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
      const result: CopyResult =
        tab?.id === undefined
          ? { ok: false, error: "現在のタブが見つかりません。" }
          : await copyTab(tab.id, "url");
      clearTimeout(badgeTimer);
      await browser.action.setBadgeText({ text: result.ok ? "OK" : "NG" });
      await browser.action.setBadgeBackgroundColor({ color: result.ok ? "#16704a" : "#ad3030" });
      badgeTimer = setTimeout(() => {
        void browser.action.setBadgeText({ text: "" });
      }, 4000);
      await browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png"),
        title: result.ok ? "コピー完了" : "コピー失敗",
        message: result.ok ? "URLをMarkdownでコピーしました。" : result.error,
      });
    })().catch(console.error);
  });
});
