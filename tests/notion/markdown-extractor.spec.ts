import { describe, expect, it } from "vite-plus/test";
import { JSDOM } from "jsdom";

import { extractPageMarkdown } from "../../lib/notion/markdown-extractor";

const makeDoc = (bodyHtml: string): Document => {
  const { window } = new JSDOM(`<!doctype html><body>${bodyHtml}</body>`);
  return window.document;
};

describe("extractPageMarkdown", () => {
  it("returns error when no Notion content element is found", () => {
    const doc = makeDoc("<div>no notion here</div>");
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("見つかりません");
    }
  });

  it("extracts content from .notion-page-content", () => {
    const doc = makeDoc('<div class="notion-page-content"><h1>Hello</h1><p>World</p></div>');
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("Hello");
      expect(result.markdown).toContain("World");
    }
  });

  it("converts headings and inline links into practical markdown", () => {
    const doc = makeDoc(
      '<div class="notion-page-content"><h1>Title</h1><p><a href="/docs">Docs</a></p></div>',
    );
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("# Title");
      expect(result.markdown).toContain("[Docs](/docs)");
    }
  });

  it("normalizes unordered lists to hyphen bullets", () => {
    const doc = makeDoc('<div class="notion-page-content"><ul><li>foo</li><li>bar</li></ul></div>');
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("- foo");
      expect(result.markdown).toContain("- bar");
    }
  });

  it("normalizes Notion-style bulleted and numbered list blocks", () => {
    const doc = makeDoc(`
      <div class="notion-page-content">
        <div data-block-id="bullet-1" class="notion-bulleted_list-block">
          <div><div><span>項目1</span></div></div>
        </div>
        <div data-block-id="bullet-2" class="notion-bulleted_list-block">
          <div><div><span>項目2</span></div></div>
        </div>
        <div data-block-id="number-1" class="notion-numbered_list-block">
          <div><div><span>順番1</span></div></div>
        </div>
        <div data-block-id="number-2" class="notion-numbered_list-block">
          <div><div><span>順番2</span></div></div>
        </div>
      </div>
    `);
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("- 項目1\n- 項目2");
      expect(result.markdown).toContain("1. 順番1\n2. 順番2");
    }
  });

  it("converts Notion-style todo blocks into markdown task items", () => {
    const doc = makeDoc(`
      <div class="notion-page-content">
        <div data-block-id="todo-1">
          <input type="checkbox" checked />
          <span>Ship Europa migration</span>
        </div>
        <div data-block-id="todo-2">
          <div role="checkbox" aria-checked="false"></div>
          <span>Review copied markdown</span>
        </div>
      </div>
    `);
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain(
        "- [x] Ship Europa migration\n- [ ] Review copied markdown",
      );
    }
  });

  it("flattens nested Notion-style todo wrappers without inserting blank lines", () => {
    const doc = makeDoc(`
      <div class="notion-page-content">
        <div data-block-id="todo-1" class="notion-to_do-block">
          <div>
            <div role="checkbox" aria-checked="false"></div>
            <div><div><span>タスク1を完了する</span></div></div>
          </div>
        </div>
        <div data-block-id="todo-2" class="notion-to_do-block">
          <div>
            <div role="checkbox" aria-checked="true"></div>
            <div><div><span>タスク2を完了する</span></div></div>
          </div>
        </div>
      </div>
    `);
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("- [ ] タスク1を完了する\n- [x] タスク2を完了する");
      expect(result.markdown).not.toContain("- [ ]\n");
    }
  });

  it("ignores mirrored Notion list blocks that reuse the same data-block-id", () => {
    const doc = makeDoc(`
      <div class="notion-page-content">
        <div data-block-id="bullet-1" class="notion-bulleted_list-block">
          <div><div>項目1</div></div>
          <div data-block-id="bullet-1" class="notion-bulleted_list-block"></div>
        </div>
        <div data-block-id="bullet-2" class="notion-bulleted_list-block">
          <div><div>項目2</div></div>
          <div data-block-id="bullet-2" class="notion-bulleted_list-block"></div>
        </div>
        <div data-block-id="number-1" class="notion-numbered_list-block">
          <div><div>順番1</div></div>
          <div data-block-id="number-1" class="notion-numbered_list-block"></div>
        </div>
        <div data-block-id="number-2" class="notion-numbered_list-block">
          <div><div>順番2</div></div>
          <div data-block-id="number-2" class="notion-numbered_list-block"></div>
        </div>
        <div data-block-id="todo-1" class="notion-to_do-block">
          <input type="checkbox" />
          <span>タスク1を完了する</span>
          <div data-block-id="todo-1" class="notion-to_do-block"></div>
        </div>
        <div data-block-id="todo-2" class="notion-to_do-block">
          <input type="checkbox" checked />
          <span>タスク2を完了する</span>
          <div data-block-id="todo-2" class="notion-to_do-block"></div>
        </div>
      </div>
    `);
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("- 項目1\n- 項目2");
      expect(result.markdown).toContain("1. 順番1\n2. 順番2");
      expect(result.markdown).toContain("- [ ] タスク1を完了する\n- [x] タスク2を完了する");
      expect(result.markdown).not.toContain("* 項目2");
      expect(result.markdown).not.toContain("2. 3.");
      expect(result.markdown).not.toContain("- [ ]\n");
    }
  });

  it("removes hidden noise before conversion", () => {
    const doc = makeDoc(`
      <div class="notion-page-content">
        <p>Visible text</p>
        <p hidden>Hidden text</p>
        <p style="display:none">Also hidden</p>
      </div>
    `);
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.markdown).toContain("Visible text");
      expect(result.markdown).not.toContain("Hidden text");
      expect(result.markdown).not.toContain("Also hidden");
    }
  });

  it("returns error when content element is empty", () => {
    const doc = makeDoc('<div class="notion-page-content"></div>');
    const result = extractPageMarkdown(doc);

    expect(result.success).toBe(false);
  });
});
