import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite-plus";
import { createOfflinePlamoPlugin } from "./offline-plamo-runtime";

const browserModule = "\0linear-offline-browser";
await build({
  configFile: false,
  publicDir: false,
  plugins: [
    createOfflinePlamoPlugin(),
    {
      name: "linear-offline-browser",
      resolveId(id) {
        if (id === "wxt/browser") return browserModule;
      },
      load(id) {
        if (id === browserModule)
          return `export const browser = { runtime: { sendMessage() { throw new Error('拡張機能への接続は使用しません。'); } } };`;
      },
    },
  ],
  build: {
    outDir: "dist/linear-offline",
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: {
      entry: resolve("features/linear-review-guide/offline-app.ts"),
      formats: ["es"],
      fileName: () => "linear-offline.js",
    },
  },
});

await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: "dist/linear-offline",
    emptyOutDir: false,
    target: "es2022",
    minify: false,
    lib: {
      entry: resolve("scripts/linear-offline/launcher.ts"),
      formats: ["iife"],
      name: "LinearOfflineLauncher",
      fileName: () => "launcher.js",
    },
  },
});

await build({
  configFile: false,
  publicDir: false,
  build: {
    outDir: "dist/linear-offline",
    emptyOutDir: false,
    target: "es2022",
    minify: true,
    lib: {
      entry: resolve("features/linear-review-guide/offline-persistence.ts"),
      formats: ["iife"],
      name: "LuvpameOfflineRestore",
      fileName: () => "restore.js",
    },
  },
});

const launcher = await readFile(resolve("dist/linear-offline/launcher.js"), "utf8");
await writeFile(
  resolve("dist/linear-offline/setup.js"),
  "(async () => {\n  await globalThis.luvpameLinearOfflineGuide?.stop();\n" +
    launcher +
    "\n})();\n",
);
