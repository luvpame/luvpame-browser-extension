import { defineConfig } from "wxt";
import { createTranslationRuntimePlugin } from "./scripts/translation-runtime";
export default defineConfig({
  outDir: "dist",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Luvpame Browser Extension",
    description: "GitHub・Notionの編集補助、Markdownコピーを一つに。",
    minimum_chrome_version: "137",
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self';",
    },
    cross_origin_embedder_policy: { value: "require-corp" },
    cross_origin_opener_policy: { value: "same-origin" },
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      "clipboardWrite",
      "notifications",
      "offscreen",
      "contextMenus",
    ],
    host_permissions: [
      "https://github.com/*",
      "https://huggingface.co/*",
      "https://*.hf.co/*",
      "http://localhost/*",
    ],
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    commands: {
      "toggle-page-translation": {
        suggested_key: { default: "Alt+A", mac: "Alt+A" },
        description: "日本語訳を開始／解除",
      },
      "toggle-easy-page-translation": {
        suggested_key: { default: "Alt+Shift+A", mac: "Alt+Shift+A" },
        description: "やさしい日本語訳を開始／解除",
      },
      "copy-markdown-link": {
        suggested_key: { default: "Ctrl+Shift+Y", mac: "Command+Shift+Y" },
        description: "現在のタブのURLをMarkdownでコピー",
      },
    },
    web_accessible_resources: [
      { resources: ["devin-redirect-icon.png"], matches: ["https://github.com/*"] },
    ],
  },
  vite: () => ({
    build: { modulePreload: false, target: "es2020" },
    plugins: [
      createTranslationRuntimePlugin(),
      {
        name: "escape-unicode-noncharacters",
        generateBundle(_options, bundle) {
          for (const output of Object.values(bundle))
            if (output.type === "chunk") {
              output.code = output.code.replace(/[\u0080-\u{10ffff}]/gu, (character) => {
                const point = character.codePointAt(0)!;
                if (!(point >= 0xfdd0 && point <= 0xfdef) && (point & 0xffff) < 0xfffe)
                  return character;
                return character
                  .split("")
                  .map((unit) => "\\u" + unit.charCodeAt(0).toString(16).padStart(4, "0"))
                  .join("");
              });
            }
        },
      },
    ],
  }),
});
