import { afterEach, describe, expect, it } from "vite-plus/test";

import { findReviewControlsAnchor } from "./surface";

describe("findReviewControlsAnchor", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("finds the review surface on a base pull request URL", () => {
    document.body.innerHTML = '<button type="button" aria-haspopup="dialog">Submit review</button>';

    const anchor = findReviewControlsAnchor(
      document,
      new URL("https://github.com/acme/widgets/pull/123"),
    );

    expect(anchor).toBe(document.querySelector("button"));
  });

  it("returns null on a non-pull-request URL", () => {
    document.body.innerHTML = '<button type="button" aria-haspopup="dialog">Submit review</button>';

    expect(
      findReviewControlsAnchor(document, new URL("https://github.com/acme/widgets/issues/123")),
    ).toBeNull();
  });

  it("returns null on a Conversation page without a review control", () => {
    expect(
      findReviewControlsAnchor(document, new URL("https://github.com/acme/widgets/pull/123")),
    ).toBeNull();
  });

  it.each(["files", "changes"])("keeps the %s surface behavior", (view) => {
    document.body.innerHTML = '<button data-testid="review-changes-button">Review changes</button>';

    const anchor = findReviewControlsAnchor(
      document,
      new URL(`https://github.com/acme/widgets/pull/123/${view}`),
    );

    expect(anchor).toBe(document.querySelector("button"));
  });

  it("uses the details wrapper as the mount anchor", () => {
    document.body.innerHTML =
      '<details><summary><button data-testid="review-changes-button">Review changes</button></summary></details>';

    const anchor = findReviewControlsAnchor(
      document,
      new URL("https://github.com/acme/widgets/pull/123/files"),
    );

    expect(anchor).toBe(document.querySelector("details"));
  });

  it("uses the classic review wrapper as the mount anchor", () => {
    document.body.innerHTML =
      '<span class="js-review-changes"><button data-testid="review-changes-button">Review changes</button></span>';

    const anchor = findReviewControlsAnchor(
      document,
      new URL("https://github.com/acme/widgets/pull/123/files"),
    );

    expect(anchor).toBe(document.querySelector("span.js-review-changes"));
  });
});
