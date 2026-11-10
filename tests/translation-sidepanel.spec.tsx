import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { isRecord } from "../lib/copy-protocol";
import { Sidepanel } from "../features/translate/sidepanel";
import {
  ARTICLE_REQUEST,
  TRANSLATION_READY,
  CANCEL_TRANSLATION,
  TRANSLATE,
  isTranslationRequest,
  type TranslationResult,
} from "../features/translate/shared";

let root: Root;
let container: HTMLDivElement;
let activeTab: number;
let article: { ok: true; url: string; title: string; paragraphs: string[] };
let onActivated: Parameters<typeof browser.tabs.onActivated.addListener>[0];
let onUpdated: (id: number, change: { status: "loading" | "complete" }) => void;
let onSettingsChanged: Parameters<typeof browser.storage.onChanged.addListener>[0];

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  activeTab = 7;
  article = {
    ok: true,
    url: "https://example.com/article",
    title: "記事の見出し",
    paragraphs: ["First paragraph.", "Second paragraph."],
  };
  vi.spyOn(browser.tabs, "query").mockImplementation(async () => [{ id: activeTab }]);
  vi.spyOn(browser.tabs, "sendMessage").mockImplementation(async (_tabId, message) =>
    isRecord(message) && message.type === TRANSLATION_READY ? { ok: true } : article,
  );
  vi.spyOn(browser.tabs.onActivated, "addListener").mockImplementation((listener) => {
    onActivated = listener;
  });
  vi.spyOn(browser.tabs.onUpdated, "addListener").mockImplementation((listener) => {
    onUpdated = (id, change) =>
      listener(id, change, {
        id,
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: true,
        incognito: false,
        selected: true,
        discarded: false,
        autoDiscardable: true,
        groupId: -1,
        frozen: false,
        lastAccessed: 0,
      });
  });
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: true,
  }));
  vi.spyOn(browser.storage.onChanged, "addListener").mockImplementation((listener) => {
    onSettingsChanged = listener;
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("translates every article paragraph into easy Japanese when the active tab exposes only its ID", async () => {
  const send = vi
    .spyOn(browser.runtime, "sendMessage")
    .mockImplementation(async (message: unknown) => {
      if (isTranslationRequest(message))
        return { ok: true, text: `やさしい訳: ${message.text}`, device: "gpu" };
      return { ok: true };
    });
  await act(async () => root.render(<Sidepanel />));

  expect(browser.tabs.sendMessage).toHaveBeenCalledWith(
    7,
    { type: ARTICLE_REQUEST },
    { frameId: 0 },
  );
  expect(container.querySelector("h2")?.textContent).toBe("記事の見出し");
  expect([...container.querySelectorAll("article p")].map((p) => p.textContent)).toEqual([
    "やさしい訳: First paragraph.",
    "やさしい訳: Second paragraph.",
  ]);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  expect(container.querySelector(".reading-status")?.hasAttribute("hidden")).toBe(true);
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
  for (const text of article.paragraphs)
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ type: TRANSLATE, target: "ja-easy", text }),
    );
});

it("clears old paragraphs while the same URL reloads and translates the replacement article", async () => {
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async (message: unknown) =>
    isTranslationRequest(message)
      ? { ok: true, text: `訳: ${message.text}`, device: "gpu" }
      : { ok: true },
  );
  await act(async () => root.render(<Sidepanel />));
  expect(container.querySelectorAll("article p")).toHaveLength(2);

  await act(async () => onUpdated(7, { status: "loading" }));
  expect(container.querySelectorAll("article p")).toHaveLength(0);
  expect(container.querySelector("h2")).toBeNull();

  article = { ...article, title: "更新後の見出し", paragraphs: ["Replacement paragraph."] };
  await act(async () => onUpdated(7, { status: "complete" }));
  expect(container.querySelector("h2")?.textContent).toBe("更新後の見出し");
  expect(container.querySelector("article")?.textContent).toBe("訳: Replacement paragraph.");
  expect(
    vi
      .mocked(browser.tabs.sendMessage)
      .mock.calls.filter(([, message]) => isRecord(message) && message.type === ARTICLE_REQUEST),
  ).toHaveLength(2);
});

