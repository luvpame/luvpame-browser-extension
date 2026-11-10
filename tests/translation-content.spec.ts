import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import content from "../entrypoints/translate.content";
import {
  PAGE_TRANSLATION,
  TRANSLATION_PROGRESS,
  TRANSLATION_READY,
} from "../features/translate/shared";

const controller = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  toggle: vi.fn(() => ({ ok: true, active: true })),
  progress: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../features/translate/content", () => ({
  createTranslationController: () => controller,
}));

let ctx: ContentScriptContext;
let listener: Parameters<typeof browser.runtime.onMessage.addListener>[0];
let settingsChanged: Parameters<typeof browser.storage.onChanged.addListener>[0];
const sender = { id: browser.runtime.id };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: true,
  }));
  ctx = new ContentScriptContext("translate", { noScriptStartedPostMessage: true });
});

const startContentScript = () => {
  const addListener = vi.spyOn(browser.runtime.onMessage, "addListener");
  const addSettingsListener = vi.spyOn(browser.storage.onChanged, "addListener");
  content.main(ctx);
  const registered = addListener.mock.calls[0]?.[0];
  const registeredSettings = addSettingsListener.mock.calls[0]?.[0];
  if (!registered || !registeredSettings) throw new Error("Content listeners were not registered.");
  listener = registered;
  settingsChanged = registeredSettings;
};

afterEach(() => {
  ctx.notifyInvalidated();
  vi.restoreAllMocks();
});

it("confirms the receiver synchronously while settings remain pending", () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(() => new Promise(() => {}));
  startContentScript();
  const respond = vi.fn();
  expect(listener({ type: TRANSLATION_READY }, sender, respond)).toBeUndefined();
  expect(respond).toHaveBeenCalledExactlyOnceWith({ ok: true });
  expect(controller.toggle).not.toHaveBeenCalled();
});

it.each(["ja", "ja-easy"])("waits for initial settings before responding to %s", async (target) => {
  const initialSettings = Promise.withResolvers<{ translationEnabled: boolean }>();
  vi.spyOn(browser.storage.local, "get").mockImplementation(() => initialSettings.promise);
  startContentScript();
  const respond = vi.fn();
  expect(listener({ type: PAGE_TRANSLATION, target }, sender, respond)).toBe(true);
  await Promise.resolve();
  expect(respond).not.toHaveBeenCalled();
  expect(controller.toggle).not.toHaveBeenCalled();

  initialSettings.resolve({ translationEnabled: true });
  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledExactlyOnceWith({ ok: true, active: true }),
  );
  expect(controller.setEnabled).toHaveBeenCalledExactlyOnceWith(true);
});

it.each(["ja", "ja-easy"])("reports initial settings failures when handling %s", async (target) => {
  const initialSettings = Promise.withResolvers<never>();
  vi.spyOn(browser.storage.local, "get").mockImplementation(() => initialSettings.promise);
  startContentScript();
  const respond = vi.fn();
  expect(listener({ type: PAGE_TRANSLATION, target }, sender, respond)).toBe(true);
  initialSettings.reject(new Error("Storage unavailable."));

  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledExactlyOnceWith({
      ok: false,
      error: "Storage unavailable.",
    }),
  );
  expect(controller.setEnabled).not.toHaveBeenCalled();
  expect(controller.toggle).not.toHaveBeenCalled();
});

it.each(["ja", "ja-easy"])(
  "ignores late settings after invalidation while handling %s",
  async (target) => {
    const initialSettings = Promise.withResolvers<{ translationEnabled: boolean }>();
    vi.spyOn(browser.storage.local, "get").mockImplementation(() => initialSettings.promise);
    startContentScript();
    const respond = vi.fn();
    expect(listener({ type: PAGE_TRANSLATION, target }, sender, respond)).toBe(true);
    ctx.notifyInvalidated();
    initialSettings.resolve({ translationEnabled: true });
    await initialSettings.promise;
    await Promise.resolve();

    expect(respond).not.toHaveBeenCalled();
    expect(controller.setEnabled).not.toHaveBeenCalled();
    expect(controller.toggle).not.toHaveBeenCalled();
  },
);

it("replies to page translation through the callback without returning a Promise", async () => {
  startContentScript();
  await Promise.resolve();
  const respond = vi.fn();
  expect(listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond)).toBe(true);
  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledExactlyOnceWith({ ok: true, active: true }),
  );
  expect(controller.toggle).toHaveBeenCalledExactlyOnceWith("below", "ja");
  expect(controller.setEnabled).toHaveBeenCalledWith(true);
});

