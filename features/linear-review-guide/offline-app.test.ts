import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { installOfflineGuideApp } from "./offline-app";
import type { createOfflinePlamo } from "./offline-engine";

vi.mock("./offline-engine", () => ({ createOfflinePlamo: vi.fn() }));

type Engine = Awaited<ReturnType<typeof createOfflinePlamo>>;
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const path = "/smartcamp/review/change-123/review";
const guide = `<div data-guide-section-text><div data-guide-overview><p>Validate the application before reviewing.</p><p>Read <code>keepCode()</code> before approval.</p></div></div>`;
const toolbar = `<div data-agent-toolbar-bounds><div style="display: flex; height: 28px"><div style="flex: 1 0 0px"></div><div><div data-agent-panel-anchor></div><button>Agent</button></div><div><button>Chat history</button></div></div></div>`;
const setPage = (html: string) => {
  document.body.innerHTML = html + toolbar;
};
const mockEngine = (device: Engine["device"] = "cpu") => ({
  device,
  modelName: "PLaMo 3 Translate 0.8B",
  translate: vi.fn<Engine["translate"]>(async () => "日本語の説明"),
  dispose: vi.fn<Engine["dispose"]>(async () => {}),
});
const chooseModel = () => {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const model = new File(["GGUF"], "model.gguf");
  Object.defineProperty(input, "files", { configurable: true, value: [model] });
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return { input, model };
};

