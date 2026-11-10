import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { parseBuildManifest, readNativeBuild, sha256 } from "./wllama/artifacts";
const root = path.resolve("dist/chrome-mv3");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.action.default_popup, "popup.html");
assert.equal(manifest.options_ui.page, "options.html");
assert.deepEqual(
  [...manifest.permissions].sort(),
  [
    "storage",
    "activeTab",
    "scripting",
    "clipboardWrite",
    "notifications",
    "offscreen",
    "contextMenus",
    "sidePanel",
  ].sort(),
);
assert.deepEqual(
  [...manifest.host_permissions].sort(),
  [
    "https://github.com/*",
    "https://huggingface.co/*",
    "https://*.hf.co/*",
    "http://localhost/*",
  ].sort(),
);
assert.equal(manifest.content_scripts.length, 4);
assert.equal(manifest.side_panel.default_path, "sidepanel.html");
for (const [command, key] of [
  ["toggle-page-translation", "Alt+A"],
  ["toggle-page-replacement-translation", "Alt+Shift+A"],
  ["open-easy-article", "Alt+B"],
] as const) {
  assert.equal(manifest.commands[command].suggested_key.default, key);
  assert.equal(manifest.commands[command].suggested_key.mac, key);
}
assert(
  Object.values(manifest.commands).filter(
    (command) => typeof command === "object" && command !== null && "suggested_key" in command,
  ).length <= 4,
);
assert(manifest.content_security_policy.extension_pages.includes("'wasm-unsafe-eval'"));
for (const file of [
  "offscreen.html",
  "options.html",
  "popup.html",
  "sidepanel.html",
  "vendor/wllama.wasm",
  "vendor/wllama-worker.js",
  "vendor/wllama-pthread.js",
  "vendor/wllama-compat.wasm",
  "vendor/wllama-compat-worker.js",
  "vendor/wllama-compat-pthread.js",
  "vendor/wllama-opfs.js",
  "vendor/wllama-build.json",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((script: { js: string[]; css?: string[] }) => [
    ...script.js,
    ...(script.css ?? []),
  ]),
])
  await access(path.join(root, file));
const buildInput: unknown = JSON.parse(
  await readFile(path.join(root, "vendor/wllama-build.json"), "utf8"),
);
const nativeManifest = parseBuildManifest(buildInput);
assert.deepEqual(nativeManifest, readNativeBuild().manifest, "Native build provenance mismatch");
for (const name of ["wllama.wasm", "wllama-compat.wasm"] as const) {
  const wasm = await readFile(path.join(root, "vendor", name));
  assert.equal(wasm.length, nativeManifest.files[name].bytes, `Native WASM size mismatch: ${name}`);
  assert.equal(
    sha256(wasm),
    nativeManifest.files[name].sha256,
    `Native WASM hash mismatch: ${name}`,
  );
}
const walk = async (directory: string): Promise<string[]> =>
  (
    await Promise.all(
      (
        await readdir(directory, { withFileTypes: true })
      ).map((entry) =>
        entry.isDirectory()
          ? walk(path.join(directory, entry.name))
          : [path.join(directory, entry.name)],
      ),
    )
  ).flat();
const files = await walk(root);
assert(files.some((file) => file.endsWith(".js")));
for (const file of files) {
  assert(!file.endsWith(".map"), `Source map in distribution: ${file}`);
  if (!/\.(js|html)$/.test(file)) continue;
  const source = await readFile(file, "utf8");
  if (file.endsWith(".html")) {
    assert(!/\brel\s*=\s*["']modulepreload["']/i.test(source), `modulepreload: ${file}`);
    assert(!/<script[^>]+src=["']https?:/i.test(source), `remote script: ${file}`);
  } else {
    assert(!/\beval\s*\(|\bnew\s+Function\b/.test(source), `dynamic code: ${file}`);
    assert(!/\b(?:import|importScripts)\s*\(\s*["']https?:/.test(source), `remote import: ${file}`);
    for (const character of source) {
      const point = character.codePointAt(0)!;
      assert(
        !(point >= 0xfdd0 && point <= 0xfdef) && (point & 0xffff) < 0xfffe,
        `Unicode noncharacter in ${file}`,
      );
    }
  }
}
console.log(`Manifest and ${files.length} distribution files verified.`);
