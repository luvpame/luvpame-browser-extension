import { Wllama } from "./baseline/wllama.js";

const texts = [
  "The red fox sleeps under the tree.",
  "The blue bird flies over the river.",
  "The city library opens at nine every morning. Visitors can borrow books and read newspapers in a quiet room.",
  "The train leaves the station at six. Please arrive early and keep your ticket until you reach the destination.",
  "The new bridge connects the two towns. Children can now walk safely to school without crossing the busy road.",
  "Heavy rain continued throughout the night. By morning, the river had risen, but the nearby houses were still safe.",
  "The teacher asked each student to write a short story. They shared their ideas and helped one another improve the ending.",
  "The bakery sells fresh bread every morning. The owner uses flour from a local farm and makes everything by hand.",
  "The small village stands beside a river. In spring, pink flowers cover the hills and many birds return from the south.",
  "The museum has changed its opening hours. It is now closed on Mondays, and tickets are available at the front desk.",
  "The computer saves a copy of the document every minute. This helps protect your work if the power suddenly goes out.",
  "The hospital has opened a new waiting room. Families can rest there while doctors look after their relatives.",
];
const prompt = (text) =>
  "<|plamo:tag|>dataset<|plamo:msg|>translation<|plamo:tag|>input<|plamo:key|>lang<|plamo:val|>en<|plamo:msg|>" +
  text +
  "<|plamo:tag|>output<|plamo:key|>lang<|plamo:val|>ja<|plamo:msg|>";
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
let model;
let runtime;
export const state = (globalThis.nativeBench = { phase: "idle", samples: [], errors: [], texts });

export async function prepare() {
  if (globalThis.runtime) {
    await globalThis.runtime.exit();
    globalThis.runtime = null;
  }
  state.phase = "fetch-model";
  model = await (await fetch("http://127.0.0.1:8768/model.gguf")).blob();
  state.modelBytes = model.size;
  const adapter = await navigator.gpu.requestAdapter();
  state.machine = {
    vendor: adapter?.info.vendor,
    architecture: adapter?.info.architecture,
    cores: navigator.hardwareConcurrency,
    userAgent: navigator.userAgent,
    isolated: crossOriginIsolated,
  };
  state.phase = "ready";
}

async function load(variant, device = "gpu", compat = false) {
  if (runtime) {
    await runtime.exit();
    runtime = null;
  }
  const logs = [];
  const note = (...args) => {
    const text = args.map((x) => (typeof x === "string" ? x : "")).join(" ");
    if (text.length < 500) logs.push(text);
  };
  const prefix = compat ? "" : variant + "/";
  runtime = new Wllama(
    { default: location.origin + "/" + prefix + "vendor/wllama.wasm" },
    { suppressNativeLog: false, logger: { debug: note, log: note, warn: note, error: note } },
  );
  runtime.setCompat({
    worker: location.origin + "/vendor/wllama-compat-worker.js",
    wasm: location.origin + "/vendor/wllama-compat.wasm",
  });
  const saved = WebAssembly.Suspending;
  if (compat) WebAssembly.Suspending = undefined;
  const start = performance.now();
  try {
    await runtime.loadModel([model], {
      n_ctx: device === "gpu" ? 8192 : 4096,
      n_parallel: device === "gpu" ? 2 : 1,
      kv_unified: false,
      swa_full: true,
      ...(device === "gpu" ? { cont_batching: true } : {}),
      n_gpu_layers: device === "gpu" ? 999 : 0,
      n_threads: Math.max(1, Math.min(4, Math.floor((navigator.hardwareConcurrency || 2) / 2))),
      cache_idle_slots: false,
      ctx_shift: false,
    });
  } finally {
    WebAssembly.Suspending = saved;
  }
  if (device === "gpu")
    assert(
      logs.some((line) => /offloaded [1-9]\d*\/\d+ layers to GPU/i.test(line)),
      "GPU offload not confirmed",
    );
  else
    assert(
      !logs.some((line) => /offloaded [1-9]\d*\/\d+ layers to GPU/i.test(line)),
      "Unexpected GPU offload",
    );
  return {
    ms: performance.now() - start,
    logs: logs.filter((line) => /offloaded|n_ctx|n_seq|cache|buffer size|version|SIMD/.test(line)),
  };
}

async function complete(text, onText = () => {}, signal) {
  let output = "",
    finish = null,
    finalChunk;
  await runtime.createCompletion({
    prompt: prompt(text),
    max_tokens: 2048,
    temperature: 0,
    cache_prompt: false,
    stop: ["<|plamo:tag|>", "<|plamo:bos|>"],
    abortSignal: signal,
    stream: true,
    stream_options: { include_usage: true },
    onData(chunk) {
      if (chunk.usage) finalChunk = chunk;
      for (const choice of chunk.choices) {
        output += choice.text;
        if (choice.finish_reason) finish = choice.finish_reason;
      }
      if (output) onText(output);
    },
  });
  assert(
    finish === "stop" && /[\u3040-\u30ff\u3400-\u9fff]/u.test(output),
    "Invalid or unfinished output",
  );
  assert(finalChunk?.usage?.prompt_tokens_details?.cached_tokens === 0, "Cached benchmark prompt");
  return { text: output.trim(), timings: finalChunk.timings, usage: finalChunk.usage };
}