beforeEach(() => {
  window.history.replaceState(null, "", path);
  setPage("");
});
afterEach(async () => {
  await globalThis.luvpameLinearOfflineGuide?.stop();
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Linear Guideのオフライン翻訳アプリ", () => {
  it("選んだローカルモデルでGuideの説明だけを翻訳し、停止で原文に戻す", async () => {
    setPage(
      `<div id="root" style="height: 800px; overflow: hidden"><main><p>Overview stays in English.</p>${guide}<div data-guide-section-code>const code = true;</div></main></div>`,
    );
    const root = document.querySelector<HTMLElement>("#root")!;
    const rootStyle = root.getAttribute("style");
    const nativeToolbar = document.querySelector("[data-agent-toolbar-bounds]")!;
    const originalToolbar = nativeToolbar.outerHTML;
    const agent = [...nativeToolbar.querySelectorAll("button")].find(
      (button) => button.textContent === "Agent",
    )!;
    const onAgent = vi.fn();
    agent.addEventListener("click", onAgent);
    const original = document.querySelector("main")!.innerHTML;
    const engine = mockEngine();
    const createEngine = vi.fn<typeof createOfflinePlamo>(async () => engine);
    const fetch = vi.fn(() => Promise.reject(new Error("通信禁止")));
    vi.stubGlobal("fetch", fetch);
    const app = await installOfflineGuideApp({ createEngine });
    expect(document.querySelector("[data-luvpame-status-bar] > button")?.textContent).toBe(
      "閉じる",
    );
    expect(document.querySelector("[data-luvpame-status-bar]")?.parentElement).toBe(
      nativeToolbar.querySelector(":scope > div > div:first-child"),
    );
    agent.click();
    expect(onAgent).toHaveBeenCalledOnce();
    expect(root.getAttribute("style")).toBe(rootStyle);
    await tick();
    expect(engine.translate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "GGUFモデルを選ぶとGuideの説明を自動翻訳します。",
    );
    const { model } = chooseModel();
    await tick();
    expect(createEngine.mock.calls[0]?.[0]).toBe(model);
    expect(document.querySelector("[data-guide-overview] p")?.textContent).toBe("日本語の説明");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "翻訳完了 3件 · CPU・GPU利用不可",
    );
    expect(document.querySelector("main > p")?.textContent).toBe("Overview stays in English.");
    expect(document.querySelector("code")?.textContent).toBe("keepCode()");
    expect(document.querySelector("[data-guide-section-code]")?.textContent).toBe(
      "const code = true;",
    );
    expect(fetch).not.toHaveBeenCalled();
    await app.stop();
    expect(document.querySelector("main")!.innerHTML).toBe(original);
    expect(document.querySelector("[data-luvpame-translation]")).toBeNull();
    expect(document.querySelector("style[data-luvpame-status-bar-style]")).toBeNull();
    expect(root.getAttribute("style")).toBe(rootStyle);
    expect(nativeToolbar.outerHTML).toBe(originalToolbar);
    expect(nativeToolbar.querySelector("[data-agent-panel-anchor]")).not.toBeNull();
    expect(engine.dispose).toHaveBeenCalledOnce();
    await app.stop();
    expect(engine.dispose).toHaveBeenCalledOnce();
  });

  it("渡されたモデルでも開始でき、追加されたGuide説明を翻訳する", async () => {
    const engine = mockEngine();
    const model = new Blob(["GGUF"]);
    const createEngine = vi.fn<typeof createOfflinePlamo>(async () => engine);
    await installOfflineGuideApp({ model, createEngine });
    await tick();
    expect(createEngine.mock.calls[0]?.[0]).toBe(model);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Guide待機 · CPU・GPU利用不可",
    );
    document.body.insertAdjacentHTML("afterbegin", guide);
    await tick();
    expect(document.querySelector("[data-guide-overview] p")?.textContent).toBe("日本語の説明");
  });

  it("Navigation APIのURL確定後にGuideへ入ると開始し、離れると復元する", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    window.history.replaceState(null, "", "/smartcamp/review/change-123");
    setPage(guide);
    const original = document.querySelector("[data-guide-section-text]")!.outerHTML;
    const engine = mockEngine();
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    expect(engine.translate).not.toHaveBeenCalled();
    window.history.replaceState(null, "", path);
    navigation.dispatchEvent(new Event("currententrychange"));
    await tick();
    expect(document.querySelector("[data-guide-overview] p")?.textContent).toBe("日本語の説明");
    const completed = document.querySelector('[role="status"]')?.textContent;
    window.history.replaceState(null, "", `${path}#guide`);
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(document.querySelector('[role="status"]')?.textContent).toBe(completed);
    window.history.replaceState(null, "", "/smartcamp/review/change-123");
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(document.querySelector("[data-guide-section-text]")!.outerHTML).toBe(original);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Guide待機 · CPU・GPU利用不可",
    );
    Reflect.deleteProperty(window, "navigation");
  });

  it("GPUでは2件まで並列に翻訳し、GPU使用を表示する", async () => {
    setPage(
      `<div data-guide-section-text><div data-guide-overview><p>First English paragraph.</p><p>Second English paragraph.</p><p>Third English paragraph.</p></div></div>`,
    );
    const first = Promise.withResolvers<string>();
    const second = Promise.withResolvers<string>();
    const engine = mockEngine("gpu");
    engine.translate
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    expect(engine.translate).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "翻訳中 完了0件 / 処理中2件 / 待機1件 · GPU",
    );
    const status = document.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.title).toContain(status.textContent);
    expect(status.title).toContain("モデル: PLaMo 3 Translate 0.8B");
    expect(status.title).toContain("デバイス: GPU");
    expect(status.title).toContain("件数は翻訳要求のテキスト数です。");
    const stop = document.querySelector<HTMLButtonElement>("[data-luvpame-status-bar] > button")!;
    expect(stop.textContent).toBe("翻訳を停止");
    expect(stop.title).toBe("翻訳を停止し、原文に戻します。モデルも終了します。");
    first.resolve("最初の日本語");
    second.resolve("次の日本語");
    await tick();
    expect(engine.translate).toHaveBeenCalledTimes(3);
    expect(
      [...document.querySelectorAll("[data-guide-overview] p")].map((p) => p.textContent),
    ).toEqual(["最初の日本語", "次の日本語", "日本語の説明"]);
    expect(status.textContent).toBe("翻訳完了 3件 · GPU");
  });

  it("翻訳を直列に処理し、失敗した後の説明も翻訳する", async () => {
    setPage(
      `<div data-guide-section-text><div data-guide-overview><p>First label</p><p>Second label</p><p>Third label</p></div></div>`,
    );
    const first = Promise.withResolvers<string>();
    const engine = mockEngine();
    engine.translate.mockImplementationOnce(() => first.promise);
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    expect(engine.translate).toHaveBeenCalledOnce();
    first.reject(new Error("最初の翻訳に失敗しました。"));
    await tick();
    expect(engine.translate.mock.calls.map(([text]) => text)).toEqual([
      "First label",
      "Second label",
      "Third label",
    ]);
    const paragraphs = document.querySelectorAll("[data-guide-overview] p");
    expect(paragraphs[0]?.textContent).toContain("First label");
    expect(paragraphs[1]?.textContent).toBe("日本語の説明");
    expect(paragraphs[2]?.textContent).toBe("日本語の説明");
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "完了2件・失敗1件 · CPU・GPU利用不可",
    );
    expect(document.querySelector<HTMLElement>('[role="status"]')?.title).toContain(
      "最新のエラー: 最初の翻訳に失敗しました。",
    );
  });

  it("一括要求は要求数ではなく含まれるテキスト数で待機・処理中・失敗を表示する", async () => {
    setPage(
      `<div data-guide-section-text><div data-guide-overview><p>First label</p><p>Second label</p><p>Third label</p></div></div>`,
    );
    const first = Promise.withResolvers<string>();
    const batch = Promise.withResolvers<string>();
    const engine = mockEngine();
    engine.translate
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => batch.promise);
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    const status = document.querySelector<HTMLElement>('[role="status"]')!;
    expect(status.textContent).toBe("翻訳中 完了0件 / 処理中1件 / 待機2件 · CPU・GPU利用不可");
    first.resolve("最初の日本語");
    await tick();
    expect(status.textContent).toBe("翻訳中 完了1件 / 処理中2件 / 待機0件 · CPU・GPU利用不可");
    batch.reject(new Error("一括翻訳に失敗しました。"));
    await tick();
    expect(status.textContent).toBe("完了1件・失敗2件 · CPU・GPU利用不可");
    expect(status.title).toContain("最新のエラー: 一括翻訳に失敗しました。");
  });

  it("Guideから離れると待機に戻り、再入場した翻訳へ古い結果や中断を数えない", async () => {
    const navigation = new EventTarget();
    Object.defineProperty(window, "navigation", { configurable: true, value: navigation });
    setPage(
      `<div data-guide-section-text><div data-guide-overview><p>One English paragraph.</p></div></div>`,
    );
    const previous = Promise.withResolvers<string>();
    const current = Promise.withResolvers<string>();
    const engine = mockEngine();
    engine.translate
      .mockImplementationOnce(() => previous.promise)
      .mockImplementationOnce(() => current.promise);
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    const status = document.querySelector<HTMLElement>('[role="status"]')!;
    window.history.replaceState(null, "", "/smartcamp/review/change-123");
    navigation.dispatchEvent(new Event("currententrychange"));
    expect(status.textContent).toBe("Guide待機 · CPU・GPU利用不可");
    expect(engine.translate.mock.calls[0]?.[1].signal.aborted).toBe(true);
    window.history.replaceState(null, "", path);
    navigation.dispatchEvent(new Event("currententrychange"));
    await tick();
    expect(status.textContent).toBe("翻訳中 完了0件 / 処理中0件 / 待機1件 · CPU・GPU利用不可");
    previous.resolve("古い結果");
    await tick();
    expect(status.textContent).toBe("翻訳中 完了0件 / 処理中1件 / 待機0件 · CPU・GPU利用不可");
    current.resolve("今回の結果");
    await tick();
    expect(status.textContent).toBe("翻訳完了 1件 · CPU・GPU利用不可");
    expect(document.querySelector("[data-guide-overview] p")?.textContent).toBe("今回の結果");
    Reflect.deleteProperty(window, "navigation");
  });

  it("停止で実行中と待機中を中断し、遅い結果も途中結果も原文へ反映しない", async () => {
    setPage(guide);
    const original = document.querySelector("[data-guide-section-text]")!.outerHTML;
    const pending = Promise.withResolvers<string>();
    const engine = mockEngine();
    engine.translate.mockImplementationOnce((_text, options) => {
      options.onText?.("途中の日本語");
      return pending.promise;
    });
    const app = await installOfflineGuideApp({
      model: new Blob(),
      createEngine: async () => engine,
    });
    await tick();
    expect(engine.translate).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "翻訳中 完了0件 / 処理中1件 / 待機2件 · CPU・GPU利用不可",
    );
    expect(document.querySelector("[data-guide-overview] p")?.textContent).toBe("途中の日本語");
    const signal = engine.translate.mock.calls[0]?.[1].signal;
    const status = document.querySelector<HTMLElement>('[role="status"]')!;
    const lastStatus = status.textContent;
    await app.stop();
    expect(signal?.aborted).toBe(true);
    pending.resolve("停止後の日本語");
    await tick();
    expect(engine.translate).toHaveBeenCalledOnce();
    expect(document.querySelector("[data-guide-section-text]")!.outerHTML).toBe(original);
    expect(status.textContent).toBe(lastStatus);
    expect(document.querySelector('[role="status"]')).toBeNull();
  });

  it("待機中に取り除かれた説明をモデルへ渡さず、残った説明を翻訳する", async () => {
    const texts = ["First", "Second", "Third"].map((label) =>
      `${label} paragraph explains the application review process. `.repeat(4).trim(),
    );
    setPage(
      `<div data-guide-section-text><div data-guide-overview>${texts.map((text) => `<p>${text}</p>`).join("")}</div></div>`,
    );
    const pending = Promise.withResolvers<string>();
    const engine = mockEngine();
    engine.translate.mockImplementationOnce(() => pending.promise);
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    expect(engine.translate).toHaveBeenCalledOnce();
    document.querySelectorAll("[data-guide-overview] p")[1]!.remove();
    window.dispatchEvent(new Event("scroll"));
    await tick();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "翻訳中 完了0件 / 処理中1件 / 待機1件 · CPU・GPU利用不可",
    );
    pending.resolve("最初の日本語");
    await tick();
    expect(engine.translate.mock.calls.map(([text]) => text)).toEqual([texts[0], texts[2]]);
    expect(document.querySelectorAll("[data-guide-overview] p")[1]?.textContent).toBe(
      "日本語の説明",
    );
  });

  it("モデル準備中に停止したら、後からできたエンジンを破棄する", async () => {
    setPage(guide);
    const loading = Promise.withResolvers<Engine>();
    const engine = mockEngine();
    const app = await installOfflineGuideApp({
      model: new Blob(),
      createEngine: () => loading.promise,
    });
    expect(document.querySelector('[role="status"]')?.textContent).toBe("モデル準備中");
    const stop = document.querySelector<HTMLButtonElement>("[data-luvpame-status-bar] > button")!;
    expect(stop.textContent).toBe("準備を中止");
    expect(stop.title).toContain("モデルの読み込み終了後");
    stop.click();
    await app.stop();
    loading.resolve(engine);
    await tick();
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(engine.translate).not.toHaveBeenCalled();
    expect(document.querySelector('[role="region"]')).toBeNull();
  });

  it("モデル読み込み失敗を表示し、同じ入力から再選択できる", async () => {
    const engine = mockEngine();
    const createEngine = vi.fn<typeof createOfflinePlamo>();
    createEngine.mockRejectedValueOnce(new Error("GGUFモデルを読み込めませんでした。"));
    createEngine.mockResolvedValueOnce(engine);
    await installOfflineGuideApp({ createEngine });
    const { input } = chooseModel();
    await tick();
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "GGUFモデルを読み込めませんでした。",
    );
    expect(input.disabled).toBe(false);
    chooseModel();
    await tick();
    expect(createEngine).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[role="status"]')?.textContent).toBe(
      "Guide待機 · CPU・GPU利用不可",
    );
  });

  it("再実行で古いアプリを停止してパネルを一つに保ち、pagehideで停止する", async () => {
    const engine = mockEngine();
    await installOfflineGuideApp({ model: new Blob(), createEngine: async () => engine });
    await tick();
    const app = await installOfflineGuideApp({ createEngine: async () => mockEngine() });
    expect(engine.dispose).toHaveBeenCalledOnce();
    expect(globalThis.luvpameLinearOfflineGuide).toBe(app);
    expect(document.querySelectorAll('[data-luvpame-translation="offline-guide"]')).toHaveLength(1);
    window.dispatchEvent(new Event("pagehide"));
    await tick();
    expect(document.querySelector('[data-luvpame-translation="offline-guide"]')).toBeNull();
    expect(globalThis.luvpameLinearOfflineGuide).toBeUndefined();
  });
});
