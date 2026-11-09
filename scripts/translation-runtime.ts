import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import type { Plugin } from "vite";

const packageEntry = join(
  dirname(createRequire(import.meta.url).resolve("@wllama/wllama")),
  "index.js",
);
const packageDirectory = dirname(packageEntry);
const compatDirectory = dirname(createRequire(import.meta.url).resolve("@wllama/wllama-compat"));
const workerUrl = (filename: string) => `new URL("${filename}", this.resources.wasmPath).href`;

function replaceOnce(source: string, search: string, replacement: string): string {
  if (source.split(search).length !== 2) {
    throw new Error(`Unsupported @wllama/wllama source: ${search.slice(0, 80)}`);
  }
  return source.replace(search, () => replacement);
}

function literal(source: string, name: string): string {
  const expression = source.match(new RegExp(`^var ${name} = (.*);$`, "m"))?.[1];
  if (!expression) throw new Error(`Missing @wllama/wllama constant: ${name}`);
  const value: unknown = runInNewContext(`(${expression})`, {}, { timeout: 1000 });
  if (typeof value !== "string") throw new Error(`Invalid @wllama/wllama constant: ${name}`);
  return value;
}

export function buildTranslationRuntime(source = readFileSync(packageEntry, "utf8")) {
  if (
    !readFileSync(join(packageDirectory, "../package.json"), "utf8").includes(
      '"version": "3.13.0"',
    ) ||
    !readFileSync(join(compatDirectory, "package.json"), "utf8").includes('"version": "3.13.0"')
  ) {
    throw new Error(
      "The translation runtime requires @wllama/wllama and @wllama/wllama-compat 3.13.0",
    );
  }
  const stub = source.match(/^var JSPI_STUB = `([\s\S]*?)`;$/m)?.[1];
  if (!stub) throw new Error("Missing @wllama/wllama JSPI stub");
  const emscripten = literal(source, "WLLAMA_EMSCRIPTEN_CODE");
  const compatEmscripten = readFileSync(join(compatDirectory, "wasm/wllama.js"), "utf8");
  const worker = literal(source, "LLAMA_CPP_WORKER_CODE");
  const opfs = literal(source, "OPFS_UTILS_WORKER_CODE");
  const initStart = "      let moduleCode = JSPI_STUB + (yield this.getModuleCode());";
  const initEnd = "      const nativeFiles = [];";
  const start = source.indexOf(initStart);
  const end = source.indexOf(initEnd, start);
  if (start < 0 || end < 0) throw new Error("Missing @wllama/wllama worker initialization");
  const initialization = `      const compat = this.resources.compat;
      if (compat
        ? this.resources.jsPath !== new URL("vendor/wllama-compat-worker.js", globalThis.location.href).href ||
          this.resources.wasmPath !== new URL("vendor/wllama-compat.wasm", globalThis.location.href).href
        : this.resources.jsPath) {
        throw new Error("Unsupported translation runtime resources");
      }
      this.worker = new Worker(compat ? ${workerUrl("wllama-compat-worker.js")} : ${workerUrl("wllama-worker.js")}, { type: "module" });
      this.worker.onmessage = this.onRecvMsg.bind(this);
      this.worker.onerror = this.logger.error;
      this.worker.postMessage({
        pathConfig: { "wllama.wasm": this.resources.wasmPath },
        nbThread: this.nbThread,
        compat,
        noWebGPU: this.resources.noWebGPU
      });
      const res = yield this.pushTask({
        verb: "module.init",
        args: [compat ? ${workerUrl("wllama-compat-pthread.js")} : ${workerUrl("wllama-pthread.js")}, this.useAsyncFile],
        callbackId: this.taskId++
      });
`;
  let moduleCode = replaceOnce(source, source.slice(start, end), initialization);
  moduleCode = replaceOnce(
    moduleCode,
    "createWorker(OPFS_UTILS_WORKER_CODE)",
    'new Worker(new URL("vendor/wllama-opfs.js", globalThis.location.href).href, { type: "module" })',
  );
  // MV3 forbids executable Blob URLs, including workers created inside Emscripten.
  const assets = new Map<string, string>();
  for (const [name, code] of [
    ["wllama", emscripten],
    ["wllama-compat", compatEmscripten],
  ] satisfies [string, string][]) {
    const mainEmscripten = replaceOnce(code, "var Module", "var ___Module");
    assets.set(
      `vendor/${name}-worker.js`,
      `self.onmessage = ({ data: RUN_OPTIONS }) => {
function wModuleInit() {
  if (RUN_OPTIONS.noWebGPU) {
    Object.defineProperty(WorkerNavigator.prototype, "gpu", { get: () => ({ requestAdapter: async () => null }) });
  }
${stub}\n${mainEmscripten}; return Module;
}
${worker}
};`,
    );
    assets.set(`vendor/${name}-pthread.js`, `${stub}\n${code}`);
  }
  assets.set("vendor/wllama-opfs.js", opfs);
  for (const [filename, code] of assets) {
    assets.set(
      filename,
      code.replace(/[\u0080-\u{10ffff}]/gu, (character) => {
        const point = character.codePointAt(0)!;
        if (!(point >= 0xfdd0 && point <= 0xfdef) && (point & 0xffff) < 0xfffe) return character;
        return character
          .split("")
          .map((unit) => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"))
          .join("");
      }),
    );
  }
  return { moduleCode, assets };
}

export function createTranslationRuntimePlugin(): Plugin {
  const { moduleCode, assets } = buildTranslationRuntime();
  const wasmAssets = new Map([
    ["vendor/wllama.wasm", join(packageDirectory, "wasm/wllama.wasm")],
    ["vendor/wllama-compat.wasm", join(compatDirectory, "wasm/wllama.wasm")],
  ]);
  return {
    name: "translation-runtime",
    enforce: "pre",
    config: () => ({ optimizeDeps: { exclude: ["@wllama/wllama"] } }),
    transform(_code, id) {
      if (id.split("?")[0] === packageEntry) return { code: moduleCode, map: null };
    },
    generateBundle(_options, bundle) {
      if (
        !Object.values(bundle).some(
          (output) => output.type === "chunk" && packageEntry in output.modules,
        )
      )
        return;
      for (const [fileName, source] of assets) this.emitFile({ type: "asset", fileName, source });
      for (const [fileName, path] of wasmAssets)
        this.emitFile({ type: "asset", fileName, source: readFileSync(path) });
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const pathname = request.url?.split("?")[0]?.slice(1);
        if (!pathname) return next();
        const wasmPath = wasmAssets.get(pathname);
        if (wasmPath) {
          response.setHeader("Content-Type", "application/wasm");
          response.end(readFileSync(wasmPath));
        } else if (assets.has(pathname)) {
          response.setHeader("Content-Type", "text/javascript");
          response.end(assets.get(pathname));
        } else next();
      });
    },
  };
}
