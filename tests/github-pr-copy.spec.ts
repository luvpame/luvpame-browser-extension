import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  ACTIONS_CONTAINER_CLASS,
  createCopyButtonSpecs,
  ensurePrCopyButtons,
  removePrCopyButtons,
  sanitizeTitleForMarkdownLink,
} from "../lib/github-pr-copy";

const createPrDocument = () => {
  document.body.innerHTML = `
    <main>
      <div id="partial-discussion-header">
        <h1><bdi>Add preview support</bdi> <span>#123</span></h1>
      </div>
    </main>
  `;
};

describe("github-pr-copy", () => {
  beforeEach(() => {
    createPrDocument();
    Object.assign(navigator, {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
  });

  it("creates copy specs for title, URL, and Markdown textlink", () => {
    expect(createCopyButtonSpecs("A [test] (PR)", "https://github.com/a/b/pull/1")).toEqual([
      { label: "Title", text: "A [test] (PR)" },
      { label: "Url", text: "https://github.com/a/b/pull/1" },
      { label: "Textlink", text: "[A 【test】 （PR）](https://github.com/a/b/pull/1)" },
    ]);
  });

  it("sanitizes Markdown link delimiters", () => {
    expect(sanitizeTitleForMarkdownLink("[x](y)")).toBe("【x】（y）");
  });

  it("adds one copy button group to the PR header", () => {
    expect(ensurePrCopyButtons(document, "https://github.com/a/b/pull/1")).toBe(true);
    expect(ensurePrCopyButtons(document, "https://github.com/a/b/pull/1")).toBe(false);

    expect(document.querySelectorAll(`.${ACTIONS_CONTAINER_CLASS}`)).toHaveLength(1);
    expect([...document.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Title",
      "Url",
      "Textlink",
    ]);
  });

  it("removes inserted buttons", () => {
    ensurePrCopyButtons(document, "https://github.com/a/b/pull/1");
    removePrCopyButtons(document);

    expect(document.querySelector(`.${ACTIONS_CONTAINER_CLASS}`)).toBeNull();
  });
});
