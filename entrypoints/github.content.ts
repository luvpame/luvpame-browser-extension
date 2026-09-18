import { defineContentScript } from "#imports";
import { watchFeatures, type Features } from "../lib/features";
import { mountLgtm } from "../features/lgtm/control";
import { mountGithubTableInserter } from "../features/table/entrypoints/content";

import {
  ensureDevinRedirectButtons,
  removeDevinRedirectButtons,
} from "../lib/github-devin-redirect";
import { ensureHtmlPreviewButtons, removeHtmlPreviews } from "../lib/github-html-preview";
import { ensurePrCopyButtons, removePrCopyButtons } from "../lib/github-pr-copy";
type EnhancerSettings = Pick<
  Features,
  "prCopyEnabled" | "htmlPreviewEnabled" | "devinRedirectEnabled"
>;

interface RepositoryLocation {
  owner: string;
  repo: string;
  pullNumber: string;
}

interface PullRequestHeadLocation {
  ref?: string;
  sourceOwner?: string;
  sourceRepo?: string;
}

interface PullRequestEmbeddedData {
  payload?: {
    pullRequestsLayoutRoute?: {
      pullRequest?: {
        headBranch?: string;
        headRepositoryName?: string;
        headRepositoryOwnerLogin?: string;
        headSha?: string;
      };
    };
  };
}

const BRANCH_LINK_SELECTOR = "a[class*='BranchName'][href*='/tree/']";
const EMBEDDED_DATA_SELECTOR = "script[data-target='react-app.embeddedData']";
const SHA2_SOURCE_SELECTOR = "[src*='sha2='], [action*='sha2=']";
export const GITHUB_CONTENT_MATCHES = ["https://github.com/*"];

export const getRepositoryFromLocation = (url: URL): RepositoryLocation | null => {
  if (url.hostname !== "github.com") {
    return null;
  }

  const [owner, repo, section, pullNumber] = url.pathname.split("/").filter(Boolean);
  if (!owner || !repo || section !== "pull" || !pullNumber) {
    return null;
  }

  return { owner, repo, pullNumber };
};

const getSha2FromUrl = (url: string): string | null => {
  try {
    return new URL(url, window.location.origin).searchParams.get("sha2");
  } catch {
    return null;
  }
};

const getPullRequestEmbeddedData = (doc: Document): PullRequestEmbeddedData | null => {
  const embeddedData = doc.querySelector<HTMLScriptElement>(EMBEDDED_DATA_SELECTOR)?.textContent;
  if (!embeddedData) {
    return null;
  }

  try {
    return JSON.parse(embeddedData) as PullRequestEmbeddedData;
  } catch {
    return null;
  }
};

const getEmbeddedPullRequest = (doc: Document) =>
  getPullRequestEmbeddedData(doc)?.payload?.pullRequestsLayoutRoute?.pullRequest;

const getBranchLinks = (doc: Document): HTMLAnchorElement[] =>
  Array.from(doc.querySelectorAll<HTMLAnchorElement>(BRANCH_LINK_SELECTOR));

const getHeadBranchLink = (doc: Document): HTMLAnchorElement | undefined =>
  getBranchLinks(doc).at(-1);

const getSha2Candidates = (doc: Document): (string | null)[] =>
  Array.from(doc.querySelectorAll<HTMLElement>(SHA2_SOURCE_SELECTOR)).map((element) =>
    getSha2FromUrl(element.getAttribute("src") ?? element.getAttribute("action") ?? ""),
  );

export const getHeadRef = (doc: Document): string | null => {
  const pullRequest = getEmbeddedPullRequest(doc);
  const candidates = [
    pullRequest?.headSha,
    doc.querySelector<HTMLElement>("[data-head-sha]")?.dataset.headSha,
    doc.querySelector<HTMLMetaElement>("meta[name='octolytics-dimension-head_sha']")?.content,
    doc.querySelector<HTMLElement>(".commit-ref.head-ref")?.textContent?.trim(),
    getHeadBranchLink(doc)?.textContent?.trim(),
    ...getSha2Candidates(doc),
  ];

  return candidates.find((candidate) => candidate && candidate.length > 0) ?? null;
};

export const getPullRequestHeadLocation = (doc: Document): PullRequestHeadLocation => {
  const pullRequest = getEmbeddedPullRequest(doc);
  const headLink = getHeadBranchLink(doc);
  const [, sourceOwner, sourceRepo] = headLink?.pathname.match(/^\/([^/]+)\/([^/]+)\/tree\//) ?? [];

  return {
    ref: getHeadRef(doc) ?? undefined,
    sourceOwner: pullRequest?.headRepositoryOwnerLogin ?? sourceOwner,
    sourceRepo: pullRequest?.headRepositoryName ?? sourceRepo,
  };
};

export const applySettings = (
  settings: EnhancerSettings,
  url: URL = new URL(window.location.href),
): void => {
  if (settings.devinRedirectEnabled) {
    ensureDevinRedirectButtons(document, url);
  } else {
    removeDevinRedirectButtons();
  }

  const repository = getRepositoryFromLocation(url);
  if (!repository) {
    removePrCopyButtons();
    removeHtmlPreviews();
    return;
  }

  if (settings.prCopyEnabled) {
    ensurePrCopyButtons();
  } else {
    removePrCopyButtons();
  }

  if (!settings.htmlPreviewEnabled) {
    removeHtmlPreviews();
    return;
  }

  const headLocation = getPullRequestHeadLocation(document);
  ensureHtmlPreviewButtons(document, { ...repository, ...headLocation });
};

export default defineContentScript({
  matches: GITHUB_CONTENT_MATCHES,
  main(ctx) {
    let settings: Features | undefined;
    let lgtm: ReturnType<typeof mountLgtm> | undefined;
    let stopTable: (() => void) | undefined;
    const refresh = () => {
      if (settings) applySettings(settings);
    };
    const observer = new MutationObserver(refresh);
    const stop = watchFeatures((next) => {
      settings = next;
      if (next.lgtmEnabled && !lgtm) lgtm = mountLgtm();
      if (!next.lgtmEnabled) {
        lgtm?.dispose();
        lgtm = undefined;
      }
      if (next.tableEnabled && !stopTable) stopTable = mountGithubTableInserter(document);
      if (!next.tableEnabled) {
        stopTable?.();
        stopTable = undefined;
      }
      observer.disconnect();
      if (next.prCopyEnabled || next.htmlPreviewEnabled || next.devinRedirectEnabled)
        observer.observe(document.documentElement, { childList: true, subtree: true });
      refresh();
    });
    ctx.addEventListener(window, "wxt:locationchange", (event) => {
      removeHtmlPreviews();
      lgtm?.syncUrl(event.newUrl);
      refresh();
    });
    ctx.onInvalidated(() => {
      stop();
      settings = undefined;
      observer.disconnect();
      lgtm?.dispose();
      stopTable?.();
      removePrCopyButtons();
      removeDevinRedirectButtons();
      removeHtmlPreviews();
    });
  },
});
