import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTranslationController, extractArticle, splitTranslationText } from "./content";
import { CANCEL_TRANSLATION, TRANSLATE, isTranslationRequest } from "./shared";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const controllers: ReturnType<typeof createTranslationController>[] = [];
const output = () =>
  Array.from(document.querySelectorAll("[data-luvpame-translation]")).map(
    (host) => host.shadowRoot?.querySelector("[data-translation-text]")?.textContent ?? "",
  );
const success = (text = "日本語の訳") => ({ ok: true, text, device: "gpu" });
function mount(send: (message: unknown) => Promise<unknown>) {
  const controller = createTranslationController({ send });
  controllers.push(controller);
  controller.setEnabled(true);
  return controller;
}

afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("ページ翻訳", () => {
  it("記事の見出し・段落・リストだけを翻訳し、図や操作UIのDOMを変えない", async () => {
    document.body.innerHTML = `<p>Outside article.</p><main><p>Article navigation.</p><article>
      <header><p>Author and publication date.</p></header>
      <h1><span class="sr-only">Copy link to heading</span>Article title.</h1><p>Article paragraph.</p><ul><li>Article item.</li></ul>
      <figure class="not-prose"><header>Bundle size.</header><label>Choose bundle.<input></label><div>react-dom/client.js</div></figure>
      <div>Visible explanation.<div role="img"><div>Diagram label.</div></div></div>
      <div class="not-prose"><p>Interactive demo.</p></div>
      <div role="application"><p>Application text.</p></div>
      <div role="dialog"><p>Dialog text.</p></div><div role="toolbar"><p>Toolbar text.</p></div>
      <label>Control label.</label><p translate="no">Untranslated text.</p>
      <p class="notranslate">Untranslated class.</p><pre><code>Code sample.</code></pre>
    </article></main>`;
    const original = document.body.innerHTML;
    const figure = document.querySelector("figure")!;
    const diagram = document.querySelector('[role="img"]')!;
    const figureHTML = figure.outerHTML;
    const diagramHTML = diagram.outerHTML;
    const send = vi.fn(async (_message: unknown) => success());
    const controller = mount(send);
    controller.toggle();
    await tick();
    expect(send.mock.calls.map(([message]) => message)).toEqual(
      ["Article title.", "Article paragraph.", "Article item.", "Visible explanation."].map(
        (text) => expect.objectContaining({ type: TRANSLATE, text }),
      ),
    );
    expect(figure.outerHTML).toBe(figureHTML);
    expect(diagram.outerHTML).toBe(diagramHTML);
    expect(output()).toHaveLength(4);
    controller.toggle();
    expect(document.body.innerHTML).toBe(original);
  });

  it("複数の記事と動的な本文追加を扱い、articleBodyが現れたら対象を切り替える", async () => {
    document.body.innerHTML =
      "<main><p>Outside the articles.</p><article><p>First article.</p></article><article><p>Second article.</p></article></main>";
    const send = vi.fn(async () => success());
    const controller = mount(send);
    controller.toggle();
    await tick();
    expect(output()).toHaveLength(2);
    const added = document.createElement("p");
    added.textContent = "Added article paragraph.";
    document.querySelector("article")!.append(added);
    await tick();
    expect(output()).toHaveLength(3);
    added.setAttribute("itemprop", "articleBody");
    await tick();
    expect(output()).toHaveLength(1);
    expect(
      added.nextElementSibling?.shadowRoot?.querySelector("[data-translation-text]")?.textContent,
    ).toBe("日本語の訳");
    added.removeAttribute("itemprop");
    await tick();
    expect(output()).toHaveLength(3);
    controller.toggle();
    expect(output()).toHaveLength(0);
  });

  it.each([
    "<p>Outside main.</p><main><p>Scoped paragraph.</p></main>",
    "<p>Outside article.</p><article><p>Scoped paragraph.</p></article>",
    '<p>Outside main.</p><div role="main"><p>Scoped paragraph.</p></div>',
    '<main><article><p>Outside articleBody.</p></article></main><div itemprop="text articleBody">Scoped paragraph.</div>',
  ])("記事のないページも意味上の本文の範囲を翻訳する（%#）", async (html) => {
    document.body.innerHTML = html;
    const send = vi.fn(async () => success());
    mount(send).toggle();
    await tick();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: TRANSLATE, text: "Scoped paragraph." }),
    );
  });

  it("本文が非本文の領域に変わると訳を取り除き、本文に戻ると翻訳する", async () => {
    document.body.innerHTML = "<main><div><p>Article paragraph.</p></div></main>";
    const original = document.body.innerHTML;
    const region = document.querySelector("main > div")!;
    const send = vi.fn(async () => success());
    const controller = mount(send);
    controller.toggle();
    await tick();
    expect(output()).toHaveLength(1);
    region.className = "not-prose";
    await tick();
    expect(output()).toHaveLength(0);
    region.removeAttribute("class");
    await tick();
    expect(output()).toHaveLength(1);
    controller.toggle();
    expect(document.body.innerHTML).toBe(original);
  });

  it.each(["hidden", 'aria-hidden="true"', 'contenteditable="true"'])(
    "除外対象の子要素（%s）があっても可視の本文だけを翻訳し、元のDOMへ戻す",
    async (attribute) => {
      document.body.innerHTML = `<div>Hello visible world.<div ${attribute}><div>Excluded child.</div></div></div>`;
      const original = document.body.innerHTML;
      const send = vi.fn(async () => success());
      const controller = mount(send);
      controller.toggle();
      await tick();
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ type: TRANSLATE, text: "Hello visible world." }),
      );
      expect(output()).toEqual(["日本語の訳"]);
      controller.toggle();
      expect(document.body.innerHTML).toBe(original);
    },
  );

  it("表とリストの構造を保ち、訳をセルや項目の内側に表示する", async () => {
    document.body.innerHTML =
      "<table><tbody><tr><td>First cell.</td><td>Second cell.</td></tr></tbody></table><ul><li>List item.</li></ul>";
    const original = document.body.innerHTML;
    const send = vi.fn(async () => success());
    const controller = mount(send);
    controller.toggle();
    await tick();
    expect(document.querySelector("tr")?.children).toHaveLength(2);
    expect(document.querySelector("ul")?.children).toHaveLength(1);
    expect(document.querySelectorAll("td > [data-luvpame-translation]")).toHaveLength(2);
    expect(document.querySelectorAll("li > [data-luvpame-translation]")).toHaveLength(1);
    expect(output()).toEqual(["日本語の訳", "日本語の訳", "日本語の訳"]);
    expect(send).toHaveBeenCalledTimes(3);
    controller.toggle();
    expect(document.body.innerHTML).toBe(original);
  });
  it("原文を保ったまま段落直後へ訳を出し、再toggleで撤去する", async () => {
    document.body.innerHTML =
      '<main><p>Hello world.</p><p>Another paragraph.</p></main><nav><p>Navigation links</p></nav><pre>const value = 1;</pre><div contenteditable="true">Editable text</div>';
    const original = document.body.innerHTML;
    const send = vi.fn(async () => success("<script>alert(1)</script> 日本語"));
    const controller = mount(send);
    expect(controller.toggle()).toEqual({ ok: true, active: true });
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(document.querySelector("p")?.textContent).toBe("Hello world.");
    expect(
      document
        .querySelector("p")
        ?.nextElementSibling?.shadowRoot?.querySelector("[data-translation-text]")?.textContent,
    ).toBe("<script>alert(1)</script> 日本語");
    expect(
      document.querySelector("p")?.nextElementSibling?.shadowRoot?.querySelector("script"),
    ).toBeNull();
    controller.toggle();
    expect(document.body.innerHTML).toBe(original);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: CANCEL_TRANSLATION }));
  });

  it("停止後に到着した応答を破棄する", async () => {
    document.body.innerHTML = "<p>Hello world.</p>";
    let resolve: ((value: unknown) => void) | undefined;
    const send = vi.fn((message: unknown) => {
      if (typeof message === "object" && message && "type" in message && message.type === TRANSLATE)
        return new Promise((done) => {
          resolve = done;
        });
      return Promise.resolve(undefined);
    });
    const controller = mount(send);
    controller.toggle();
    controller.toggle();
    resolve?.(success());
    await tick();
    expect(output()).toEqual([]);
    expect(document.querySelector("p")?.textContent).toBe("Hello world.");
  });

  it("停止した翻訳の応答を待たずに再開し、遅れて届く古い訳を表示しない", async () => {
    document.body.innerHTML = "<p>Hello world.</p>";
    let resolveOld: ((value: unknown) => void) | undefined;
    const send = vi.fn((message: unknown) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      if (!resolveOld)
        return new Promise((resolve) => {
          resolveOld = resolve;
        });
      return Promise.resolve(success("再開した翻訳"));
    });
    const controller = mount(send);
    controller.toggle();
    controller.toggle();
    controller.toggle();
    await tick();
    expect(output()).toEqual(["再開した翻訳"]);
    expect(send.mock.calls.filter(([message]) => isTranslationRequest(message))).toHaveLength(2);
    resolveOld?.(success("停止した翻訳"));
    await tick();
    expect(output()).toEqual(["再開した翻訳"]);
  });

  it("停止した要求が完了しても再開中の段落を重複送信せず、次の段落を順番に翻訳する", async () => {
    document.body.innerHTML = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const pending: ((value: unknown) => void)[] = [];
    const send = vi.fn((message: unknown) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      return new Promise((resolve) => pending.push(resolve));
    });
    const controller = mount(send);
    controller.toggle();
    controller.toggle();
    controller.toggle();
    expect(pending).toHaveLength(2);
    pending[0]!(success("停止した翻訳"));
    await tick();
    expect(pending).toHaveLength(2);
    expect(document.querySelector("[data-luvpame-translation]")?.getAttribute("aria-busy")).toBe(
      "true",
    );
    pending[1]!(success("最初の段落"));
    await tick();
    expect(pending).toHaveLength(3);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Second paragraph." }));
    pending[2]!(success("次の段落"));
    await tick();
    expect(output()).toEqual(["最初の段落", "次の段落"]);
  });

  it.each([
    { response: success("翻訳した文章"), text: "翻訳した文章" },
    { response: { ok: false, error: "翻訳に失敗しました。" }, text: "翻訳に失敗しました。" },
  ])("ラベルを付けずに待機・進捗・応答を訳文領域へ表示する（%#）", async ({ response, text }) => {
    document.body.innerHTML = "<p>Hello world.</p>";
    let resolve: ((value: unknown) => void) | undefined;
    let sessionId = "";
    const send = vi.fn((message: unknown) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const controller = mount(send);
    controller.toggle();
    const host = document.querySelector("[data-luvpame-translation]");
    const shadow = host?.shadowRoot;
    const spinner = shadow?.querySelector(".translation-spinner");
    expect(output()).toEqual(["翻訳を待っています…"]);
    expect(host?.getAttribute("aria-busy")).toBe("true");
    expect(spinner?.getAttribute("aria-hidden")).toBe("true");
    expect(spinner?.textContent).toBe("");
    controller.progress(sessionId, "モデルを準備しています…");
    expect(output()).toEqual(["モデルを準備しています…"]);
    expect(shadow?.querySelector(".translation-spinner")).toBe(spinner);
    resolve?.(response);
    await tick();
    expect(output()).toEqual([text]);
    expect(host?.getAttribute("aria-busy")).toBe("false");
    expect(shadow?.querySelector("[data-translation-text]")?.textContent).toBe(text);
  });

  it("順番待ちの段落は進捗で書き換えず、実行中の段落だけbusyにする", async () => {
    document.body.innerHTML = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const pending: ((value: unknown) => void)[] = [];
    let sessionId = "";
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      return new Promise((resolve) => pending.push(resolve));
    });
    controller.toggle();
    const hosts = [...document.querySelectorAll("[data-luvpame-translation]")];
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual(["true", "false"]);
    controller.progress(sessionId, "日本語に訳しています…");
    expect(output()).toEqual(["日本語に訳しています…", "翻訳を待っています…"]);
    pending[0]!(success("最初の訳"));
    await tick();
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual(["false", "true"]);
    pending[1]!(success("次の訳"));
    await tick();
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual(["false", "false"]);
  });

  it("動的に追加、書き換えられた英文を翻訳し、消えた段落の訳も消す", async () => {
    document.body.innerHTML = "<p>First paragraph.</p>";
    const send = vi.fn(async () => success());
    const controller = mount(send);
    controller.toggle();
    await tick();
    const added = document.createElement("p");
    added.textContent = "Second paragraph.";
    document.body.append(added);
    await tick();
    expect(output()).toHaveLength(2);
    added.firstChild!.textContent = "Changed paragraph.";
    await tick();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: "Changed paragraph." }));
    added.remove();
    await tick();
    expect(output()).toHaveLength(1);
    controller.setEnabled(false);
    expect(output()).toHaveLength(0);
  });

  it("書換前の翻訳が遅れて返っても新しい段落に表示しない", async () => {
    document.body.innerHTML = "<p>Old paragraph.</p>";
    let resolve: ((value: unknown) => void) | undefined;
    const send = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValue(success("新しい段落"));
    mount(send).toggle();
    document.querySelector("p")!.textContent = "New paragraph.";
    await tick();
    resolve?.(success("古い段落"));
    await tick();
    expect(output()).toEqual(["新しい段落"]);
  });
});

