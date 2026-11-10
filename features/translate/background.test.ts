import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Browser, browser } from "wxt/browser";
const api = vi.hoisted(() => {
  const runtimeError: { lastError?: { message: string } } = {};
  return {
    runtime: {
      ...runtimeError,
      id: "test-extension",
      getURL: (path: string) => `chrome-extension://test-extension${path}`,
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      sendMessage: vi.fn(),
    },
    storage: { local: { get: vi.fn() }, onChanged: { addListener: vi.fn() } },
    tabs: { sendMessage: vi.fn(), query: vi.fn(), onRemoved: { addListener: vi.fn() } },
    scripting: { executeScript: vi.fn() },
    notifications: { create: vi.fn() },
    commands: { onCommand: { addListener: vi.fn() } },
    contextMenus: {
      removeAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    offscreen: { hasDocument: vi.fn() },
  };
});
vi.mock("wxt/browser", () => ({ browser: api }));
vi.mock("../../lib/offscreen", () => ({ ensureOffscreen: vi.fn(async () => {}) }));
import { registerTranslationBackground } from "./background";
import { ensureOffscreen } from "../../lib/offscreen";
import {
  PREPARE_TRANSLATION,
  OFFSCREEN_PREPARE_TRANSLATION,
  TRANSLATE,
  TRANSLATE_BATCH,
  OFFSCREEN_TRANSLATE_BATCH,
  CANCEL_TRANSLATION_REQUEST,
  OFFSCREEN_CANCEL_REQUEST,
  REPRIORITIZE_TRANSLATIONS,
  OFFSCREEN_REPRIORITIZE,
  isTranslationBatchRequest,
  isTranslationUpdate,
  CANCEL_TRANSLATION,
  OFFSCREEN_TRANSLATE,
  isTranslationRequest,
  TRANSLATION_READY,
  PAGE_TRANSLATION,
} from "./shared";

const request = {
  type: TRANSLATE,
  sessionId: "session-1",
  requestId: "request-1",
  priority: "page",
  text: "Hello world",
  target: "ja",
};
const sender = { id: "test-extension", tab: { id: 7 }, frameId: 0, url: "https://example.com" };
const menus = new Map<string | number, Browser.contextMenus.CreateProperties>();
const menuIds = ["luvpame:page-translation", "luvpame:easy-page-translation"];

beforeEach(() => {
  vi.resetAllMocks();
  menus.clear();
  api.runtime.lastError = undefined;
  api.storage.local.get.mockResolvedValue({});
  api.scripting.executeScript.mockResolvedValue([]);
  api.tabs.sendMessage.mockImplementation(async (_tabId, message) =>
    message.type === TRANSLATION_READY ? { ok: true } : undefined,
  );
  api.notifications.create.mockResolvedValue("notification");
  api.contextMenus.removeAll.mockImplementation((callback: () => void) => {
    menus.clear();
    queueMicrotask(callback);
  });
  api.contextMenus.create.mockImplementation(
    (menu: Browser.contextMenus.CreateProperties, callback?: () => void) => {
      const id = menu.id ?? "missing-id";
      const duplicate = menus.has(id);
      if (!duplicate) menus.set(id, menu);
      queueMicrotask(() => {
        api.runtime.lastError = duplicate ? { message: `Duplicate id ${id}` } : undefined;
        callback?.();
        api.runtime.lastError = undefined;
      });
      return id;
    },
  );
  api.contextMenus.update.mockImplementation(
    (
      id: string | number,
      properties: Parameters<typeof browser.contextMenus.update>[1],
      callback: () => void,
    ) => {
      queueMicrotask(() => {
        const menu = menus.get(id);
        api.runtime.lastError = menu ? undefined : { message: "Menu not found" };
        if (menu) menus.set(id, { ...menu, ...properties });
        callback();
        api.runtime.lastError = undefined;
      });
    },
  );
  api.runtime.sendMessage.mockImplementation(async (message) => ({
    requestId: message.requestId,
    ok: true,
    text: "こんにちは",
    device: "cpu",
  }));
});

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.restoreAllMocks();
});