it.each(["below", "replace"])("dispatches both targets with mode %s", async (mode) => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: true,
    translationMode: mode,
  }));
  startContentScript();
  for (const target of ["ja", "ja-easy"]) {
    const respond = vi.fn();
    expect(listener({ type: PAGE_TRANSLATION, target }, sender, respond)).toBe(true);
    await vi.waitFor(() => expect(respond).toHaveBeenCalled());
    expect(controller.toggle).toHaveBeenLastCalledWith(mode, target);
  }
});
it("reads the display setting again for every operation", async () => {
  startContentScript();
  const respond = vi.fn();
  listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalled());
  vi.mocked(browser.storage.local.get).mockImplementation(async () => ({
    translationMode: "replace",
  }));
  listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond);
  await vi.waitFor(() => expect(controller.toggle).toHaveBeenLastCalledWith("replace", "ja"));
});
it("reports display-setting failures and ignores their completion after invalidation", async () => {
  startContentScript();
  await vi.waitFor(() => expect(controller.setEnabled).toHaveBeenCalled());
  vi.mocked(browser.storage.local.get).mockRejectedValueOnce(new Error("Mode unavailable"));
  const respond = vi.fn();
  listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond);
  await vi.waitFor(() =>
    expect(respond).toHaveBeenCalledWith({ ok: false, error: "Mode unavailable" }),
  );
  const pending = Promise.withResolvers<Record<string, unknown>>();
  vi.mocked(browser.storage.local.get).mockImplementationOnce(() => pending.promise);
  respond.mockClear();
  listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond);
  await Promise.resolve();
  ctx.notifyInvalidated();
  pending.resolve({ translationMode: "replace" });
  await pending.promise;
  await Promise.resolve();
  expect(respond).not.toHaveBeenCalled();
  expect(controller.toggle).not.toHaveBeenCalled();
});

it("ignores foreign senders, content senders and malformed messages", () => {
  startContentScript();
  const respond = vi.fn();
  for (const { message, source } of [
    { message: { type: PAGE_TRANSLATION, target: "ja" }, source: { id: "other-extension" } },
    { message: { type: TRANSLATION_READY }, source: { id: "other-extension" } },
    {
      message: { type: PAGE_TRANSLATION, target: "ja" },
      source: {
        ...sender,
        tab: {
          id: 7,
          index: 0,
          windowId: 1,
          groupId: -1,
          lastAccessed: 0,
          active: true,
          highlighted: true,
          selected: true,
          pinned: false,
          frozen: false,
          incognito: false,
          discarded: false,
          autoDiscardable: true,
        },
      },
    },
    { message: { type: PAGE_TRANSLATION, target: "invalid" }, source: sender },
    { message: { type: PAGE_TRANSLATION }, source: sender },
    { message: null, source: sender },
    { message: { type: "unknown" }, source: sender },
  ]) {
    expect(listener(message, source, respond)).toBeUndefined();
    if ("tab" in source)
      expect(listener({ type: TRANSLATION_READY }, source, respond)).toBeUndefined();
  }
  expect(respond).not.toHaveBeenCalled();
  expect(controller.toggle).not.toHaveBeenCalled();
});

it("forwards valid progress without replying", () => {
  startContentScript();
  const respond = vi.fn();
  expect(
    listener(
      {
        type: TRANSLATION_PROGRESS,
        sessionId: "session-1",
        requestId: "request-1",
        update: { kind: "status", message: "Loading" },
      },
      sender,
      respond,
    ),
  ).toBeUndefined();
  listener({ type: TRANSLATION_PROGRESS, sessionId: 42, message: "Loading" }, sender, respond);
  expect(controller.progress).toHaveBeenCalledExactlyOnceWith("session-1", "request-1", {
    kind: "status",
    message: "Loading",
  });
  expect(respond).not.toHaveBeenCalled();
});

it("resets on pagehide and removes listeners when invalidated", () => {
  startContentScript();
  const removeListener = vi.spyOn(browser.runtime.onMessage, "removeListener");
  const removeSettings = vi.spyOn(browser.storage.onChanged, "removeListener");
  window.dispatchEvent(new Event("pagehide"));
  expect(controller.reset).toHaveBeenCalledTimes(1);
  ctx.notifyInvalidated();
  expect(controller.dispose).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledExactlyOnceWith(listener);
  expect(removeSettings).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("pagehide"));
  expect(controller.reset).toHaveBeenCalledTimes(1);
});

it("applies feature changes received before the initial settings finish", async () => {
  const initial = Promise.withResolvers<{ translationEnabled: boolean }>();
  vi.mocked(browser.storage.local.get).mockImplementation(() => initial.promise);
  startContentScript();
  settingsChanged({ translationEnabled: { newValue: false } }, "local");
  initial.resolve({ translationEnabled: true });
  await vi.waitFor(() => expect(controller.setEnabled).toHaveBeenCalledExactlyOnceWith(false));
});
