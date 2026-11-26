import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createXAutoTranslationController } from "./content";
import { isRecord } from "../../lib/copy-protocol";
import {
  CANCEL_TRANSLATION_REQUEST,
  REPRIORITIZE_TRANSLATIONS,
  TRANSLATE,
} from "../translate/shared";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const controllers: { dispose(): void }[] = [];
const article = (body: string) =>
  `<article data-testid="tweet"><div><div data-testid="User-Name"><a href="/someone">Someone</a></div><div>${body}</div></div></article>`;
const tweetText = (content: string, attributes = 'lang="en"') =>
  `<div data-testid="tweetText" ${attributes}>${content}</div>`;
const timeline = (...articles: string[]) =>
  `<div data-testid="primaryColumn">${articles.join("")}</div>`;
const tweet = (index = 0) =>
  document.querySelectorAll<HTMLElement>('[data-testid="tweetText"]')[index]!;
const view = (text: Element) => {
  const host = text.previousElementSibling;
  const root = host?.hasAttribute("data-luvpame-x-translation") ? host.shadowRoot : null;
  return {
    button: root?.querySelector("button") ?? null,
    output: root?.querySelector<HTMLElement>('[lang="ja"]') ?? null,
  };
};
const translated = (text: string) => ({ ok: true, text: `訳: ${text}`, device: "gpu" });
const requests = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls
    .map(([message]) => message)
    .filter((message) => isRecord(message) && message.type === TRANSLATE);
const translator = () =>
  vi.fn(async (message: unknown) =>
    isRecord(message) && message.type === TRANSLATE
      ? translated(String(message.text))
      : { ok: true },
  );
