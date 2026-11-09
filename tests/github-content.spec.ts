import { describe, expect, it } from "vite-plus/test";

import {
  applySettings,
  GITHUB_CONTENT_MATCHES,
  getRepositoryFromLocation,
} from "../entrypoints/github.content";

describe("github content helpers", () => {
  it("extracts owner and repo from GitHub PR URLs", () => {
    expect(getRepositoryFromLocation(new URL("https://github.com/luvpame/demo/pull/1"))).toEqual({
      owner: "luvpame",
      pullNumber: "1",
      repo: "demo",
    });
  });

  it("ignores non-PR URLs", () => {
    expect(getRepositoryFromLocation(new URL("https://github.com/luvpame/demo"))).toBeNull();
  });

  it("runs on GitHub repository pages beyond pull requests", () => {
    expect(GITHUB_CONTENT_MATCHES).toEqual(["https://github.com/*"]);
  });

  it("does not add PR copy controls outside pull request pages", () => {
    document.body.innerHTML = "<main><h1><bdi>demo</bdi></h1></main>";

    applySettings(
      {
        prCopyEnabled: true,
        devinRedirectEnabled: false,
      },
      new URL("https://github.com/luvpame/demo"),
    );

    expect(document.querySelector(".github-enhancer-pr-copy-actions")).toBeNull();
  });

  it("shows the Review link only on PR pages and respects the setting", () => {
    document.body.innerHTML = "<main><h1><bdi>demo</bdi></h1></main>";

    applySettings(
      {
        prCopyEnabled: false,
        devinRedirectEnabled: true,
      },
      new URL("https://github.com/luvpame/demo"),
    );

    expect(document.getElementById("github-enhancer-devin-redirect")).toBeNull();

    const url = new URL("https://github.com/luvpame/demo/pull/123");
    applySettings({ prCopyEnabled: false, devinRedirectEnabled: true }, url);
    expect(document.querySelector("#github-enhancer-devin-redirect a")?.getAttribute("href")).toBe(
      "https://app.devin.ai/review/luvpame/demo/pull/123",
    );
    applySettings({ prCopyEnabled: false, devinRedirectEnabled: false }, url);
    expect(document.getElementById("github-enhancer-devin-redirect")).toBeNull();
  });
});
