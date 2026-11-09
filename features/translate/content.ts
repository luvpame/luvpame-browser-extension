import { browser } from "wxt/browser";
import { CANCEL_TRANSLATION, TRANSLATE, isTranslationResult } from "./shared";

const OWN = "data-luvpame-translation";
const EXCLUDED = `script,style,noscript,code,pre,input,textarea,select,button,svg,canvas,iframe,nav,footer,aside,[contenteditable]:not([contenteditable="false"]),[role="navigation"],[role="menu"],[role="textbox"],[role="banner"],[role="complementary"],[hidden],[aria-hidden="true"],[${OWN}]`;
const BLOCKS = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dt,dd,figcaption,div";
const english = (text: string) => /[A-Za-z]{2,}/.test(text);
const sourceText = (element: Element) => {
  if (!element.querySelector(EXCLUDED)) return element.textContent?.trim() ?? "";
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  copy.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
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
    const end = sentence > 600 ? sentence + 1 : space > 600 ? space : 1200;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function paragraphs(root: ParentNode): Element[] {
  return Array.from(root.querySelectorAll(BLOCKS)).filter(
    (element) =>
      !element.closest(EXCLUDED) &&
      !Array.from(element.querySelectorAll(BLOCKS)).some((child) => !child.closest(`[${OWN}]`)) &&
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
  copy.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
  const result = new Defuddle(copy, { url: doc.location.href }).parse();
  const article = new DOMParser().parseFromString(result.content, "text/html");
  article.querySelectorAll(EXCLUDED).forEach((node) => node.remove());
  const texts: string[] = [];
  const walker = article.createTreeWalker(article.body, NodeFilter.SHOW_TEXT);
  let previousBlock: Element | null = null;
  let paragraph = "";
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (!parent || parent.closest(EXCLUDED)) continue;
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
  let running = false;
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
  const createOutput = (text: string) => {
    const host = doc.createElement("div");
    host.setAttribute(OWN, "");
    const shadow = host.attachShadow({ mode: "open" });
    const output = doc.createElement("div");
    output.lang = "ja";
    output.style.cssText =
      "font:16px/1.7 system-ui,sans-serif;color:#183d30;background:#eef7f0;border-left:3px solid #398863;padding:8px 12px;margin:6px 0 12px;white-space:pre-wrap;overflow-wrap:anywhere;text-align:left;";
    output.textContent = text;
    shadow.append(output);
    return { host, output };
  };
  const pump = async () => {
    if (running || !active) return;
    running = true;
    const epoch = generation;
    const id = sessionId;
    try {
      for (const [element, entry] of entries) {
        if (!active || epoch !== generation) break;
        if (entry.state !== "queued") continue;
        entry.state = "running";
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
        }
      }
    } finally {
      running = false;
      if (active && Array.from(entries.values()).some((entry) => entry.state === "queued"))
        void pump();
    }
  };
  const refresh = () => {
    if (!active) return;
    const candidates = new Set(paragraphs(doc).filter((node) => english(sourceText(node))));
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
        ...createOutput("翻訳を待っています…"),
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
      "all:initial;position:fixed;z-index:2147483647;max-width:calc(100vw - 16px);";
    const shadow = host.attachShadow({ mode: "open" });
    const style = doc.createElement("style");
    style.textContent =
      ":host{color-scheme:light}button{font:15px system-ui;cursor:pointer;border:1px solid #849b8d;border-radius:7px;background:#fff;color:#17382b;padding:8px 12px}button:focus-visible{outline:3px solid #26865f}.panel{box-sizing:border-box;max-height:60vh;overflow:auto;width:320px;max-width:calc(100vw - 16px);font:16px/1.65 system-ui;color:#183d30;background:#f5fbf5;border:1px solid #849b8d;border-radius:8px;padding:12px;box-shadow:0 4px 20px #0003}.text{white-space:pre-wrap;overflow-wrap:anywhere}";
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
      const close = doc.createElement("button");
      close.type = "button";
      close.textContent = "閉じる";
      close.addEventListener("click", closeSelection);
      const output = doc.createElement("div");
      output.className = "text";
      output.lang = "ja";
      output.setAttribute("role", "status");
      output.textContent = "翻訳しています…";
      panel.append(close, output);
      button.replaceWith(panel);
      close.focus();
      void translate(text, id, () => selectionSession === id)
        .then((result) => {
          if (selectionSession === id && result !== undefined) output.textContent = result;
        })
        .catch((error) => {
          if (selectionSession === id)
            output.textContent = error instanceof Error ? error.message : "翻訳に失敗しました。";
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
          attributeFilter: ["hidden", "aria-hidden", "contenteditable"],
        });
        refresh();
      }
      return { ok: true, active };
    },
    progress(id: string, message: string) {
      if (id === sessionId)
        for (const entry of entries.values())
          if (entry.state !== "done") entry.output.textContent = message;
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
