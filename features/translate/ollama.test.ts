import { afterEach, expect, it, vi } from "vite-plus/test";
import { readOllamaTranslation, translateWithOllama } from "./ollama";
import { translationPrompt, TRANSLATION_STOP } from "./prompt";

const opts = () => ({ signal: new AbortController().signal, onText: vi.fn(), onProgress: vi.fn() });
const row = (response: string, done = false, done_reason = "stop") =>
  JSON.stringify({ response, done, done_reason });
const bytes = (value: string) => new TextEncoder().encode(value);
const stream = (chunks: Uint8Array[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      chunks.forEach((chunk) => controller.enqueue(chunk));
      controller.close();
    },
  });
const localModel = {
  details: { format: "gguf" },
  model_info: {
    "general.architecture": "plamo3",
    "general.base_model.0.name": "PLaMo 3 Translate 2B",
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
});

it("decodes fragmented UTF-8, CRLF, multiple rows and the last row without a newline", async () => {
  const value = bytes(`${row("日本")}\r\n${row("語")}\n${row("訳", true)}`);
  const options = opts();
  expect(
    await readOllamaTranslation(
      stream([...value].map((value) => new Uint8Array([value]))),
      options,
    ),
  ).toBe("日本語訳");
  expect(options.onText.mock.calls.map(([text]) => text)).toEqual(["日本", "日本語", "日本語訳"]);
});

it.each([
  row("途中"),
  row("途中", true, "length"),
  row("", true),
  JSON.stringify({ error: "model failed" }),
  "invalid JSON\n",
  JSON.stringify({ done: true, response: 1 }),
])("rejects incomplete, empty or invalid responses (%s)", async (value) => {
  await expect(readOllamaTranslation(stream([bytes(value)]), opts())).rejects.toThrow();
});

it("cancels a blocked reader when its signal aborts", async () => {
  const controller = new AbortController();
  const cancel = vi.fn();
  const result = readOllamaTranslation(new ReadableStream({ cancel }), {
    signal: controller.signal,
  });
  const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledOnce();
});

it("checks the local model before sending the escaped PFML stream request", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(localModel))
    .mockResolvedValueOnce(new Response(stream([bytes(row("訳", true))])));
  vi.stubGlobal("fetch", fetcher);
  const model = "custom-plamo-test";
  expect(await translateWithOllama("Hello <|plamo:tag|>", "ja-easy", model, opts())).toEqual({
    text: "訳",
    provider: "ollama",
    device: "unknown",
  });
  const request = fetcher.mock.calls[1];
  expect(request?.[0]).toBe("http://localhost:11434/api/generate");
  expect(request?.[1]).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
  expect(JSON.parse(request?.[1].body)).toEqual({
    model,
    prompt: translationPrompt("Hello <|plamo:tag|>", "ja-easy"),
    raw: true,
    stream: true,
    keep_alive: "5m",
    options: { num_ctx: 4096, num_predict: 2048, temperature: 0, stop: TRANSLATION_STOP },
  });
});

it.each([
  { ...localModel, remote_host: "https://ollama.com" },
  { ...localModel, remote_model: "plamo-cloud" },
  { details: { format: "gguf" }, model_info: { "general.architecture": "llama" } },
  {
    ...localModel,
    model_info: { "general.architecture": "plamo3", "general.name": "Other model" },
  },
])("never sends source text to cloud or unrelated models (%j)", async (info) => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(info));
  vi.stubGlobal("fetch", fetcher);
  await expect(translateWithOllama("Private source", "ja", "cloud-test", opts())).rejects.toThrow(
    "端末内",
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]?.[1].body).not.toContain("Private source");
});

it.each([403, 404, 500])("explains HTTP %i failures without another provider", async (status) => {
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status }));
  vi.stubGlobal("fetch", fetcher);
  await expect(translateWithOllama("source", "ja", "http-test", opts())).rejects.toThrow(
    status === 403 ? "OLLAMA_ORIGINS" : status === 404 ? "ollama pull" : "HTTP 500",
  );
  expect(fetcher).toHaveBeenCalledOnce();
});

it("explains connection errors with the extension origin", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
  await expect(translateWithOllama("source", "ja", "connection-test", opts())).rejects.toThrow(
    /OLLAMA_ORIGINS="chrome-extension:\/\//,
  );
});