describe("選択翻訳", () => {
  function select(html = "<p>A selected English sentence.</p>") {
    document.body.innerHTML = html;
    const node = document.querySelector("p")!.firstChild!;
    const range = document.createRange();
    range.selectNodeContents(node);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 20, bottom: 40 }),
    });
    const selection = document.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }

  it.each([
    { response: success("選択した文章"), text: "選択した文章" },
    { response: { ok: false, error: "翻訳に失敗しました。" }, text: "翻訳に失敗しました。" },
  ])("選択翻訳の進捗中はbusyを保ち、応答時に終了する（%#）", async ({ response, text }) => {
    let finish: ((value: unknown) => void) | undefined;
    let sessionId = "";
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    select();
    const shadow = document.querySelector('[data-luvpame-translation="selection"]')?.shadowRoot;
    shadow?.querySelector("button")?.click();
    const panel = shadow?.querySelector('[role="dialog"]');
    const spinner = panel?.querySelector(".translation-spinner");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.querySelector('[role="status"]')?.textContent).toBe("日本語に訳しています…");
    controller.progress(sessionId, "翻訳の準備をしています…");
    expect(panel?.querySelector(".translation-spinner")).toBe(spinner);
    finish?.(response);
    await tick();
    expect(panel?.getAttribute("aria-busy")).toBe("false");
    expect(panel?.querySelector('[role="status"]')?.textContent).toBe(text);
  });

  it("閉じた選択翻訳の応答が新しい選択のbusyを解除しない", async () => {
    const pending: ((value: unknown) => void)[] = [];
    mount((message) =>
      isTranslationRequest(message)
        ? new Promise((resolve) => pending.push(resolve))
        : Promise.resolve(undefined),
    );
    select();
    const first = document.querySelector('[data-luvpame-translation="selection"]');
    first?.shadowRoot?.querySelector("button")?.click();
    first?.shadowRoot?.querySelector("button")?.click();
    expect(first?.isConnected).toBe(false);
    select("<p>Another selected English sentence.</p>");
    const second = document.querySelector('[data-luvpame-translation="selection"]');
    second?.shadowRoot?.querySelector("button")?.click();
    pending[0]!(success("古い選択"));
    await tick();
    expect(second?.shadowRoot?.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe(
      "true",
    );
    pending[1]!(success("新しい選択"));
    await tick();
    expect(second?.shadowRoot?.querySelector('[role="dialog"]')?.getAttribute("aria-busy")).toBe(
      "false",
    );
  });

  it("選択位置のアイコンから安全なpopup訳を表示しEscapeで閉じる", async () => {
    const send = vi.fn(async () => success("選択した文章"));
    mount(send);
    select();
    const host = document.querySelector('[data-luvpame-translation="selection"]');
    const button = host?.shadowRoot?.querySelector("button");
    expect(button?.getAttribute("aria-label")).toBe("選択した文章を日本語に翻訳");
    button?.click();
    await tick();
    expect(host?.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("選択した文章");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector('[data-luvpame-translation="selection"]')).toBeNull();
  });

  it("自動翻訳から除外した図でも、明示的に選択した文章は翻訳する", async () => {
    const send = vi.fn(async () => success("選択した図の文章"));
    mount(send);
    select('<figure class="not-prose"><p>A selected diagram label.</p></figure>');
    const host = document.querySelector('[data-luvpame-translation="selection"]');
    host?.shadowRoot?.querySelector("button")?.click();
    await tick();
    expect(send).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: TRANSLATE, text: "A selected diagram label." }),
    );
    expect(host?.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe(
      "選択した図の文章",
    );
  });

  it("選択変更、スクロール、機能OFFでUIと保留中の翻訳を閉じる", () => {
    const send = vi.fn(async () => success());
    const controller = mount(send);
    select();
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(output()).toHaveLength(0);
    select();
    window.dispatchEvent(new Event("scroll"));
    expect(output()).toHaveLength(0);
    select();
    controller.setEnabled(false);
    expect(output()).toHaveLength(0);
  });
});

