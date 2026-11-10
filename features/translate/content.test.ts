import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTranslationController, extractArticle, splitTranslationText } from "./content";
import { CANCEL_TRANSLATION, TRANSLATE, isTranslationRequest } from "./shared";
import { scheduleTranslation } from "./scheduler";

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

  it("停止した要求が完了しても再開中の2段落を重複送信しない", async () => {
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
    expect(pending).toHaveLength(4);
    pending[0]!(success("停止した翻訳"));
    pending[1]!(success("停止した2番目の翻訳"));
    await tick();
    expect(pending).toHaveLength(4);
    expect(
      [...document.querySelectorAll("[data-luvpame-translation]")].map((host) =>
        host.getAttribute("aria-busy"),
      ),
    ).toEqual(["true", "true"]);
    pending[2]!(success("最初の段落"));
    pending[3]!(success("次の段落"));
    await tick();
    expect(output()).toEqual(["最初の段落", "次の段落"]);
  });

  it.each([
    { response: success("翻訳した文章"), text: "翻訳した文章" },
    { response: { ok: false, error: "翻訳に失敗しました。" }, text: "翻訳に失敗しました。" },
  ])("待機・進捗の文言を表示せず、途中訳・応答だけを表示する（%#）", async ({ response, text }) => {
    document.body.innerHTML = "<p>Hello world.</p>";
    let resolve: ((value: unknown) => void) | undefined;
    let sessionId = "";
    let requestId = "";
    const send = vi.fn((message: unknown) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      requestId = message.requestId;
      return new Promise((done) => {
        resolve = done;
      });
    });
    const controller = mount(send);
    controller.toggle();
    const host = document.querySelector("[data-luvpame-translation]");
    const shadow = host?.shadowRoot;
    const indicator = shadow?.querySelector(".translation-indicator");
    expect(output()).toEqual([""]);
    expect(host?.getAttribute("aria-busy")).toBe("true");
    expect(indicator?.getAttribute("role")).toBe("status");
    expect(indicator?.getAttribute("aria-label")).toBe("翻訳中");
    expect(indicator?.textContent).toBe("");
    controller.progress(sessionId, requestId, {
      kind: "status",
      message: "準備中",
    });
    expect(output()).toEqual([""]);
    controller.progress(sessionId, requestId, { kind: "text", text: "途中の訳" });
    controller.progress(sessionId, requestId, { kind: "status", message: "表示しない" });
    expect(output()).toEqual(["途中の訳"]);
    expect(shadow?.querySelector(".translation-indicator")).toBe(indicator);
    resolve?.(response);
    await tick();
    expect(output()).toEqual([text]);
    expect(host?.getAttribute("aria-busy")).toBe("false");
    expect(shadow?.querySelector("[data-translation-text]")?.textContent).toBe(text);
  });

  it("順番待ちから全段落をbusyにし、完了した段落だけ解除する", async () => {
    document.body.innerHTML =
      "<p>First paragraph.</p><p>Second paragraph.</p><p>Third paragraph.</p><p>Fourth paragraph.</p><p>Fifth paragraph.</p>";
    const pending: ((value: unknown) => void)[] = [];
    let sessionId = "";
    let requestId = "";
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      if (!requestId) requestId = message.requestId;
      return new Promise((resolve) => pending.push(resolve));
    });
    controller.toggle();
    const hosts = [...document.querySelectorAll("[data-luvpame-translation]")];
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual([
      "true",
      "true",
      "true",
      "true",
      "true",
    ]);
    controller.progress(sessionId, requestId, { kind: "status", message: "翻訳中" });
    expect(output()).toEqual(["", "", "", "", ""]);
    pending[0]!(success("最初の訳"));
    await tick();
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual([
      "false",
      "true",
      "true",
      "true",
      "true",
    ]);
    pending[1]!(success("次の訳"));
    pending[2]!(success("3番目の訳"));
    pending[3]!(success("4番目の訳"));
    pending[4]!(success("最後の訳"));
    await tick();
    expect(hosts.map((host) => host.getAttribute("aria-busy"))).toEqual([
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
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

describe("原文を置き換えるページ翻訳", () => {
  it("Textだけを書き換えて空白・リンク・コード・表・リストを保ち、再実行で完全に戻す", async () => {
    document.body.innerHTML = `<main><article><p>  Hello <a href="/next"><em>linked world</em></a>! <code>keepCode()</code> after code.\n</p><table><tbody><tr><td>Table cell.</td></tr></tbody></table><ul><li>List item.</li></ul><nav><p>Navigation text.</p></nav><button>Button text.</button><div class="not-prose"><p>Demo text.</p></div></article></main>`;
    const original = document.body.innerHTML;
    const paragraph = document.querySelector("p")!;
    const link = document.querySelector("a")!;
    const code = document.querySelector("code")!;
    const nodes = [...paragraph.childNodes];
    const onClick = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener("click", onClick);
    const send = vi.fn(async (_message: unknown) => success("日本語"));
    const controller = mount(send);
    expect(controller.toggle("replace")).toEqual({ ok: true, active: true });
    await tick();
    expect(paragraph.childNodes).toHaveLength(nodes.length);
    nodes.forEach((node, index) => expect(paragraph.childNodes[index]).toBe(node));
    expect(paragraph.textContent).toBe("  日本語 日本語! keepCode() 日本語\n");
    expect(document.querySelector("a")).toBe(link);
    expect(document.querySelector("code")).toBe(code);
    expect(document.querySelector("tr")?.children).toHaveLength(1);
    expect(document.querySelector("ul")?.children).toHaveLength(1);
    expect(document.querySelector("td")?.textContent).toBe("日本語");
    expect(document.querySelector("li")?.textContent).toBe("日本語");
    expect(document.querySelector("nav")?.textContent).toBe("Navigation text.");
    expect(document.querySelector("button")?.textContent).toBe("Button text.");
    expect(document.querySelector(".not-prose")?.textContent).toBe("Demo text.");
    expect(output()).toEqual([]);
    expect(send.mock.calls.map(([message]) => message)).toEqual(
      ["Hello", "linked world", "after code.", "Table cell.", "List item."].map((text) =>
        expect.objectContaining({ type: TRANSLATE, text }),
      ),
    );
    link.click();
    expect(onClick).toHaveBeenCalledOnce();
    expect(controller.toggle("replace")).toEqual({ ok: true, active: false });
    expect(document.body.innerHTML).toBe(original);
    nodes.forEach((node, index) => expect(paragraph.childNodes[index]).toBe(node));
    link.click();
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("空の進捗では原文を残し、途中訳の後で失敗したら原文を復元してエラーを添える", async () => {
    document.body.innerHTML = "<p>  Original sentence.\n</p>";
    const node = document.querySelector("p")!.firstChild!;
    let finish: ((value: unknown) => void) | undefined;
    let sessionId = "";
    let requestId = "";
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      requestId = message.requestId;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    controller.toggle("replace");
    controller.progress(sessionId, requestId, { kind: "text", text: "" });
    expect(node.textContent).toBe("  Original sentence.\n");
    controller.progress(sessionId, requestId, { kind: "text", text: "途中訳" });
    expect(node.textContent).toBe("  途中訳\n");
    finish?.({ ok: false, error: "<script>失敗</script>" });
    await tick();
    expect(node.textContent).toBe("  Original sentence.\n");
    expect(output()).toEqual(["<script>失敗</script>"]);
    expect(
      document.querySelector("[data-luvpame-translation]")?.shadowRoot?.querySelector("script"),
    ).toBeNull();
    controller.toggle("replace");
    expect(output()).toEqual([]);
  });

  it("表示方式の切替で原文を戻し、前の方式の応答や進捗を捨てる", async () => {
    document.body.innerHTML = "<p>Original sentence.</p>";
    const pending: { sessionId: string; requestId: string; finish: (value: unknown) => void }[] =
      [];
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      return new Promise((finish) => pending.push({ ...message, finish }));
    });
    controller.toggle("replace");
    const first = pending[0]!;
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "置換の途中" });
    expect(document.querySelector("p")?.textContent).toBe("置換の途中");
    controller.toggle();
    expect(document.querySelector("p")?.textContent).toBe("Original sentence.");
    expect(output()).toEqual([""]);
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "古い置換" });
    first.finish(success("古い置換"));
    pending[1]!.finish(success("下に表示する訳"));
    await tick();
    expect(document.querySelector("p")?.textContent).toBe("Original sentence.");
    expect(output()).toEqual(["下に表示する訳"]);
    controller.toggle("replace");
    expect(output()).toEqual([]);
    pending[2]!.finish(success("新しい置換"));
    await tick();
    expect(document.querySelector("p")?.textContent).toBe("新しい置換");
    controller.toggle("replace");
    expect(document.querySelector("p")?.textContent).toBe("Original sentence.");
  });

  it("同じ段落の複数Textが失敗してもエラー表示のDOM更新が収束する", async () => {
    document.body.innerHTML = "<p>First fragment. <em>Second fragment.</em></p>";
    const send = vi.fn(async () => ({ ok: false, error: "翻訳できませんでした。" }));
    const controller = mount(send);
    let mutations = 0;
    const observer = new MutationObserver((records) => {
      mutations += records.length;
    });
    observer.observe(document.body, { childList: true, subtree: true });
    try {
      controller.toggle("replace");
      await tick();
      const settled = mutations;
      await tick();
      expect(mutations).toBe(settled);
      expect(send).toHaveBeenCalledTimes(2);
      expect(document.querySelector("p")?.textContent).toBe("First fragment. Second fragment.");
      expect(output()).toEqual(["翻訳できませんでした。", "翻訳できませんでした。"]);
    } finally {
      observer.disconnect();
    }
  });

  it("サイトが途中訳を原文へ戻したときも古い進捗で上書きしない", async () => {
    document.body.innerHTML = "<p>Original sentence.</p>";
    const pending: { sessionId: string; requestId: string; finish: (value: unknown) => void }[] =
      [];
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      return new Promise((finish) => pending.push({ ...message, finish }));
    });
    controller.toggle("replace");
    const first = pending[0]!;
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "途中訳" });
    const node = document.querySelector("p")!.firstChild!;
    node.textContent = "Original sentence.";
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "古い続き" });
    expect(node.textContent).toBe("Original sentence.");
    first.finish(success("古い確定訳"));
    await tick();
    expect(pending).toHaveLength(2);
    pending[1]!.finish(success("新しい確定訳"));
    await tick();
    expect(node.textContent).toBe("新しい確定訳");
  });

  it("自分の英文出力を再翻訳せず、SPAの変更・追加だけ翻訳し、サイト側の変更を復元で消さない", async () => {
    document.body.innerHTML = "<main><p>Original sentence.</p></main>";
    const send = vi.fn(async () => success("Translated English output."));
    const controller = mount(send);
    controller.toggle("replace");
    await tick();
    await tick();
    expect(send).toHaveBeenCalledTimes(1);
    const paragraph = document.querySelector("p")!;
    const node = paragraph.firstChild!;
    node.textContent = "Updated source.";
    await tick();
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenLastCalledWith(expect.objectContaining({ text: "Updated source." }));
    const added = document.createElement("span");
    added.textContent = "New fragment.";
    paragraph.append(added);
    await tick();
    expect(send).toHaveBeenCalledTimes(3);
    expect(added.textContent).toBe("Translated English output.");
    node.textContent = "Site changed immediately before reset.";
    controller.toggle("replace");
    expect(node.textContent).toBe("Site changed immediately before reset.");
    expect(added.textContent).toBe("New fragment.");
  });

  it("除外への変更・本文削除で原文に戻し、非表示・停止後に届いた応答を捨てる", async () => {
    document.body.innerHTML = "<main><section><p>Original sentence.</p></section></main>";
    const pending: { sessionId: string; requestId: string; finish: (value: unknown) => void }[] =
      [];
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      return new Promise((finish) => pending.push({ ...message, finish }));
    });
    const region = document.querySelector("section")!;
    const paragraph = document.querySelector("p")!;
    controller.toggle("replace");
    const first = pending[0]!;
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "途中訳" });
    region.setAttribute("translate", "no");
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "除外後" });
    expect(paragraph.textContent).toBe("途中訳");
    await tick();
    expect(paragraph.textContent).toBe("Original sentence.");
    first.finish(success("除外後の古い訳"));
    region.removeAttribute("translate");
    await tick();
    const second = pending[1]!;
    controller.progress(second.sessionId, second.requestId, { kind: "text", text: "新しい途中訳" });
    paragraph.remove();
    await tick();
    expect(paragraph.textContent).toBe("Original sentence.");
    second.finish(success("削除した段落の訳"));
    document.querySelector("main")!.append(paragraph);
    await tick();
    const third = pending[2]!;
    controller.progress(third.sessionId, third.requestId, { kind: "text", text: "停止前の途中訳" });
    controller.setEnabled(false);
    expect(paragraph.textContent).toBe("Original sentence.");
    third.finish(success("停止後の訳"));
    await tick();
    expect(paragraph.textContent).toBe("Original sentence.");
  });

  it("サイトが原文を書き換えた直後の古い進捗を破棄し、新しい原文を復元する", async () => {
    document.body.innerHTML = "<p>Old sentence.</p>";
    const pending: { sessionId: string; requestId: string; finish: (value: unknown) => void }[] =
      [];
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      return new Promise((finish) => pending.push({ ...message, finish }));
    });
    controller.toggle("replace");
    const first = pending[0]!;
    const node = document.querySelector("p")!.firstChild!;
    node.textContent = "New sentence.";
    controller.progress(first.sessionId, first.requestId, { kind: "text", text: "古い途中訳" });
    expect(node.textContent).toBe("New sentence.");
    first.finish(success("古い訳"));
    await tick();
    pending[1]!.finish(success("新しい訳"));
    await tick();
    expect(node.textContent).toBe("新しい訳");
    controller.dispose();
    expect(node.textContent).toBe("New sentence.");
  });

  it("置換中でもやさしい翻訳へ原文を渡し、ページの訳と隣接Textノードを保つ", async () => {
    const first = "This article explains how the application reduces JavaScript for its readers. ";
    const second =
      "Readers can understand the original article without losing any important details. ";
    document.body.innerHTML = "<article><h1>Original article title</h1><p></p></article>";
    const paragraph = document.querySelector("p")!;
    paragraph.append(
      document.createTextNode(first.repeat(8)),
      document.createTextNode(second.repeat(8)),
    );
    const controller = mount(async () => success("日本語の本文です。"));
    controller.toggle("replace");
    await tick();
    const translated = document.body.innerHTML;
    const result = await controller.extractArticle();
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("原文を抽出できませんでした");
    expect(result.paragraphs.join("\n")).toContain(first.trim());
    expect(result.paragraphs.join("\n")).toContain(second.trim());
    expect(result.paragraphs.join("\n")).not.toContain("日本語の本文です。");
    expect(document.body.innerHTML).toBe(translated);
    expect(paragraph.childNodes).toHaveLength(2);
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
    let requestId = "";
    const controller = mount((message) => {
      if (!isTranslationRequest(message)) return Promise.resolve(undefined);
      sessionId = message.sessionId;
      requestId = message.requestId;
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    select();
    const shadow = document.querySelector('[data-luvpame-translation="selection"]')?.shadowRoot;
    shadow?.querySelector("button")?.click();
    const panel = shadow?.querySelector('[role="dialog"]');
    const indicator = panel?.querySelector(".translation-indicator");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.querySelector('[role="status"]')?.textContent).toBe("");
    expect(panel?.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe("翻訳中");
    controller.progress(sessionId, requestId, {
      kind: "status",
      message: "準備中",
    });
    expect(panel?.querySelector('[role="status"]')?.textContent).toBe("");
    controller.progress(sessionId, requestId, { kind: "text", text: "選択の途中訳" });
    controller.progress(sessionId, requestId, { kind: "status", message: "上書きしない" });
    controller.progress(sessionId, "old-request", { kind: "text", text: "古い要求" });
    expect(panel?.querySelector('[role="status"]')?.textContent).toBe("選択の途中訳");
    expect(panel?.querySelector(".translation-indicator")).toBe(indicator);
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

  it("翻訳UIへのフォーカスで選択が消えても翻訳を継続し、ページ側の解除で閉じる", async () => {
    let finish: ((value: unknown) => void) | undefined;
    const send = vi.fn((message: unknown) =>
      isTranslationRequest(message)
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(undefined),
    );
    mount(send);
    select();
    const host = document.querySelector('[data-luvpame-translation="selection"]');
    host?.shadowRoot?.querySelector("button")?.click();
    expect(document.activeElement).toBe(host);
    document.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    expect(host?.isConnected).toBe(true);
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: CANCEL_TRANSLATION }));
    finish?.(success("選択した文章"));
    await tick();
    expect(host?.shadowRoot?.querySelector('[role="status"]')?.textContent).toBe("選択した文章");
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    document.dispatchEvent(new Event("selectionchange"));
    expect(host?.isConnected).toBe(false);
  });

  it("翻訳UIにフォーカスがあっても新しいページ選択へ切り替える", () => {
    mount(async () => success());
    select();
    const host = document.querySelector('[data-luvpame-translation="selection"]');
    host?.shadowRoot?.querySelector("button")?.click();
    expect(document.activeElement).toBe(host);
    select("<p>Another selected English sentence.</p>");
    expect(host?.isConnected).toBe(false);
    expect(
      document
        .querySelector('[data-luvpame-translation="selection"]')
        ?.shadowRoot?.querySelector("button")?.textContent,
    ).toBe("訳");
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

it("rechecks the viewport before filling each free paragraph slot", async () => {
  document.body.innerHTML =
    "<p>First offscreen.</p><p>Second near.</p><p>Third visible.</p><p>Fourth near.</p><p>Fifth offscreen.</p><p>Sixth moves.</p>";
  const elements = [...document.querySelectorAll("p")];
  const tops = [-2000, 900, 20, 1000, 3000, 4000];
  elements.forEach((element, index) =>
    vi
      .spyOn(element, "getBoundingClientRect")
      .mockImplementation(() => new DOMRect(0, tops[index], 400, 20)),
  );
  const pending: (() => void)[] = [];
  const sent: string[] = [];
  const controller = mount((message) => {
    if (!isTranslationRequest(message)) return Promise.resolve(undefined);
    sent.push(message.text);
    return new Promise((resolve) => pending.push(() => resolve(success(message.text))));
  });
  controller.toggle();
  expect(sent).toEqual(["Third visible.", "Second near.", "Fourth near.", "First offscreen."]);
  tops[5] = 30;
  pending[0]?.();
  await tick();
  expect(sent.at(-1)).toBe("Sixth moves.");
  pending[1]?.();
  await tick();
  expect(sent.at(-1)).toBe("Fifth offscreen.");
  pending[2]?.();
  pending[3]?.();
  pending[4]?.();
  pending[5]?.();
  await tick();
});

it("keeps two GPU chunks per warm wave despite delayed messaging without exceeding two inferences", async () => {
  vi.useFakeTimers();
  try {
    document.body.innerHTML = Array.from(
      { length: 12 },
      (_, index) => `<p>Paragraph ${index}.</p>`,
    ).join("");
    const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const waves: number[] = [];
    let warm = false;
    let active = 0;
    let peak = 0;
    const resource = {
      group: "gpu",
      capacity: () => {
        waves.push(0);
        return warm ? 2 : 1;
      },
    };
    const controller = mount(async (message) => {
      if (!isTranslationRequest(message)) return undefined;
      await delay(5);
      const result = await scheduleTranslation(
        { signal: new AbortController().signal, onProgress: vi.fn() },
        async () => {
          waves[waves.length - 1] = (waves[waves.length - 1] ?? 0) + 1;
          warm = true;
          active += 1;
          peak = Math.max(peak, active);
          await delay(30);
          active -= 1;
          return success(message.text);
        },
        resource,
      );
      await delay(10);
      return result;
    });
    controller.toggle();
    await vi.runAllTimersAsync();
    expect(waves).toEqual([1, 2, 2, 2, 2, 2, 1]);
    expect(peak).toBe(2);
    expect(active).toBe(0);
    expect(output()).toEqual(Array.from({ length: 12 }, (_, index) => `Paragraph ${index}.`));
  } finally {
    vi.useRealTimers();
  }
});

it("keeps completed chunks while streaming the current one and ignores old requests and changed source", async () => {
  document.body.innerHTML = `<p>${"Hello world. ".repeat(150)}</p>`;
  const requests: { sessionId: string; requestId: string; finish: (value: unknown) => void }[] = [];
  const controller = mount((message) => {
    if (!isTranslationRequest(message)) return Promise.resolve(undefined);
    return new Promise((finish) =>
      requests.push({ sessionId: message.sessionId, requestId: message.requestId, finish }),
    );
  });
  controller.toggle();
  const first = requests[0]!;
  controller.progress(first.sessionId, first.requestId, { kind: "text", text: "途中" });
  controller.progress(first.sessionId, first.requestId, {
    kind: "status",
    message: "上書きしない",
  });
  expect(output()).toEqual(["途中"]);
  first.finish(success("確定した前半"));
  await tick();
  const second = requests[1]!;
  controller.progress(second.sessionId, second.requestId, { kind: "text", text: "後半の途中" });
  expect(output()).toEqual(["確定した前半\n後半の途中"]);
  controller.progress(first.sessionId, first.requestId, { kind: "text", text: "古い前半" });
  expect(output()).toEqual(["確定した前半\n後半の途中"]);
  document.querySelector("p")!.textContent = "Replaced source.";
  controller.progress(second.sessionId, second.requestId, { kind: "text", text: "変更前の訳" });
  expect(output()).toEqual(["確定した前半\n後半の途中"]);
  second.finish(success("変更前の確定訳"));
  await tick();
  requests[2]?.finish(success("置換後"));
  await tick();
  expect(output()).toEqual(["置換後"]);
});
