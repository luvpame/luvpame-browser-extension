import { beforeEach, describe, expect, it } from "vite-plus/test";

import {
  DEVIN_REDIRECT_CONTAINER_ID,
  DEVIN_REDIRECT_ICON_PATH,
  ensureDevinRedirectButtons,
  removeDevinRedirectButtons,
} from "../lib/github-devin-redirect";

describe("github-devin-redirect", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
  });

  it("shows a single accessible icon linking directly to Review in a new tab", () => {
    const url = new URL("https://github.com/luvpame/demo/pull/123/files");
    expect(ensureDevinRedirectButtons(document, url)).toBe(true);
    expect(ensureDevinRedirectButtons(document, url)).toBe(false);

    const container = document.getElementById(DEVIN_REDIRECT_CONTAINER_ID)!;
    const link = container.querySelector("a")!;
    expect(document.querySelectorAll(`#${DEVIN_REDIRECT_CONTAINER_ID}`)).toHaveLength(1);
    expect(container.querySelectorAll("a")).toHaveLength(1);
    expect(container.querySelector("button")).toBeNull();
    expect(link.href).toBe("https://app.devin.ai/review/luvpame/demo/pull/123");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    expect(link.getAttribute("aria-label")).toBe("Devin Review（別タブで開く）");
    expect(link.querySelector("img")?.src).toContain(DEVIN_REDIRECT_ICON_PATH);
  });

  it("updates the destination when navigating between PRs", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo/pull/123"));
    expect(
      ensureDevinRedirectButtons(document, new URL("https://github.com/other/repo/pull/456")),
    ).toBe(true);
    expect(document.querySelector("a")?.href).toBe(
      "https://app.devin.ai/review/other/repo/pull/456",
    );
  });

  it.each([
    "https://github.com/luvpame/demo",
    "https://github.com/luvpame/demo/issues/123",
    "https://github.com/luvpame/demo/pulls",
    "https://github.com/luvpame/demo/pull/new",
    "https://github.com/luvpame/demo/pull/123abc",
    "https://github.com/settings/profile",
    "https://example.com/luvpame/demo/pull/123",
  ])("removes the icon outside PR pages: %s", (url) => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo/pull/123"));
    expect(ensureDevinRedirectButtons(document, new URL(url))).toBe(false);
    expect(document.getElementById(DEVIN_REDIRECT_CONTAINER_ID)).toBeNull();
  });

  it("removes the icon when disabled", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo/pull/123"));
    removeDevinRedirectButtons(document);
    expect(document.getElementById(DEVIN_REDIRECT_CONTAINER_ID)).toBeNull();
  });
});
