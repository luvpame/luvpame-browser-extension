import { browser } from "wxt/browser";
import loadingCss from "./loading.css?inline";
import { CANCEL_TRANSLATION, TRANSLATE, isTranslationResult } from "./shared";

const OWN = "data-luvpame-translation";
const EXCLUDED = `script,style,noscript,code,pre,input,textarea,select,button,svg,canvas,iframe,nav,footer,aside,[contenteditable]:not([contenteditable="false"]),[role="navigation"],[role="menu"],[role="textbox"],[role="banner"],[role="complementary"],[hidden],[aria-hidden="true"],[${OWN}]`;
const PAGE_EXCLUDED = `${EXCLUDED},header,figure,label,.not-prose,.notranslate,.sr-only:not(.not-sr-only),.visually-hidden:not(.not-visually-hidden),.screen-reader-only,[translate="no"],[role="img"],[role="application"],[role="dialog"],[role="toolbar"]`;
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dt,dd,figcaption,div";
const english = (text: string) => /[A-Za-z]{2,}/.test(text);
const sourceText = (element: Element) => {
  if (!element.querySelector(PAGE_EXCLUDED)) return element.textContent?.trim() ?? "";
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  copy.querySelectorAll(PAGE_EXCLUDED).forEach((node) => node.remove());
  return copy.textContent?.trim() ?? "";
};

export function splitTranslationText(text: string): string[] {
  const chunks: string[] = [];
  let remaining = text.trim();
  while (remaining.length > 1200) {
    const prefix = remaining.slice(0, 1200);
    const sentence = Math.max(
      prefix.lastIndexOf(". "),
      prefix.lastIndexOf("? "),
      prefix.lastIndexOf("! "),
      prefix.lastIndexOf("\n"),
    );
    const space = prefix.lastIndexOf(" ");
    let end = sentence > 600 ? sentence + 1 : space > 600 ? space : 1200;
    if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(remaining.slice(end - 1, end + 1))) end -= 1;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function articleRoots(doc: Document): Element[] {
  for (const selector of [
    '[itemprop~="articleBody"]',
    'main article,[role="main"] article',
    'main,[role="main"]',
    "article",
  ]) {
    const roots = Array.from(doc.querySelectorAll(selector)).filter(
      (element) => !element.closest(PAGE_EXCLUDED),
    );
    if (roots.length)
      return roots.filter((root) => !roots.some((other) => other !== root && other.contains(root)));
  }
  return [doc.body];
}

function paragraphs(root: Element): Element[] {
  return [root, ...root.querySelectorAll(BLOCKS)].filter(
    (element) =>
      element.matches(BLOCKS) &&
      !element.closest(PAGE_EXCLUDED) &&
      !Array.from(element.querySelectorAll(BLOCKS)).some(
        (child) => !child.closest(PAGE_EXCLUDED),
      ) &&
      sourceText(element).length > 0,
  );
}

export async function extractArticle(
  doc: Document = document,
): Promise<
  { ok: true; url: string; title: string; paragraphs: string[] } | { ok: false; error: string }
> {
  const { default: Defuddle } = await import("defuddle/full");
  const copy = new DOMParser().parseFromString(doc.documentElement.outerHTML, "text/html");
  const roots = articleRoots(copy);
  if (!roots.includes(copy.body)) copy.body.replaceChildren(...roots);
  copy.querySelectorAll(PAGE_EXCLUDED).forEach((node) => node.remove());
  const result = new Defuddle(copy, { url: doc.location.href }).parse();
  const article = new DOMParser().parseFromString(result.content, "text/html");
  article.querySelectorAll(PAGE_EXCLUDED).forEach((node) => node.remove());
  const texts: string[] = [];
  const walker = article.createTreeWalker(article.body, NodeFilter.SHOW_TEXT);
  let previousBlock: Element | null = null;
  let paragraph = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || parent.closest(PAGE_EXCLUDED)) continue;
    const block = parent.closest(BLOCKS) ?? article.body;
    if (block !== previousBlock && paragraph.trim()) {
      texts.push(paragraph.trim());
      paragraph = "";
    }
    previousBlock = block;
    paragraph += node.textContent ?? "";
  }
  if (paragraph.trim()) texts.push(paragraph.trim());
  if (!texts.length) return { ok: false, error: "読み取れる本文がありません。" };
  return { ok: true, url: doc.location.href, title: result.title || doc.title, paragraphs: texts };
}