it("clears visible translations and cancels pending work when translation is disabled", async () => {
  let finish!: (result: TranslationResult) => void;
  let sessionId = "";
  const send = vi
    .spyOn(browser.runtime, "sendMessage")
    .mockImplementation(async (message: unknown) => {
      if (!isTranslationRequest(message)) return { ok: true };
      if (!sessionId) sessionId = message.sessionId;
      if (message.text === "First paragraph.") return { ok: true, text: "最初の訳", device: "gpu" };
      return new Promise<TranslationResult>((resolve) => {
        finish = resolve;
      });
    });
  await act(async () => root.render(<Sidepanel />));
  expect(container.querySelector("article")?.textContent).toBe("最初の訳");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");

  await act(async () => onSettingsChanged({ translationEnabled: { newValue: false } }, "local"));
  expect(container.querySelector("article")?.textContent).toBe("");
  expect(container.textContent).toContain("翻訳は共通設定でOFFになっています。");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
  expect(send).toHaveBeenCalledWith({
    type: CANCEL_TRANSLATION,
    sessionId,
  });
  await act(async () => finish({ ok: true, text: "遅れて届いた訳", device: "gpu" }));
  expect(container.querySelector("article")?.textContent).toBe("");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
});

it.each([
  { ok: true, text: "翻訳した記事", device: "cpu" },
  { ok: false, error: "翻訳に失敗しました。" },
] satisfies TranslationResult[])(
  "keeps the article busy until the translation settles (%#)",
  async (result) => {
    article = { ...article, paragraphs: ["One paragraph."] };
    let finish: ((response: TranslationResult) => void) | undefined;
    vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
      if (!isTranslationRequest(message)) return { ok: true };
      return new Promise<TranslationResult>((resolve) => {
        finish = resolve;
      });
    });
    await act(async () => root.render(<Sidepanel />));
    const status = container.querySelector('[role="status"]');
    const indicator = status?.querySelector(".translation-indicator");
    expect(status?.getAttribute("aria-busy")).toBe("true");
    expect(status?.textContent).toBe("");
    expect(status?.getAttribute("aria-label")).toBe("翻訳中");
    expect(container.querySelector(".reading-status")?.hasAttribute("hidden")).toBe(false);
    await act(async () => finish?.(result));
    expect(status?.getAttribute("aria-busy")).toBe("false");
    expect(status?.querySelector(".translation-indicator")).toBe(indicator);
    expect(status?.textContent).toBe(result.ok ? "" : result.error);
    expect(status?.hasAttribute("aria-label")).toBe(false);
    expect(container.querySelector(".reading-status")?.hasAttribute("hidden")).toBe(result.ok);
    expect(container.querySelector("article")?.textContent).toBe(result.ok ? result.text : "");
    expect(container.textContent).not.toContain("CPUで翻訳中");
    expect(container.querySelector("button")?.textContent).toBe(result.ok ? undefined : "再試行");
  },
);

it("does not stay busy when the article has no paragraphs", async () => {
  article = { ...article, paragraphs: [] };
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async () => ({ ok: true }));
  await act(async () => root.render(<Sidepanel />));
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
  expect(container.querySelector('[role="status"]')?.textContent).toBe(
    "読み取れる本文がありません。",
  );
});

it("ignores a cancelled tab's late response after switching to another article", async () => {
  let finish!: (result: TranslationResult) => void;
  let sessionId = "";
  const send = vi
    .spyOn(browser.runtime, "sendMessage")
    .mockImplementation(async (message: unknown) => {
      if (!isTranslationRequest(message)) return { ok: true };
      if (!sessionId) sessionId = message.sessionId;
      if (message.text === "New tab paragraph.")
        return { ok: true, text: "新しいタブの訳", device: "gpu" };
      return new Promise<TranslationResult>((resolve) => {
        finish = resolve;
      });
    });
  await act(async () => root.render(<Sidepanel />));
  activeTab = 8;
  article = {
    ...article,
    url: "https://example.com/new",
    title: "別の記事",
    paragraphs: ["New tab paragraph."],
  };
  await act(async () => onActivated({ tabId: 8, windowId: 1 }));
  expect(container.querySelector("h2")?.textContent).toBe("別の記事");
  expect(send).toHaveBeenCalledWith({
    type: CANCEL_TRANSLATION,
    sessionId,
  });
  await act(async () => finish({ ok: true, text: "古いタブの訳", device: "gpu" }));
  expect(container.querySelector("article")?.textContent).toBe("新しいタブの訳");
});

