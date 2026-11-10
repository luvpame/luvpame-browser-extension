import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  WLLAMA_VERSION,
  WLLAMA_COMMIT,
  LLAMA_CPP_COMMIT,
  EMSDK_VERSION,
  DAWN_TAG,
  DAWN_SHA256,
  NATIVE_FILES,
} from "./pins";
import { parseBuildManifest, readNativeBuild, sha256 } from "./artifacts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const patchDirectory = join(root, "scripts/wllama/patches");
const directory = await mkdtemp(join(tmpdir(), "luvpame-wllama-"));
const image = `emscripten/emsdk:${EMSDK_VERSION}${process.arch === "arm64" ? "-arm64" : ""}`;
console.log(`Building pinned translation WASM in ${directory}`);

function run(command: string, args: string[], capture = false): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: directory,
      stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit",
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    let output = "";
    child.stdout?.on("data", (data: Buffer) => (output += data.toString()));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(output.trim());
      else reject(new Error(`${command} failed with exit code ${code}`));
    });
  });
}

await run("git", ["init", "--quiet"]);
await run("git", ["remote", "add", "origin", "https://github.com/ngxson/wllama.git"]);
await run("git", ["fetch", "--depth", "1", "origin", WLLAMA_COMMIT]);
await run("git", ["checkout", "--detach", WLLAMA_COMMIT]);
await run("git", ["submodule", "update", "--init", "--depth", "1", "llama.cpp"]);
assert.equal(await run("git", ["rev-parse", "HEAD"], true), WLLAMA_COMMIT);
assert.equal(await run("git", ["-C", "llama.cpp", "rev-parse", "HEAD"], true), LLAMA_CPP_COMMIT);

const patches = [];
for (const file of (await readdir(patchDirectory))
  .filter((file) => file.endsWith(".patch"))
  .sort()) {
  const path = join(patchDirectory, file);
  await run("git", ["apply", "--check", path]);
  await run("git", ["apply", path]);
  patches.push({ file, sha256: sha256(await readFile(path)) });
}
assert.equal(patches.length, 3);

const dawn = await fetch(
  `https://github.com/google/dawn/releases/download/${DAWN_TAG}/emdawnwebgpu_pkg-${DAWN_TAG}.zip`,
);
assert(dawn.ok, `Dawn download failed with ${dawn.status}`);
const dawnZip = Buffer.from(await dawn.arrayBuffer());
assert.equal(sha256(dawnZip), DAWN_SHA256, "Dawn archive checksum mismatch");
await writeFile(join(directory, "dawn.zip"), dawnZip);
await copyFile(join(root, "scripts/wllama/build-native.sh"), join(directory, "build-native.sh"));
await run("docker", ["pull", image]);
const digest = await run(
  "docker",
  ["image", "inspect", "--format", "{{index .RepoDigests 0}}", image],
  true,
);
const digestHash = digest.split("@")[1];
assert(digestHash?.match(/^sha256:[0-9a-f]{64}$/), "Missing Emscripten image digest");
await run("docker", [
  "run",
  "--rm",
  "--mount",
  `type=bind,source=${directory},target=/source`,
  "--workdir",
  "/source",
  image,
  "bash",
  "/source/build-native.sh",
]);

const files = Object.fromEntries(
  await Promise.all(
    NATIVE_FILES.map(async (file) => {
      const data = await readFile(join(directory, "output", file));
      assert(
        data.byteLength > (file.endsWith(".wasm") ? 4 * 1024 * 1024 : 50_000),
        `${file} is incomplete`,
      );
      return [file, { bytes: data.byteLength, sha256: sha256(data) }];
    }),
  ),
);
const manifest = parseBuildManifest({
  schemaVersion: 1,
  wllama: { version: WLLAMA_VERSION, commit: WLLAMA_COMMIT },
  llamaCpp: { commit: LLAMA_CPP_COMMIT },
  emscripten: { version: EMSDK_VERSION, image, digest: digestHash },
  dawn: { tag: DAWN_TAG, sha256: DAWN_SHA256 },
  buildScriptSha256: sha256(await readFile(join(root, "scripts/wllama/build-native.sh"))),
  patches,
  files,
});
await writeFile(join(directory, "output/build.json"), JSON.stringify(manifest, null, 2) + "\n");
readNativeBuild(join(directory, "output"));
await mkdir(join(root, "vendor/wllama"), { recursive: true });
for (const file of [...NATIVE_FILES, "build.json"]) {
  const temporary = join(root, "vendor/wllama", `${file}.tmp`);
  await copyFile(join(directory, "output", file), temporary);
  await rename(temporary, join(root, "vendor/wllama", file));
}
readNativeBuild();
console.log("Pinned source, SIMD kernels, native versions and output hashes verified.");
