const css = `
[data-luvpame-status-bar] {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-width: 0;
  max-height: 28px;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
}
[data-luvpame-status-bar] > [data-luvpame-status-bar-brand] {
  flex: none;
  font-weight: 600;
  white-space: nowrap;
}
[data-luvpame-status-bar] > label {
  flex: 0 1 240px;
  min-width: 0;
  max-width: 32vw;
  font-size: 0;
}
[data-luvpame-status-bar] > label:has(input:disabled) {
  display: none;
}
[data-luvpame-status-bar] input[type="file"] {
  display: block !important;
  box-sizing: border-box;
  width: 100%;
  max-width: 100% !important;
  margin: 0 !important;
  color: inherit;
  font: inherit;
}
[data-luvpame-status-bar] > [role="status"] {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
[data-luvpame-status-bar] > button {
  flex: none;
  height: 22px;
  padding: 2px 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
[data-luvpame-status-bar] :is(button, input):focus-visible {
  outline: 2px solid #a9baff;
  outline-offset: 1px;
}
`;

export function applyStatusBar(panel: HTMLElement): void {
  const host = panel.ownerDocument.querySelector(
    "[data-agent-toolbar-bounds] > div > div:first-child",
  );
  if (!host) throw new Error("Linearの下部ステータスバーが見つかりません。");
  panel.dataset.luvpameStatusBar = "";
  panel.removeAttribute("style");
  if (!panel.hasAttribute("role")) panel.setAttribute("role", "region");
  if (!panel.hasAttribute("aria-label")) panel.setAttribute("aria-label", "Guide翻訳");
  if (!panel.querySelector(":scope > [data-luvpame-status-bar-brand]")) {
    const brand = panel.ownerDocument.createElement("span");
    brand.dataset.luvpameStatusBarBrand = "";
    brand.textContent = "Guide翻訳";
    brand.title = "Guideの英語の説明文だけを日本語に自動翻訳します。";
    panel.prepend(brand);
  }
  let style = panel.querySelector<HTMLStyleElement>(
    ":scope > style[data-luvpame-status-bar-style]",
  );
  if (!style) {
    style = panel.ownerDocument.createElement("style");
    style.dataset.luvpameStatusBarStyle = "";
    panel.append(style);
  }
  style.textContent = css;
  for (const label of panel.querySelectorAll("label")) {
    if (!label.title) label.title = label.textContent?.trim() ?? "";
  }
  if (panel.dataset.luvpameTranslation === "offline-guide") {
    const stop = panel.querySelector<HTMLButtonElement>(":scope > button");
    if (stop?.textContent === "停止") {
      stop.textContent = "翻訳を停止";
      stop.title = "翻訳を停止し、原文に戻します。モデルも終了します。";
    }
  }
  host.append(panel);
}
