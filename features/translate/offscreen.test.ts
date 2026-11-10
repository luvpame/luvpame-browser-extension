import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { TranslationOptions } from "./shared";
import {
  OFFSCREEN_PREPARE_TRANSLATION,
  OFFSCREEN_PREWARM_TRANSLATION,
  OFFSCREEN_TRANSLATE,
  OFFSCREEN_TRANSLATE_BATCH,
  OFFSCREEN_CANCEL,
  OFFSCREEN_CANCEL_REQUEST,
  OFFSCREEN_REPRIORITIZE,
} from "./shared";

const mocks = vi.hoisted(() => ({
  addListener: vi.fn(),
  sendMessage: vi.fn(),
  translate: vi.fn(),
  prepare: vi.fn(),
  prewarm: vi.fn(),
  batch: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    runtime: {
      id: "test-extension",
      onMessage: { addListener: mocks.addListener },
      sendMessage: mocks.sendMessage,
    },
  },
}));
vi.mock("./engine", () => ({
  translate: mocks.translate,
  prepareTranslation: mocks.prepare,
  prewarmTranslation: mocks.prewarm,
}));
vi.mock("./batch", () => ({ translateBatch: mocks.batch }));
vi.mock("../../lib/offscreen-copy", () => ({ convertHtml: vi.fn(), writeClipboard: vi.fn() }));
const sender = { id: "test-extension" };
const request = {
  type: OFFSCREEN_TRANSLATE,
  text: "Hello",
  target: "ja",
  priority: "page",
  sessionId: "tab-7:session-1",
  requestId: "request-1",
  provider: { kind: "browser", model: "0.8b" },
};
const listen = async () => {
  await import("./engine");
  await import("../../entrypoints/offscreen/main");
  return mocks.addListener.mock.calls[0]?.[0];
};

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.sendMessage.mockResolvedValue(undefined);
});
afterEach(() => vi.restoreAllMocks());

it("sends initial text, rate-limited append diffs and full replacements while returning the complete result", async () => {
  let now = 0;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  mocks.translate.mockImplementation(
    async (_text, _target, _model, options: TranslationOptions) => {
      options.onText?.("");
      options.onText?.(" ");
      options.onText?.("こ");
      now = 10;
      options.onText?.("こん");
      now = 60;
      options.onText?.("こんに");
      now = 120;
      options.onText?.("別の訳");
      return { text: "別の訳の全文", device: "gpu" };
    },
  );
  const listener = await listen();
  const result = await new Promise((resolve) => listener(request, sender, resolve));
  expect(mocks.sendMessage.mock.calls.map(([message]) => message.update)).toEqual([
    { kind: "text", text: "こ" },
    { kind: "append", offset: 1, text: "んに" },
    { kind: "text", text: "別の訳" },
  ]);
  expect(result).toEqual({ requestId: "request-1", ok: true, text: "別の訳の全文", device: "gpu" });
});

it("updates live distances and cancels only a matching request within its session", async () => {
  const jobs = new Map<string, { options: TranslationOptions; finish: () => void }>();
  mocks.translate.mockImplementation(
    (_text, _target, _model, options: TranslationOptions) =>
      new Promise((resolve) => {
        jobs.set(String(jobs.size), {
          options,
          finish: () => resolve({ text: "訳", device: "gpu" }),
        });
      }),
  );
  const listener = await listen();
  const first = vi.fn();
  const second = vi.fn();
  const third = vi.fn();
  listener({ ...request, viewportDistance: 50 }, sender, first);
  await vi.waitFor(() => expect(jobs.size).toBe(1));
  listener({ ...request, requestId: "request-2" }, sender, second);
  await vi.waitFor(() => expect(jobs.size).toBe(2));
  listener({ ...request, sessionId: "tab-8:session-1" }, sender, third);
  await vi.waitFor(() => expect(jobs.size).toBe(3));
  listener(
    {
      type: OFFSCREEN_REPRIORITIZE,
      sessionId: request.sessionId,
      updates: [{ requestId: request.requestId, distance: 2 }],
    },
    sender,
    vi.fn(),
  );
  expect(jobs.get("0")?.options.viewportDistance?.()).toBe(2);
  listener(
    { type: OFFSCREEN_CANCEL_REQUEST, sessionId: request.sessionId, requestId: request.requestId },
    sender,
    vi.fn(),
  );
  expect(jobs.get("0")?.options.signal.aborted).toBe(true);
  expect(jobs.get("1")?.options.signal.aborted).toBe(false);
  expect(jobs.get("2")?.options.signal.aborted).toBe(false);
  listener({ type: OFFSCREEN_CANCEL, sessionId: request.sessionId }, sender, vi.fn());
  expect(jobs.get("1")?.options.signal.aborted).toBe(true);
  expect(jobs.get("2")?.options.signal.aborted).toBe(false);
  for (const job of jobs.values()) job.finish();
  await vi.waitFor(() => {
    expect(first).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(second).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
    expect(third).toHaveBeenCalledWith(expect.objectContaining({ ok: true }));
  });
});