type Send = (message: unknown) => Promise<unknown>;

type Entry = {
  text: string;
  host: HTMLElement;
  output: HTMLElement;
  state: "queued" | "running" | "done";
};

export function createTranslationController({
  doc = document,
  send = (message) => browser.runtime.sendMessage(message),
}: { doc?: Document; send?: Send } = {}) {
  const win = doc.defaultView;
  if (!win) throw new Error("ページが見つかりません。");
  let enabled = false;
  let active = false;
  let generation = 0;
  let sessionId = "";
  let runningGeneration: number | undefined;
  const entries = new Map<Element, Entry>();
  let selectionSession = "";
  let selectionText = "";
  let selectionHost: HTMLElement | undefined;
  let selectionRect: DOMRect | undefined;

  const cancel = (id: string) => {
    if (id) void send({ type: CANCEL_TRANSLATION, sessionId: id }).catch(() => {});
  };
  const translate = async (text: string, id: string, current: () => boolean) => {
    const parts: string[] = [];
    for (const chunk of splitTranslationText(text)) {
      if (!current()) return undefined;
      const result = await send({ type: TRANSLATE, text: chunk, target: "ja", sessionId: id });
      if (!current()) return undefined;
      if (!isTranslationResult(result)) throw new Error("翻訳の応答を読み取れませんでした。");
      if (!result.ok) throw new Error(result.error);
      parts.push(result.text);
    }
    return parts.join("\n");
  };
  const createOutput = (element: Element, text: string) => {
    const host = doc.createElement("div");
    host.setAttribute(OWN, "");
    host.setAttribute("aria-busy", "false");
    host.style.cssText =
      "all:initial;display:block;color:inherit;margin:0.35em 0 0.75em;padding:8px 12px;background:color-mix(in srgb,currentColor 4%,transparent);border-inline-start:1px solid color-mix(in srgb,currentColor 22%,transparent);";
    const original = win.getComputedStyle(element);
    for (const property of [
      "font-family",
      "font-size",
      "font-weight",
      "font-style",
      "line-height",
      "letter-spacing",
      "text-align",
    ]) {
      host.style.setProperty(property, original.getPropertyValue(property));
    }
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = loadingCss;
    const spinner = doc.createElement("span");
    spinner.className = "translation-spinner";
    spinner.setAttribute("aria-hidden", "true");
    const output = doc.createElement("div");
    output.setAttribute("data-translation-text", "");
    output.lang = "ja";
    output.style.cssText = "display:inline;white-space:pre-wrap;overflow-wrap:anywhere;";
    output.textContent = text;
    shadow.append(style, spinner, output);
    return { host, output };
  };
  const pump = async () => {
    if (runningGeneration === generation || !active) return;
    const epoch = generation;
    runningGeneration = epoch;
    const id = sessionId;
    try {
      for (const [element, entry] of entries) {
        if (!active || epoch !== generation) break;
        if (entry.state !== "queued") continue;
        entry.state = "running";
        entry.host.setAttribute("aria-busy", "true");
        const current = () =>
          active &&
          epoch === generation &&
          element.isConnected &&
          entries.get(element) === entry &&
          sourceText(element) === entry.text;
        try {
          const text = await translate(entry.text, id, current);
          if (current() && text !== undefined) entry.output.textContent = text;
        } catch (error) {
          if (current())
            entry.output.textContent =
              error instanceof Error ? error.message : "翻訳に失敗しました。";
        } finally {
          entry.state = "done";
          entry.host.setAttribute("aria-busy", "false");
        }
      }
    } finally {
      if (runningGeneration === epoch) {
        runningGeneration = undefined;
        if (active && Array.from(entries.values()).some((entry) => entry.state === "queued"))
          void pump();
      }
    }
  };
  const refresh = () => {
    if (!active) return;
    const candidates = new Set(
      articleRoots(doc)
        .flatMap(paragraphs)
        .filter((node) => english(sourceText(node))),
    );
    for (const [element, entry] of entries) {
      if (!candidates.has(element) || sourceText(element) !== entry.text) {
        entry.host.remove();
        entries.delete(element);
      } else if (element.matches("td,th,li,dt,dd")) {
        if (element.lastChild !== entry.host) element.append(entry.host);
      } else if (element.nextSibling !== entry.host) element.after(entry.host);
    }
    for (const element of candidates) {
      if (entries.has(element)) continue;
      const entry: Entry = {
        text: sourceText(element),
        ...createOutput(element, "翻訳を待っています…"),
        state: "queued",
      };
      entries.set(element, entry);
      if (element.matches("td,th,li,dt,dd")) element.append(entry.host);
      else element.after(entry.host);
    }
    void pump();
  };
  const observer = new win.MutationObserver(refresh);
  const closeSelection = () => {
    cancel(selectionSession);
    selectionSession = "";
    selectionText = "";
    selectionHost?.remove();
    selectionHost = undefined;
  };
  const positionSelection = () => {
    if (!selectionHost || !selectionRect) return;
    selectionHost.style.left = `${Math.max(8, Math.min(selectionRect.left, win.innerWidth - 320))}px`;
    selectionHost.style.top = `${Math.max(8, Math.min(selectionRect.bottom + 8, win.innerHeight - 180))}px`;
  };
  const onSelection = () => {
    if (!enabled) return;
    const selection = doc.getSelection();
    const text = selection?.toString().trim() ?? "";
    if (!text && selectionHost?.contains(doc.activeElement)) return;
    if (text === selectionText) return;
    closeSelection();
    if (!selection || selection.isCollapsed || !english(text) || !selection.rangeCount) return;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const element = container instanceof Element ? container : container.parentElement;
    if (!element || element.closest(EXCLUDED)) return;
    const fragment = range.cloneContents();
    if (fragment.querySelector(EXCLUDED)) return;
    selectionText = text;
    selectionRect = range.getBoundingClientRect();
    const host = doc.createElement("div");
    host.setAttribute(OWN, "selection");
    host.style.cssText =
      "all:initial;color-scheme:light dark;position:fixed;z-index:2147483647;max-width:calc(100vw - 16px);";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent = `${loadingCss}
      :host {
        color-scheme: light dark;
        --ink: light-dark(#262626, #eeeeee);
        --surface: light-dark(#ffffff, #262626);
        --border: light-dark(#e5e5e5, #525252);
        --accent: light-dark(#525252, #d4d4d4);
      }
      button {
        box-sizing: border-box;
        min-width: 44px;
        min-height: 44px;
        padding: 9px 14px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--surface);
        color: var(--ink);
        font: 600 14px/1.5 system-ui, sans-serif;
        cursor: pointer;
        touch-action: manipulation;
      }
      button:focus-visible {
        outline: 3px solid var(--accent);
        outline-offset: 3px;
      }
      .panel {
        box-sizing: border-box;
        max-height: 60vh;
        overflow: auto;
        overscroll-behavior: contain;
        width: 320px;
        max-width: calc(100vw - 16px);
        padding: 14px 18px 20px;
        border: 1px solid var(--border);
        border-radius: 14px;
        color: var(--ink);
        background: var(--surface);
        font: 16px/1.8 system-ui, sans-serif;
        box-shadow: 0 8px 28px #0000001a, 0 2px 6px #0000000a;
      }
      .panel button {
        display: block;
        margin: 0 0 12px auto;
        min-height: 36px;
        padding: 6px 12px;
        font-weight: 500;
      }
      .text {
        display: inline;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        text-align: left;
      }
      @media (hover: hover) and (pointer: fine) {
        button:hover { background: light-dark(#f5f5f5, #404040); }
        button:active:not(:focus-visible) { transform: scale(0.97); }
        @media (prefers-reduced-motion: no-preference) {
          button:not(:focus-visible) {
            transition: transform 140ms cubic-bezier(0.23, 1, 0.32, 1);
          }
        }
      }
    `;
    const button = doc.createElement("button");
    button.type = "button";
    button.textContent = "訳";
    button.setAttribute("aria-label", "選択した文章を日本語に翻訳");
    button.addEventListener("mousedown", (event) => event.preventDefault());
    button.addEventListener("click", () => {
      const id = crypto.randomUUID();
      selectionSession = id;
      const panel = doc.createElement("div");
      panel.className = "panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-label", "選択した文章の翻訳");
      panel.setAttribute("aria-busy", "true");
      const close = doc.createElement("button");
      close.type = "button";
      close.textContent = "閉じる";
      close.addEventListener("click", closeSelection);
      const output = doc.createElement("div");
      output.className = "text";
      output.lang = "ja";
      output.setAttribute("role", "status");
      output.textContent = "日本語に訳しています…";
      const spinner = doc.createElement("span");
      spinner.className = "translation-spinner";
      spinner.setAttribute("aria-hidden", "true");
      panel.append(close, spinner, output);
      button.replaceWith(panel);
      close.focus();
      void translate(text, id, () => selectionSession === id)
        .then((result) => {
          if (selectionSession === id && result !== undefined) output.textContent = result;
        })
        .catch((error) => {
          if (selectionSession === id)
            output.textContent = error instanceof Error ? error.message : "翻訳に失敗しました。";
        })
        .finally(() => {
          if (selectionSession === id) panel.setAttribute("aria-busy", "false");
        });
    });
    shadow.append(style, button);
    selectionHost = host;
    doc.documentElement.append(host);
    positionSelection();
  };
  const reset = () => {
    active = false;
    generation += 1;
    cancel(sessionId);
    sessionId = "";
    observer.disconnect();
    entries.forEach((entry) => entry.host.remove());
    entries.clear();
    closeSelection();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && selectionHost) {
      closeSelection();
      event.preventDefault();
    }
  };
  doc.addEventListener("selectionchange", onSelection);
  doc.addEventListener("keydown", onKey);
  win.addEventListener("scroll", closeSelection, true);
  win.addEventListener("resize", closeSelection);
  return {
    setEnabled(value: boolean) {
      enabled = value;
      if (!value) reset();
    },
    toggle() {
      if (!enabled) return { ok: false, error: "翻訳はOFFです。" };
      if (active) reset();
      else {
        active = true;
        sessionId = crypto.randomUUID();
        observer.observe(doc.documentElement, {
          subtree: true,
          childList: true,
          characterData: true,
          attributes: true,
          attributeFilter: [
            "hidden",
            "aria-hidden",
            "contenteditable",
            "itemprop",
            "role",
            "translate",
            "class",
          ],
        });
        refresh();
      }
      return { ok: true, active };
    },
    progress(id: string, message: string) {
      if (id === sessionId)
        for (const entry of entries.values())
          if (entry.state === "running") entry.output.textContent = message;
      if (id === selectionSession) {
        const output = selectionHost?.shadowRoot?.querySelector('[role="status"]');
        if (output) output.textContent = message;
      }
    },
    reset,
    dispose() {
      reset();
      doc.removeEventListener("selectionchange", onSelection);
      doc.removeEventListener("keydown", onKey);
      win.removeEventListener("scroll", closeSelection, true);
      win.removeEventListener("resize", closeSelection);
    },
  };
}
