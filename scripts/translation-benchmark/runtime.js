import { Wllama as NativeWllama } from "benchmark-runtime-native";
export * from "benchmark-runtime-native";

const report = (event) => chrome.runtime.sendMessage({ type: "bench:telemetry", event });
export class Wllama extends NativeWllama {
  constructor(paths, config) {
    const logger = Object.fromEntries(
      ["debug", "log", "warn", "error"].map((level) => [
        level,
        (...args) => {
          void report({ kind: "native-log", level, args: args.map(String), at: Date.now() });
          config.logger?.[level]?.(...args);
        },
      ]),
    );
    super(paths, { ...config, logger });
  }
  async loadModelFromUrl(url, options) {
    const started = performance.now();
    await report({
      kind: "model-options",
      options: { ...options, signal: undefined, progressCallback: undefined },
    });
    const result = await super.loadModelFromUrl(url, options);
    await report({ kind: "model-loaded", elapsedMs: performance.now() - started });
    return result;
  }
  async createCompletion(options) {
    const id = crypto.randomUUID();
    const started = performance.now();
    let firstTokenMs;
    let usage;
    let timings;
    let finishReason;
    void report({ kind: "completion-start", id, prompt: options.prompt, at: Date.now() });
    try {
      const result = await super.createCompletion({
        ...options,
        stream_options: { ...options.stream_options, include_usage: true },
        onData(chunk) {
          if (firstTokenMs === undefined && chunk.choices.some((choice) => choice.text))
            firstTokenMs = performance.now() - started;
          usage = chunk.usage ?? usage;
          timings = chunk.timings ?? timings;
          finishReason =
            chunk.choices.find((choice) => choice.finish_reason)?.finish_reason ?? finishReason;
          options.onData?.(chunk);
        },
      });
      void report({
        kind: "completion-done",
        id,
        elapsedMs: performance.now() - started,
        firstTokenMs,
        usage,
        timings,
        finishReason,
      });
      return result;
    } catch (error) {
      void report({ kind: "completion-error", id, error: String(error) });
      throw error;
    }
  }
}