it("creates static menus synchronously before settings resolve", async () => {
  let finishRead: (value: { translationEnabled: boolean }) => void = () => {};
  api.storage.local.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  registerTranslationBackground();
  expect(api.contextMenus.create.mock.calls.map(([menu]) => menu.id)).toEqual(menuIds);
  expect(api.storage.local.get).not.toHaveBeenCalled();
  expect([...menus.values()]).toEqual([
    {
      id: menuIds[0],
      title: "日本語訳を開始／解除（Option+A）",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
    {
      id: menuIds[1],
      title: "やさしい日本語訳を開始／解除（Option+Shift+A）",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
  ]);
  await vi.waitFor(() => expect(api.storage.local.get).toHaveBeenCalledOnce());
  expect(api.contextMenus.update).not.toHaveBeenCalled();
  finishRead({ translationEnabled: false });
  await vi.waitFor(() =>
    expect([...menus.values()].map((menu) => menu.enabled)).toEqual([false, false]),
  );
  expect(api.contextMenus.removeAll).toHaveBeenCalledOnce();
});

it("replaces stale menus synchronously during installation before applying settings", async () => {
  for (const id of menuIds) menus.set(id, { id, title: "old", contexts: ["page"] });
  registerTranslationBackground();
  api.runtime.onInstalled.addListener.mock.calls[0]?.[0]();
  expect(api.contextMenus.create).toHaveBeenCalledTimes(4);
  api.runtime.onStartup.addListener.mock.calls[0]?.[0]();
  await vi.waitFor(() => {
    expect([...menus.values()].map((menu) => menu.contexts)).toEqual([["all"], ["all"]]);
    expect(api.storage.local.get).toHaveBeenCalledTimes(3);
  });
  expect([...menus.keys()]).toEqual(menuIds);
  expect(api.contextMenus.removeAll).toHaveBeenCalledTimes(2);
  expect(api.contextMenus.removeAll.mock.invocationCallOrder[0]).toBeLessThan(
    api.contextMenus.create.mock.invocationCallOrder[0]!,
  );
});

it("keeps the latest feature change while callback-only creation and settings are pending", async () => {
  let finishCreate: () => void = () => {};
  let finishRead: (value: { translationEnabled: boolean }) => void = () => {};
  api.storage.local.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  api.contextMenus.create.mockImplementationOnce(
    (menu: Browser.contextMenus.CreateProperties, callback: () => void) => {
      finishCreate = () => {
        menus.set(menu.id ?? "missing-id", menu);
        callback();
      };
      return menu.id ?? "missing-id";
    },
  );
  registerTranslationBackground();
  const changed = api.storage.onChanged.addListener.mock.calls[0]?.[0];
  changed({ translationEnabled: { newValue: false } }, "local");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.contextMenus.update).not.toHaveBeenCalled();
  expect(api.storage.local.get).not.toHaveBeenCalled();
  finishCreate();
  await vi.waitFor(() => expect(api.storage.local.get).toHaveBeenCalledOnce());
  api.storage.local.get.mockResolvedValue({ translationEnabled: false });
  finishRead({ translationEnabled: true });
  await vi.waitFor(() =>
    expect([...menus.values()].map((menu) => menu.enabled)).toEqual([false, false]),
  );
  api.storage.local.get.mockResolvedValue({ translationEnabled: true });
  changed({ translationEnabled: { newValue: true } }, "local");
  await vi.waitFor(() =>
    expect([...menus.values()].map((menu) => menu.enabled)).toEqual([true, true]),
  );
  const synchronizations = api.contextMenus.update.mock.calls.length;
  changed({ urlCopyEnabled: { newValue: false } }, "local");
  changed({ translationEnabled: { newValue: false } }, "sync");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.contextMenus.update).toHaveBeenCalledTimes(synchronizations);
  expect(api.contextMenus.create).toHaveBeenCalledTimes(2);
});

it("reports callback update failures and recovers at the next synchronization", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  api.storage.local.get.mockResolvedValue({ translationEnabled: false });
  api.contextMenus.update.mockImplementationOnce(
    (
      _id: string | number,
      _properties: Parameters<typeof browser.contextMenus.update>[1],
      callback: () => void,
    ) => {
      queueMicrotask(() => {
        api.runtime.lastError = { message: "Menu update failed" };
        callback();
        api.runtime.lastError = undefined;
      });
    },
  );
  registerTranslationBackground();
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error("Menu update failed")));
  expect(menus.get(menuIds[0] ?? "")?.enabled).toBe(true);
  api.runtime.onStartup.addListener.mock.calls[0]?.[0]();
  await vi.waitFor(() =>
    expect([...menus.values()].map((menu) => menu.enabled)).toEqual([false, false]),
  );
});

