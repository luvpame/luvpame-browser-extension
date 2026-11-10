import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTranslationRuntime } from "./translation-runtime";

// Run with Bun; the repository intentionally does not install Bun's ambient types.
declare const Bun: {
  build(options: {
    entrypoints: string[];
    target: string;
    format: string;
    define: Record<string, string>;
    plugins: {
      name: string;
      setup(build: {
        onResolve(
          filter: { filter: RegExp },
          callback: (args: { path: string }) => { path: string; namespace: string },
        ): void;
        onLoad(
          filter: { filter: RegExp; namespace?: string },
          callback: (args: {
            path: string;
          }) =>
            | Promise<{ contents: string; loader: string } | undefined>
            | { contents: string; loader: string }
            | undefined,
        ): void;
      }): void;
    }[];
  }): Promise<{ success: boolean; logs: unknown[]; outputs: { text(): Promise<string> }[] }>;
  file(path: string): Blob & { exists(): Promise<boolean> };
  serve(options: { hostname: string; port: number; fetch(request: Request): Promise<Response> }): {
    url: URL;
  };
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "scripts/translation-benchmark");
const outputRoot = resolve(process.env.BENCH_DIRECTORY ?? "/tmp/luvpame-translation-benchmark");
const baseline = "08a37fc2e0c743ddc1c4a899c69f835cc77b7da0";
const option = (name: string) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  assert(
    process.argv[index + 1] && !process.argv[index + 1]!.startsWith("--"),
    `${name} requires a value`,
  );
  return process.argv[index + 1];
};
const modelName = option("--model") ?? "0.8b";
assert(modelName === "0.8b" || modelName === "2b", "--model must be 0.8b or 2b");
const model =
  option("--model-file") ?? process.env.BENCH_MODEL ?? "/tmp/luvpame-wasm-task/plamo-0.8b.gguf";
assert(
  modelName === "0.8b" || option("--model-file") || process.env.BENCH_MODEL,
  "2b requires --model-file",
);
const origin = "http://127.0.0.1:8817";
const command = process.argv[2] ?? "build";
assert(
  ["build", "serve", "selfcheck"].includes(command),
  "Use: bun scripts/bench-browser-translation.ts [build|serve|selfcheck] [--model 0.8b|2b] [--model-file path] [--candidate-model-file path]",
);
const modelFiles = {
  baseline: await realpath(model),
  current: await realpath(option("--candidate-model-file") ?? model),
};
const hashes = new Map<string, string>();
for (const path of new Set(Object.values(modelFiles))) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  hashes.set(path, hash.digest("hex"));
}
const hashFor = (variant: "baseline" | "current") => {
  const hash = hashes.get(modelFiles[variant]);
  assert(hash);
  return hash;
};
const modelFilesByHash = new Map([...hashes].map(([path, hash]) => [hash, path]));

