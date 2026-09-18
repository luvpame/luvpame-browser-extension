import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DEVIN_REDIRECT_CONTAINER_ID,
  DEVIN_REDIRECT_ICON_PATH,
  DEVIN_REDIRECT_STYLE_ID,
  buildDeepwikiUrl,
  buildDevinReviewUrl,
  buildDevinWikiUrl,
  ensureDevinRedirectButtons,
  getRepoRedirectContext,
  removeDevinRedirectButtons,
} from "../lib/github-devin-redirect";

describe("github-devin-redirect", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("builds DeepWiki, Devin Wiki, and Devin Review URLs", () => {
    expect(buildDeepwikiUrl({ owner: "luvpame", repo: "demo" })).toBe(
      "https://deepwiki.com/luvpame/demo",
    );
    expect(buildDevinWikiUrl({ owner: "luvpame", repo: "demo" })).toBe(
      "https://app.devin.ai/wiki/luvpame/demo",
    );
    expect(buildDevinReviewUrl({ owner: "luvpame", repo: "demo", pullNumber: "123" })).toBe(
      "https://app.devin.ai/review/luvpame/demo/pull/123",
    );
  });

  it("extracts repository context from GitHub repository URLs", () => {
    document.head.innerHTML = `
      <meta name="octolytics-dimension-repository_public" content="false">
    `;

    expect(getRepoRedirectContext(new URL("https://github.com/luvpame/demo/pull/123"))).toEqual({
      owner: "luvpame",
      repo: "demo",
      isPrivate: true,
      isPullRequest: true,
      pullNumber: "123",
    });
  });

  it("ignores non-repository GitHub URLs", () => {
    expect(getRepoRedirectContext(new URL("https://github.com/settings/profile"))).toBeNull();
  });

  it("adds redirect buttons once and uses private wiki URLs for private repos", () => {
    document.head.innerHTML = `
      <meta name="octolytics-dimension-repository_public" content="false">
    `;

    expect(ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo"))).toBe(
      true,
    );
    expect(ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo"))).toBe(
      false,
    );

    const buttons = [...document.querySelectorAll<HTMLButtonElement>("[data-target]")];
    expect(buttons.map((button) => button.textContent)).toEqual(["DeepWiki"]);
    expect(buttons[0]?.dataset.url).toBe("https://app.devin.ai/wiki/luvpame/demo");
    expect(document.querySelectorAll(`#${DEVIN_REDIRECT_CONTAINER_ID}`)).toHaveLength(1);
  });

  it("keeps redirect actions collapsed by default", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo"));

    const container = document.getElementById(DEVIN_REDIRECT_CONTAINER_ID);
    expect(container?.dataset.expanded).toBe("false");
    expect(container?.classList.contains(`${DEVIN_REDIRECT_CONTAINER_ID}-collapsed`)).toBe(true);
    expect(container?.querySelector("[aria-expanded]")?.getAttribute("aria-expanded")).toBe(
      "false",
    );
  });

  it("uses the Devin icon for the toggle button", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo"));

    const toggleButton = document.querySelector<HTMLButtonElement>("[data-role='toggle']");
    const icon = toggleButton?.querySelector<HTMLImageElement>("img");
    expect(toggleButton?.textContent?.trim()).toBe("");
    expect(toggleButton?.querySelector("svg")).toBeNull();
    expect(icon?.src).toContain(DEVIN_REDIRECT_ICON_PATH);
  });

  it("adds motion styles for hover, click, and menu expansion", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo/pull/123"));

    const styleText = document.getElementById(DEVIN_REDIRECT_STYLE_ID)?.textContent ?? "";
    expect(styleText).toContain("transition:");
    expect(styleText).toContain("transform:");
    expect(styleText).toContain("animation:");
    expect(styleText).toContain("@keyframes github-enhancer-devin-action-in");
    expect(styleText).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("adds Devin Review on pull request pages", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo/pull/123"));

    expect(
      [...document.querySelectorAll<HTMLButtonElement>("[data-target]")].map((button) => ({
        label: button.textContent,
        url: button.dataset.url,
      })),
    ).toEqual([
      {
        label: "DeepWiki",
        url: "https://deepwiki.com/luvpame/demo",
      },
      {
        label: "Devin Review",
        url: "https://app.devin.ai/review/luvpame/demo/pull/123",
      },
    ]);
  });

  it("removes inserted buttons", () => {
    ensureDevinRedirectButtons(document, new URL("https://github.com/luvpame/demo"));
    removeDevinRedirectButtons(document);

    expect(document.getElementById(DEVIN_REDIRECT_CONTAINER_ID)).toBeNull();
  });
});
