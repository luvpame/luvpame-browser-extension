import { describe, expect, it } from "vite-plus/test";

import {
  applySettings,
  GITHUB_CONTENT_MATCHES,
  getHeadRef,
  getPullRequestHeadLocation,
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

  it("does not add PR-only features outside pull request pages", () => {
    document.body.innerHTML = "<main><h1><bdi>demo</bdi></h1></main>";

    applySettings(
      {
        prCopyEnabled: true,
        htmlPreviewEnabled: true,
        devinRedirectEnabled: false,
      },
      new URL("https://github.com/luvpame/demo"),
    );

    expect(document.querySelector(".github-enhancer-pr-copy-actions")).toBeNull();
    expect(document.querySelector(".github-enhancer-html-preview-button")).toBeNull();
  });

  it("shows the Review link only on PR pages and respects the setting", () => {
    document.body.innerHTML = "<main><h1><bdi>demo</bdi></h1></main>";

    applySettings(
      {
        prCopyEnabled: false,
        htmlPreviewEnabled: false,
        devinRedirectEnabled: true,
      },
      new URL("https://github.com/luvpame/demo"),
    );

    expect(document.getElementById("github-enhancer-devin-redirect")).toBeNull();

    const url = new URL("https://github.com/luvpame/demo/pull/123");
    applySettings(
      { prCopyEnabled: false, htmlPreviewEnabled: false, devinRedirectEnabled: true },
      url,
    );
    expect(document.querySelector("#github-enhancer-devin-redirect a")?.getAttribute("href")).toBe(
      "https://app.devin.ai/review/luvpame/demo/pull/123",
    );
    applySettings(
      { prCopyEnabled: false, htmlPreviewEnabled: false, devinRedirectEnabled: false },
      url,
    );
    expect(document.getElementById("github-enhancer-devin-redirect")).toBeNull();
  });

  it("extracts the pull request head ref from GitHub sha2 URLs", () => {
    document.body.innerHTML = `
      <include-fragment src="/luvpame/demo/diffs?sha2=12322913653a4b271361ebac2d32cdcff27785c6"></include-fragment>
    `;

    expect(getHeadRef(document)).toBe("12322913653a4b271361ebac2d32cdcff27785c6");
  });

  it("extracts the pull request head SHA from GitHub embedded data", () => {
    document.body.innerHTML = `
      <script type="application/json" data-target="react-app.embeddedData">
        ${JSON.stringify({
          payload: {
            pullRequestsLayoutRoute: {
              pullRequest: {
                headBranch: "salvage0707/SGN-FY26-655",
                headRepositoryName: "shogun",
                headRepositoryOwnerLogin: "smartcamp",
                headSha: "12322913653a4b271361ebac2d32cdcff27785c6",
              },
            },
          },
        })}
      </script>
    `;

    expect(getHeadRef(document)).toBe("12322913653a4b271361ebac2d32cdcff27785c6");
  });

  it("extracts the pull request head branch from GitHub React branch links", () => {
    document.body.innerHTML = `
      <a class="PullRequestBranchName-module__branchName__SCtl2" href="/luvpame/demo/tree/main">
        main
      </a>
      <a class="PullRequestBranchName-module__branchName__SCtl2" href="/luvpame/demo/tree/test/html-preview-pr">
        test/html-preview-pr
      </a>
    `;

    expect(getHeadRef(document)).toBe("test/html-preview-pr");
  });

  it("extracts the pull request head repo from GitHub React branch links", () => {
    document.body.innerHTML = `
      <a class="PullRequestBranchName-module__branchName__SCtl2" href="/base-owner/base-repo/tree/main">
        main
      </a>
      <a class="PullRequestBranchName-module__branchName__SCtl2" href="/head-owner/head-repo/tree/feature/html-preview">
        feature/html-preview
      </a>
    `;

    expect(getPullRequestHeadLocation(document)).toEqual({
      ref: "feature/html-preview",
      sourceOwner: "head-owner",
      sourceRepo: "head-repo",
    });
  });

  it("extracts the pull request head repo from GitHub embedded data", () => {
    document.body.innerHTML = `
      <a class="PullRequestBranchName-module__branchName__SCtl2" href="/base-owner/base-repo/tree/main">
        main
      </a>
      <script type="application/json" data-target="react-app.embeddedData">
        ${JSON.stringify({
          payload: {
            pullRequestsLayoutRoute: {
              pullRequest: {
                headBranch: "salvage0707/SGN-FY26-655",
                headRepositoryName: "shogun",
                headRepositoryOwnerLogin: "smartcamp",
                headSha: "12322913653a4b271361ebac2d32cdcff27785c6",
              },
            },
          },
        })}
      </script>
    `;

    expect(getPullRequestHeadLocation(document)).toEqual({
      ref: "12322913653a4b271361ebac2d32cdcff27785c6",
      sourceOwner: "smartcamp",
      sourceRepo: "shogun",
    });
  });
});
