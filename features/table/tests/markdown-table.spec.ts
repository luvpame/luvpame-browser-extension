import { describe, expect, it } from "vite-plus/test";

import {
  buildMarkdownTable,
  isValidTableDimensions,
  parsePositiveInteger,
} from "../lib/markdown-table";

describe("parsePositiveInteger", () => {
  it("parses positive integers", () => {
    expect(parsePositiveInteger("3")).toBe(3);
    expect(parsePositiveInteger(" 12 ")).toBe(12);
  });

  it("rejects empty, invalid, and non-positive values", () => {
    expect(parsePositiveInteger("")).toBeUndefined();
    expect(parsePositiveInteger("0")).toBeUndefined();
    expect(parsePositiveInteger("-1")).toBeUndefined();
    expect(parsePositiveInteger("2.5")).toBeUndefined();
    expect(parsePositiveInteger("abc")).toBeUndefined();
  });
});

describe("buildMarkdownTable", () => {
  it("builds a header-based markdown table", () => {
    expect(buildMarkdownTable({ columns: 3, rows: 2 })).toBe(
      [
        "| Column 1 | Column 2 | Column 3 |",
        "| --- | --- | --- |",
        "|  |  |  |",
        "|  |  |  |",
      ].join("\n"),
    );
  });

  it("rejects invalid dimensions", () => {
    expect(isValidTableDimensions({ columns: 0, rows: 1 })).toBe(false);
    expect(() => {
      buildMarkdownTable({ columns: 0, rows: 1 });
    }).toThrow("Table dimensions must be positive integers.");
  });
});
