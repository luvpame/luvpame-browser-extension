import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createLinearReviewGuideController } from "./content";
import { createTranslationController } from "../translate/content";
import { isRecord } from "../../lib/copy-protocol";
import { CANCEL_TRANSLATION, TRANSLATE, TRANSLATE_BATCH } from "../translate/shared";

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const controllers: { dispose(): void }[] = [];
const path = "/smartcamp/review/change-123/review";
const success = () => ({ ok: true, text: "日本語の訳", device: "gpu" });
const requests = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls
    .map(([message]) => message)
    .filter(
      (message) =>
        isRecord(message) && (message.type === TRANSLATE || message.type === TRANSLATE_BATCH),
    );
const mount = (send: (message: unknown) => Promise<unknown>) => {
  const controller = createLinearReviewGuideController({ send });
  controllers.push(controller);
  controller.setEnabled(true);
  return controller;
};
const guide = `<div data-guide-section-text="true"><div><div><div data-guide-overview="true"><div><div>
  <span>Validate the application before reviewing.</span>
  <span>Read <a href="#tour-section-checks"><span>the validation guide</span></a> before approving.</span>
</div></div></div></div></div></div>`;

beforeEach(() => window.history.replaceState(null, "", path));
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  document.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

describe("Linear Review Guide翻訳", () => {
  it("Guideを開いたら説明だけを置換し、リンクをまたぐ文は1つの文字列として翻訳してOFF時に戻す", async () => {
    document.body.innerHTML = `<main>
      <h1>PR Review Guide</h1><p>Overview tab summary.</p>
      <div data-guide-sticky-title="true"><span>Run app checks with TypeScript 7</span>
        <button>Review section</button>
      </div>${guide}
      <div data-guide-section-code="true"><div><span>const application = buildApp();</span></div></div>
      <div data-diff-code-column><span>return application.start();</span></div>
    </main>`;
    const original = document.body.innerHTML;
    const link = document.querySelector("a")!;
    const excluded = Array.from(
      document.querySelectorAll(
        "h1,p,[data-guide-sticky-title],[data-guide-section-code],[data-diff-code-column]",
      ),
    );
    const excludedHTML = excluded.map((element) => element.outerHTML);
    const send = vi.fn(async (_message: unknown) => success());
    const controller = mount(send);
    await tick();
    expect(requests(send)).toEqual(
      [
        "Validate the application before reviewing.",
        "Read the validation guide before approving.",
      ].map((text) =>
        expect.objectContaining({
          type: TRANSLATE,
          text,
          target: "ja",
          feature: "linear-review-guide",
        }),
      ),
    );
    expect(excluded.map((element) => element.outerHTML)).toEqual(excludedHTML);
    expect(document.querySelector("a")).toBe(link);
    expect(link.getAttribute("href")).toBe("#tour-section-checks");
    expect(link.textContent).toBe("");
    expect(link.parentElement?.textContent).toBe("日本語の訳");
    expect(document.querySelector("[data-luvpame-translation]")).toBeNull();
    controller.setEnabled(false);
    expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector("a")).toBe(link);
  });

  it("本文が遅れて現れても説明を翻訳し、Guide内のコードや見出しを送らない", async () => {
    document.body.innerHTML =
      "<main><div data-guide-section-code><div>const initial = true;</div></div></main>";
    const send = vi.fn(async (_message: unknown) => success());
    mount(send);
    await tick();
    expect(requests(send)).toEqual([]);
    document.querySelector("main")!.insertAdjacentHTML("beforeend", guide);
    const overview = document.querySelector("[data-guide-overview]")!;
    overview.insertAdjacentHTML(
      "beforeend",
      "<h2>Section heading.</h2><p>Check <code>keepCode()</code> before approval.</p>",
    );
    await tick();
    expect(requests(send)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text: "Validate the application before reviewing." }),
        expect.objectContaining({ text: "Check" }),
        expect.objectContaining({ text: "before approval." }),
      ]),
    );
    expect(overview.querySelector("code")?.textContent).toBe("keepCode()");
    expect(overview.querySelector("h2")?.textContent).toBe("Section heading.");
    expect(
      requests(send).every((message) => isRecord(message) && message.text !== "Section heading."),
    ).toBe(true);
    const added = document.createElement("span");
    added.textContent = "Review the next change carefully.";
    overview.querySelector("div > div")!.append(added);
    await tick();
    expect(added.textContent).toBe("日本語の訳");
  });

  it.each([
    "/smartcamp/review/change-123",
    "/smartcamp/review/change-123/files",
    "/smartcamp/issue/SC-1/review",
  ])("Guide以外のURL %s では翻訳しない", async (pathname) => {
    window.history.replaceState(null, "", pathname);
    document.body.innerHTML = guide;
    const send = vi.fn(async (_message: unknown) => success());
    mount(send);
    await tick();
    expect(send).not.toHaveBeenCalled();
    expect(document.body.innerHTML).toContain("Validate the application before reviewing.");
  });

  it("GuideへのURL確定後に更新すると、残っていた説明を翻訳する", async () => {
    const overviewPath = "/smartcamp/review/change-123";
    window.history.replaceState(null, "", overviewPath);
    document.body.innerHTML = guide;
    const send = vi.fn(async (_message: unknown) => success());
    const controller = mount(send);
    await tick();
    expect(requests(send)).toHaveLength(0);
    window.history.replaceState(null, "", path);
    controller.refresh();
    await tick();
    expect(requests(send)).toHaveLength(2);
    expect(document.querySelector("a")?.parentElement?.textContent).toBe("日本語の訳");
  });

  it("Guideを離れたURL確定後に更新すると復元し、追加された説明も翻訳しない", async () => {
    document.body.innerHTML = guide;
    const original = document.body.innerHTML;
    const send = vi.fn(async (_message: unknown) => success());
    const controller = mount(send);
    await tick();
    const count = requests(send).length;
    window.history.replaceState(null, "", "/smartcamp/review/change-123");
    controller.refresh();
    expect(document.body.innerHTML).toBe(original);
    document.body.insertAdjacentHTML("beforeend", guide);
    await tick();
    expect(requests(send)).toHaveLength(count);
  });

  it("同じ設定を再通知されても解除せず、ルート離脱時に復元して再入場で翻訳する", async () => {
    document.body.innerHTML = guide;
    const original = document.body.innerHTML;
    const send = vi.fn(async (_message: unknown) => success());
    const controller = mount(send);
    await tick();
    const count = requests(send).length;
    controller.setEnabled(true);
    controller.refresh();
    await tick();
    expect(requests(send)).toHaveLength(count);
    expect(document.body.innerHTML).not.toBe(original);
    window.history.replaceState(null, "", "/smartcamp/review/change-123");
    controller.refresh();
    expect(document.body.innerHTML).toBe(original);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: CANCEL_TRANSLATION }));
    window.history.replaceState(null, "", `${path}/`);
    controller.refresh();
    await tick();
    expect(requests(send)).toHaveLength(count * 2);
    controller.dispose();
    expect(document.body.innerHTML).toBe(original);
  });

  it("停止後に届いた翻訳結果を表示しない", async () => {
    document.body.innerHTML = guide;
    const original = document.body.innerHTML;
    const pending = Promise.withResolvers<unknown>();
    const controller = mount(async () => pending.promise);
    controller.setEnabled(false);
    pending.resolve(success());
    await tick();
    expect(document.body.innerHTML).toBe(original);
  });

  it("短い説明の一括要求にも専用機能を指定する", async () => {
    document.body.innerHTML =
      "<div data-guide-section-text><div data-guide-overview><div><span>First label</span><span>Second label</span><span>Third label</span></div></div></div>";
    const send = vi.fn(async (message: unknown) => {
      if (isRecord(message) && message.type === TRANSLATE_BATCH && Array.isArray(message.texts))
        return { ok: true, texts: message.texts.map(() => "日本語"), device: "gpu" };
      return success();
    });
    mount(send);
    await tick();
    expect(requests(send)).toEqual([
      expect.objectContaining({ type: TRANSLATE, feature: "linear-review-guide" }),
      expect.objectContaining({
        type: TRANSLATE_BATCH,
        feature: "linear-review-guide",
        texts: ["Second label", "Third label"],
      }),
    ]);
  });

  it("ページ翻訳がOFFでも動き、通常の選択翻訳と競合するアイコンを作らない", async () => {
    document.body.innerHTML = `<p>Selected English paragraph.</p>${guide}`;
    const send = vi.fn(async (_message: unknown) => success());
    mount(send);
    await tick();
    const paragraph = document.querySelector("p")!;
    const range = document.createRange();
    range.selectNodeContents(paragraph);
    Object.defineProperty(range, "getBoundingClientRect", {
      value: () => ({ left: 10, bottom: 20 }),
    });
    document.getSelection()?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    expect(document.querySelectorAll('[data-luvpame-translation="selection"]')).toHaveLength(0);
    const general = createTranslationController({ send });
    controllers.push(general);
    general.setEnabled(true);
    document.dispatchEvent(new Event("selectionchange"));
    expect(document.querySelectorAll('[data-luvpame-translation="selection"]')).toHaveLength(1);
  });
});
