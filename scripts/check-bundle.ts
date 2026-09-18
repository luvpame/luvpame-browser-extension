import assert from "node:assert/strict";
import { readdir, readFile, access } from "node:fs/promises";
import path from "node:path";
const root = path.resolve("dist/chrome-mv3");
const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.action.default_popup, "popup.html");
assert.equal(manifest.options_ui.page, "options.html");
assert.deepEqual(
  [...manifest.permissions].sort(),
  ["storage", "activeTab", "scripting", "clipboardWrite", "notifications", "offscreen"].sort(),
);
assert.equal(manifest.content_scripts.length, 4);
for (const file of [
  "offscreen.html",
  "options.html",
  "popup.html",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((script: { js: string[]; css?: string[] }) => [
    ...script.js,
    ...(script.css ?? []),
  ]),
])
  await access(path.join(root, file));
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
