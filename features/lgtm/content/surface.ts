import { findReviewOpener } from "./dom-adapter";
import { isPullRequestPage } from "./route";

export function findReviewControlsAnchor(document: Document, url: URL): HTMLElement | null {
  if (!isPullRequestPage(url)) {
    return null;
  }

  const opener = findReviewOpener(document);
  if (!opener) {
    return null;
  }

  return (
    opener.closest<HTMLElement>("details") ??
    opener.closest<HTMLElement>("span.js-review-changes") ??
    opener
  );
}
