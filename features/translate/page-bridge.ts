import { browser } from "wxt/browser";
import { errorText, isRecord } from "../../lib/copy-protocol";
import { ARTICLE_REQUEST, PAGE_TRANSLATION, TRANSLATION_READY } from "./shared";

async function hasTranslationReceiver(tabId: number): Promise<boolean> {
  try {
    const response: unknown = await browser.tabs.sendMessage(
      tabId,
      { type: TRANSLATION_READY },
      { frameId: 0 },
    );
    return isRecord(response) && response.ok === true;
  } catch (error) {
    if (errorText(error) !== "Could not establish connection. Receiving end does not exist.")
      throw error;
    return false;
  }
}

export async function sendPageTranslationMessage(
  tabId: number,
  type: typeof PAGE_TRANSLATION | typeof ARTICLE_REQUEST,
): Promise<unknown> {
  if (!(await hasTranslationReceiver(tabId))) {
    await browser.scripting.executeScript({
      target: { tabId, frameIds: [0] },
      files: ["/content-scripts/translate.js"],
    });
    if (!(await hasTranslationReceiver(tabId)))
      throw new Error("翻訳機能への接続を確認できませんでした。");
  }
  return browser.tabs.sendMessage(tabId, { type }, { frameId: 0 });
}