function replaceModelUrl(source: string, url: string) {
  const factory =
    /^const modelUrl = \(model: TranslationModel\) =>[\s\S]*?;(?=\n\nasync function canUseGpu\()/gm;
  const matches = [...source.matchAll(factory)];
  assert.equal(matches.length, 1, "Expected exactly one modelUrl factory before canUseGpu");
  const match = matches[0]!;
  const prefix = source.slice(0, match.index);
  const suffix = source.slice(match.index + match[0].length);
  return `${prefix}const modelUrl = (_model: TranslationModel) => ${JSON.stringify(url)};${suffix}`;
}
for (const factory of [
  "const modelUrl = (model: TranslationModel) =>\n  `https://example.com/${model}-Q4_K_M.gguf`;",
  'const modelUrl = (model: TranslationModel) => {\n  const quant = model === "0.8b" ? "Q4_0" : "Q4_K_M";\n  return `https://example.com/${model}-${quant}.gguf`;\n};',
]) {
  const suffix = "\n\nasync function canUseGpu() { return false; }";
  const transformed = replaceModelUrl(`// before\n${factory}${suffix}`, "http://localhost/model");
  assert(transformed.startsWith("// before\nconst modelUrl ="));
  assert(transformed.endsWith(suffix));
}
assert.throws(() =>
  replaceModelUrl("const modelUrl = () => 'unsupported';", "http://localhost/model"),
);

async function buildVariant(variant: "baseline" | "current") {
  const output = join(outputRoot, variant);
  const runtime = buildTranslationRuntime();
  const sourceFor = async (path: string) =>
    variant === "baseline"
      ? execFileSync("git", ["show", `${baseline}:${path}`], { cwd: root, encoding: "utf8" })
      : readFile(join(root, path), "utf8");
  const sourcePaths = [
    ...[
      "engine",
      "scheduler",
      "content",
      "background",
      "shared",
      "prompt",
      "settings",
      "ollama",
      "page-bridge",
      ...(variant === "current" ? ["batch"] : []),
    ].map((name) => `features/translate/${name}.ts`),
    "features/translate/loading.css",
    "entrypoints/offscreen/main.ts",
    ...["features", "offscreen", "copy-protocol", "offscreen-copy"].map((name) => `lib/${name}.ts`),
  ];
  const sources = new Map(
    await Promise.all(sourcePaths.map(async (path) => [path, await sourceFor(path)] as const)),
  );
  const sourceSha256 = createHash("sha256")
    .update(JSON.stringify([...sources]))
    .digest("hex");
  await mkdir(join(output, "vendor"), { recursive: true });
  for (const [name, source] of runtime.assets) await writeFile(join(output, name), source);
  for (const name of ["wllama.wasm", "wllama-compat.wasm"] as const)
    await writeFile(join(output, "vendor", name), runtime.nativeBuild.files[name]);
  await writeFile(
    join(output, "vendor/wllama-build.json"),
    JSON.stringify(runtime.nativeBuild.manifest),
  );
  for (const [entrypoint, name, format] of [
    [join(assets, "background.js"), "background.js", "esm"],
    [join(root, "entrypoints/offscreen/main.ts"), "offscreen.js", "esm"],
    [join(assets, "content.js"), "content.js", "iife"],
  ]) {
    assert(entrypoint && name && format);
    const build = await Bun.build({
      entrypoints: [entrypoint],
      target: "browser",
      format,
      define: {
        BENCH_VARIANT: JSON.stringify(variant),
        BENCH_MODEL: JSON.stringify(modelName),
        BENCH_MODEL_SHA256: JSON.stringify(hashFor(variant)),
        BENCH_SOURCE_SHA256: JSON.stringify(sourceSha256),
      },
      plugins: [
        {
          name: "translation-benchmark",
          setup(builder) {
            builder.onResolve(
              { filter: /^(wxt\/browser|@wllama\/wllama|benchmark-runtime-native)$/ },
              ({ path }) => ({ path, namespace: "benchmark" }),
            );
            builder.onResolve({ filter: /loading\.css\?inline$/ }, () => ({
              path: "css",
              namespace: "benchmark",
            }));
            builder.onLoad({ filter: /.*/, namespace: "benchmark" }, async ({ path }) => ({
              contents:
                path === "wxt/browser"
                  ? "export const browser = chrome;"
                  : path === "@wllama/wllama"
                    ? await readFile(join(assets, "runtime.js"), "utf8")
                    : path === "css"
                      ? `export default ${JSON.stringify(sources.get("features/translate/loading.css"))};`
                      : runtime.moduleCode,
              loader: "js",
            }));
            builder.onLoad({ filter: /\.ts$/ }, ({ path }) => {
              const relative = path.slice(root.length + 1);
              let contents = sources.get(relative);
              if (contents === undefined) return;
              if (relative.endsWith("engine.ts")) {
                contents = replaceModelUrl(
                  contents,
                  `${origin}/model.gguf?sha=${hashFor(variant)}`,
                );
              }
              return { contents, loader: "ts" };
            });
          },
        },
      ],
    });
    assert(build.success, JSON.stringify(build.logs));
    assert.equal(build.outputs.length, 1);
    await writeFile(join(output, name), await build.outputs[0]!.text());
  }
  await writeFile(
    join(output, "offscreen.html"),
    '<!doctype html><meta charset="utf-8"><script type="module" src="offscreen.js"></script>',
  );
  const manifest = {
    manifest_version: 3,
    name: `PLaMo benchmark ${variant}`,
    version: "1.0.0",
    permissions: ["offscreen", "storage", "contextMenus", "notifications", "tabs", "scripting"],
    host_permissions: [`${origin}/*`],
    background: { service_worker: "background.js", type: "module" },
    commands: {
      "toggle-page-translation": { description: "日本語訳を開始／解除" },
      "toggle-easy-page-translation": { description: "やさしい日本語訳を開始／解除" },
    },
    content_scripts: [{ matches: [`${origin}/*`], js: ["content.js"], run_at: "document_idle" }],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    cross_origin_embedder_policy: { value: "require-corp" },
    cross_origin_opener_policy: { value: "same-origin" },
  };
  await writeFile(join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${variant}: ${output}\n${origin}/?variant=${variant}`);
  return output;
}

if (command === "build" || command === "selfcheck") {
  for (const variant of ["baseline", "current"] as const) {
    const output = await buildVariant(variant);
    const offscreen = await readFile(join(output, "offscreen.js"), "utf8");
    const content = await readFile(join(output, "content.js"), "utf8");
    const background = await readFile(join(output, "background.js"), "utf8");
    assert(offscreen.includes(`${origin}/model.gguf?sha=${hashFor(variant)}`));
    assert(content.includes(hashFor(variant)));
    assert(offscreen.includes("completion-done"));
    assert(content.includes("luvpame:translate"));
    assert(background.includes("luvpame:offscreen-translate"));
    assert.equal(
      JSON.parse(await readFile(join(output, "manifest.json"), "utf8")).manifest_version,
      3,
    );
  }
  if (command === "selfcheck")
    execFileSync("node", [join(assets, "selfcheck.mjs")], { cwd: root, stdio: "inherit" });
  console.log(
    "Asset self-check passed. Start server with: bun scripts/bench-browser-translation.ts serve",
  );
} else {
  await mkdir(join(outputRoot, "results"), { recursive: true });
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 8817,
    async fetch(request) {
      const url = new URL(request.url);
      if (request.method === "OPTIONS")
        return new Response(null, {
          headers: {
            ...headers,
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
          },
        });
      if (url.pathname === "/results" && request.method === "POST") {
        const result: unknown = await request.json();
        assert(
          typeof result === "object" &&
            result !== null &&
            "variant" in result &&
            (result.variant === "baseline" || result.variant === "current"),
        );
        const path = join(outputRoot, "results", `${Date.now()}-${result.variant}.json`);
        await writeFile(path, JSON.stringify(result, null, 2));
        console.log(`Saved ${path}`);
        return Response.json({ ok: true }, { headers });
      }
      const file =
        url.pathname === "/model.gguf"
          ? modelFilesByHash.get(url.searchParams.get("sha") ?? "")
          : url.pathname === "/page.js"
            ? join(assets, "page.js")
            : url.pathname === "/"
              ? join(assets, "fixture.html")
              : undefined;
      return file
        ? new Response(Bun.file(file), { headers })
        : new Response("Not found", { status: 404, headers });
    },
  });
  console.log(`Serving fixture and model at ${server.url}`);
}
