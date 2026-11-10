import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script, runInNewContext } from "node:vm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { buildTranslationRuntime } from "../scripts/translation-runtime";
import { type BuildManifest, type NativeFile, sha256 } from "../scripts/wllama/artifacts";
import {
  DAWN_SHA256,
  DAWN_TAG,
  EMSDK_VERSION,
  LLAMA_CPP_COMMIT,
  NATIVE_FILES,
  WLLAMA_COMMIT,
  WLLAMA_VERSION,
} from "../scripts/wllama/pins";

const require = createRequire(import.meta.url);
const sdkDirectory = dirname(require.resolve("@wllama/wllama"));
const compatDirectory = dirname(require.resolve("@wllama/wllama-compat"));
const sdkSource = readFileSync(join(sdkDirectory, "index.js"), "utf8");
const scriptsDirectory = join(dirname(fileURLToPath(import.meta.url)), "../scripts/wllama");
let nativeDirectory: string;
let manifest: BuildManifest;

beforeAll(() => {
  nativeDirectory = mkdtempSync(join(tmpdir(), "translation-native-"));
  for (const [file, source] of [
    ["wllama.js", join(sdkDirectory, "../src/wasm/wllama.js")],
    ["wllama.wasm", join(sdkDirectory, "wasm/wllama.wasm")],
    ["wllama-compat.js", join(compatDirectory, "wasm/wllama.js")],
    ["wllama-compat.wasm", join(compatDirectory, "wasm/wllama.wasm")],
  ] satisfies [string, string][])
    cpSync(source, join(nativeDirectory, file));
  for (const name of ["wllama", "wllama-compat"]) {
    const path = join(nativeDirectory, `${name}.js`);
    writeFileSync(path, readFileSync(path, "utf8") + `\n// Native fixture: ${name}\n`);
  }
  const file = (name: NativeFile) => {
    const bytes = readFileSync(join(nativeDirectory, name));
    return { bytes: bytes.length, sha256: sha256(bytes) };
  };
  const patchesDirectory = join(scriptsDirectory, "patches");
  manifest = {
    schemaVersion: 1,
    buildScriptSha256: sha256(readFileSync(join(scriptsDirectory, "build-native.sh"))),
    wllama: { version: WLLAMA_VERSION, commit: WLLAMA_COMMIT },
    llamaCpp: { commit: LLAMA_CPP_COMMIT },
    emscripten: {
      version: EMSDK_VERSION,
      image: `emscripten/emsdk:${EMSDK_VERSION}`,
      digest: `sha256:${"0".repeat(64)}`,
    },
    dawn: { tag: DAWN_TAG, sha256: DAWN_SHA256 },
    patches: readdirSync(patchesDirectory)
      .filter((name) => name.endsWith(".patch"))
      .sort()
      .map((file) => ({ file, sha256: sha256(readFileSync(join(patchesDirectory, file))) })),
    files: {
      "wllama.js": file("wllama.js"),
      "wllama.wasm": file("wllama.wasm"),
      "wllama-compat.js": file("wllama-compat.js"),
      "wllama-compat.wasm": file("wllama-compat.wasm"),
    },
  };
  writeFileSync(join(nativeDirectory, "build.json"), JSON.stringify(manifest));
});

afterAll(() => rmSync(nativeDirectory, { recursive: true, force: true }));

const buildRuntime = (source = sdkSource) => buildTranslationRuntime(source, nativeDirectory);

