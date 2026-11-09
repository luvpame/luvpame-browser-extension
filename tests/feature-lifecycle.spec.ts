import { beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { featureKeys, normalizeFeatures, watchFeatures } from "../lib/features";
import { setMergeGuard } from "../lib/merge-guard";
import { suspendVim, suspendVimEvent, resumeVimEvent } from "../lib/editor-bridge";
import { writeClipboard } from "../lib/offscreen-copy";
import { mountGithubTableInserter } from "../features/table/entrypoints/content";

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
it("normalizes all thirteen feature values without accepting string booleans", () => {
  expect(featureKeys).toHaveLength(13);
  expect(Object.values(normalizeFeatures({})).every(Boolean)).toBe(true);
  expect(normalizeFeatures({ vimEnabled: false, lgtmEnabled: "false" })).toMatchObject({
    vimEnabled: false,
    lgtmEnabled: true,
  });
});
it("does not apply settings after disposing an initial pending read", async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  vi.spyOn(browser.storage.local, "get").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn();
  const stop = watchFeatures(apply);
  stop();
  resolve({ vimEnabled: true });
  await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
});
it("restores the existing merge button without removing the DOM element", () => {
  document.body.innerHTML = '<button data-testid="merge-button">Merge</button>';
  const button = document.querySelector("button");
  setMergeGuard(true);
  setMergeGuard(true);
  expect(document.querySelectorAll("#luvpame-merge-guard")).toHaveLength(1);
  setMergeGuard(false);
  expect(document.querySelector("button")).toBe(button);
  expect(document.getElementById("luvpame-merge-guard")).toBeNull();
});
it("pairs one Vim suspend with exactly one resume", () => {
  const suspended = vi.fn();
  const resumed = vi.fn();
  document.addEventListener(suspendVimEvent, suspended, { once: true });
  document.addEventListener(resumeVimEvent, resumed);
  const resume = suspendVim();
  resume();
  resume();
  expect(suspended).toHaveBeenCalledTimes(1);
  expect(resumed).toHaveBeenCalledTimes(1);
  document.removeEventListener(resumeVimEvent, resumed);
});
it("removes table controls and permits enabling again", () => {
  document.body.innerHTML =
    '<markdown-toolbar for="body"></markdown-toolbar><textarea id="body"></textarea>';
  const stop = mountGithubTableInserter(document);
  expect(document.querySelectorAll(".gmti-control")).toHaveLength(1);
  stop();
  expect(document.querySelectorAll(".gmti-control")).toHaveLength(0);
  const stopAgain = mountGithubTableInserter(document);
  expect(document.querySelectorAll(".gmti-control")).toHaveLength(1);
  stopAgain();
});
it("cleans up the clipboard textarea even when writing fails", () => {
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
  expect(() => writeClipboard("copy")).toThrow();
  expect(document.querySelector("textarea")).toBeNull();
});

it("prefers local changes that arrive during initial settings loading", async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  let listener: Parameters<typeof browser.storage.onChanged.addListener>[0] | undefined;
  vi.spyOn(browser.storage.local, "get").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  vi.spyOn(browser.storage.onChanged, "addListener").mockImplementation((callback) => {
    listener = callback;
  });
  const apply = vi.fn();
  const stop = watchFeatures(apply);
  listener!({ vimEnabled: { newValue: false } }, "local");
  resolve({ vimEnabled: true });
  await Promise.resolve();
  expect(apply).toHaveBeenLastCalledWith(expect.objectContaining({ vimEnabled: false }));
  stop();
});

it("ignores a rejected settings read after invalidation", async () => {
  let reject!: (error: Error) => void;
  vi.spyOn(browser.storage.local, "get").mockImplementation(
    () =>
      new Promise((_done, fail) => {
        reject = fail;
      }),
  );
  const apply = vi.fn();
  const onError = vi.fn();
  const stop = watchFeatures(apply, onError);
  stop();
  reject(new Error("Extension context invalidated."));
  await Promise.resolve();
  await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
});

it("extracts generic page HTML as Markdown without copying script text", async () => {
  const { convertHtml } = await import("../lib/offscreen-copy");
  const paragraph =
    "<p>This is <strong>useful article content</strong> for a readable page. It contains enough text for extraction.</p>";
  const markdown = await convertHtml(
    `<html><head><title>Example</title></head><body><article><h1>Example</h1>${paragraph.repeat(8)}</article><script>SECRET_SCRIPT</script></body></html>`,
    "https://example.com/article",
  );
  expect(markdown).toContain("**useful article content**");
  expect(markdown).not.toContain("SECRET_SCRIPT");
});
