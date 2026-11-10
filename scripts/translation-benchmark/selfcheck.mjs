import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(process.cwd() + "/package.json");
const { JSDOM } = require("jsdom");
const source = (await readFile("scripts/translation-benchmark/content.js", "utf8")).replace(
  /^import[\s\S]*?;\n/gm,
  "",
);
async function run(mode) {
  const batch = mode.startsWith("batch") || mode === "fallback";
  const succeeds = ["success", "batch", "fallback"].includes(mode);
  const inputs = batch ? ["Local translation", "Browser settings"] : ["Local translation works."];
  const dom = new JSDOM(
    `<main id="fixture">${inputs.map((text) => `<p>${text}</p>`).join("")}</main>`,
    {
      url: "http://localhost/?variant=current",
      runScripts: "outside-only",
    },
  );
  const w = dom.window;
  const saved = [],
    listeners = [];
  let resets = 0;
  let sender;
  const emit = (e) => listeners.forEach((fn) => fn({ type: "bench:telemetry", event: e }));
  const completion = {
    kind: "completion-done",
    finishReason: "stop",
    usage: {
      completion_tokens: 3,
      prompt_tokens_details: { cached_tokens: mode === "cached" ? 2 : 0 },
    },
    timings: { cache_n: 0 },
  };
  Object.assign(w, {
    BENCH_VARIANT: "current",
    BENCH_MODEL: "0.8b",
    BENCH_MODEL_SHA256: "modelhash",
    BENCH_SOURCE_SHA256: "sourcehash",
    TRANSLATE: "translate",
    TRANSLATION_PROGRESS: "progress",
    AbortSignal,
    splitTranslationText: (t) => [t],
    fetch: async (_url, options) => {
      saved.push(JSON.parse(options.body));
      return { ok: mode !== "save-failure", status: 503, json: async () => ({ ok: true }) };
    },
    chrome: {
      runtime: {
        onMessage: { addListener: (fn) => listeners.push(fn) },
        sendMessage: async (message) => {
          if (message.type === "bench:reset") {
            resets++;
            return { ok: true };
          }
          if (message.priority === "selection") {
            if (mode !== "missing-log")
              emit({ kind: "native-log", args: ["load_tensors: offloaded 17/17 layers to GPU"] });
            emit(completion);
            return { ok: true, text: "準備", device: mode === "cpu" ? "cpu" : "gpu" };
          }
          emit({ kind: "completion-start" });
          if (mode === "fallback") {
            emit({ kind: "completion-error", error: "Batch failed; translating separately" });
            for (const _text of inputs) {
              emit({ kind: "completion-start" });
              emit(completion);
            }
          } else setTimeout(() => emit(completion), 20);
          return batch
            ? {
                ok: true,
                texts: mode === "batch-missing-output" ? ["翻訳"] : inputs.map(() => "翻訳"),
                device: "gpu",
              }
            : { ok: true, text: "翻訳", device: "gpu" };
        },
      },
    },
    createTranslationController: (options) => {
      sender = options.send;
      return {
        setEnabled() {},
        progress() {},
        reset() {
          w.document.querySelectorAll("[data-luvpame-translation]").forEach((e) => e.remove());
        },
        toggle() {
          for (const _text of inputs) {
            const host = w.document.createElement("div");
            host.setAttribute("data-luvpame-translation", "");
            host.setAttribute("aria-busy", "false");
            const shadow = host.attachShadow({ mode: "open" });
            shadow.innerHTML = "<span data-translation-text>翻訳</span>";
            w.document.body.append(host);
          }
          void sender(
            batch
              ? {
                  type: "translate-batch",
                  requestId: "batch",
                  texts: mode === "batch-wrong-source" ? [inputs[0], inputs[0]] : inputs,
                }
              : { type: "translate", requestId: "one", text: inputs[0] },
          );
        },
      };
    },
  });
  const done = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("test timeout " + mode)), 1000);
    w.document.addEventListener("translation-bench:event", (event) => {
      const value = JSON.parse(event.detail);
      if (value.kind === "done" || value.kind === "failed") {
        clearTimeout(timer);
        resolve(value);
      }
    });
  });
  w.eval(source);
  w.document.dispatchEvent(new w.CustomEvent("translation-bench:command", { detail: "run" }));
  const result = await done;
  assert.equal(result.kind, succeeds ? "done" : "failed");
  assert.equal(saved.at(-1).ok, succeeds);
  assert.equal(saved.at(-1).modelSha256, "modelhash");
  assert.equal(saved.at(-1).sourceSha256, "sourcehash");
  assert.equal(resets, succeeds ? 1 : 2);
  if (batch && succeeds) {
    assert.equal(result.result.logicalCount, 2);
    assert.equal(result.result.requests.length, 1);
    assert.equal(result.result.completions.length, mode === "fallback" ? 2 : 1);
    assert.equal(result.result.errors.length, mode === "fallback" ? 1 : 0);
  }
  if (mode === "batch-missing-output") assert.match(result.error, /omitted a source text/);
  if (mode === "batch-wrong-source") assert.match(result.error, /do not match the source/);
  if (mode === "cpu") assert.match(result.error, /did not use the GPU/);
  if (mode === "missing-log") assert.match(result.error, /positive GPU/);
  if (mode === "cached") assert.match(result.error, /cached tokens/);
  if (mode === "save-failure") {
    assert.match(result.error, /HTTP 503/);
    assert.match(result.error, /Saving failed run also failed/);
  }
  dom.window.close();
  console.log("PASS", mode);
}
for (const mode of [
  "success",
  "batch",
  "fallback",
  "batch-missing-output",
  "batch-wrong-source",
  "cpu",
  "missing-log",
  "cached",
  "save-failure",
])
  await run(mode);
