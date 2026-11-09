import { browser } from "wxt/browser";

let creating: Promise<void> | undefined;
export const ensureOffscreen = async (): Promise<void> => {
  creating ??= (async () => {
    if (!(await browser.offscreen.hasDocument()))
      await browser.offscreen.createDocument({
        url: "offscreen.html",
        reasons: [browser.offscreen.Reason.CLIPBOARD, browser.offscreen.Reason.WORKERS],
        justification: "Markdownのコピーと、端末内のPLaMo翻訳を実行します。",
      });
  })().finally(() => {
    creating = undefined;
  });
  await creating;
};
