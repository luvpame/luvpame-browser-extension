import { beforeEach, expect, it, vi } from "vite-plus/test";
import { translateBatch } from "./batch";
import type { TranslationOptions } from "./shared";

const mocks = vi.hoisted(() => ({ translate: vi.fn(), ollama: vi.fn() }));
vi.mock("./engine", () => ({ translate: mocks.translate }));
vi.mock("./ollama", () => ({ translateWithOllama: mocks.ollama }));
const browserProvider = { kind: "browser", model: "0.8b" } as const;
const options = (): TranslationOptions => ({
  signal: new AbortController().signal,
  onProgress: vi.fn(),
  onText: vi.fn(),
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.translate.mockResolvedValue({ text: "単独訳", device: "gpu" });
});

it("translates numbered labels once and keeps their numbers and order", async () => {
  const opts = options();
  mocks.translate.mockImplementationOnce(async (_text, _target, _model, given) => {
    given.onText?.("1. 未確定");
    return { text: "1. 第12章\n2. 価格は1,000円", device: "gpu" };
  });
  expect(await translateBatch(["Chapter 12", "Price 1,000"], "ja", browserProvider, opts)).toEqual({
    texts: ["第12章", "価格は1,000円"],
    device: "gpu",
  });
  expect(mocks.translate).toHaveBeenCalledExactlyOnceWith(
    "1. Chapter 12\n2. Price 1,000",
    "ja",
    "0.8b",
    expect.objectContaining({ onText: undefined }),
  );
  expect(opts.onText).not.toHaveBeenCalled();
});

it.each([
  "2. 価格12\n1. 設定",
  "1. 価格12\n1. 設定",
  "1. 価格12",
  "1. 価格12\n\n2. 設定",
  "1. 価格12\n2. 設定\n3. 余分",
  "1. \n2. 設定",
  "1. 価格13\n2. 設定",
  "1. 価格\n2. 設定",
])("falls back for every label when the batch response is unsafe: %s", async (output) => {
  mocks.translate.mockResolvedValueOnce({ text: output, device: "gpu" });
  const result = await translateBatch(["Price 12", "Settings"], "ja", browserProvider, options());
  expect(result).toEqual({ texts: ["単独訳", "単独訳"], device: "gpu" });
  expect(mocks.translate.mock.calls.map(([text]) => text)).toEqual([
    "1. Price 12\n2. Settings",
    "Price 12",
    "Settings",
  ]);
});

it("does not retry a cancelled batch as individual translations", async () => {
  const controller = new AbortController();
  mocks.translate.mockImplementationOnce(async () => {
    controller.abort();
    throw controller.signal.reason;
  });
  await expect(
    translateBatch(["One", "Two"], "ja", browserProvider, {
      ...options(),
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.translate).toHaveBeenCalledOnce();
});

it("uses individual Ollama requests without leaking partial text", async () => {
  mocks.ollama.mockResolvedValue({ text: "端末内の訳", provider: "ollama", device: "unknown" });
  const opts = options();
  expect(
    await translateBatch(["One", "Two"], "ja", { kind: "ollama", model: "local" }, opts),
  ).toEqual({ texts: ["端末内の訳", "端末内の訳"], provider: "ollama", device: "unknown" });
  expect(mocks.ollama.mock.calls.map(([text, , , given]) => [text, given.onText])).toEqual([
    ["One", undefined],
    ["Two", undefined],
  ]);
  expect(mocks.translate).not.toHaveBeenCalled();
});
