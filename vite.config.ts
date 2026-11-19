import { defineConfig } from "vite-plus";
import { WxtVitest } from "wxt/testing/vitest-plugin";
export default defineConfig({
  fmt: { ignorePatterns: ["dist/**", ".wxt/**", "docs/plan/**", "vendor/**"] },
  lint: { ignorePatterns: ["dist/**", ".wxt/**", "vendor/**"] },
  plugins: [WxtVitest()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.spec.{ts,tsx}", "features/**/*.test.ts", "features/**/tests/*.spec.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
