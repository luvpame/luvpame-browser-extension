import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import content from "../entrypoints/linear.content";
import { TRANSLATE, TRANSLATION_PROGRESS } from "../features/translate/shared";

const navigation = vi.hoisted(() => {
  const target = new EventTarget();
  vi.stubGlobal("navigation", target);
  return target;
});
const controller = vi.hoisted(() => ({
  setEnabled: vi.fn(),
  refresh: vi.fn(),
  progress: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
}));
const createController = vi.hoisted(() =>
  vi.fn<
    typeof import("../features/linear-review-guide/content").createLinearReviewGuideController
  >(),
);
vi.mock("../features/linear-review-guide/content", () => ({
  createLinearReviewGuideController: createController,
}));

let ctx: ContentScriptContext;
let listener: Parameters<typeof browser.runtime.onMessage.addListener>[0];
let settingsChanged: Parameters<typeof browser.storage.onChanged.addListener>[0];

beforeEach(() => {
  vi.clearAllMocks();
  createController.mockReturnValue(controller);
  window.history.replaceState(null, "", "/smartcamp/review/change-123");
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: false,
    linearReviewGuideTranslationEnabled: true,
  }));
  ctx = new ContentScriptContext("linear", { noScriptStartedPostMessage: true });
  const addListener = vi.spyOn(browser.runtime.onMessage, "addListener");
  const addSettingsListener = vi.spyOn(browser.storage.onChanged, "addListener");
  content.main(ctx);
  const registered = addListener.mock.calls[0]?.[0];
  const registeredSettings = addSettingsListener.mock.calls[0]?.[0];
  if (!registered || !registeredSettings) throw new Error("Content listeners were not registered.");
  listener = registered;
  settingsChanged = registeredSettings;
});
afterEach(() => {
  ctx.notifyInvalidated();
  vi.useRealTimers();
  vi.stubGlobal("navigation", navigation);
  document.body.replaceChildren();
  window.history.replaceState(null, "", "/");
  vi.restoreAllMocks();
});

it("Linearだけで動き、ページ翻訳の設定から独立して専用設定を適用する", async () => {
  expect(content.matches).toEqual(["https://linear.app/*"]);
  await vi.waitFor(() => expect(controller.setEnabled).toHaveBeenCalledExactlyOnceWith(true));
  settingsChanged({ translationEnabled: { newValue: true } }, "local");
  expect(controller.setEnabled).toHaveBeenLastCalledWith(true);
  settingsChanged({ linearReviewGuideTranslationEnabled: { newValue: false } }, "local");
  expect(controller.setEnabled).toHaveBeenLastCalledWith(false);
});

