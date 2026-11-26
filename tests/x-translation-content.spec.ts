// @vitest-environment-options {"url":"https://x.com/home"}
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import content from "../entrypoints/translate.content";
import { isRecord } from "../lib/copy-protocol";
import { PAGE_TRANSLATION, TRANSLATE } from "../features/translate/shared";

let ctx: ContentScriptContext;
let listener: Parameters<typeof browser.runtime.onMessage.addListener>[0];
let settingsChanged: Parameters<typeof browser.storage.onChanged.addListener>[0];
let send: ReturnType<typeof vi.fn<(message: unknown) => Promise<unknown>>>;
const sender = { id: browser.runtime.id };
const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
const text = () => document.querySelector<HTMLElement>('[data-testid="tweetText"]')!;
const xTranslation = () => {
  const host = document.querySelector("[data-luvpame-x-translation]");
  return host?.shadowRoot?.querySelector('[lang="ja"]')?.textContent;
};
const requests = (feature?: string) =>
  send.mock.calls
    .map(([message]) => message)
    .filter(
      (message) => isRecord(message) && message.type === TRANSLATE && message.feature === feature,
    );

beforeEach(() => {
  document.body.innerHTML = `<main><div data-testid="primaryColumn"><article data-testid="tweet"><div>
    <div data-testid="User-Name"><a href="/someone">Someone</a></div>
    <div><div data-testid="tweetText" lang="en"><span>English post on the timeline</span></div></div>
  </div></article></div></main>`;
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationEnabled: true,
    xAutoTranslationEnabled: true,
  }));
  send = vi.fn(async (message: unknown) => {
    if (!isRecord(message) || message.type !== TRANSLATE) return { ok: true };
    const translation = message.feature === "x-auto-translation" ? "Xの訳文" : "ページの訳文";
    return { ok: true, text: translation, device: "gpu" };
  });
  vi.spyOn(browser.runtime, "sendMessage").mockImplementation((message: unknown) => send(message));
  ctx = new ContentScriptContext("translate", { noScriptStartedPostMessage: true });
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
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("ページ翻訳の開始前にXの訳文を外して原文に戻し、解除後に自動翻訳を再開する", async () => {
  await vi.waitFor(() => expect(xTranslation()).toBe("Xの訳文"));
  const respond = vi.fn();
  expect(listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond)).toBe(true);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, active: true }));
  expect(xTranslation()).toBeUndefined();
  expect(text().hasAttribute("style")).toBe(false);
  expect(text().hasAttribute("aria-hidden")).toBe(false);
  await vi.waitFor(() =>
    expect(requests()).toContainEqual(
      expect.objectContaining({ text: "English post on the timeline" }),
    ),
  );
  await tick();
  expect(requests("x-auto-translation")).toHaveLength(1);

  respond.mockClear();
  listener({ type: PAGE_TRANSLATION, target: "ja" }, sender, respond);
  await vi.waitFor(() => expect(respond).toHaveBeenCalledWith({ ok: true, active: false }));
  await vi.waitFor(() => expect(xTranslation()).toBe("Xの訳文"));
  expect(requests("x-auto-translation")).toHaveLength(2);
});

it("X自動翻訳の設定だけで開始と停止を切り替える", async () => {
  await vi.waitFor(() => expect(xTranslation()).toBe("Xの訳文"));
  settingsChanged({ xAutoTranslationEnabled: { newValue: false } }, "local");
  expect(xTranslation()).toBeUndefined();
  expect(text().hasAttribute("style")).toBe(false);
  settingsChanged({ translationEnabled: { newValue: false } }, "local");
  await tick();
  expect(requests("x-auto-translation")).toHaveLength(1);
  settingsChanged({ xAutoTranslationEnabled: { newValue: true } }, "local");
  await vi.waitFor(() => expect(xTranslation()).toBe("Xの訳文"));
});