it("rejects invalid targets, oversized input and unbounded session IDs", () => {
  expect(isTranslationRequest(request)).toBe(true);
  expect(isTranslationRequest({ ...request, target: "en" })).toBe(false);
  expect(isTranslationRequest({ ...request, text: "x".repeat(20001) })).toBe(false);
  expect(isTranslationRequest({ ...request, sessionId: "x".repeat(161) })).toBe(false);
});

it("uses the persisted model and scopes content requests to the sender tab", async () => {
  api.storage.local.get.mockResolvedValue({ translationModel: "0.8b" });
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const result = await new Promise((resolve) => listener(request, sender, resolve));
  expect(result).toMatchObject({ ok: true, text: "こんにちは", device: "cpu" });
  expect(api.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: OFFSCREEN_TRANSLATE,
      sessionId: "tab-7:session-1",
      provider: { kind: "browser", model: "0.8b" },
      text: "Hello world",
    }),
  );
});

it.each([undefined, { id: 7 }])("rejects removed sidepanel senders (%j)", (tab) => {
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const respond = vi.fn();
  expect(
    listener(
      request,
      { id: "test-extension", url: api.runtime.getURL("/sidepanel.html"), tab, frameId: 0 },
      respond,
    ),
  ).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
});

it("never starts inference for a disabled feature or forged sender", async () => {
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const respond = vi.fn();
  expect(listener(request, { ...sender, id: "other-extension" }, respond)).toBeUndefined();
  expect(listener(request, { ...sender, frameId: 1 }, respond)).toBeUndefined();
  expect(
    listener(
      request,
      { id: "test-extension", url: "chrome-extension://test-extension/popup.html" },
      respond,
    ),
  ).toBeUndefined();
  for (const invalidSender of [
    { ...sender, url: api.runtime.getURL("/popup.html") },
    { ...sender, url: api.runtime.getURL("/sidepanel.html?forged") },
    { ...sender, url: api.runtime.getURL("/sidepanel.html"), id: "other-extension" },
    { id: "test-extension", url: "https://example.com" },
  ]) {
    expect(listener(request, invalidSender, respond)).toBeUndefined();
  }
  expect(respond).not.toHaveBeenCalled();
  api.storage.local.get.mockResolvedValue({ translationEnabled: false });
  const result = await new Promise((resolve) => listener(request, sender, resolve));
  expect(result).toMatchObject({ ok: false, error: "翻訳機能はOFFです。" });
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});

it("rejects unrelated offscreen replies instead of displaying them as a translation", async () => {
  api.runtime.sendMessage.mockResolvedValue({
    requestId: "unrelated",
    ok: true,
    text: "wrong",
    device: "cpu",
  });
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const result = await new Promise((resolve) => listener(request, sender, resolve));
  expect(result).toMatchObject({ ok: false });
});

it.each([
  ["luvpame:page-translation", "ja"],
  ["luvpame:easy-page-translation", "ja-easy"],
])("routes menu %s to page translation", async (menuItemId, target) => {
  registerTranslationBackground();
  api.contextMenus.onClicked.addListener.mock.calls[0]?.[0]({ menuItemId }, { id: 7 });
  await vi.waitFor(() =>
    expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(
      7,
      { type: PAGE_TRANSLATION, target },
      { frameId: 0 },
    ),
  );
});
it.each([
  ["toggle-page-translation", "ja"],
  ["toggle-easy-page-translation", "ja-easy"],
])("toggles the active page with %s without reinjecting", async (name, target) => {
  api.tabs.query.mockResolvedValue([{ id: 7 }]);
  registerTranslationBackground();
  api.commands.onCommand.addListener.mock.calls[0]?.[0](name);
  await vi.waitFor(() =>
    expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(
      7,
      { type: PAGE_TRANSLATION, target },
      { frameId: 0 },
    ),
  );
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
it("uses the command tab for easy translation", async () => {
  registerTranslationBackground();
  api.commands.onCommand.addListener.mock.calls[0]?.[0]("toggle-easy-page-translation", { id: 8 });
  await vi.waitFor(() =>
    expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(
      8,
      { type: PAGE_TRANSLATION, target: "ja-easy" },
      { frameId: 0 },
    ),
  );
  expect(api.tabs.query).not.toHaveBeenCalled();
});

it("recovers the keyboard command on an existing page after extension reload", async () => {
  api.tabs.query.mockResolvedValue([{ id: 7 }]);
  api.tabs.sendMessage
    .mockRejectedValueOnce(
      new Error("Could not establish connection. Receiving end does not exist."),
    )
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: true, active: true });
  registerTranslationBackground();
  api.commands.onCommand.addListener.mock.calls[0]?.[0]("toggle-page-translation");
  await vi.waitFor(() => expect(api.tabs.sendMessage).toHaveBeenCalledTimes(3));
  expect(api.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 7, frameIds: [0] },
    files: ["/content-scripts/translate.js"],
  });
  expect(api.notifications.create).not.toHaveBeenCalled();
});