it("accepts the maximum local session length after namespacing and dispatches batch results", async () => {
  mocks.batch.mockResolvedValue({ texts: ["一", "二"], device: "gpu" });
  const listener = await listen();
  const result = await new Promise((resolve) =>
    listener(
      {
        ...request,
        type: OFFSCREEN_TRANSLATE_BATCH,
        texts: ["One", "Two"],
        sessionId: `tab-7:${"s".repeat(160)}`,
      },
      sender,
      resolve,
    ),
  );
  expect(result).toEqual({
    requestId: request.requestId,
    ok: true,
    texts: ["一", "二"],
    device: "gpu",
  });
  expect(mocks.batch).toHaveBeenCalledOnce();
});

it("prepares a browser model independently and reports model load failures", async () => {
  mocks.prepare
    .mockResolvedValueOnce({ device: "gpu" })
    .mockRejectedValueOnce(new Error("load failed"));
  const listener = await listen();
  const message = { type: OFFSCREEN_PREPARE_TRANSLATION, provider: request.provider };
  const result = await new Promise((resolve) => listener(message, sender, resolve));
  expect(result).toEqual({ ok: true, device: "gpu" });
  expect(mocks.prepare).toHaveBeenCalledWith(
    "0.8b",
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      onProgress: expect.any(Function),
    }),
  );
  expect(await new Promise((resolve) => listener(message, sender, resolve))).toEqual({
    ok: false,
    error: "load failed",
  });
  expect(mocks.sendMessage).not.toHaveBeenCalled();
});

it("rejects invalid or Ollama prepare providers and ignores untrusted senders", async () => {
  const listener = await listen();
  for (const provider of [
    undefined,
    { kind: "browser", model: "other" },
    { kind: "ollama", model: "local" },
  ]) {
    const respond = vi.fn();
    listener({ type: OFFSCREEN_PREPARE_TRANSLATION, provider }, sender, respond);
    expect(respond).toHaveBeenCalledWith(expect.objectContaining({ ok: false }));
  }
  const respond = vi.fn();
  for (const invalidSender of [{ ...sender, tab: { id: 7 } }, { id: "other-extension" }])
    expect(
      listener(
        { type: OFFSCREEN_PREPARE_TRANSLATION, provider: request.provider },
        invalidSender,
        respond,
      ),
    ).toBeUndefined();
  expect(respond).not.toHaveBeenCalled();
  expect(mocks.prepare).not.toHaveBeenCalled();
});

it("aborts remaining batch work before responding to a failed translation", async () => {
  const failure = new Error("translation failed");
  let batchSignal: AbortSignal | undefined;
  mocks.batch.mockImplementation(
    async (_texts, _target, _provider, options: TranslationOptions) => {
      batchSignal = options.signal;
      throw failure;
    },
  );
  const listener = await listen();
  const result = await new Promise((resolve) =>
    listener(
      {
        ...request,
        type: OFFSCREEN_TRANSLATE_BATCH,
        texts: ["One", "Two"],
      },
      sender,
      resolve,
    ),
  );
  expect(result).toEqual({ requestId: request.requestId, ok: false, error: "translation failed" });
  expect(batchSignal?.aborted).toBe(true);
  expect(batchSignal?.reason).toBe(failure);
});

it("prewarms saved models through the cache-only engine path", async () => {
  const listener = await listen();
  expect(
    await new Promise((resolve) =>
      listener(
        { type: OFFSCREEN_PREWARM_TRANSLATION, provider: request.provider },
        sender,
        resolve,
      ),
    ),
  ).toEqual({ ok: true });
  expect(mocks.prewarm).toHaveBeenCalledWith(
    "0.8b",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(mocks.prepare).not.toHaveBeenCalled();
  mocks.prewarm.mockRejectedValueOnce(new Error("cache deleted"));
  expect(
    await new Promise((resolve) =>
      listener(
        { type: OFFSCREEN_PREWARM_TRANSLATION, provider: request.provider },
        sender,
        resolve,
      ),
    ),
  ).toEqual({ ok: false, error: "cache deleted" });
});