function withNativeCopy(check: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), "translation-native-changed-"));
  try {
    cpSync(nativeDirectory, directory, { recursive: true });
    check(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe("translation runtime", () => {
  it.each([false, true])(
    "keeps main and draft model files separate (draft: %s)",
    async (withDraft) => {
      const { moduleCode } = buildRuntime();
      const main = new Blob(["main"]);
      const draft = new Blob(["draft"]);
      const getModelOrDownload = vi.fn().mockResolvedValue({ open: async () => [draft] });
      const moduleInit = vi.fn();
      const action = vi.fn().mockResolvedValue({ metadata_key: [], list_tokens_eog: [] });
      const params = Object.freeze({
        n_threads: 1,
        ...(withDraft ? { spec_draft_model: "https://example.com/draft.gguf" } : {}),
        signal: new AbortController().signal,
      });
      await runInNewContext(
        moduleCode.replace(/export \{[\s\S]*?\};\s*$/, "") +
          `
        ProxyToWorker = class {
          moduleInit = moduleInit;
          wllamaStart = async () => ({ success: true });
          wllamaAction = action;
        };
        Wllama.prototype.loadModel.call({
          pathConfig: { default: "bundled.wasm" },
          config: {}, logger: () => ({ debug() {} }),
          getWorkerResources: () => ({}),
          checkWasmVersion: async () => {},
          modelManager: { getModelOrDownload },
        }, [main], params);
      `,
        {
          main,
          params,
          getModelOrDownload,
          moduleInit,
          action,
          TextEncoder,
          TextDecoder,
          navigator: {},
        },
      );
      expect(moduleInit).toHaveBeenCalledWith([
        { name: "model-00001-of-00001.gguf", blob: main },
        ...(withDraft ? [{ name: "draft.gguf", blob: draft }] : []),
      ]);
      expect(action).toHaveBeenCalledWith(
        "load",
        expect.objectContaining({
          model_paths: ["models/model-00001-of-00001.gguf"],
          spec_draft_model: withDraft ? "models/draft.gguf" : undefined,
        }),
      );
      expect(getModelOrDownload).toHaveBeenCalledTimes(withDraft ? 1 : 0);
      if (withDraft) {
        expect(params.spec_draft_model).toBe("https://example.com/draft.gguf");
        expect(getModelOrDownload).toHaveBeenCalledWith({ url: params.spec_draft_model }, params);
      }
    },
  );

  it("packages valid static main, pthread and cache workers from the installed runtime", () => {
    const { moduleCode, assets } = buildRuntime();
    expect([...assets.keys()]).toEqual([
      "vendor/wllama-worker.js",
      "vendor/wllama-pthread.js",
      "vendor/wllama-compat-worker.js",
      "vendor/wllama-compat-pthread.js",
      "vendor/wllama-opfs.js",
    ]);
    for (const [filename, source] of assets) {
      expect(() => new Script(source, { filename })).not.toThrow();
    }
    for (const name of ["wllama", "wllama-compat"]) {
      expect(assets.get(`vendor/${name}-worker.js`)).toContain(`// Native fixture: ${name}`);
      expect(assets.get(`vendor/${name}-pthread.js`)).toContain(`// Native fixture: ${name}`);
    }
    expect(moduleCode).toContain('new URL("wllama-pthread.js", this.resources.wasmPath).href');
    expect(moduleCode).not.toContain("this.worker = createWorker(completeCode)");
    expect(moduleCode).not.toContain("createWorker(OPFS_UTILS_WORKER_CODE)");
    expect(moduleCode).not.toContain('new Blob([moduleCode], { type: "text/javascript" })');
  });

  it.each([false, true])("initializes the bundled runtime when compat is %s", async (compat) => {
    const { moduleCode } = buildRuntime();
    const postMessage = vi.fn();
    const worker = vi.fn(function () {
      return { postMessage };
    });
    const pushTask = vi.fn().mockResolvedValue("ready");
    const base = "chrome-extension://test/";
    const resources = {
      compat,
      wasmPath: `${base}vendor/wllama${compat ? "-compat" : ""}.wasm`,
      ...(compat ? { jsPath: `${base}vendor/wllama-compat-worker.js` } : {}),
      noWebGPU: true,
    };
    const initialize = (resources: unknown): Promise<unknown> =>
      runInNewContext(
        moduleCode.replace(/export \{[\s\S]*?\};\s*$/, "") +
          `
        const proxy = new ProxyToWorker(resources, 2, false, console);
        proxy.pushTask = pushTask;
        proxy.moduleInit([]);
      `,
        {
          resources,
          pushTask,
          Worker: worker,
          URL,
          TextDecoder,
          TextEncoder,
          location: { href: `${base}offscreen.html` },
          navigator: {},
          WebAssembly: compat ? {} : { Suspending: function () {}, promising: function () {} },
          console,
        },
      );
    await expect(initialize(resources)).resolves.toBe("ready");
    expect(worker).toHaveBeenCalledWith(
      `${base}vendor/wllama${compat ? "-compat" : ""}-worker.js`,
      { type: "module" },
    );
    expect(postMessage).toHaveBeenCalledWith({
      pathConfig: { "wllama.wasm": resources.wasmPath },
      nbThread: 2,
      compat,
      noWebGPU: true,
    });
    expect(pushTask).toHaveBeenCalledWith({
      verb: "module.init",
      args: [`${base}vendor/wllama${compat ? "-compat" : ""}-pthread.js`, true],
      callbackId: 1,
    });
    await expect(
      initialize({ ...resources, jsPath: "https://example.com/worker.js" }),
    ).rejects.toThrow("Unsupported translation runtime resources");
    if (compat) {
      await expect(
        initialize({ ...resources, wasmPath: "https://example.com/wllama-compat.wasm" }),
      ).rejects.toThrow("Unsupported translation runtime resources");
      await expect(initialize({ ...resources, jsPath: { code: "remote code" } })).rejects.toThrow(
        "Unsupported translation runtime resources",
      );
    }
  });

  it.each([false, true])(
    "initializes the static worker message handler synchronously before the next task (compat: %s)",
    async (compat) => {
      const { assets } = buildRuntime();
      const worker = assets.get(`vendor/wllama${compat ? "-compat" : ""}-worker.js`);
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
      configure({ data: { pathConfig: {}, nbThread: 4, compat } });
      expect(workerGlobal.onmessage).not.toBe(configure);
      await workerGlobal.onmessage?.({ data: { verb: "test" } });
      expect(workerGlobal.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ verb: "console.error" }),
        undefined,
      );
    },
  );

  it("fails instead of shipping a partial patch when the pinned runtime changes", () => {
    expect(() =>
      buildRuntime(sdkSource.replace("createWorker(OPFS_UTILS_WORKER_CODE)", "changed()")),
    ).toThrow("Unsupported @wllama/wllama source");
    expect(() =>
      buildRuntime(sdkSource.replace("let moduleCode = JSPI_STUB", "let changed = JSPI_STUB")),
    ).toThrow("Missing @wllama/wllama worker initialization");
  });

  it.each(NATIVE_FILES)("rejects a one-byte change to %s", (file) => {
    withNativeCopy((directory) => {
      const path = join(directory, file);
      const bytes = readFileSync(path);
      bytes[bytes.length - 1] = bytes.readUInt8(bytes.length - 1) ^ 1;
      writeFileSync(path, bytes);
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
        `Native build artifact hash mismatch: ${file}`,
      );
    });
  });

  it("rejects an SDK compiled for another llama.cpp commit", () => {
    expect(() =>
      buildRuntime(
        sdkSource.replace(/^var LIBLLAMA_VERSION = .*;$/m, 'var LIBLLAMA_VERSION = "b1-0000000";'),
      ),
    ).toThrow("SDK llama.cpp version does not match pinned native build");
  });

  it("rejects a native manifest built for another SDK commit", () => {
    withNativeCopy((directory) => {
      writeFileSync(
        join(directory, "build.json"),
        JSON.stringify({ ...manifest, wllama: { ...manifest.wllama, commit: "0".repeat(40) } }),
      );
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
        "Native build does not match pinned SDK/native toolchain",
      );
    });
  });

  it("rejects native artifacts built with different patches", () => {
    withNativeCopy((directory) => {
      writeFileSync(join(directory, "build.json"), JSON.stringify({ ...manifest, patches: [] }));
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
        "Native build patch hashes do not match current patches",
      );
    });
  });

  it("rejects native artifacts built with a different recipe", () => {
    withNativeCopy((directory) => {
      writeFileSync(
        join(directory, "build.json"),
        JSON.stringify({ ...manifest, buildScriptSha256: "0".repeat(64) }),
      );
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
        "Native build does not match pinned SDK/native toolchain",
      );
    });
  });

  it("rejects an invalid manifest before using its artifact paths", () => {
    withNativeCopy((directory) => {
      writeFileSync(join(directory, "build.json"), JSON.stringify({ ...manifest, files: null }));
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
        "Invalid native build manifest object",
      );
    });
  });

  it("fails when native artifacts are missing", () => {
    withNativeCopy((directory) => {
      rmSync(join(directory, "wllama.js"));
      expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(/ENOENT/);
    });
  });

  it.each(["wllama.wasm", "wllama-compat.wasm"] as const)(
    "rejects another llama.cpp commit inside %s even when its hash matches",
    (file) => {
      withNativeCopy((directory) => {
        const path = join(directory, file);
        const bytes = readFileSync(path);
        const version = bytes.indexOf(Buffer.from(`-${LLAMA_CPP_COMMIT.slice(0, 7)}"`));
        expect(version).toBeGreaterThan(-1);
        bytes[version + 1] = "0".charCodeAt(0);
        writeFileSync(path, bytes);
        writeFileSync(
          join(directory, "build.json"),
          JSON.stringify({
            ...manifest,
            files: { ...manifest.files, [file]: { bytes: bytes.length, sha256: sha256(bytes) } },
          }),
        );
        expect(() => buildTranslationRuntime(sdkSource, directory)).toThrow(
          `Native WASM version does not match pinned llama.cpp: ${file}`,
        );
      });
    },
  );
});
