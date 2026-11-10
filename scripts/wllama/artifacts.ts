import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DAWN_SHA256,
  DAWN_TAG,
  EMSDK_VERSION,
  LLAMA_CPP_COMMIT,
  NATIVE_FILES,
  WLLAMA_COMMIT,
  WLLAMA_VERSION,
} from "./pins";

export type NativeFile = (typeof NATIVE_FILES)[number];
export type BuildManifest = {
  schemaVersion: 1;
  buildScriptSha256: string;
  wllama: { version: string; commit: string };
  llamaCpp: { commit: string };
  emscripten: { version: string; image: string; digest: string };
  dawn: { tag: string; sha256: string };
  patches: { file: string; sha256: string }[];
  files: Record<NativeFile, { bytes: number; sha256: string }>;
};

const scriptsDirectory = dirname(fileURLToPath(import.meta.url));
export const nativeDirectory = resolve(scriptsDirectory, "../../vendor/wllama");
const patchesDirectory = join(scriptsDirectory, "patches");
export const sha256 = (data: string | Uint8Array): string =>
  createHash("sha256").update(data).digest("hex");

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Invalid native build manifest object");
  return value as Record<string, unknown>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value.length)
    throw new Error("Invalid native build manifest string");
  return value;
}

function hash(value: unknown): string {
  const result = string(value);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new Error("Invalid native build manifest SHA-256");
  return result;
}

export function parseBuildManifest(input: unknown): BuildManifest {
  const value = object(input);
  const wllama = object(value.wllama);
  const llamaCpp = object(value.llamaCpp);
  const emscripten = object(value.emscripten);
  const dawn = object(value.dawn);
  const files = object(value.files);
  if (value.schemaVersion !== 1 || !Array.isArray(value.patches))
    throw new Error("Unsupported native build manifest schema");
  const digest = string(emscripten.digest);
  if (!/^sha256:[a-f0-9]{64}$/.test(digest))
    throw new Error("Invalid native build manifest image digest");
  const file = (name: NativeFile) => {
    const entry = object(files[name]);
    if (typeof entry.bytes !== "number" || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0)
      throw new Error(`Invalid native build manifest size: ${name}`);
    return { bytes: entry.bytes, sha256: hash(entry.sha256) };
  };
  return {
    schemaVersion: 1,
    buildScriptSha256: hash(value.buildScriptSha256),
    wllama: { version: string(wllama.version), commit: string(wllama.commit) },
    llamaCpp: { commit: string(llamaCpp.commit) },
    emscripten: { version: string(emscripten.version), image: string(emscripten.image), digest },
    dawn: { tag: string(dawn.tag), sha256: hash(dawn.sha256) },
    patches: value.patches.map((input: unknown) => {
      const patch = object(input);
      return { file: string(patch.file), sha256: hash(patch.sha256) };
    }),
    files: {
      "wllama.js": file("wllama.js"),
      "wllama.wasm": file("wllama.wasm"),
      "wllama-compat.js": file("wllama-compat.js"),
      "wllama-compat.wasm": file("wllama-compat.wasm"),
    },
  };
}

export function readNativeBuild(directory = nativeDirectory) {
  const input: unknown = JSON.parse(readFileSync(join(directory, "build.json"), "utf8"));
  const manifest = parseBuildManifest(input);
  if (
    manifest.buildScriptSha256 !==
      sha256(readFileSync(join(scriptsDirectory, "build-native.sh"))) ||
    manifest.wllama.version !== WLLAMA_VERSION ||
    manifest.wllama.commit !== WLLAMA_COMMIT ||
    manifest.llamaCpp.commit !== LLAMA_CPP_COMMIT ||
    manifest.emscripten.version !== EMSDK_VERSION ||
    manifest.dawn.tag !== DAWN_TAG ||
    manifest.dawn.sha256 !== DAWN_SHA256
  )
    throw new Error("Native build does not match pinned SDK/native toolchain");
  const patches = readdirSync(patchesDirectory)
    .filter((file) => file.endsWith(".patch"))
    .sort()
    .map((file) => ({ file, sha256: sha256(readFileSync(join(patchesDirectory, file))) }));
  if (JSON.stringify(manifest.patches) !== JSON.stringify(patches))
    throw new Error("Native build patch hashes do not match current patches");
  const read = (name: NativeFile) => {
    const data = readFileSync(join(directory, name));
    if (data.length !== manifest.files[name].bytes || sha256(data) !== manifest.files[name].sha256)
      throw new Error(`Native build artifact hash mismatch: ${name}`);
    if (name.endsWith(".wasm")) {
      const version = data.toString("latin1").match(/"version":"b\d+-([0-9a-f]+)"/)?.[1];
      if (version !== LLAMA_CPP_COMMIT.slice(0, 7))
        throw new Error(`Native WASM version does not match pinned llama.cpp: ${name}`);
    }
    return data;
  };
  const files = {
    "wllama.js": read("wllama.js"),
    "wllama.wasm": read("wllama.wasm"),
    "wllama-compat.js": read("wllama-compat.js"),
    "wllama-compat.wasm": read("wllama-compat.wasm"),
  };
  return { manifest, files };
}
