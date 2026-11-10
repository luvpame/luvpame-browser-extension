import { beforeEach, expect, it, vi } from "vite-plus/test";

const api = vi.hoisted(() => ({
  tabs: { sendMessage: vi.fn() },
  scripting: { executeScript: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser: api }));
import { sendPageTranslationMessage } from "./page-bridge";
import { PAGE_TRANSLATION, TRANSLATION_READY } from "./shared";

const missingReceiver = new Error("Could not establish connection. Receiving end does not exist.");
const requestTypes = ["ja", "ja-easy"] satisfies Parameters<typeof sendPageTranslationMessage>[1][];

beforeEach(() => {
  vi.resetAllMocks();
  api.scripting.executeScript.mockResolvedValue([]);
});

it.each(requestTypes)(
  "delivers %s to the main frame without reinjecting a working receiver",
  async (target) => {
    const result = { ok: true };
    api.tabs.sendMessage.mockResolvedValue(result);
    await expect(sendPageTranslationMessage(7, target)).resolves.toBe(result);
    expect(api.tabs.sendMessage).toHaveBeenNthCalledWith(
      1,
      7,
      { type: TRANSLATION_READY },
      { frameId: 0 },
    );
    expect(api.tabs.sendMessage).toHaveBeenNthCalledWith(
      2,
      7,
      { type: PAGE_TRANSLATION, target },
      { frameId: 0 },
    );
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  },
);

it.each(requestTypes)("restores a missing receiver before delivering %s once", async (target) => {
  const result = { ok: true };
  api.tabs.sendMessage
    .mockRejectedValueOnce(missingReceiver)
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce(result);
  await expect(sendPageTranslationMessage(7, target)).resolves.toBe(result);
  expect(api.scripting.executeScript).toHaveBeenCalledExactlyOnceWith({
    target: { tabId: 7, frameIds: [0] },
    files: ["/content-scripts/translate.js"],
  });
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(3);
  expect(api.tabs.sendMessage).toHaveBeenLastCalledWith(
    7,
    { type: PAGE_TRANSLATION, target },
    { frameId: 0 },
  );
});

it.each([
  "The message port closed before a response was received.",
  "Cannot access contents of the page. Extension manifest must request permission to access the respective host.",
  "Could not establish connection.",
])("does not retry an ambiguous or unrelated delivery failure: %s", async (message) => {
  const error = new Error(message);
  api.tabs.sendMessage.mockRejectedValue(error);
  await expect(sendPageTranslationMessage(7, "ja")).rejects.toBe(error);
  expect(api.tabs.sendMessage).toHaveBeenCalledOnce();
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("preserves content failures without reinjecting or repeating a toggle", async () => {
  const result = { ok: false, error: "翻訳機能はOFFです。" };
  api.tabs.sendMessage.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce(result);
  await expect(sendPageTranslationMessage(7, "ja")).resolves.toBe(result);
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});

it("does not resend when script injection fails", async () => {
  const error = new Error("Cannot access a chrome:// URL");
  api.tabs.sendMessage.mockRejectedValue(missingReceiver);
  api.scripting.executeScript.mockRejectedValue(error);
  await expect(sendPageTranslationMessage(7, "ja")).rejects.toBe(error);
  expect(api.tabs.sendMessage).toHaveBeenCalledOnce();
  expect(api.scripting.executeScript).toHaveBeenCalledOnce();
});

it("stops when the injected receiver is still unavailable", async () => {
  api.tabs.sendMessage.mockRejectedValue(missingReceiver);
  await expect(sendPageTranslationMessage(7, "ja")).rejects.toThrow(
    "翻訳機能への接続を確認できませんでした。",
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.scripting.executeScript).toHaveBeenCalledOnce();
});

it.each([undefined, null, { ok: false }, "invalid"])(
  "recovers an invalid readiness response %j before delivering the operation once",
  async (response) => {
    const result = { ok: true, active: true };
    api.tabs.sendMessage
      .mockResolvedValueOnce(response)
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce(result);
    await expect(sendPageTranslationMessage(7, "ja")).resolves.toBe(result);
    expect(api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(api.tabs.sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
      TRANSLATION_READY,
      TRANSLATION_READY,
      PAGE_TRANSLATION,
    ]);
  },
);

it("stops when the injected receiver gives no response", async () => {
  api.tabs.sendMessage.mockResolvedValue(undefined);
  await expect(sendPageTranslationMessage(7, "ja")).rejects.toThrow(
    "翻訳機能への接続を確認できませんでした。",
  );
  expect(api.tabs.sendMessage).toHaveBeenCalledTimes(2);
  expect(api.scripting.executeScript).toHaveBeenCalledOnce();
});

it("never repeats a toggle whose response is lost", async () => {
  const error = new Error("The message port closed before a response was received.");
  api.tabs.sendMessage.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(error);
  await expect(sendPageTranslationMessage(7, "ja")).rejects.toBe(error);
  expect(api.tabs.sendMessage.mock.calls.map(([, message]) => message.type)).toEqual([
    TRANSLATION_READY,
    PAGE_TRANSLATION,
  ]);
  expect(api.scripting.executeScript).not.toHaveBeenCalled();
});
