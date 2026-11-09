import { browser } from "wxt/browser";
import { readFeatures } from "./features";
import { buildMarkdownLink } from "./markdown-link";
import { ensureOffscreen } from "./offscreen";
import {
  type CopyKind,
  type CopyResult,
  type OffscreenRequest,
  OFFSCREEN_REQUEST,
  NOTION_REQUEST,
  isNotionUrl,
  isRecord,
  errorText,
} from "./copy-protocol";

export const copyTab = async (tabId: number, kind: CopyKind): Promise<CopyResult> => {
  try {
    const settings = await readFeatures();
    if (!settings[kind === "url" ? "urlCopyEnabled" : "bodyCopyEnabled"])
      throw new Error("このコピー機能はOFFです。");
    const tab = await browser.tabs.get(tabId);
    const url = tab.url ?? "";
    const scheme = new URL(url).protocol;
    if (
      kind === "url"
        ? !["http:", "https:"].includes(scheme)
        : !["http:", "https:", "file:"].includes(scheme)
    )
      throw new Error("このページではコピーを実行できません。");
    let mode: OffscreenRequest["mode"] = "text";
    let text: string;
    if (kind === "url") text = buildMarkdownLink(tab.title ?? "", url);
    else if (isNotionUrl(url)) {
      const result: unknown = await browser.tabs.sendMessage(tabId, { type: NOTION_REQUEST });
      if (!isRecord(result) || result.success !== true || typeof result.markdown !== "string")
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "Notionの本文を取得できません。ページを再読み込みしてください。",
        );
      text = result.markdown;
    } else {
      const results = await browser.scripting.executeScript({
        target: { tabId },
        func: () => ({ html: document.documentElement.outerHTML, url: location.href }),
      });
      const snapshot = results[0]?.result;
      if (!snapshot || snapshot.url !== url)
        throw new Error("ページが移動しました。もう一度実行してください。");
      text = snapshot.html;
      mode = "html";
    }
    await ensureOffscreen();
    const requestId = crypto.randomUUID();
    const result: unknown = await browser.runtime.sendMessage({
      type: OFFSCREEN_REQUEST,
      requestId,
      mode,
      text,
      url,
    } satisfies OffscreenRequest);
    if (!isRecord(result) || result.requestId !== requestId || result.ok !== true)
      throw new Error(
        isRecord(result) && typeof result.error === "string"
          ? result.error
          : "コピーに失敗しました。",
      );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorText(error) };
  }
};
