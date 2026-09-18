import { defineConfig } from "wxt";
export default defineConfig({
  outDir: "dist",
  manifestVersion: 3,
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Luvpame Browser Extension",
    description: "GitHub・Notionの編集補助、Vim入力、Markdownコピーを一つに。",
    permissions: [
      "storage",
      "activeTab",
      "scripting",
      "clipboardWrite",
      "notifications",
      "offscreen",
    ],
    host_permissions: ["https://github.com/*"],
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
    commands: {
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