it("長文を欠落なしで1200文字以下へ分割する", () => {
  const text = "An English sentence with some words. ".repeat(200);
  const chunks = splitTranslationText(text);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((chunk) => chunk.length <= 1200)).toBe(true);
  expect(chunks.join(" ")).toBe(text.trim());
  expect(splitTranslationText("a".repeat(2500)).join("")).toBe("a".repeat(2500));
});

it.each([
  "x".repeat(1199) + "😀tail",
  "x".repeat(1199) + "😀" + "x".repeat(1197) + "😀tail",
  "あ".repeat(2500),
])("サロゲートペアを壊さず1200文字以下へ分割する（%#）", (text) => {
  const chunks = splitTranslationText(text);
  expect(chunks.join("")).toBe(text);
  expect(chunks.every((chunk) => chunk.length <= 1200 && chunk.isWellFormed())).toBe(true);
});

it("記事全体を元ページの変更や文字数切捨てなしで抽出する", async () => {
  const sentences = Array.from(
    { length: 45 },
    (_, index) =>
      `Article paragraph ${index}: ` +
      "A detailed account of the event contains the complete facts and explanations. ".repeat(8),
  );
  document.body.innerHTML = `<nav><p>Navigation must not appear.</p></nav><article><header><h1>The complete story</h1></header>${sentences.map((text) => `<p>${text}</p>`).join("")}</article>`;
  const original = document.body.innerHTML;
  const result = await extractArticle();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("本文が抽出されませんでした");
  const text = result.paragraphs.join("\n");
  for (const sentence of sentences) expect(text).toContain(sentence.trim());
  expect(text).not.toContain("Navigation must not appear.");
  expect(document.body.innerHTML).toBe(original);
});

it("記事抽出にも本文の範囲と図・操作UIの除外を適用する", async () => {
  const sentence = "This article explains how the application reduces JavaScript for its readers. ";
  document.body.innerHTML = `<main><p>Outside article content.</p><article><h1>Article extraction</h1>
    <div itemprop="articleBody">${Array.from({ length: 8 }, () => `<p>${sentence.repeat(5)}</p>`).join("")}
      <figure><p>Figure demo text.</p></figure><div role="img"><p>Diagram demo text.</p></div>
      <div class="not-prose"><p>Interactive demo text.</p></div><label>Control demo text.</label>
      <p translate="no">Untranslated demo text.</p>
    </div><p>Outside article body.</p></article></main>`;
  const original = document.body.innerHTML;
  const result = await extractArticle();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("本文が抽出されませんでした");
  const text = result.paragraphs.join("\n");
  expect(text).toContain(sentence.trim());
  expect(text).not.toMatch(/demo text|Outside article/);
  expect(document.body.innerHTML).toBe(original);
});
