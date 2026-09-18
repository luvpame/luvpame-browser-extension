import { describe, expect, it } from "vite-plus/test";

import { DEFAULT_TEMPLATE, prepareTemplate } from "./template";

describe("prepareTemplate", () => {
  it("ships the agreed LGTM template as the default", () => {
    expect(DEFAULT_TEMPLATE).toBe(
      "LGTM!!\n\n{{cursor}}\n\n![LGTM](https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExeHA2cDZmZ2J3NXBoOWprd3pnb3BvMjF6d3BkNWk1MjQ0cmJydW90YyZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/ABC2bhcjgwZ1ZyvpvI/giphy.gif)",
    );
  });

  it("removes the cursor marker and returns its text position", () => {
    expect(prepareTemplate("Before{{cursor}}After")).toEqual({
      ok: true,
      text: "BeforeAfter",
      cursorOffset: 6,
    });
  });

  it("rejects a template with more than one cursor marker", () => {
    expect(prepareTemplate("{{cursor}}Keep{{cursor}}")).toEqual({
      ok: false,
      error: "multiple-cursors",
    });
  });

  it("rejects an empty template after removing its optional cursor marker", () => {
    expect(prepareTemplate("  {{cursor}}  ")).toEqual({
      ok: false,
      error: "required",
    });
  });
});
