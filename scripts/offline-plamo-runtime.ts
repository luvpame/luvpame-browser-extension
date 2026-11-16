import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { buildTranslationRuntime } from "./translation-runtime";

const packageEntry = join(
  dirname(createRequire(import.meta.url).resolve("@wllama/wllama")),
  "index.js",
);
const virtualModule = "offline-plamo-native";

export function buildOfflinePlamoRuntime(
  source = readFileSync(packageEntry, "utf8"),
  nativeBuildDirectory?: string,
) {
  const { nativeBuild } = buildTranslationRuntime(source, nativeBuildDirectory);
  const compatSelection = "var needCompat = () => !isSupportJSPI() || !isSupportMem64();";
  if (source.split(compatSelection).length !== 2)
    throw new Error("Unsupported @wllama/wllama compatibility selection");
  const normalSelection = "return WLLAMA_EMSCRIPTEN_CODE;";
  if (source.split(normalSelection).length !== 2)
    throw new Error("Unsupported @wllama/wllama native worker selection");
  const embeddedNativeCode = (name: "wllama" | "wllama-compat") => {
    const emscripten = nativeBuild.files[`${name}.js`].toString("utf8");
    if (!emscripten.startsWith("var Module=") || !emscripten.includes('Module["wasmBinary"]'))
      throw new Error("Unsupported offline Emscripten initialization");
    const wasm = nativeBuild.files[`${name}.wasm`].toString("base64");
    return (
      `Module.wasmBinary = Uint8Array.from(atob(${JSON.stringify(wasm)}), c => c.charCodeAt(0));\n` +
      emscripten
    );
  };
  const nativeCode = embeddedNativeCode("wllama");
  const compatNativeCode = embeddedNativeCode("wllama-compat");
  return {
    moduleCode: source.replace(normalSelection, () => `return ${JSON.stringify(nativeCode)};`),
    nativeCode,
    compatNativeCode,
  };
}

export function createOfflinePlamoPlugin(): Plugin {
  const { moduleCode, compatNativeCode } = buildOfflinePlamoRuntime();
  return {
    name: "offline-plamo-runtime",
    enforce: "pre",
    config: () => ({ optimizeDeps: { exclude: ["@wllama/wllama"] } }),
    resolveId(id) {
      if (id === virtualModule) return `\0${virtualModule}`;
    },
    load(id) {
      if (id === `\0${virtualModule}`)
        return `export const compatNativeCode = ${JSON.stringify(compatNativeCode)};`;
    },
    transform(_code, id) {
      if (id.split("?")[0] === packageEntry) return { code: moduleCode, map: null };
    },
  };
}
