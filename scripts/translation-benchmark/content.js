import {
  createTranslationController,
  splitTranslationText,
} from "../../features/translate/content";
import { TRANSLATE, TRANSLATION_PROGRESS } from "../../features/translate/shared";

if (new URL(location.href).searchParams.get("variant") === BENCH_VARIANT) {
  const requests = [];
  const updates = [];
  const telemetry = [];
  let start;
  let active = false;
  let firstDomMs;
  const publish = (value) =>
    document.dispatchEvent(
      new CustomEvent("translation-bench:event", { detail: JSON.stringify(value) }),
    );
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const bounded = async (promise, milliseconds, message) => {
    let timer;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  const resetOffscreen = async () => {
    const reset = await bounded(
      chrome.runtime.sendMessage({ type: "bench:reset" }),
      15000,
      "Background reset did not respond within 15 seconds. Reload the benchmark extension and page.",
    );
    assert(reset?.ok, reset?.error ?? "Reset failed");
  };
  const identity = {
    variant: BENCH_VARIANT,
    model: BENCH_MODEL,
    modelSha256: BENCH_MODEL_SHA256,
    sourceSha256: BENCH_SOURCE_SHA256,
  };
  const saveResult = async (result) => {
    const response = await fetch("http://127.0.0.1:8817/results", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(result),
      signal: AbortSignal.timeout(15000),
    });
    assert(response.ok, `Saving benchmark failed: HTTP ${response.status}`);
    assert((await response.json())?.ok === true, "Saving benchmark was not acknowledged");
  };
  const controller = createTranslationController({
    send: async (message) => {
      if (message.type !== TRANSLATE && !Array.isArray(message.texts))
        return chrome.runtime.sendMessage(message);
      const request = {
        id: message.requestId,
        ...(Array.isArray(message.texts) ? { texts: message.texts } : { text: message.text }),
        sentMs: performance.now() - start,
      };
      requests.push(request);
      const result = await chrome.runtime.sendMessage(message);
      request.doneMs = performance.now() - start;
      request.result = result;
      return result;
    },
  });
  controller.setEnabled(true);
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === TRANSLATION_PROGRESS) {
      if (active) updates.push({ ...message, atMs: performance.now() - start });
      controller.progress(message.sessionId, message.requestId, message.update);
    } else if (message.type === "bench:telemetry") telemetry.push(message.event);
  });
  const outputs = () => [...document.querySelectorAll("[data-luvpame-translation]")];
  const visibleText = (host) =>
    host.shadowRoot?.querySelector("[data-translation-text]")?.textContent ?? "";
  document.addEventListener("translation-bench:command", async (event) => {
    if (event.detail === "release") {
      assert(!active, "Cannot release during a run");
      controller.reset();
      await resetOffscreen();
      publish({ kind: "released" });
      return;
    }
    if (event.detail !== "run" || active) return;
    active = true;
    try {
      controller.reset();
      publish({ kind: "resetting" });
      await resetOffscreen();
      publish({ kind: "warming" });
      telemetry.length = 0;
      const warmupStart = performance.now();
      const warmup = await bounded(
        chrome.runtime.sendMessage({
          type: TRANSLATE,
          text: "This warmup sentence prepares the local translation model.",
          target: "ja",
          priority: "selection",
          sessionId: crypto.randomUUID(),
          requestId: crypto.randomUUID(),
        }),
        600000,
        "Warmup translation timed out after 10 minutes",
      );
      assert(warmup?.ok, warmup?.error ?? "Warmup failed");
      assert(warmup.device === "gpu", "Warmup did not use the GPU");
      while (!telemetry.some((entry) => entry.kind === "completion-done")) {
        assert(performance.now() - warmupStart < 600000, "Warmup telemetry timed out");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const preparationMs = performance.now() - warmupStart;
      const setupTelemetry = telemetry.splice(0);
      assert(
        setupTelemetry.some(
          (entry) =>
            entry.kind === "native-log" &&
            entry.args.some((message) => /offloaded [1-9]\d*\/\d+ layers to GPU/i.test(message)),
        ),
        "Native logs did not confirm positive GPU layer offloading",
      );
      const paragraphs = [...document.querySelectorAll("#fixture p")];
      const source = paragraphs.map((element) => element.textContent.trim());
      const viewportIndexes = paragraphs.flatMap((element, index) => {
        const rect = element.getBoundingClientRect();
        return rect.top < innerHeight && rect.bottom > 0 ? [index] : [];
      });
      const expectedTexts = source.flatMap(splitTranslationText);
      const expectedRequests = expectedTexts.length;
      requests.length = 0;
      updates.length = 0;
      firstDomMs = undefined;
      start = performance.now();
      publish({ kind: "running" });
      controller.toggle("below", "ja");
      let domDoneMs;
      let firstParagraphMs;
      let viewportDoneMs;
      await new Promise((resolve, reject) => {
        const timer = setInterval(() => {
          const failed = requests.find((request) => request.result?.ok === false);
          if (failed) {
            clearInterval(timer);
            reject(new Error(failed.result.error));
            return;
          }
          const hosts = outputs();
          const done = (index) => hosts[index]?.getAttribute("aria-busy") === "false";
          if (done(0)) firstParagraphMs ??= performance.now() - start;
          if (viewportIndexes.every(done)) viewportDoneMs ??= performance.now() - start;
          if (
            firstDomMs === undefined &&
            hosts.some((host) => /[\u3040-\u30ff\u3400-\u9fff]/.test(visibleText(host)))
          )
            firstDomMs = performance.now() - start;
          if (
            hosts.length === source.length &&
            hosts.every((host) => host.getAttribute("aria-busy") === "false")
          )
            domDoneMs ??= performance.now() - start;
          if (
            domDoneMs !== undefined &&
            requests.every((request) => request.result?.ok) &&
            telemetry.filter((entry) => entry.kind === "completion-done").length >=
              requests.length &&
            telemetry.filter(
              (entry) => entry.kind === "completion-done" || entry.kind === "completion-error",
            ).length >= telemetry.filter((entry) => entry.kind === "completion-start").length
          ) {
            clearInterval(timer);
            resolve();
          } else if (performance.now() - start > 600000) {
            clearInterval(timer);
            reject(new Error("Translation timed out after 10 minutes"));
          }
        }, 10);
      });
      const elapsedMs = domDoneMs;
      const translations = outputs().map(visibleText);
      const requestedTexts = requests.flatMap((request) => request.texts ?? [request.text]);
      const logicalCount = requestedTexts.length;
      assert(
        logicalCount === expectedRequests,
        `Expected ${expectedRequests} texts, received ${logicalCount}`,
      );
      assert(
        JSON.stringify([...requestedTexts].sort()) === JSON.stringify([...expectedTexts].sort()),
        "Requested texts do not match the source paragraphs",
      );
      assert(
        requests.every((request) => request.result?.ok),
        "Some translation requests failed",
      );
      assert(
        requests.every((request) => {
          const texts = request.texts ? request.result.texts : [request.result.text];
          return (
            Array.isArray(texts) &&
            texts.length === (request.texts?.length ?? 1) &&
            texts.every(
              (text) => typeof text === "string" && /[\u3040-\u30ff\u3400-\u9fff]/.test(text),
            )
          );
        }),
        "A translation response omitted a source text or Japanese output",
      );
      assert(
        translations.every((text) => /[\u3040-\u30ff\u3400-\u9fff]/.test(text)),
        "A translation has no Japanese text",
      );
      const completions = telemetry.filter((entry) => entry.kind === "completion-done");
      assert(
        completions.length >= requests.length,
        "A request hit a cache or missed native completion telemetry",
      );
      assert(
        completions.every((entry) => entry.finishReason === "stop"),
        "A native completion did not finish normally",
      );
      assert(
        completions.every((entry) => entry.usage && entry.timings),
        "A native completion omitted usage or timings",
      );
      assert(
        completions.every(
          (entry) =>
            entry.timings.cache_n === 0 &&
            entry.usage.prompt_tokens_details?.cached_tokens === 0 &&
            entry.usage.completion_tokens > 0,
        ),
        "A native completion reused cached tokens or generated no tokens",
      );
      const result = {
        ...identity,
        ok: true,
        elapsedMs,
        firstDomMs,
        firstParagraphMs,
        viewportDoneMs,
        viewportIndexes,
        preparationMs,
        source,
        translations,
        requests,
        updates,
        completions,
        errors: telemetry.filter((entry) => entry.kind === "completion-error"),
        telemetry,
        setupTelemetry,
        expectedRequests,
        logicalCount,
        device: warmup.device,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency,
      };
      await saveResult(result);
      publish({ kind: "done", result });
    } catch (error) {
      let failure = String(error);
      try {
        controller.reset();
      } catch (cleanupError) {
        failure += `; Controller cleanup failed: ${cleanupError}`;
      }
      try {
        await resetOffscreen();
      } catch (cleanupError) {
        failure += `; Offscreen cleanup failed: ${cleanupError}`;
      }
      const result = { ...identity, ok: false, error: failure };
      try {
        await saveResult(result);
      } catch (saveError) {
        failure += `; Saving failed run also failed: ${saveError}`;
      }
      publish({ kind: "failed", error: failure, result });
    } finally {
      active = false;
    }
  });
  publish({ kind: "ready" });
}
