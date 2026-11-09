import { defineContentScript } from "#imports";
import { watchFeatures, type Features } from "../lib/features";
import { mountLgtm } from "../features/lgtm/control";

import {
  ensureDevinRedirectButtons,
  removeDevinRedirectButtons,
} from "../lib/github-devin-redirect";
import { ensurePrCopyButtons, removePrCopyButtons } from "../lib/github-pr-copy";
type EnhancerSettings = Pick<Features, "prCopyEnabled" | "devinRedirectEnabled">;

interface RepositoryLocation {
  owner: string;
  repo: string;
  pullNumber: string;
}

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
    return;
  }

  if (settings.prCopyEnabled) {
    ensurePrCopyButtons();
  } else {
    removePrCopyButtons();
  }
};

export default defineContentScript({
  matches: GITHUB_CONTENT_MATCHES,
  main(ctx) {
    let settings: Features | undefined;
    let lgtm: ReturnType<typeof mountLgtm> | undefined;
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
      observer.disconnect();
      if (next.prCopyEnabled || next.devinRedirectEnabled)
        observer.observe(document.documentElement, { childList: true, subtree: true });
      refresh();
    });
    ctx.addEventListener(window, "wxt:locationchange", (event) => {
      lgtm?.syncUrl(event.newUrl);
      refresh();
    });
    ctx.onInvalidated(() => {
      stop();
      settings = undefined;
      observer.disconnect();
      lgtm?.dispose();
      removePrCopyButtons();
      removeDevinRedirectButtons();
    });
  },
});