it("keeps article extraction errors visible and retries extraction from the retry button", async () => {
  vi.spyOn(browser.tabs, "sendMessage")
    .mockImplementationOnce(async () => ({ ok: true }))
    .mockRejectedValueOnce(new Error("記事の接続に失敗しました"))
    .mockImplementation(async (_tabId, message) =>
      isRecord(message) && message.type === TRANSLATION_READY ? { ok: true } : article,
    );
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async (message: unknown) =>
    isTranslationRequest(message)
      ? { ok: true, text: "再取得後の訳", device: "gpu" }
      : { ok: true },
  );
  await act(async () => root.render(<Sidepanel />));
  expect(container.querySelector('[role="status"]')?.textContent).toBe("記事の接続に失敗しました");
  const retry = container.querySelector("button");
  expect(retry?.textContent).toBe("再試行");
  await act(async () => retry?.click());
  expect(
    vi
      .mocked(browser.tabs.sendMessage)
      .mock.calls.filter(([, message]) => isRecord(message) && message.type === ARTICLE_REQUEST),
  ).toHaveLength(2);
  expect(container.querySelector("article")?.textContent).toContain("再取得後の訳");
});

it("extracts and translates the current article after the feature is enabled", async () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: false,
  }));
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async (message: unknown) =>
    isTranslationRequest(message)
      ? { ok: true, text: "有効化後の訳", device: "gpu" }
      : { ok: true },
  );
  await act(async () => root.render(<Sidepanel />));
  expect(container.textContent).toContain("翻訳は共通設定でOFFになっています。");
  expect(browser.tabs.sendMessage).not.toHaveBeenCalled();
  await act(async () => onSettingsChanged({ translationEnabled: { newValue: true } }, "local"));
  expect(container.querySelector("h2")?.textContent).toBe("記事の見出し");
  expect(container.querySelectorAll("article p")).toHaveLength(2);
  expect(container.querySelector("article")?.textContent).toContain("有効化後の訳");
});

it("shows partial paragraphs without marking them complete and rejects stale chunk updates", async () => {
  article = { ...article, paragraphs: ["Hello world. ".repeat(150)] };
  let progress: Parameters<typeof browser.runtime.onMessage.addListener>[0] | undefined;
  vi.spyOn(browser.runtime.onMessage, "addListener").mockImplementation((listener) => {
    progress = listener;
  });
  const requests: {
    sessionId: string;
    requestId: string;
    finish: (value: TranslationResult) => void;
  }[] = [];
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async (message: unknown) => {
    if (!isTranslationRequest(message)) return { ok: true };
    return new Promise<TranslationResult>((finish) =>
      requests.push({ sessionId: message.sessionId, requestId: message.requestId, finish }),
    );
  });
  await act(async () => root.render(<Sidepanel />));
  const emit = (request: { sessionId: string; requestId: string }, text: string) =>
    progress?.(
      { type: "luvpame:translation-progress", ...request, update: { kind: "text", text } },
      { id: browser.runtime.id },
      vi.fn(),
    );
  await act(async () => {
    progress?.(
      {
        type: "luvpame:translation-progress",
        ...requests[0]!,
        update: { kind: "status", message: "翻訳中" },
      },
      { id: browser.runtime.id },
      vi.fn(),
    );
  });
  expect(container.querySelector('[role="status"]')?.textContent).toBe("");
  await act(async () => {
    emit(requests[0]!, "途中の訳");
  });
  expect(container.querySelector("article")?.textContent).toBe("途中の訳");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
  await act(async () => requests[0]?.finish({ ok: true, text: "確定した前半", device: "gpu" }));
  await act(async () => {
    emit(requests[1]!, "後半の途中");
    emit(requests[0]!, "古い前半");
  });
  expect(container.querySelector("article")?.textContent).toBe("確定した前半\n後半の途中");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("true");
  await act(async () => requests[1]?.finish({ ok: true, text: "確定した後半", device: "gpu" }));
  await act(async () => {
    emit(requests[1]!, "完了後の遅延");
  });
  expect(container.querySelector("article")?.textContent).toBe("確定した前半\n確定した後半");
  expect(container.querySelector('[role="status"]')?.getAttribute("aria-busy")).toBe("false");
});