it("notifies command failures without repeating an operation that may have been delivered", async () => {
  api.tabs.query.mockResolvedValue([{ id: 7 }]);
  api.tabs.sendMessage.mockRejectedValue(
    new Error("The message port closed before a response was received."),
  );
  registerTranslationBackground();
  api.commands.onCommand.addListener.mock.calls[0]?.[0]("toggle-page-translation");
  await vi.waitFor(() =>
    expect(api.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "翻訳を開始できません",
        message: expect.stringContaining("The message port closed before a response was received."),
      }),
    ),
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledOnce();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("notifies the keyboard command when a content receiver rejects translation", async () => {
  api.tabs.query.mockResolvedValue([{ id: 7 }]);
  api.tabs.sendMessage
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ ok: false, error: "翻訳機能はOFFです。" });
  registerTranslationBackground();
  api.commands.onCommand.addListener.mock.calls[0]?.[0]("toggle-page-translation");
  await vi.waitFor(() =>
    expect(api.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("翻訳機能はOFFです。") }),
    ),
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("routes concurrent chunks by request and tab, and ignores late progress after settlement", async () => {
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const pending = new Map<string, (value: unknown) => void>();
  api.runtime.sendMessage.mockImplementation(
    (message) =>
      new Promise((resolve) => {
        pending.set(`${message.sessionId}:${message.requestId}`, resolve);
      }),
  );
  const first = vi.fn();
  const second = vi.fn();
  const anotherTab = vi.fn();
  listener(request, sender, first);
  listener({ ...request, requestId: "request-2" }, sender, second);
  listener(request, { ...sender, tab: { id: 8 } }, anotherTab);
  await vi.waitFor(() => expect(pending.size).toBe(3));
  const emit = (sessionId: string, requestId: string, text: string) =>
    listener(
      {
        type: "luvpame:translation-progress",
        sessionId,
        requestId,
        update: { kind: "text", text },
      },
      { id: "test-extension" },
      vi.fn(),
    );
  emit("tab-7:session-1", "request-2", "途中");
  expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(7, {
    type: "luvpame:translation-progress",
    sessionId: "session-1",
    requestId: "request-2",
    update: { kind: "text", text: "途中" },
  });
  pending.get("tab-7:session-1:request-2")?.({
    requestId: "request-2",
    ok: true,
    text: "確定",
    device: "cpu",
  });
  await vi.waitFor(() => expect(second).toHaveBeenCalled());
  const count = api.tabs.sendMessage.mock.calls.length;
  emit("tab-7:session-1", "request-2", "古い訳");
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(count);
  emit("tab-8:session-1", "request-1", "別タブ");
  expect(api.tabs.sendMessage.mock.calls.at(-1)?.[0]).toBe(8);
  api.offscreen.hasDocument.mockResolvedValue(true);
  listener({ type: CANCEL_TRANSLATION, sessionId: request.sessionId }, sender, vi.fn());
  const afterCancel = api.tabs.sendMessage.mock.calls.length;
  emit("tab-7:session-1", "request-1", "取消後");
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(afterCancel);
  pending.get("tab-7:session-1:request-1")?.({
    requestId: "request-1",
    ok: true,
    text: "確定",
    device: "cpu",
  });
  pending.get("tab-8:session-1:request-1")?.({
    requestId: "request-1",
    ok: true,
    text: "確定",
    device: "cpu",
  });
  await vi.waitFor(() => {
    expect(first).toHaveBeenCalledWith({ ok: false, error: "翻訳を停止しました。" });
    expect(anotherTab).toHaveBeenCalled();
  });
});

