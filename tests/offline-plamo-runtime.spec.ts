import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { Script, runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vite-plus/test";
import { buildOfflinePlamoRuntime } from "../scripts/offline-plamo-runtime";
import { nativeDirectory, sha256 } from "../scripts/wllama/artifacts";

const packageEntry = join(
  dirname(createRequire(import.meta.url).resolve("@wllama/wllama")),
  "index.js",
);
const sdkSource = readFileSync(packageEntry, "utf8");
const compatibilitySelection = "var needCompat = () => !isSupportJSPI() || !isSupportMem64();";

describe("offline PLaMo runtime", () => {
  it.each(["wllama", "wllama-compat"] as const)(
    "embeds verified %s WASM while preserving the SDK capability selection",
    (name) => {
      const runtime = buildOfflinePlamoRuntime();
      const nativeCode = name === "wllama" ? runtime.nativeCode : runtime.compatNativeCode;
      expect(runtime.moduleCode).toContain(compatibilitySelection);
      const prefix = nativeCode.slice(0, nativeCode.indexOf("\nvar Module="));
      const module = { wasmBinary: new Uint8Array() };
      runInNewContext(prefix, { Module: module, Uint8Array, atob });
      expect(sha256(module.wasmBinary)).toBe(
        sha256(readFileSync(join(nativeDirectory, `${name}.wasm`))),
      );
      expect(nativeCode.slice(prefix.length + 1)).toBe(
        readFileSync(join(nativeDirectory, `${name}.js`), "utf8"),
      );
    },
  );

  it.each([false, true])(
    "creates an embedded worker without fetching resources when compat is %s",
    async (compat) => {
      const runtime = buildOfflinePlamoRuntime();
      const nativeCode = compat ? runtime.compatNativeCode : runtime.nativeCode;
      const blobs: Blob[] = [];
      const fetch = vi.fn(() => {
        throw new Error("Unexpected network request");
      });
      const worker = vi.fn(function () {});
      const url = class extends URL {
        static override createObjectURL(blob: Blob) {
          blobs.push(blob);
          return "blob:offline-worker";
        }
      };
      await runInNewContext(
        runtime.moduleCode.replace(/export \{[\s\S]*?\};\s*$/, "") +
          `
        const proxy = new ProxyToWorker({
          jsPath: compat ? { code: nativeCode } : undefined,
          wasmPath: "https://linear.app/offline-plamo.wasm",
          compat,
          noWebGPU: false
        }, 0, false, console);
        proxy.pushTask = async () => "ready";
        proxy.moduleInit([]);
      `,
        {
          compat,
          nativeCode,
          fetch,
          Worker: worker,
          URL: url,
          Blob,
          TextDecoder,
          TextEncoder,
          navigator: {},
          WebAssembly: {},
          console,
        },
      );
      expect(fetch).not.toHaveBeenCalled();
      expect(worker).toHaveBeenCalledWith("blob:offline-worker", { type: "module" });
      expect(blobs).toHaveLength(1);
      const blob = blobs[0];
      if (!blob) throw new Error("Offline worker was not created");
      const workerSource = await blob.text();
      expect(workerSource).toContain(nativeCode.replace("var Module", "var ___Module"));
      expect(() => new Script(workerSource)).not.toThrow();
    },
  );

  it("rejects SDK changes instead of silently using an unverified native runtime", () => {
    for (const selection of [compatibilitySelection, "return WLLAMA_EMSCRIPTEN_CODE;"]) {
      expect(() => buildOfflinePlamoRuntime(sdkSource.replace(selection, ""))).toThrow(
        /Unsupported @wllama\/wllama/,
      );
      expect(() =>
        buildOfflinePlamoRuntime(sdkSource.replace(selection, selection.repeat(2))),
      ).toThrow(/Unsupported @wllama\/wllama/);
    }
  });
});
