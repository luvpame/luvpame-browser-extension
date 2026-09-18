import { describe, expect, it } from "vite-plus/test";

import { buildMarkdownLink, escapeMarkdownTitle } from "../lib/markdown-link";

describe("escapeMarkdownTitle", () => {
  it("replaces [] and escapes backslashes", () => {
    expect(escapeMarkdownTitle("A [B] (C) \\ D")).toBe("A 【B】 (C) \\\\ D");
  });

  it("keeps plain text unchanged", () => {
    expect(escapeMarkdownTitle("Simple Title")).toBe("Simple Title");
  });
});

describe("buildMarkdownLink", () => {
  it("builds markdown link with replaced title", () => {
    expectMarkdownLink(
      "Docs [v1]",
      "https://example.com/docs",
      "[Docs 【v1】](https://example.com/docs)",
    );
  });

  it("keeps parentheses as-is in title", () => {
    expectMarkdownLink("Guide (v2)", "https://example.com", "[Guide (v2)](https://example.com)");
  });

  it("falls back to URL when title is empty", () => {
    expectMarkdownLink("   ", "https://example.com", "[https://example.com](https://example.com)");
  });

  it("applies [] replacement to fallback URL text", () => {
    expectMarkdownLink(
      "   ",
      "https://example.com/[docs](v1)",
      "[https://example.com/【docs】(v1)](https://example.com/[docs](v1))",
    );
  });
});

function expectMarkdownLink(title: string, url: string, expected: string): void {
  expect(buildMarkdownLink(title, url)).toBe(expected);
}