it("passes the explicit Ollama provider through the same offscreen path", async () => {
  api.storage.local.get.mockResolvedValue({
    translationBackend: "ollama",
    translationOllamaModel: "plamo-local:test",
  });
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  await new Promise((resolve) => listener(request, sender, resolve));
  expect(api.runtime.sendMessage).toHaveBeenCalledWith(
    expect.objectContaining({
      type: OFFSCREEN_TRANSLATE,
      provider: { kind: "ollama", model: "plamo-local:test" },
    }),
  );
});

it("validates bounded page batches, distances and append offsets at the boundary", () => {
  const batch = { ...request, type: TRANSLATE_BATCH, texts: ["One", "Two"] };
  expect(isTranslationBatchRequest(batch)).toBe(true);
  for (const invalid of [
    { ...batch, texts: ["One"] },
    { ...batch, texts: Array(9).fill("One") },
    { ...batch, texts: ["", "Two"] },
    { ...batch, texts: ["x".repeat(161), "Two"] },
    { ...batch, texts: Array(5).fill("x".repeat(160)) },
    { ...batch, priority: "selection" },
    { ...batch, viewportDistance: Infinity },
  ])
    expect(isTranslationBatchRequest(invalid)).toBe(false);
  for (const distance of [-1, NaN, Infinity, 10_000_001])
    expect(isTranslationRequest({ ...request, viewportDistance: distance })).toBe(false);
  expect(isTranslationRequest({ ...request, viewportDistance: 0 })).toBe(true);
  expect(isTranslationUpdate({ kind: "append", offset: 2, text: "続き" })).toBe(true);
  for (const offset of [-1, 0.5, NaN, Infinity, "2"])
    expect(isTranslationUpdate({ kind: "append", offset, text: "続き" })).toBe(false);
});

it.each([{ texts: ["一", "二"] }, { texts: ["一"] }, { texts: ["一", ""] }])(
  "validates the number and content of batch results: $texts",
  async ({ texts }) => {
    api.runtime.sendMessage.mockImplementation(async (message) => ({
      requestId: message.requestId,
      ok: true,
      texts,
      device: "gpu",
    }));
    registerTranslationBackground();
    const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const result = await new Promise((resolve) =>
      listener({ ...request, type: TRANSLATE_BATCH, texts: ["One", "Two"] }, sender, resolve),
    );
    expect(result).toMatchObject({ ok: texts.length === 2 && texts.every(Boolean) });
    expect(api.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: OFFSCREEN_TRANSLATE_BATCH,
        sessionId: "tab-7:session-1",
        texts: ["One", "Two"],
      }),
    );
  },
);

it("keeps reprioritization while offscreen initialization is pending and isolates tabs and sessions", async () => {
  let ready: () => void = () => {};
  vi.mocked(ensureOffscreen).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        ready = resolve;
      }),
  );
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const respond = vi.fn();
  listener({ ...request, viewportDistance: 900 }, sender, respond);
  await vi.waitFor(() => expect(ensureOffscreen).toHaveBeenCalledOnce());
  const reprioritize = {
    type: REPRIORITIZE_TRANSLATIONS,
    sessionId: request.sessionId,
    updates: [{ requestId: request.requestId, distance: 10 }],
  };
  listener(reprioritize, sender, vi.fn());
  listener(
    { ...reprioritize, updates: [{ requestId: request.requestId, distance: 999 }] },
    { ...sender, tab: { id: 8 } },
    vi.fn(),
  );
  listener({ ...reprioritize, sessionId: "other" }, sender, vi.fn());
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  ready();
  await vi.waitFor(() => expect(respond).toHaveBeenCalled());
  expect(api.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ viewportDistance: 10 }),
  );
});

