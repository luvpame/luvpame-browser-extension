import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createTranslationController, extractArticle, splitTranslationText } from "./content";
import { CANCEL_TRANSLATION, TRANSLATE } from "./shared";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const controllers: ReturnType<typeof createTranslationController>[] = [];
const output = () =>
  Array.from(document.querySelectorAll("[data-luvpame-translation]")).map(
    (host) => host.shadowRoot?.textContent ?? "",
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
    expect(document.querySelector("p")?.nextElementSibling?.shadowRoot?.textContent).toBe(
      "<script>alert(1)</script> 日本語",
    );
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
  function select() {
    document.body.innerHTML = "<p>A selected English sentence.</p>";
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
