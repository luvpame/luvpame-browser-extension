import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Script, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { buildTranslationRuntime } from "../scripts/translation-runtime";

describe("translation runtime", () => {
  it("packages valid static main, pthread and cache workers from the installed runtime", () => {
    const { moduleCode, assets } = buildTranslationRuntime();
    expect([...assets.keys()]).toEqual([
      "vendor/wllama-worker.js",
      "vendor/wllama-pthread.js",
      "vendor/wllama-opfs.js",
    ]);
    for (const [filename, source] of assets) {
      expect(() => new Script(source, { filename })).not.toThrow();
    }
    expect(moduleCode).toContain('new URL("wllama-pthread.js", this.resources.wasmPath).href');
    expect(moduleCode).not.toContain("this.worker = createWorker(completeCode)");
    expect(moduleCode).not.toContain("createWorker(OPFS_UTILS_WORKER_CODE)");
    expect(moduleCode).not.toContain('new Blob([moduleCode], { type: "text/javascript" })');
  });

  it("initializes the static worker message handler synchronously before the next task", async () => {
    const { assets } = buildTranslationRuntime();
    const worker = assets.get("vendor/wllama-worker.js");
    if (!worker) throw new Error("Missing worker");
    const workerGlobal: {
      self?: unknown;
      onmessage?: (event: { data: unknown }) => unknown;
      postMessage: ReturnType<typeof vi.fn>;
    } = { postMessage: vi.fn() };
    workerGlobal.self = workerGlobal;
    runInNewContext(worker, workerGlobal);
    const configure = workerGlobal.onmessage;
    if (!configure) throw new Error("Missing configuration handler");
    configure({ data: { pathConfig: {}, nbThread: 4, compat: false } });
    expect(workerGlobal.onmessage).not.toBe(configure);
    await workerGlobal.onmessage?.({ data: { verb: "test" } });
    expect(workerGlobal.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ verb: "console.error" }),
      undefined,
    );
  });

  it("fails instead of shipping a partial patch when the pinned runtime changes", () => {
    const entry = createRequire(import.meta.url).resolve("@wllama/wllama");
    const source = readFileSync(join(dirname(entry), "index.js"), "utf8");
    expect(() =>
      buildTranslationRuntime(source.replace("createWorker(OPFS_UTILS_WORKER_CODE)", "changed()")),
    ).toThrow("Unsupported @wllama/wllama source");
    expect(() =>
      buildTranslationRuntime(
        source.replace("let moduleCode = JSPI_STUB", "let changed = JSPI_STUB"),
      ),
    ).toThrow("Missing @wllama/wllama worker initialization");
  });
});
