import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { Browser } from "wxt/browser";
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
    commands: { onCommand: { addListener: vi.fn() } },
    contextMenus: {
      removeAll: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      onClicked: { addListener: vi.fn() },
    },
    offscreen: { hasDocument: vi.fn() },
    sidePanel: { open: vi.fn() },
  };
});
vi.mock("wxt/browser", () => ({ browser: api }));
vi.mock("../../lib/offscreen", () => ({ ensureOffscreen: vi.fn(async () => {}) }));
import { registerTranslationBackground } from "./background";
import { TRANSLATE, OFFSCREEN_TRANSLATE, isTranslationRequest } from "./shared";

const request = { type: TRANSLATE, sessionId: "session-1", text: "Hello world", target: "ja" };
const sender = { id: "test-extension", tab: { id: 7 }, frameId: 0, url: "https://example.com" };
const menus = new Map<string | number, Browser.contextMenus.CreateProperties>();
const menuIds = ["luvpame:page-translation", "luvpame:easy-article"];

beforeEach(() => {
  vi.resetAllMocks();
  menus.clear();
  api.runtime.lastError = undefined;
  api.storage.local.get.mockResolvedValue({});
  api.contextMenus.removeAll.mockImplementation(async () => menus.clear());
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
    async (id: string | number, properties: Omit<Browser.contextMenus.CreateProperties, "id">) => {
      const menu = menus.get(id);
      if (!menu) throw new Error(`Cannot find menu item with id ${id}`);
      menus.set(id, { ...menu, ...properties });
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

it("restores missing menus when the worker starts without install or startup events", async () => {
  registerTranslationBackground();
  await vi.waitFor(() => expect([...menus.keys()]).toEqual(menuIds));
  expect([...menus.values()]).toEqual([
    {
      id: menuIds[0],
      title: "原文下の日本語訳を開始／解除（Option+A）",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
    {
      id: menuIds[1],
      title: "本文をやさしい日本語で読む",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
  ]);
  expect(api.contextMenus.removeAll).not.toHaveBeenCalled();
});

it("reuses existing menus across overlapping installation and startup events", async () => {
  for (const id of menuIds) menus.set(id, { id, title: "old", contexts: ["page"] });
  registerTranslationBackground();
  api.runtime.onInstalled.addListener.mock.calls[0]?.[0]();
  api.runtime.onStartup.addListener.mock.calls[0]?.[0]();
  await vi.waitFor(() => expect(api.contextMenus.update).toHaveBeenCalledTimes(6));
  expect([...menus.values()].map((menu) => menu.contexts)).toEqual([["all"], ["all"]]);
  expect(api.contextMenus.create).not.toHaveBeenCalled();
  expect(api.contextMenus.removeAll).not.toHaveBeenCalled();
});

it("keeps the latest feature change when the initial read and menu creation are still pending", async () => {
  let finishRead: (value: { translationEnabled: boolean }) => void = () => {};
  api.storage.local.get.mockReturnValueOnce(
    new Promise((resolve) => {
      finishRead = resolve;
    }),
  );
  registerTranslationBackground();
  await vi.waitFor(() => expect(api.storage.local.get).toHaveBeenCalledOnce());
  const changed = api.storage.onChanged.addListener.mock.calls[0]?.[0];
  changed({ translationEnabled: { newValue: false } }, "local");
  api.runtime.onInstalled.addListener.mock.calls[0]?.[0]();
  api.runtime.onStartup.addListener.mock.calls[0]?.[0]();
  api.storage.local.get.mockResolvedValue({ translationEnabled: false });
  finishRead({ translationEnabled: true });
  await vi.waitFor(() => {
    expect(menus.size).toBe(2);
    expect([...menus.values()].every((menu) => menu.enabled === false)).toBe(true);
  });
  changed({ translationEnabled: { newValue: true } }, "local");
  api.storage.local.get.mockResolvedValue({ translationEnabled: true });
  await vi.waitFor(() =>
    expect([...menus.values()].every((menu) => menu.enabled === true)).toBe(true),
  );
  expect(api.contextMenus.create).toHaveBeenCalledTimes(2);
  expect(api.contextMenus.removeAll).not.toHaveBeenCalled();
  const updates = api.contextMenus.update.mock.calls.length;
  changed({ urlCopyEnabled: { newValue: false } }, "local");
  changed({ translationEnabled: { newValue: false } }, "sync");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(api.contextMenus.update).toHaveBeenCalledTimes(updates);
});

it("waits for menu creation callbacks before applying a newer disabled setting", async () => {
  let finishCreate: () => void = () => {};
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
  await vi.waitFor(() => expect(api.contextMenus.create).toHaveBeenCalledOnce());
  api.storage.local.get.mockResolvedValue({ translationEnabled: false });
  api.storage.onChanged.addListener.mock.calls[0]?.[0](
    { translationEnabled: { newValue: false } },
    "local",
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  finishCreate();
  await vi.waitFor(() => {
    expect(menus.size).toBe(2);
    expect([...menus.values()].every((menu) => menu.enabled === false)).toBe(true);
  });
  expect(api.contextMenus.create).toHaveBeenCalledTimes(2);
});

it("reports menu creation callback failures and allows the next synchronization to recover", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  api.contextMenus.create.mockImplementationOnce(
    (menu: Browser.contextMenus.CreateProperties, callback: () => void) => {
      queueMicrotask(() => {
        api.runtime.lastError = { message: "Menu creation failed" };
        callback();
        api.runtime.lastError = undefined;
      });
      return menu.id ?? "missing-id";
    },
  );
  registerTranslationBackground();
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error("Menu creation failed")));
  api.runtime.onStartup.addListener.mock.calls[0]?.[0]();
  await vi.waitFor(() => expect([...menus.keys()]).toEqual(menuIds));
  expect(api.contextMenus.removeAll).not.toHaveBeenCalled();
});

it("reports update failures without trying to recreate an existing menu", async () => {
  const report = vi.spyOn(console, "error").mockImplementation(() => {});
  for (const id of menuIds) menus.set(id, { id, title: "existing" });
  api.contextMenus.update.mockRejectedValueOnce(new Error("Menu update failed"));
  registerTranslationBackground();
  await vi.waitFor(() => expect(report).toHaveBeenCalledWith(new Error("Menu update failed")));
  expect(api.contextMenus.create).not.toHaveBeenCalled();
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
      model: "0.8b",
      text: "Hello world",
    }),
  );
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

it("offers both context menus and opens the native sidepanel directly from its menu action", async () => {
  api.sidePanel.open.mockResolvedValue(undefined);
  api.tabs.sendMessage.mockResolvedValue({ ok: true, active: true });
  registerTranslationBackground();
  await vi.waitFor(() => expect(api.contextMenus.create).toHaveBeenCalledTimes(2));
  expect(api.contextMenus.create.mock.calls.map(([menu]) => menu.id)).toEqual([
    "luvpame:page-translation",
    "luvpame:easy-article",
  ]);
  const click = api.contextMenus.onClicked.addListener.mock.calls[0]?.[0];
  click({ menuItemId: "luvpame:easy-article" }, { id: 7 });
  expect(api.sidePanel.open).toHaveBeenCalledWith({ tabId: 7 });
  click({ menuItemId: "luvpame:page-translation" }, { id: 7 });
  await vi.waitFor(() =>
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(7, {
      type: "luvpame:page-translation",
    }),
  );
});
