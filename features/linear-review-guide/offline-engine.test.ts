import type { RawCompletionChunk, RawCompletionParams, WllamaConfig } from "@wllama/wllama";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  construct: vi.fn<(paths: unknown, config?: WllamaConfig) => void>(),
  load: vi.fn(),
  complete: vi.fn(),
  exit: vi.fn(),
  metadata: vi.fn(),
  setCompat: vi.fn(),
  gpu: vi.fn(),
}));
vi.mock("@wllama/wllama", () => ({
  Wllama: class {
    constructor(paths: unknown, config?: WllamaConfig) {
      mocks.construct(paths, config);
    }
    loadModel = mocks.load;
    createCompletion = mocks.complete;
    exit = mocks.exit;
    getModelMetadata = mocks.metadata;
    setCompat = mocks.setCompat;
  },
}));
vi.mock("offline-plamo-native", () => ({ compatNativeCode: "embedded compat native code" }));

const model = () => new Blob(["GGUF model"]);
const options = () => ({ signal: new AbortController().signal });
const captureLog = (message: string) => mocks.construct.mock.lastCall?.[1]?.logger?.log(message);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal("navigator", { hardwareConcurrency: 16, gpu: { requestAdapter: mocks.gpu } });
  mocks.gpu.mockResolvedValue({});
  mocks.load.mockImplementation(async () =>
    captureLog("load_tensors: offloaded 33/33 layers to GPU"),
  );
  mocks.exit.mockResolvedValue(undefined);
  mocks.metadata.mockReturnValue({
    meta: { "general.architecture": "plamo3", "general.name": "PLaMo 3 Translate" },
  });
  mocks.complete.mockImplementation(
    async (params: RawCompletionParams & { onData: (chunk: RawCompletionChunk) => void }) => {
      params.onData({
        id: "offline-test",
        object: "text_completion",
        created: 0,
        model: "test",
        choices: [{ text: "日本語の訳", index: 0, finish_reason: "stop", logprobs: null }],
      });
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("offline PLaMo engine", () => {
  it("uses the browser GPU parameters and confirms native layer offload before reporting GPU", async () => {
    const { createOfflinePlamo } = await import("./offline-engine");
    const status = vi.fn();
    const engine = await createOfflinePlamo(model(), status);
    expect(engine.device).toBe("gpu");
    expect(engine.modelName).toBe("PLaMo 3 Translate");
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
      [expect.any(Blob)],
      expect.objectContaining({
        n_gpu_layers: 999,
        n_ctx: 8192,
        n_parallel: 2,
        n_threads: 4,
        cont_batching: true,
      }),
    );
    expect(mocks.setCompat).toHaveBeenCalledWith({
      worker: { code: "embedded compat native code" },
      wasm: expect.stringContaining("offline-plamo.wasm"),
    });
    expect(status).toHaveBeenLastCalledWith("翻訳の準備ができました。GPUを使用します。");
    expect(await engine.translate("English source", options())).toBe("日本語の訳");
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ cache_prompt: false }));
    await engine.dispose();
    await expect(engine.translate("English source", options())).rejects.toThrow("終了しています");
  });

  it.each([
    [[]],
    [["llama_model_load: using device WebGPU"]],
    [["llama_model_load: using device WebGPU", "load_tensors: offloaded 0/33 layers to GPU"]],
    [["ggml_webgpu: Failed to get an adapter: unavailable"]],
  ])("falls back to explicit CPU use without confirmed GPU layer offload (%j)", async (logs) => {
    mocks.load.mockImplementationOnce(async () => {
      for (const log of logs) captureLog(log);
    });
    const { createOfflinePlamo } = await import("./offline-engine");
    const status = vi.fn();
    const engine = await createOfflinePlamo(model(), status);
    expect(engine.device).toBe("cpu");
    expect(mocks.exit).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenLastCalledWith(
      [expect.any(Blob)],
      expect.objectContaining({ n_gpu_layers: 0, n_ctx: 4096, n_parallel: 1, n_threads: 8 }),
    );
    expect(status).toHaveBeenLastCalledWith(
      "翻訳の準備ができました。GPUを利用できないためCPUを使用します。",
    );
    await engine.translate("English source", options());
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({ cache_prompt: true }));
  });

  it("retries CPU after a GPU load failure and releases both runtimes if CPU also fails", async () => {
    mocks.load.mockRejectedValueOnce(new Error("GPU failure"));
    mocks.load.mockRejectedValueOnce(new Error("CPU failure"));
    const { createOfflinePlamo } = await import("./offline-engine");
    await expect(createOfflinePlamo(model())).rejects.toThrow("CPU failure");
    expect(mocks.exit).toHaveBeenCalledTimes(2);
  });

  it("uses CPU directly when WebGPU adapter requests fail", async () => {
    mocks.gpu.mockRejectedValue(new Error("WebGPU unavailable"));
    const { createOfflinePlamo } = await import("./offline-engine");
    expect((await createOfflinePlamo(model())).device).toBe("cpu");
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.load).toHaveBeenCalledWith(
      [expect.any(Blob)],
      expect.objectContaining({ n_gpu_layers: 0, n_parallel: 1 }),
    );
  });

  it("reuses successful translations only within the loaded model instance", async () => {
    const { createOfflinePlamo } = await import("./offline-engine");
    const engine = await createOfflinePlamo(model());
    expect(await engine.translate("Repeated source", options())).toBe("日本語の訳");
    expect(await engine.translate("Repeated source", options())).toBe("日本語の訳");
    expect(mocks.complete).toHaveBeenCalledOnce();
    const otherEngine = await createOfflinePlamo(model());
    await otherEngine.translate("Repeated source", options());
    expect(mocks.complete).toHaveBeenCalledTimes(2);
  });

  it("does not cache cancelled or incomplete translations", async () => {
    const { createOfflinePlamo } = await import("./offline-engine");
    const engine = await createOfflinePlamo(model());
    const controller = new AbortController();
    mocks.complete.mockImplementationOnce(async () => controller.abort());
    await expect(
      engine.translate("Cancelled source", { signal: controller.signal }),
    ).rejects.toThrow();
    await engine.translate("Cancelled source", options());
    mocks.complete.mockImplementationOnce(async () => {});
    await expect(engine.translate("Incomplete source", options())).rejects.toThrow("最後まで");
    await engine.translate("Incomplete source", options());
    expect(mocks.complete).toHaveBeenCalledTimes(4);
  });

  it("rejects non-GGUF files before creating a runtime and releases non-Translate models", async () => {
    const { createOfflinePlamo } = await import("./offline-engine");
    await expect(createOfflinePlamo(new Blob(["wrong file"]))).rejects.toThrow("GGUF");
    expect(mocks.construct).not.toHaveBeenCalled();
    mocks.metadata.mockReturnValue({ meta: { "general.architecture": "llama" } });
    await expect(createOfflinePlamo(model())).rejects.toThrow("PLaMo 3 Translate");
    expect(mocks.exit).toHaveBeenCalledOnce();
  });
});
