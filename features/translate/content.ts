import { browser } from "wxt/browser";
import loadingCss from "./loading.css?inline";
import {
  CANCEL_TRANSLATION,
  TRANSLATE,
  isTranslationResult,
  type TranslationPriority,
  type TranslationMode,
  type TargetLanguage,
  type TranslationUpdate,
} from "./shared";

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

type Send = (message: unknown) => Promise<unknown>;

type Output = { host: HTMLElement; output: HTMLElement };
type Entry = {
  text: string;
  element: Element;
  state: "queued" | "running" | "done";
} & (
  | ({ mode: "below" } & Output)
  | {
      mode: "replace";
      node: Text;
      original: string;
      applied: string | undefined;
      error: Output | undefined;
    }
);

export function createTranslationController({
  doc = document,
  send = (message) => browser.runtime.sendMessage(message),
}: { doc?: Document; send?: Send } = {}) {
  const win = doc.defaultView;
  if (!win) throw new Error("ページが見つかりません。");
  let enabled = false;
  let active: { mode: TranslationMode; target: TargetLanguage } | undefined;
  let generation = 0;
  let sessionId = "";
  let runningGeneration: number | undefined;
  const entries = new Map<Element | Text, Entry>();
  let selectionSession = "";
  let selectionText = "";
  let selectionHost: HTMLElement | undefined;
  let selectionRect: DOMRect | undefined;

  const requests = new Map<
    string,
    { sessionId: string; update: (value: TranslationUpdate) => void }
  >();
  const cancel = (id: string) => {
    if (id) void send({ type: CANCEL_TRANSLATION, sessionId: id }).catch(() => {});
  };
  const translate = async (
    text: string,
    id: string,
    current: () => boolean,
    output: (text: string) => void,
    priority: TranslationPriority,
    target: TargetLanguage,
  ) => {
    const parts: string[] = [];
    for (const chunk of splitTranslationText(text)) {
      if (!current()) return undefined;
      const requestId = crypto.randomUUID();
      requests.set(requestId, {
        sessionId: id,
        update: (value) => {
          if (!current()) return;
          if (value.kind === "text") output([...parts, value.text].join("\n"));
        },
      });
      try {
        const result = await send({
          type: TRANSLATE,
          text: chunk,
          target,
          sessionId: id,
          requestId,
          priority,
        });
        if (!current()) return undefined;
        if (!isTranslationResult(result)) throw new Error("翻訳の応答を読み取れませんでした。");
        if (!result.ok) throw new Error(result.error);
        parts.push(result.text);
        output(parts.join("\n"));
      } finally {
        requests.delete(requestId);
      }
    }
    return parts.join("\n");
  };
  const createOutput = (element: Element) => {
    const host = doc.createElement("div");
    host.setAttribute(OWN, "");
    host.setAttribute("aria-busy", "true");
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
    const indicator = doc.createElement("span");
    indicator.className = "translation-indicator";
    indicator.setAttribute("role", "status");
    indicator.setAttribute("aria-label", "翻訳中");
    const output = doc.createElement("div");
    output.setAttribute("data-translation-text", "");
    output.lang = "ja";
    output.style.cssText = "display:inline;white-space:pre-wrap;overflow-wrap:anywhere;";
    shadow.append(style, indicator, output);
    return { host, output };
  };
  const placeOutput = (element: Element, host: HTMLElement) => {
    if (element.matches("td,th,li,dt,dd")) {
      if (element.lastChild !== host) element.append(host);
    } else if (element.nextSibling !== host) element.after(host);
  };
  const unchanged = (entry: Entry) =>
    entry.mode === "below"
      ? sourceText(entry.element) === entry.text
      : entry.element.contains(entry.node) &&
        !!entry.node.parentElement &&
        !entry.node.parentElement.closest(PAGE_EXCLUDED) &&
        entry.node.data === (entry.applied ?? entry.original);
  const restore = (entry: Entry) => {
    if (entry.mode === "below") entry.host.remove();
    else {
      if (entry.node.data === entry.applied) entry.node.data = entry.original;
      entry.applied = undefined;
      entry.error?.host.remove();
      entry.error = undefined;
    }
  };
  const showText = (entry: Entry, text: string) => {
    if (entry.mode === "below") entry.output.textContent = text;
    else if (text.trim()) {
      const leading = entry.original.match(/^\s*/)?.[0] ?? "";
      const trailing = entry.original.match(/\s*$/)?.[0] ?? "";
      entry.applied = `${leading}${text.trim()}${trailing}`;
      entry.node.data = entry.applied;
    }
  };
  const pump = async () => {
    if (runningGeneration === generation || !active) return;
    const epoch = generation;
    runningGeneration = epoch;
    const id = sessionId;
    const target = active.target;
    const tasks = new Set<Promise<void>>();
    const processEntry = async (key: Element | Text, entry: Entry) => {
      entry.state = "running";
      const current = () =>
        !!active &&
        epoch === generation &&
        key.isConnected &&
        entries.get(key) === entry &&
        unchanged(entry);
      try {
        const text = await translate(
          entry.text,
          id,
          current,
          (text) => {
            showText(entry, text);
          },
          "page",
          target,
        );
        if (current() && text !== undefined) showText(entry, text);
      } catch (error) {
        if (current()) {
          const message = error instanceof Error ? error.message : "翻訳に失敗しました。";
          if (entry.mode === "below") entry.output.textContent = message;
          else {
            restore(entry);
            entry.error = createOutput(entry.element);
            entry.error.output.textContent = message;
            placeOutput(entry.element, entry.error.host);
          }
        }
      } finally {
        entry.state = "done";
        const output = entry.mode === "below" ? entry : entry.error;
        output?.host.setAttribute("aria-busy", "false");
      }
    };
    try {
      while (active && epoch === generation) {
        // 応答待ちで次の波が欠けないよう、実行2件に加えて次の2件を先読みする。
        while (tasks.size < 4) {
          const next = Array.from(entries)
            .filter(([, entry]) => entry.state === "queued")
            .sort(([, a], [, b]) => {
              const distance = (element: Element) => {
                const rect = element.getBoundingClientRect();
                return Math.max(
                  0,
                  -rect.bottom,
                  rect.top - win.innerHeight,
                  -rect.right,
                  rect.left - win.innerWidth,
                );
              };
              return (
                distance(a.element) - distance(b.element) ||
                (a.element === b.element
                  ? 0
                  : a.element.compareDocumentPosition(b.element) &
                      win.Node.DOCUMENT_POSITION_FOLLOWING
                    ? -1
                    : 1)
              );
            })[0];
          if (!next) break;
          const [element, entry] = next;

          const task = processEntry(element, entry);
          tasks.add(task);
          void task.finally(() => tasks.delete(task));
        }
        if (!tasks.size) break;
        await Promise.race(tasks);
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
    const candidates = new Map<Element | Text, Element>();
    for (const element of articleRoots(doc).flatMap(paragraphs)) {
      if (active.mode === "below") {
        if (english(sourceText(element))) candidates.set(element, element);
      } else {
        const walker = doc.createTreeWalker(element, win.NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (
            node instanceof win.Text &&
            node.parentElement &&
            !node.parentElement.closest(PAGE_EXCLUDED)
          )
            candidates.set(node, element);
        }
      }
    }
    for (const [key, entry] of entries) {
      if (!candidates.has(key) || candidates.get(key) !== entry.element || !unchanged(entry)) {
        restore(entry);
        entries.delete(key);
      } else if (entry.mode === "below") placeOutput(entry.element, entry.host);
    }
    for (const [key, element] of candidates) {
      if (entries.has(key)) continue;
      if (active.mode === "below") {
        const entry: Entry = {
          mode: active.mode,
          element,
          text: sourceText(element),
          ...createOutput(element),
          state: "queued",
        };
        entries.set(key, entry);
        placeOutput(element, entry.host);
      } else if (key instanceof win.Text && english(key.data)) {
        entries.set(key, {
          mode: active.mode,
          element,
          node: key,
          original: key.data,
          text: key.data.trim(),
          applied: undefined,
          error: undefined,
          state: "queued",
        });
      }
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
      output.setAttribute("aria-label", "翻訳中");
      const indicator = doc.createElement("span");
      indicator.className = "translation-indicator";
      indicator.setAttribute("aria-hidden", "true");
      panel.append(close, indicator, output);
      button.replaceWith(panel);
      close.focus();
      void translate(
        text,
        id,
        () => selectionSession === id,
        (text) => {
          output.textContent = text;
        },
        "selection",
        "ja",
      )
        .then((result) => {
          if (selectionSession === id && result !== undefined) output.textContent = result;
        })
        .catch((error) => {
          if (selectionSession === id)
            output.textContent = error instanceof Error ? error.message : "翻訳に失敗しました。";
        })
        .finally(() => {
          if (selectionSession === id) {
            panel.setAttribute("aria-busy", "false");
            output.removeAttribute("aria-label");
          }
        });
    });
    shadow.append(style, button);
    selectionHost = host;
    doc.documentElement.append(host);
    positionSelection();
  };
  const reset = () => {
    active = undefined;
    generation += 1;
    cancel(sessionId);
    sessionId = "";
    observer.disconnect();
    entries.forEach(restore);
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
    toggle(nextMode: TranslationMode = "below", nextTarget: TargetLanguage = "ja") {
      if (!enabled) return { ok: false, error: "翻訳はOFFです。" };
      const stop = active?.mode === nextMode && active.target === nextTarget;
      reset();
      if (!stop) {
        active = { mode: nextMode, target: nextTarget };
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
      return { ok: true, active: !!active };
    },
    progress(id: string, requestId: string, update: TranslationUpdate) {
      const request = requests.get(requestId);
      if (request?.sessionId === id) request.update(update);
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