const deferred = () => {
  const pending = new Map<string, () => void>();
  const send = vi.fn((message: unknown): Promise<unknown> => {
    if (!isRecord(message) || message.type !== TRANSLATE) return Promise.resolve({ ok: true });
    const text = String(message.text);
    return new Promise((resolve) => pending.set(text, () => resolve(translated(text))));
  });
  return { send, finish: (text: string) => pending.get(text)?.() };
};
const mount = (send: (message: unknown) => Promise<unknown>) => {
  const controller = createXAutoTranslationController({ send });
  controllers.push(controller);
  controller.setEnabled(true);
  return controller;
};

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("X英語ポスト自動翻訳", () => {
  it("英語のポストは訳文が届いてから原文の直前に表示し、原文の子要素を残して隠す", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>Shipping the new release today</span>")),
    );
    const text = tweet();
    const span = text.firstElementChild;
    const { send, finish } = deferred();
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));
    expect(requests(send)[0]).toMatchObject({
      type: TRANSLATE,
      text: "Shipping the new release today",
      target: "ja",
      priority: "page",
      feature: "x-auto-translation",
    });
    await tick();
    expect(view(text).button).toBeNull();
    expect(text.hasAttribute("style")).toBe(false);

    finish("Shipping the new release today");
    await vi.waitFor(() =>
      expect(view(text).output?.textContent).toBe("訳: Shipping the new release today"),
    );
    expect(view(text).output?.hidden).toBe(false);
    expect(view(text).output?.dir).toBe("auto");
    expect(view(text).button?.textContent).toBe("原文を表示");
    expect(text.style.display).toBe("none");
    expect(text.getAttribute("aria-hidden")).toBe("true");
    expect(text.firstElementChild).toBe(span);
    expect(text.textContent).toBe("Shipping the new release today");
  });

  it("切替ボタンは再翻訳せずに原文と訳文を入れ替え、ポストの遷移操作へ伝えない", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>Hello from the timeline</span>", 'lang="en" style="color: red;"')),
    );
    const text = tweet();
    const post = document.querySelector("article")!;
    const navigate = vi.fn();
    post.addEventListener("click", navigate);
    post.addEventListener("keydown", navigate);
    const send = translator();
    mount(send);
    await vi.waitFor(() => expect(view(text).button?.textContent).toBe("原文を表示"));

    view(text).button!.click();
    expect(view(text).button?.textContent).toBe("翻訳を表示");
    expect(view(text).output?.hidden).toBe(true);
    expect(text.getAttribute("style")).toBe("color: red;");
    expect(text.hasAttribute("aria-hidden")).toBe(false);

    view(text).button!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    view(text).button!.click();
    expect(view(text).button?.textContent).toBe("原文を表示");
    expect(view(text).output?.hidden).toBe(false);
    expect(text.style.display).toBe("none");
    await tick();
    expect(requests(send)).toHaveLength(1);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("日本語・他言語・省略中・タイムライン外のポストは送らず、展開された英語を翻訳する", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>今日は新しい機能を公開しました</span>", 'lang="ja"')),
      article(tweetText("<span>Nous publions la version</span>", 'lang="fr"')),
      article(tweetText("<span>言語の指定がない日本語のポストです</span>", "")),
      article(
        tweetText("<span>A long English post that is cut off</span>") +
          '<button type="button" data-testid="tweet-text-show-more-link">Show more</button>',
      ),
      article(tweetText("<span>English post without any language attribute</span>", "")),
    );
    const sidebar = article(tweetText("<span>Trending English post</span>"));
    document.body.insertAdjacentHTML("beforeend", `<aside>${sidebar}</aside>`);
    const send = translator();
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));
    expect(requests(send)[0]).toMatchObject({
      text: "English post without any language attribute",
    });

    const truncated = tweet(3);
    truncated.parentElement!.querySelector("button")!.remove();
    truncated.firstElementChild!.textContent = "A long English post that is now fully expanded";
    await vi.waitFor(() => expect(requests(send)).toHaveLength(2));
    expect(requests(send)[1]).toMatchObject({
      text: "A long English post that is now fully expanded",
    });
    await vi.waitFor(() => expect(view(truncated).button).not.toBeNull());
    expect(document.querySelectorAll("[data-luvpame-x-translation]")).toHaveLength(2);
  });

  it("Xの翻訳ボタンがあるポストは送らず、後から現れたら要求を取り消してXに任せる", async () => {
    document.body.innerHTML = timeline(
      article(
        '<div><div><button type="button" aria-label="原文を表示"><span>原文を表示</span></button></div></div>' +
          `<div>${tweetText("<span>Already handled by X translation</span>")}</div>`,
      ),
      article(tweetText("<span>Translation that X takes over later</span>")),
    );
    const { send, finish } = deferred();
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));
    const [request] = requests(send);
    expect(request).toMatchObject({ text: "Translation that X takes over later" });

    const control = document.createElement("button");
    control.type = "button";
    control.textContent = "翻訳を表示";
    tweet(1).before(control);
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: CANCEL_TRANSLATION_REQUEST,
        sessionId: request.sessionId,
        requestId: request.requestId,
      }),
    );
    finish("Translation that X takes over later");
    await tick();
    expect(view(tweet(1)).button).toBeNull();
    expect(tweet(1).hasAttribute("style")).toBe(false);
    expect(control.isConnected).toBe(true);
    expect(document.querySelector("article button")?.textContent).toBe("原文を表示");
    expect(requests(send)).toHaveLength(1);
  });

  it("言語属性だけが後から入ったポストはX管理にせず翻訳を続ける", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>English post before language detection</span>", "")),
    );
    const send = translator();
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));

    tweet().setAttribute("lang", "en");
    await tick();
    await tick();
    await vi.waitFor(() =>
      expect(view(tweet()).output?.textContent).toBe("訳: English post before language detection"),
    );
    expect(view(tweet()).button?.textContent).toBe("原文を表示");
  });

  it("Xが本文の言語を切り替えたポストは、翻訳済みなら原文に戻し、以後は翻訳しない", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>Xが日本語に翻訳した本文です</span>", 'lang="ja"')),
      article(tweetText("<span>English post that X translates afterwards</span>")),
    );
    const send = translator();
    mount(send);
    await vi.waitFor(() => expect(view(tweet(1)).button).not.toBeNull());

    tweet(0).setAttribute("lang", "en");
    tweet(0).firstElementChild!.textContent = "The original English text shown again by X";
    tweet(1).setAttribute("lang", "ja");
    tweet(1).firstElementChild!.textContent = "Xが日本語に差し替えた本文";
    await tick();
    await tick();
    expect(requests(send)).toHaveLength(1);
    expect(view(tweet(1)).button).toBeNull();
    expect(tweet(1).hasAttribute("style")).toBe(false);
    expect(tweet(1).hasAttribute("aria-hidden")).toBe(false);
  });

  it("OFFにすると実行中の要求を取り消し、原文のDOMへ完全に戻す", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>First English post</span>", 'lang="en" style="color: red;"')),
      article(tweetText("<span>Second English post still running</span>")),
    );
    const original = document.body.innerHTML;
    const { send, finish } = deferred();
    const controller = mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(2));
    finish("First English post");
    await vi.waitFor(() => expect(view(tweet(0)).button).not.toBeNull());
    const running = requests(send)[1];

    controller.setEnabled(false);
    expect(document.body.innerHTML).toBe(original);
    expect(send).toHaveBeenCalledWith({
      type: CANCEL_TRANSLATION_REQUEST,
      sessionId: running.sessionId,
      requestId: running.requestId,
    });
    finish("Second English post still running");
    await tick();
    expect(document.body.innerHTML).toBe(original);
  });

  it("ポストの削除や本文の変更で古い要求を取り消し、変更後の本文だけを表示する", async () => {
    document.body.innerHTML = timeline(
      article(tweetText("<span>Post that scrolls away</span>")),
      article(tweetText("<span>Post before editing</span>")),
    );
    const { send, finish } = deferred();
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(2));
    const [removed, edited] = requests(send);

    document.querySelector("article")!.remove();
    tweet().firstElementChild!.textContent = "Post after editing";
    await vi.waitFor(() => expect(requests(send)).toHaveLength(3));
    expect(requests(send)[2]).toMatchObject({ text: "Post after editing" });
    for (const request of [removed, edited])
      expect(send).toHaveBeenCalledWith({
        type: CANCEL_TRANSLATION_REQUEST,
        sessionId: request.sessionId,
        requestId: request.requestId,
      });
    finish("Post before editing");
    await tick();
    expect(view(tweet()).button).toBeNull();
    finish("Post after editing");
    await vi.waitFor(() =>
      expect(view(tweet()).output?.textContent).toBe("訳: Post after editing"),
    );
  });

  it("翻訳に失敗したポストは原文のまま残し、エラーを表示せず再送しない", async () => {
    document.body.innerHTML = timeline(article(tweetText("<span>This translation fails</span>")));
    const send = vi.fn(async (message: unknown) =>
      isRecord(message) && message.type === TRANSLATE
        ? { ok: false, error: "翻訳に失敗しました。" }
        : { ok: true },
    );
    mount(send);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));
    await tick();
    document.querySelector("article")!.append(document.createElement("span"));
    await tick();
    expect(requests(send)).toHaveLength(1);
    expect(view(tweet()).button).toBeNull();
    expect(tweet().hasAttribute("style")).toBe(false);
    expect(document.body.textContent).not.toContain("失敗");
  });

  it("画面付近に入ったポストだけを翻訳し、表示位置の変化を優先度に反映する", async () => {
    let notify: (entries: { target: Element; isIntersecting: boolean }[]) => void = () => {};
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(callback: typeof notify) {
          notify = callback;
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    document.body.innerHTML = timeline(
      article(tweetText("<span>Post near the viewport</span>")),
      article(tweetText("<span>Post far below the viewport</span>")),
    );
    const { send } = deferred();
    mount(send);
    await tick();
    expect(requests(send)).toHaveLength(0);

    notify([
      { target: tweet(0), isIntersecting: true },
      { target: tweet(1), isIntersecting: false },
    ]);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(1));
    const [near] = requests(send);
    expect(near).toMatchObject({ text: "Post near the viewport" });

    notify([{ target: tweet(0), isIntersecting: false }]);
    await vi.waitFor(() =>
      expect(send).toHaveBeenCalledWith({
        type: CANCEL_TRANSLATION_REQUEST,
        sessionId: near.sessionId,
        requestId: near.requestId,
      }),
    );
    notify([{ target: tweet(0), isIntersecting: true }]);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(2));
    const restarted = requests(send)[1]!;

    notify([{ target: tweet(1), isIntersecting: true }]);
    await vi.waitFor(() => expect(requests(send)).toHaveLength(3));
    expect(send).toHaveBeenCalledWith({
      type: REPRIORITIZE_TRANSLATIONS,
      sessionId: restarted.sessionId,
      updates: [{ requestId: restarted.requestId, distance: 0 }],
    });
  });
});