it("拡張機能のバックグラウンドからの妥当な進捗だけを配送する", () => {
  const message = {
    type: TRANSLATION_PROGRESS,
    sessionId: "guide-session",
    requestId: "guide-request",
    update: { kind: "text", text: "途中の訳" },
  };
  const respond = vi.fn();
  listener(message, { id: "other-extension" }, respond);
  listener(
    message,
    {
      id: browser.runtime.id,
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
    respond,
  );
  listener({ ...message, sessionId: 1 }, { id: browser.runtime.id }, respond);
  listener({ ...message, update: {} }, { id: browser.runtime.id }, respond);
  listener(null, { id: browser.runtime.id }, respond);
  expect(controller.progress).not.toHaveBeenCalled();
  listener(message, { id: browser.runtime.id }, respond);
  expect(controller.progress).toHaveBeenCalledExactlyOnceWith("guide-session", "guide-request", {
    kind: "text",
    text: "途中の訳",
  });
  expect(respond).not.toHaveBeenCalled();
});

it("URL確定後に更新し、ページ離脱と拡張機能の破棄で翻訳とリスナーを片付ける", () => {
  const removeListener = vi.spyOn(browser.runtime.onMessage, "removeListener");
  const removeSettings = vi.spyOn(browser.storage.onChanged, "removeListener");
  const path = "/smartcamp/review/change-123/review";
  navigation.dispatchEvent(
    Object.assign(new Event("navigate"), {
      destination: { url: new URL(path, location.href).href },
    }),
  );
  expect(location.pathname).toBe("/smartcamp/review/change-123");
  expect(controller.refresh).not.toHaveBeenCalled();
  window.history.replaceState(null, "", path);
  navigation.dispatchEvent(new Event("currententrychange"));
  expect(controller.refresh).toHaveBeenCalledExactlyOnceWith();
  window.dispatchEvent(new Event("pagehide"));
  expect(controller.reset).toHaveBeenCalledTimes(1);
  window.dispatchEvent(new Event("pageshow"));
  expect(controller.refresh).toHaveBeenCalledTimes(2);
  ctx.notifyInvalidated();
  expect(controller.dispose).toHaveBeenCalledTimes(1);
  expect(removeListener).toHaveBeenCalledExactlyOnceWith(listener);
  expect(removeSettings).toHaveBeenCalledTimes(1);
  navigation.dispatchEvent(new Event("currententrychange"));
  window.dispatchEvent(new Event("pageshow"));
  window.dispatchEvent(new Event("pagehide"));
  expect(controller.refresh).toHaveBeenCalledTimes(2);
  expect(controller.reset).toHaveBeenCalledTimes(1);
});

it("Navigation APIがない環境ではWXTのURL変更で更新し、破棄後は更新しない", async () => {
  ctx.notifyInvalidated();
  vi.stubGlobal("navigation", undefined);
  vi.useFakeTimers();
  window.history.replaceState(null, "", "/smartcamp/review/change-123");
  vi.resetModules();
  const { ContentScriptContext: FallbackContext } =
    await import("wxt/utils/content-script-context");
  const { default: fallbackContent } = await import("../entrypoints/linear.content");
  ctx = new FallbackContext("linear", { noScriptStartedPostMessage: true });
  fallbackContent.main(ctx);
  window.history.replaceState(null, "", "/smartcamp/review/change-123/review");
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.refresh).toHaveBeenCalledExactlyOnceWith();
  ctx.notifyInvalidated();
  window.history.replaceState(null, "", "/smartcamp/review/change-123");
  await vi.advanceTimersByTimeAsync(1000);
  expect(controller.refresh).toHaveBeenCalledTimes(1);
});

it("OverviewにGuide本文が残っていてもURL確定後だけ翻訳要求を送る", async () => {
  ctx.notifyInvalidated();
  window.history.replaceState(null, "", "/smartcamp/review/change-123");
  document.body.innerHTML =
    "<div data-guide-section-text><div data-guide-overview><div><span>Validate the application before reviewing.</span></div></div></div>";
  const sentPaths: string[] = [];
  const send = vi.fn(async (_message: unknown) => {
    sentPaths.push(location.pathname);
    return { ok: true, text: "日本語の訳", device: "gpu" };
  });
  const actual = await vi.importActual<typeof import("../features/linear-review-guide/content")>(
    "../features/linear-review-guide/content",
  );
  createController.mockImplementation(() => actual.createLinearReviewGuideController({ send }));
  ctx = new ContentScriptContext("linear", { noScriptStartedPostMessage: true });
  content.main(ctx);
  await vi.waitFor(() => expect(createController).toHaveBeenCalledTimes(2));
  const path = "/smartcamp/review/change-123/review";
  navigation.dispatchEvent(
    Object.assign(new Event("navigate"), {
      destination: { url: new URL(path, location.href).href },
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(send).not.toHaveBeenCalled();
  window.history.replaceState(null, "", path);
  navigation.dispatchEvent(new Event("currententrychange"));
  await vi.waitFor(() => {
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: TRANSLATE,
        text: "Validate the application before reviewing.",
        feature: "linear-review-guide",
      }),
    );
    expect(document.querySelector("span")?.textContent).toBe("日本語の訳");
  });
  expect(sentPaths).toEqual([path]);
});
