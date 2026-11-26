import { browser } from "wxt/browser";
import css from "./style.css?inline";
import { splitTranslationText } from "../translate/content";
import {
  CANCEL_TRANSLATION_REQUEST,
  REPRIORITIZE_TRANSLATIONS,
  TRANSLATE,
  isTranslationResult,
} from "../translate/shared";

const POSTS =
  '[data-testid="primaryColumn"] article[data-testid="tweet"] [data-testid="tweetText"]';
const SHOW_MORE = '[data-testid="tweet-text-show-more-link"]';
const HOST = "data-luvpame-x-translation";

type View = { host: HTMLElement; button: HTMLButtonElement; output: HTMLElement };
type Saved = { hadStyle: boolean; display: string; priority: string; ariaHidden: string | null };
type Source = { text: string; lang: string | null };
type Shown =
  | (Source & { state: "translated"; view: View; saved: Saved })
  | (Source & { state: "original"; view: View });
type Post =
  | (Source & { state: "waiting" | "skipped" | "failed" })
  | (Source & { state: "translating"; requestIds: string[] })
  | Shown
  | { state: "native" };

const isEnglish = ({ text, lang }: Source) => {
  if (lang && lang.toLowerCase() !== "und") return /^en(?:-|$)/i.test(lang);
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z]/g)?.length ?? 0;
  return latin >= 12 && latin >= letters * 0.9;
};
const buttonsIn = (element: Element) => [
  ...(element.matches('button,[role="button"]') ? [element] : []),
  ...element.querySelectorAll('button,[role="button"]'),
];
const controlLabel = (button: Element) =>
  `${button.getAttribute("aria-label") ?? ""} ${button.textContent ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
// Xの翻訳ボタンは表示言語で文言が変わるため、本文直前の構造と文言の両方で判定する。
const hasNativeControl = (element: Element) => {
  for (
    let node: Element | null = element, depth = 0;
    node && depth < 4 && !node.matches("article");
    node = node.parentElement, depth += 1
  ) {
    const parent = node.parentElement;
    if (!parent) continue;
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(node);
    if (index <= 0) continue;
    const buttons = siblings
      .slice(0, index)
      .filter((sibling) => !sibling.hasAttribute(HOST))
      .flatMap(buttonsIn);
    if (!buttons.length) continue;
    const labels = buttons.map(controlLabel);
    if (labels.some((label) => /翻訳|原文|translat|original/i.test(label))) return true;
    if (buttons.length === 1) {
      const button = buttons[0]!;
      const text = button.textContent?.trim() ?? "";
      if (text.length > 0 && text.length <= 40 && !button.hasAttribute("data-testid")) return true;
    }
  }
  return false;
};

export function createXAutoTranslationController({
  doc = document,
  send = (message) => browser.runtime.sendMessage(message),
}: { doc?: Document; send?: (message: unknown) => Promise<unknown> } = {}) {
  const win = doc.defaultView;
  if (!win) throw new Error("ページが見つかりません。");
  const sessionId = crypto.randomUUID();
  const posts = new Map<HTMLElement, Post>();
  const visible = new Set<Element>();
  let active = false;
  let frame: number | undefined;
  const sheet = (() => {
    try {
      const constructed = new win.CSSStyleSheet();
      constructed.replaceSync(css);
      return constructed;
    } catch {
      return undefined;
    }
  })();

  const viewportDistance = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return Math.min(
      1e7,
      Math.max(
        0,
        -rect.bottom,
        rect.top - win.innerHeight,
        -rect.right,
        rect.left - win.innerWidth,
      ),
    );
  };
  const sourceText = (element: Element) => {
    let text = "";
    const walker = doc.createTreeWalker(
      element,
      win.NodeFilter.SHOW_ELEMENT | win.NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof win.Text) text += node.data;
      else if (node instanceof win.HTMLImageElement) text += node.alt;
    }
    return text.trim();
  };
  const hide = (element: HTMLElement): Saved => {
    const saved = {
      hadStyle: element.hasAttribute("style"),
      display: element.style.getPropertyValue("display"),
      priority: element.style.getPropertyPriority("display"),
      ariaHidden: element.getAttribute("aria-hidden"),
    };
    element.style.setProperty("display", "none", "important");
    element.setAttribute("aria-hidden", "true");
    return saved;
  };
  const reveal = (element: HTMLElement, saved: Saved) => {
    if (saved.display) element.style.setProperty("display", saved.display, saved.priority);
    else element.style.removeProperty("display");
    if (!saved.hadStyle && !element.getAttribute("style")) element.removeAttribute("style");
    if (saved.ariaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", saved.ariaHidden);
  };
  const place = (element: HTMLElement, view: View) => {
    if (element.previousElementSibling !== view.host) element.before(view.host);
  };
  const render = (element: HTMLElement, post: Shown) => {
    posts.set(element, post);
    post.view.button.textContent = post.state === "translated" ? "原文を表示" : "翻訳を表示";
    post.view.output.hidden = post.state !== "translated";
    place(element, post.view);
  };
  const withdraw = (element: HTMLElement, post: Post) => {
    if (post.state === "translating")
      for (const requestId of post.requestIds)
        void send({ type: CANCEL_TRANSLATION_REQUEST, sessionId, requestId }).catch(() => {});
    if (post.state === "translated") reveal(element, post.saved);
    if (post.state === "translated" || post.state === "original") post.view.host.remove();
  };
  const show = (element: HTMLElement, source: Source, translation: string) => {
    const host = doc.createElement("div");
    host.setAttribute(HOST, "");
    const computed = win.getComputedStyle(element);
    for (const property of [
      "color",
      "font-family",
      "font-size",
      "font-weight",
      "line-height",
      "letter-spacing",
    ])
      host.style.setProperty(property, computed.getPropertyValue(property));
    const shadow = host.attachShadow({ mode: "open" });
    if (sheet && "adoptedStyleSheets" in shadow) shadow.adoptedStyleSheets = [sheet];
    else {
      const style = doc.createElement("style");
      style.textContent = css;
      shadow.append(style);
    }
    const button = doc.createElement("button");
    button.type = "button";
    const output = doc.createElement("div");
    output.className = "text";
    output.lang = "ja";
    output.dir = "auto";
    output.textContent = translation;
    shadow.append(button, output);
    // ポストはクリックとEnterで詳細へ遷移するため、切替の操作をXへ伝えない。
    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") event.stopPropagation();
    });
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const post = posts.get(element);
      if (post?.state === "translated") {
        reveal(element, post.saved);
        render(element, { state: "original", text: post.text, lang: post.lang, view: post.view });
      } else if (post?.state === "original")
        render(element, { ...post, state: "translated", saved: hide(element) });
    });
    const view = { host, button, output };
    render(element, { ...source, state: "translated", view, saved: hide(element) });
  };
  const start = (element: HTMLElement, source: Source) => {
    const requests = splitTranslationText(source.text).map((text) => ({
      text,
      requestId: crypto.randomUUID(),
    }));
    const post: Post = {
      ...source,
      state: "translating",
      requestIds: requests.map(({ requestId }) => requestId),
    };
    posts.set(element, post);
    const distance = viewportDistance(element);
    const translate = async () => {
      const results = await Promise.all(
        requests.map(({ text, requestId }) =>
          send({
            type: TRANSLATE,
            text,
            target: "ja",
            sessionId,
            requestId,
            priority: "page",
            viewportDistance: distance,
            feature: "x-auto-translation",
          }),
        ),
      );
      const texts = results.map((result) =>
        isTranslationResult(result) && result.ok ? result.text.trim() : "",
      );
      if (texts.some((text) => !text)) throw new Error("翻訳に失敗しました。");
      return texts.join("\n");
    };
    void translate().then(
      (translation) => {
        if (posts.get(element) === post) show(element, source, translation);
      },
      () => {
        if (posts.get(element) !== post) return;
        withdraw(element, post);
        posts.set(element, { ...source, state: "failed" });
      },
    );
  };
  const scan = () => {
    frame = undefined;
    if (!active) return;
    const found = new Set(
      Array.from(doc.querySelectorAll(POSTS)).filter(
        (element): element is HTMLElement => element instanceof win.HTMLElement,
      ),
    );
    for (const [element, post] of posts) {
      if (found.has(element)) continue;
      withdraw(element, post);
      posts.delete(element);
      visible.delete(element);
      intersection?.unobserve(element);
    }
    for (const element of found) {
      let post = posts.get(element);
      if (post?.state === "native") continue;
      const lang = element.getAttribute("lang");
      const text = sourceText(element);
      const languageChanged = !!post && post.lang !== lang;
      const textChanged = !!post && post.text !== text;
      if (hasNativeControl(element) || (languageChanged && textChanged)) {
        if (post) withdraw(element, post);
        posts.set(element, { state: "native" });
        continue;
      }
      if (post && languageChanged && !textChanged) post.lang = lang;
      if (post && textChanged) {
        withdraw(element, post);
        post = undefined;
      }
      if (!post) {
        const source = { text, lang };
        const truncated = !!(element.parentElement ?? element).querySelector(SHOW_MORE);
        post = { ...source, state: isEnglish(source) && !truncated ? "waiting" : "skipped" };
        posts.set(element, post);
        if (post.state === "waiting") intersection?.observe(element);
      }
      if (post.state === "translated" || post.state === "original") place(element, post.view);
      else if (post.state === "waiting" && (!intersection || visible.has(element)))
        start(element, post);
    }
  };
  const schedule = () => {
    if (!active || frame !== undefined) return;
    if (typeof win.requestAnimationFrame !== "function") scan();
    else frame = win.requestAnimationFrame(scan);
  };
  const onIntersection = (entries: IntersectionObserverEntry[]) => {
    for (const entry of entries) {
      if (!(entry.target instanceof win.HTMLElement)) continue;
      if (entry.isIntersecting) {
        visible.add(entry.target);
        continue;
      }
      visible.delete(entry.target);
      const post = posts.get(entry.target);
      if (post?.state !== "translating") continue;
      withdraw(entry.target, post);
      posts.set(entry.target, { text: post.text, lang: post.lang, state: "waiting" });
    }
    const updates = Array.from(posts).flatMap(([element, post]) => {
      if (post.state !== "translating") return [];
      const distance = viewportDistance(element);
      return post.requestIds.map((requestId) => ({ requestId, distance }));
    });
    if (updates.length)
      void send({
        type: REPRIORITIZE_TRANSLATIONS,
        sessionId,
        updates: updates.slice(0, 64),
      }).catch(() => {});
    schedule();
  };
  const intersection =
    typeof win.IntersectionObserver === "function"
      ? new win.IntersectionObserver(onIntersection, { rootMargin: "50% 0px" })
      : undefined;
  const mutations = new win.MutationObserver(schedule);
  const clear = () => {
    if (frame !== undefined) win.cancelAnimationFrame?.(frame);
    frame = undefined;
    posts.forEach((post, element) => withdraw(element, post));
    posts.clear();
    visible.clear();
    intersection?.disconnect();
  };
  const setEnabled = (value: boolean) => {
    if (value === active) return;
    active = value;
    if (!value) {
      mutations.disconnect();
      clear();
      return;
    }
    mutations.observe(doc.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["lang"],
    });
    schedule();
  };
  return {
    setEnabled,
    reset() {
      clear();
      schedule();
    },
    dispose: () => setEnabled(false),
  };
}