export async function sample(variant, iteration) {
  state.phase = variant + "-" + iteration;
  const loading = await load(variant);
  await complete("A white dog waits outside the house.");
  const start = performance.now();
  let firstTextMs;
  const rows = [];
  rows.push(
    await complete(texts[0], () => {
      firstTextMs ??= performance.now() - start;
    }),
  );
  const firstDoneMs = performance.now() - start;
  for (let i = 1; i < texts.length; i += 2)
    rows.push(...(await Promise.all(texts.slice(i, i + 2).map((text) => complete(text)))));
  const ms = performance.now() - start;
  assert(
    rows[0].text === "赤狐は木の下で眠っている。" &&
      rows[1].text === "青い鳥が川の上を飛んでいる。",
    "Known translation changed",
  );
  const row = {
    variant,
    iteration,
    modelBytes: model.size,
    ms,
    firstTextMs,
    firstDoneMs,
    loading,
    rows,
  };
  state.samples.push(row);
  await runtime.exit();
  runtime = null;
  return row;
}

export async function compare() {
  try {
    for (let iteration = 0; iteration < 5; iteration++)
      for (const variant of ["baseline", "optimized"]) await sample(variant, iteration);
    const baseline = state.samples
      .find((row) => row.variant === "baseline")
      .rows.map((row) => row.text);
    state.outputComparisons = state.samples.map((row) => ({
      variant: row.variant,
      iteration: row.iteration,
      matches: row.rows.map((output, index) => output.text === baseline[index]),
    }));
    state.phase = "passed";
  } catch (error) {
    state.errors.push(String(error));
    state.phase = "failed";
    if (runtime) await runtime.exit().catch(() => {});
    runtime = null;
  }
  return state;
}

export async function smoke(device = "gpu", compat = false) {
  try {
    const loading = await load("optimized", device, compat);
    const first = await complete(texts[0]);
    let cancellation;
    if (device === "gpu") {
      const controller = new AbortController();
      let chunks = 0;
      const cancel = complete(
        texts[6],
        () => {
          chunks++;
          controller.abort();
        },
        controller.signal,
      ).then(
        () => {
          throw Error("Cancellation succeeded unexpectedly");
        },
        (error) => {
          assert(error.name === "AbortError", "Wrong cancellation failure");
          return "AbortError";
        },
      );
      const survivor = complete(texts[1]);
      const results = await Promise.all([cancel, survivor]);
      assert(chunks > 0, "No generated chunk before cancellation");
      cancellation = { chunks, result: results[0], survivor: results[1] };
    }
    const earlyController = new AbortController();
    let earlyChunks = 0;
    const early = complete(texts[6].repeat(4), () => earlyChunks++, earlyController.signal).then(
      () => {
        throw Error("Early cancellation succeeded unexpectedly");
      },
      (error) => {
        assert(error.name === "AbortError", "Wrong early cancellation failure");
        return error.name;
      },
    );
    const timer = setTimeout(() => earlyController.abort(), 10);
    let earlyCancellation;
    try {
      earlyCancellation = await early;
    } finally {
      clearTimeout(timer);
    }
    assert(earlyChunks === 0, "Early cancellation received text");
    const after = await complete("The yellow boat crosses the quiet lake.");
    await runtime.exit();
    runtime = null;
    const result = {
      device,
      compat,
      modelBytes: model.size,
      loading,
      first,
      cancellation,
      earlyCancellation,
      earlyChunks,
      after,
      ok: true,
    };
    (state.smokes ??= []).push(result);
    return result;
  } catch (error) {
    if (runtime) await runtime.exit().catch(() => {});
    runtime = null;
    const result = { device, compat, ok: false, error: String(error) };
    (state.smokes ??= []).push(result);
    return result;
  }
}

export async function prepareSmall() {
  model = await (await fetch("http://127.0.0.1:8768/model-0.8b.gguf")).blob();
  state.smallModelBytes = model.size;
  return model.size;
}

export async function compareCpu() {
  state.cpuSamples = [];
  try {
    for (let iteration = 0; iteration < 5; iteration++)
      for (const variant of ["baseline", "optimized"]) {
        state.phase = "cpu-" + variant + "-" + iteration;
        const loading = await load(variant, "cpu");
        await complete("A white dog waits outside the house.");
        const start = performance.now();
        const rows = [];
        for (const text of texts.slice(0, 2)) rows.push(await complete(text));
        state.cpuSamples.push({
          variant,
          iteration,
          modelBytes: model.size,
          ms: performance.now() - start,
          loading,
          rows,
        });
        await runtime.exit();
        runtime = null;
      }
    const baseline = state.cpuSamples[0].rows.map((row) => row.text);
    state.cpuOutputComparisons = state.cpuSamples.map((row) => ({
      variant: row.variant,
      iteration: row.iteration,
      matches: row.rows.map((output, index) => output.text === baseline[index]),
    }));
    state.phase = "cpu-passed";
  } catch (error) {
    state.errors.push(String(error));
    state.phase = "cpu-failed";
    if (runtime) await runtime.exit().catch(() => {});
    runtime = null;
  }
  return state;
}

export async function warmCpu(variant) {
  const loading = await load(variant, "cpu");
  await complete("A white dog waits outside the house.");
  return loading;
}
export async function workCpu() {
  const rows = [];
  for (const text of texts.slice(0, 2)) rows.push(await complete(text));
  return rows;
}
export async function closeRuntime() {
  if (runtime) await runtime.exit();
  runtime = null;
}
