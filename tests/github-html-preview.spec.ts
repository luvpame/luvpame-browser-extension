import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  HTML_PREVIEW_BUTTON_CLASS,
  HTML_PREVIEW_PANEL_CLASS,
  HTML_PREVIEW_STYLE_ID,
  buildBlobUrlFromRawUrl,
  buildRawUrl,
  buildRawUrlFromBlobUrl,
  ensureHtmlPreviewButtons,
  extractHtmlFromBlobPage,
  findChangedFiles,
  removeHtmlPreviews,
} from "../lib/github-html-preview";

const PREVIEW_BUTTON_SELECTOR = `.${HTML_PREVIEW_BUTTON_CLASS}`;

const createFilesDocument = () => {
  document.body.innerHTML = `
    <div data-testid="file" data-file-path="app/index.html">
      <div class="file-header">
        <a title="app/index.html" href="#diff-1">app/index.html</a>
      </div>
    </div>
    <div data-testid="file" data-file-path="README.md">
      <div class="file-header">
        <a title="README.md" href="#diff-2">README.md</a>
      </div>
    </div>
  `;
};

const clickPreviewButton = () => {
  document.querySelector<HTMLButtonElement>(PREVIEW_BUTTON_SELECTOR)?.click();
};

const waitForPreview = async () => {
  await Promise.resolve();
};