it("cancels and reprioritizes only the matching tab, session and request", async () => {
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const pending = new Map<string, (value: unknown) => void>();
  api.runtime.sendMessage.mockImplementation((message) => {
    if (message.type !== OFFSCREEN_TRANSLATE) return Promise.resolve({ ok: true });
    return new Promise((resolve) =>
      pending.set(`${message.sessionId}:${message.requestId}`, resolve),
    );
  });
  const first = vi.fn();
  const second = vi.fn();
  const third = vi.fn();
  listener(request, sender, first);
  listener(request, { ...sender, tab: { id: 8 } }, second);
  listener({ ...request, sessionId: "other" }, sender, third);
  await vi.waitFor(() => expect(pending.size).toBe(3));
  listener(
    {
      type: REPRIORITIZE_TRANSLATIONS,
      sessionId: request.sessionId,
      updates: [
        { requestId: request.requestId, distance: 20 },
        { requestId: "missing", distance: 0 },
      ],
    },
    sender,
    vi.fn(),
  );
  expect(api.runtime.sendMessage).toHaveBeenLastCalledWith({
    type: OFFSCREEN_REPRIORITIZE,
    sessionId: "tab-7:session-1",
    updates: [{ requestId: request.requestId, distance: 20 }],
  });
  listener(
    {
      type: CANCEL_TRANSLATION_REQUEST,
      sessionId: request.sessionId,
      requestId: request.requestId,
    },
    sender,
    vi.fn(),
  );
  expect(api.runtime.sendMessage).toHaveBeenLastCalledWith({
    type: OFFSCREEN_CANCEL_REQUEST,
    sessionId: "tab-7:session-1",
    requestId: request.requestId,
  });
  for (const finish of pending.values())
    finish({ requestId: request.requestId, ok: true, text: "訳", device: "cpu" });
  await vi.waitFor(() => {
    expect(first).toHaveBeenCalledWith({ ok: false, error: "翻訳を停止しました。" });
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
    expect(third).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

it.each([false, true])(
  "prepares the persisted browser model after an extension-page request (tab: %s)",
  async (inTab) => {
    api.storage.local.get.mockResolvedValue({ translationModel: "2b" });
    api.runtime.sendMessage.mockResolvedValue({ ok: true, device: "gpu" });
    registerTranslationBackground();
    const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
    expect(ensureOffscreen).not.toHaveBeenCalled();
    const result = await new Promise((resolve) =>
      listener(
        { type: PREPARE_TRANSLATION, model: "2b" },
        {
          id: "test-extension",
          url: api.runtime.getURL("/options.html"),
          ...(inTab ? { tab: { id: 77 } } : {}),
        },
        resolve,
      ),
    );
    expect(result).toEqual({ ok: true, device: "gpu" });
    expect(api.runtime.sendMessage).toHaveBeenCalledExactlyOnceWith({
      type: OFFSCREEN_PREPARE_TRANSLATION,
      provider: { kind: "browser", model: "2b" },
    });
  },
);

it.each([
  { settings: { translationEnabled: false }, error: "翻訳機能はOFF" },
  { settings: { translationBackend: "ollama" }, error: "ブラウザ内翻訳" },
])(
  "rejects model preparation for unavailable browser translation: $settings",
  async ({ settings, error }) => {
    api.storage.local.get.mockResolvedValue(settings);
    registerTranslationBackground();
    const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
    const result = await new Promise((resolve) =>
      listener(
        { type: PREPARE_TRANSLATION, model: "0.8b" },
        { id: "test-extension", url: api.runtime.getURL("/options.html") },
        resolve,
      ),
    );
    expect(result).toEqual({ ok: false, error: expect.stringContaining(error) });
    expect(ensureOffscreen).not.toHaveBeenCalled();
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  },
);

it("ignores model preparation from content scripts, foreign extensions and non-extension URLs", () => {
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const respond = vi.fn();
  for (const invalidSender of [
    sender,
    { id: "other-extension", url: api.runtime.getURL("/options.html") },
    { id: "test-extension", url: "https://example.com" },
    { id: "test-extension" },
  ])
    expect(
      listener({ type: PREPARE_TRANSLATION, model: "0.8b" }, invalidSender, respond),
    ).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  expect(ensureOffscreen).not.toHaveBeenCalled();
});

it("rejects invalid or changed model selections before preparing any model", async () => {
  api.storage.local.get.mockResolvedValue({ translationModel: "2b" });
  registerTranslationBackground();
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const extensionPage = { id: "test-extension", url: api.runtime.getURL("/options.html") };
  for (const model of [undefined, "other", "0.8b"]) {
    const result = await new Promise((resolve) =>
      listener({ type: PREPARE_TRANSLATION, model }, extensionPage, resolve),
    );
    expect(result).toEqual({
      ok: false,
      error: expect.stringContaining(model === "0.8b" ? "設定が変更されました" : "モデルが不正"),
    });
  }
  expect(ensureOffscreen).not.toHaveBeenCalled();
  expect(api.runtime.sendMessage).not.toHaveBeenCalled();
});
