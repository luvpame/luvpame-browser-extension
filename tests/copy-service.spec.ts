import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
const api = vi.hoisted(() => ({
  storage: { local: { get: vi.fn() } },
  tabs: { get: vi.fn(), sendMessage: vi.fn() },
  offscreen: {
    hasDocument: vi.fn(),
    createDocument: vi.fn(),
    Reason: { CLIPBOARD: "CLIPBOARD", WORKERS: "WORKERS" },
  },
  runtime: { sendMessage: vi.fn() },
  scripting: { executeScript: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser: api }));
import { copyTab } from "../lib/copy-service";
import {
  isCopyRequest,
  isOffscreenRequest,
  isNotionUrl,
  NOTION_REQUEST,
} from "../lib/copy-protocol";

describe("copy routing and boundaries", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.storage.local.get.mockResolvedValue({});
    api.tabs.get.mockResolvedValue({ url: "https://example.com/article", title: "An [article]" });
    api.offscreen.hasDocument.mockResolvedValue(true);
    api.runtime.sendMessage.mockImplementation(async (request) => ({
      requestId: request.requestId,
      ok: true,
    }));
  });
  it("validates message types, IDs, and exact Notion hosts", () => {
    expect(isCopyRequest({ type: "luvpame:copy", kind: "url", tabId: 1 })).toBe(true);
    expect(isCopyRequest({ type: "luvpame:copy", kind: "delete", tabId: 1 })).toBe(false);
    expect(isCopyRequest({ type: "luvpame:copy", kind: "url", tabId: -1 })).toBe(false);
    expect(
      isOffscreenRequest({
        type: "luvpame:offscreen-copy",
        requestId: "x",
        mode: "html",
        text: 1,
        url: "",
      }),
    ).toBe(false);
    expect(isNotionUrl("https://demo.notion.site/page")).toBe(true);
    expect(isNotionUrl("https://notion.site.evil.com/page")).toBe(false);
  });
  it("preserves tab link formatting and copies using the shared offscreen document", async () => {
    expect(await copyTab(1, "url")).toEqual({ ok: true });
    expect(api.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "text",
        text: "[An 【article】](https://example.com/article)",
      }),
    );
  });
  it("does no page access for a disabled feature", async () => {
    api.storage.local.get.mockResolvedValue({ bodyCopyEnabled: false });
    expect((await copyTab(1, "body")).ok).toBe(false);
    expect(api.tabs.get).not.toHaveBeenCalled();
  });
  it("uses Notion extraction even if its page button is off", async () => {
    api.storage.local.get.mockResolvedValue({ copyMarkdownButtonEnabled: false });
    api.tabs.get.mockResolvedValue({ url: "https://www.notion.so/page" });
    api.tabs.sendMessage.mockResolvedValue({ success: true, markdown: "- [x] done" });
    expect(await copyTab(1, "body")).toEqual({ ok: true });
    expect(api.tabs.sendMessage).toHaveBeenCalledWith(1, { type: NOTION_REQUEST });
    expect(api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it("passes generic HTML to Defuddle and rejects snapshots from a different page", async () => {
    api.scripting.executeScript.mockResolvedValue([
      { result: { html: "<article>Hi</article>", url: "https://example.com/article" } },
    ]);
    expect(await copyTab(1, "body")).toEqual({ ok: true });
    expect(api.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "html", text: "<article>Hi</article>" }),
    );
    api.scripting.executeScript.mockResolvedValue([
      { result: { html: "wrong", url: "https://example.com/next" } },
    ]);
    expect((await copyTab(1, "body")).ok).toBe(false);
  });
  it("surfaces Notion and clipboard failures and rejects unrelated responses", async () => {
    api.runtime.sendMessage.mockResolvedValue({ requestId: "wrong", ok: true });
    expect((await copyTab(1, "url")).ok).toBe(false);
    api.tabs.get.mockResolvedValue({ url: "https://www.notion.so/page" });
    api.tabs.sendMessage.mockResolvedValue({ success: false, error: "not loaded" });
    expect(await copyTab(1, "body")).toEqual({ ok: false, error: "not loaded" });
  });
  it("shares concurrent offscreen creation and matches each response", async () => {
    api.offscreen.hasDocument.mockResolvedValue(false);
    api.offscreen.createDocument.mockResolvedValue(undefined);
    expect(await Promise.all([copyTab(1, "url"), copyTab(2, "url")])).toEqual([
      { ok: true },
      { ok: true },
    ]);
    expect(api.offscreen.createDocument).toHaveBeenCalledTimes(1);
    const requests = api.runtime.sendMessage.mock.calls.map(([request]) => request.requestId);
    expect(new Set(requests).size).toBe(2);
  });
  it("rejects restricted pages without creating offscreen content", async () => {
    api.tabs.get.mockResolvedValue({ url: "chrome://extensions" });
    expect((await copyTab(1, "url")).ok).toBe(false);
    expect(api.runtime.sendMessage).not.toHaveBeenCalled();
  });
});