describe("github-html-preview", () => {
  beforeEach(() => {
    createFilesDocument();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("finds changed files and filters HTML files during insertion", () => {
    expect(findChangedFiles(document).map((file) => file.path)).toEqual([
      "app/index.html",
      "README.md",
    ]);

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml: vi.fn(),
    });

    expect(document.querySelectorAll(PREVIEW_BUTTON_SELECTOR)).toHaveLength(1);
  });

  it("places the preview button next to the file name when GitHub exposes a truncate header", () => {
    document.body.innerHTML = `
      <div data-file-path="fixtures/html-preview-test.html">
        <div class="file-header">
          <div class="file-info">
            <span class="Truncate">
              <a title="fixtures/html-preview-test.html" href="#diff-html">
                fixtures/html-preview-test.html
              </a>
            </span>
          </div>
          <div class="file-actions"></div>
        </div>
      </div>
    `;

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "github-enhancer",
      ref: "abc123",
      fetchHtml: vi.fn(),
    });

    expect(
      document.querySelector(`.file-info .Truncate > ${PREVIEW_BUTTON_SELECTOR}`),
    ).not.toBeNull();
  });

  it("detects GitHub React diff headers", () => {
    document.body.innerHTML = `
      <div class="PullRequestDiffsList-module__diffEntry__djnVa">
        <div role="region" id="diff-8452769c09dc819b72061899930d937ff7509025ab5a93fa30cedd5dd2da2ded">
          <div data-diff-header-wrapper="true">
            <div class="DiffFileHeader-module__diff-file-header__UuNN4">
              <div class="DiffFileHeader-module__file-path-section__ZcmB1">
                <h3 class="DiffFileHeader-module__file-name__VVXpg">
                  <a href="#diff-8452769c09dc819b72061899930d937ff7509025ab5a93fa30cedd5dd2da2ded">
                    <code>\u200Efixtures/html-preview-test.html\u200E</code>
                  </a>
                </h3>
                <button type="button" aria-label="Copy file name to clipboard"></button>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    expect(findChangedFiles(document).map((file) => file.path)).toEqual([
      "fixtures/html-preview-test.html",
    ]);

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "github-enhancer",
      ref: "abc123",
      fetchHtml: vi.fn(),
    });

    expect(
      document.querySelector(`[class*="file-path-section"] > ${PREVIEW_BUTTON_SELECTOR}`),
    ).not.toBeNull();
  });

  it("styles preview iframes to use most of the viewport height", () => {
    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml: vi.fn(),
    });

    expect(document.getElementById(HTML_PREVIEW_STYLE_ID)?.textContent).toContain(
      "height: calc(100vh - 160px);",
    );
  });

  it("replaces React diff bodies with previews", async () => {
    document.body.innerHTML = `
      <div role="region">
        <div data-diff-header-wrapper="true">
          <div class="DiffFileHeader-module__file-path-section__ZcmB1">
            <h3 class="DiffFileHeader-module__file-name__VVXpg">
              <a href="#diff-html">
                <code>fixtures/html-preview-test.html</code>
              </a>
            </h3>
          </div>
        </div>
        <div class="border position-relative rounded-bottom-2" data-testid="diff-body">
          <table></table>
        </div>
      </div>
    `;
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "github-enhancer",
      ref: "abc123",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    const header = document.querySelector<HTMLElement>("[data-diff-header-wrapper='true']");
    const diffBody = document.querySelector<HTMLElement>("[data-testid='diff-body']");
    expect(header?.nextElementSibling?.classList.contains(HTML_PREVIEW_PANEL_CLASS)).toBe(true);
    expect(diffBody?.hidden).toBe(true);

    clickPreviewButton();

    expect(document.querySelector(`.${HTML_PREVIEW_PANEL_CLASS}`)).toBeNull();
    expect(diffBody?.hidden).toBe(false);
  });

  it("replaces classic diff bodies with previews", async () => {
    document.body.innerHTML = `
      <div data-file-path="app/index.html">
        <div class="file-header">
          <a title="app/index.html" href="#diff-html">app/index.html</a>
        </div>
        <div class="js-file-content" data-testid="diff-body">
          <table></table>
        </div>
      </div>
    `;
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    const header = document.querySelector<HTMLElement>(".file-header");
    const diffBody = document.querySelector<HTMLElement>("[data-testid='diff-body']");
    expect(header?.nextElementSibling?.classList.contains(HTML_PREVIEW_PANEL_CLASS)).toBe(true);
    expect(diffBody?.hidden).toBe(true);
  });

  it("builds authenticated GitHub raw URLs", () => {
    expect(
      buildRawUrl({
        owner: "luvpame",
        repo: "demo",
        ref: "abc123",
        path: "app/index.html",
      }),
    ).toBe("https://github.com/luvpame/demo/raw/refs/heads/abc123/app/index.html");
  });

  it("builds unambiguous raw URLs for branch names with slashes", () => {
    expect(
      buildRawUrl({
        owner: "smartcamp",
        repo: "shogun",
        ref: "salvage0707/SGN-FY26-655",
        path: "docs/plans/stories/STR-FY26-372/SGN-FY26-655/plan.html",
      }),
    ).toBe(
      "https://github.com/smartcamp/shogun/raw/refs/heads/salvage0707/SGN-FY26-655/docs/plans/stories/STR-FY26-372/SGN-FY26-655/plan.html",
    );
  });

  it("keeps commit SHAs unchanged in raw URLs", () => {
    expect(
      buildRawUrl({
        owner: "luvpame",
        repo: "demo",
        ref: "12322913653a4b271361ebac2d32cdcff27785c6",
        path: "app/index.html",
      }),
    ).toBe(
      "https://github.com/luvpame/demo/raw/12322913653a4b271361ebac2d32cdcff27785c6/app/index.html",
    );
  });

  it("builds authenticated GitHub raw URLs from blob URLs", () => {
    expect(
      buildRawUrlFromBlobUrl(
        "https://github.com/luvpame/github-enhancer/blob/12322913653a4b271361ebac2d32cdcff27785c6/fixtures/html-preview-test.html",
      ),
    ).toBe(
      "https://github.com/luvpame/github-enhancer/raw/12322913653a4b271361ebac2d32cdcff27785c6/fixtures/html-preview-test.html",
    );
  });

  it("builds GitHub blob URLs from raw URLs", () => {
    expect(
      buildBlobUrlFromRawUrl(
        "https://github.com/luvpame/github-enhancer/raw/refs/heads/test/html-preview-pr/fixtures/html-preview-test.html",
      ),
    ).toBe(
      "https://github.com/luvpame/github-enhancer/blob/refs/heads/test/html-preview-pr/fixtures/html-preview-test.html",
    );
  });

  it("extracts raw lines from GitHub blob pages", () => {
    const html = `
      <script type="application/json" data-target="react-app.embeddedData">
        ${JSON.stringify({
          payload: {
            "codeViewBlobLayoutRoute.StyledBlob": {
              rawLines: ["<h1>Hello</h1>", "<p>Private</p>"],
            },
          },
        })}
      </script>
    `;

    expect(extractHtmlFromBlobPage(html)).toBe("<h1>Hello</h1>\n<p>Private</p>");
  });

  it("uses GitHub data-file-path containers and blob links when no global ref is available", async () => {
    document.body.innerHTML = `
      <div data-file-path="fixtures/html-preview-test.html">
        <div class="file-header">
          <a href="/luvpame/github-enhancer/blob/f9b1f23b6ae7d71860e2e09c9fbbab25408dad67/fixtures/html-preview-test.html">
            fixtures/html-preview-test.html
          </a>
        </div>
      </div>
    `;
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "github-enhancer",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    expect(fetchHtml).toHaveBeenCalledWith(
      "https://github.com/luvpame/github-enhancer/raw/f9b1f23b6ae7d71860e2e09c9fbbab25408dad67/fixtures/html-preview-test.html",
    );
  });

  it("uses blob links from React diff regions when no global ref is available", async () => {
    document.body.innerHTML = `
      <div role="region">
        <div data-diff-header-wrapper="true">
          <div class="DiffFileHeader-module__file-path-section__ZcmB1">
            <h3 class="DiffFileHeader-module__file-name__VVXpg">
              <a href="#diff-html">
                <code>fixtures/html-preview-test.html</code>
              </a>
            </h3>
          </div>
        </div>
        <a href="/luvpame/github-enhancer/blob/12322913653a4b271361ebac2d32cdcff27785c6/fixtures/html-preview-test.html">
          View file
        </a>
      </div>
    `;
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "github-enhancer",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    expect(fetchHtml).toHaveBeenCalledWith(
      "https://github.com/luvpame/github-enhancer/raw/12322913653a4b271361ebac2d32cdcff27785c6/fixtures/html-preview-test.html",
    );
  });

  it("renders a sandboxed iframe after fetch succeeds", async () => {
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");
    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    const iframe = document.querySelector<HTMLIFrameElement>("iframe");
    expect(iframe?.getAttribute("sandbox")).toBe("");
    expect(iframe?.srcdoc).toBe("<h1>Hello</h1>");
  });

  it("uses the pull request head repo when it differs from the base repo", async () => {
    const fetchHtml = vi.fn().mockResolvedValue("<h1>Hello</h1>");

    ensureHtmlPreviewButtons(document, {
      owner: "base-owner",
      repo: "base-repo",
      sourceOwner: "head-owner",
      sourceRepo: "head-repo",
      ref: "feature/html-preview",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    expect(fetchHtml).toHaveBeenCalledWith(
      "https://github.com/head-owner/head-repo/raw/refs/heads/feature/html-preview/app/index.html",
    );
  });

  it("falls back to authenticated blob pages when raw fetch fails", async () => {
    const blobPage = `
      <script type="application/json" data-target="react-app.embeddedData">
        ${JSON.stringify({
          payload: {
            "codeViewBlobLayoutRoute.StyledBlob": {
              rawLines: ["<h1>Private</h1>", "<p>Preview</p>"],
            },
          },
        })}
      </script>
    `;
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("raw blocked"))
      .mockResolvedValueOnce({
        ok: true,
        text: vi.fn().mockResolvedValue(blobPage),
      });
    vi.stubGlobal("fetch", fetchMock);

    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
    });

    clickPreviewButton();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/luvpame/demo/raw/refs/heads/abc123/app/index.html",
      { credentials: "include" },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://github.com/luvpame/demo/blob/refs/heads/abc123/app/index.html",
      { credentials: "include" },
    );
    expect(document.querySelector<HTMLIFrameElement>("iframe")?.srcdoc).toBe(
      "<h1>Private</h1>\n<p>Preview</p>",
    );
  });

  it("shows an error when fetch fails", async () => {
    const fetchHtml = vi.fn().mockRejectedValue(new Error("not found"));
    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml,
    });

    clickPreviewButton();
    await waitForPreview();

    expect(document.querySelector(`.${HTML_PREVIEW_PANEL_CLASS}`)?.textContent).toContain(
      "Could not load HTML preview",
    );
  });

  it("removes preview buttons and panels", () => {
    ensureHtmlPreviewButtons(document, {
      owner: "luvpame",
      repo: "demo",
      ref: "abc123",
      fetchHtml: vi.fn(),
    });

    removeHtmlPreviews(document);

    expect(document.querySelector(PREVIEW_BUTTON_SELECTOR)).toBeNull();
    expect(document.querySelector(`.${HTML_PREVIEW_PANEL_CLASS}`)).toBeNull();
  });
  it("does not restore a preview after disabling while HTML is loading", async () => {
    let resolve!: (html: string) => void;
    ensureHtmlPreviewButtons(document, {
      owner: "a",
      repo: "b",
      ref: "main",
      fetchHtml: () =>
        new Promise((done) => {
          resolve = done;
        }),
    });
    clickPreviewButton();
    removeHtmlPreviews(document);
    resolve("<h1>late</h1>");
    await waitForPreview();
    expect(document.querySelector("iframe")).toBeNull();
  });
  it("allows only one pending preview per file", async () => {
    let resolve!: (html: string) => void;
    const fetchHtml = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    ensureHtmlPreviewButtons(document, { owner: "a", repo: "b", ref: "main", fetchHtml });
    clickPreviewButton();
    clickPreviewButton();
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    resolve("<h1>one</h1>");
    await waitForPreview();
    await waitForPreview();
    expect(document.querySelectorAll("iframe")).toHaveLength(1);
    clickPreviewButton();
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
  });
});
