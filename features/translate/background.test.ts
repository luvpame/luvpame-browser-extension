import { beforeEach, expect, it, vi } from "vite-plus/test";
const api = vi.hoisted(() => ({
  runtime: {
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
}));
vi.mock("wxt/browser", () => ({ browser: api }));
vi.mock("../../lib/offscreen", () => ({ ensureOffscreen: vi.fn(async () => {}) }));
import { registerTranslationBackground } from "./background";
import { TRANSLATE, OFFSCREEN_TRANSLATE, isTranslationRequest } from "./shared";

const request = { type: TRANSLATE, sessionId: "session-1", text: "Hello world", target: "ja" };
const sender = { id: "test-extension", tab: { id: 7 }, frameId: 0, url: "https://example.com" };

beforeEach(() => {
  vi.resetAllMocks();
  api.storage.local.get.mockResolvedValue({});
  api.runtime.sendMessage.mockImplementation(async (message) => ({
    requestId: message.requestId,
    ok: true,
    text: "こんにちは",
    device: "cpu",
  }));
  registerTranslationBackground();
});

it("rejects invalid targets, oversized input and unbounded session IDs", () => {
  expect(isTranslationRequest(request)).toBe(true);
  expect(isTranslationRequest({ ...request, target: "en" })).toBe(false);
  expect(isTranslationRequest({ ...request, text: "x".repeat(20001) })).toBe(false);
  expect(isTranslationRequest({ ...request, sessionId: "x".repeat(161) })).toBe(false);
});

it("uses the persisted model and scopes content requests to the sender tab", async () => {
  api.storage.local.get.mockResolvedValue({ translationModel: "0.8b" });
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
  const listener = api.runtime.onMessage.addListener.mock.calls[0]?.[0];
  const result = await new Promise((resolve) => listener(request, sender, resolve));
  expect(result).toMatchObject({ ok: false });
});

it("offers both context menus and opens the native sidepanel directly from its menu action", async () => {
  api.contextMenus.removeAll.mockResolvedValue(undefined);
  api.sidePanel.open.mockResolvedValue(undefined);
  api.tabs.sendMessage.mockResolvedValue({ ok: true, active: true });
  api.runtime.onInstalled.addListener.mock.calls[0]?.[0]();
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
