import { afterEach, describe, expect, it } from "vite-plus/test";

import { findReviewOpener, prepareApprovalReview } from "./dom-adapter";

describe("findReviewOpener", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("finds the popup Submit review control used by the current Files changed UI", () => {
    document.body.innerHTML = '<button type="button" aria-haspopup="dialog">Submit review</button>';

    expect(findReviewOpener(document)).not.toBeNull();
  });

  it("finds the new Files changed toolbar review control without popup attributes", () => {
    document.body.innerHTML = `
      <section data-component="Stack">
        <h2 class="sr-only">Pull request toolbar</h2>
        <div data-component="Stack">
          <button data-component="Button" type="button" data-variant="primary">
            <span data-component="buttonContent">
              <span data-component="text">
                <span>Submit review</span>
                <span>Review</span>
              </span>
            </span>
            <span data-component="trailingAction"><svg></svg></span>
          </button>
        </div>
      </section>`;

    const button = document.querySelector<HTMLButtonElement>(
      'button[data-component="Button"][data-variant="primary"]',
    );

    expect(button).not.toBeNull();
    expect(findReviewOpener(document)).toBe(button);
  });

  it("does not treat a review-shaped button outside the pull request toolbar as the opener", () => {
    document.body.innerHTML = `
      <section>
        <h2>Unrelated toolbar</h2>
        <button data-component="Button" type="button" data-variant="primary">
          <span data-component="text"><span>Submit review</span><span>Review</span></span>
          <span data-component="trailingAction"><svg></svg></span>
        </button>
      </section>`;

    expect(findReviewOpener(document)).toBeNull();
  });

  it("requires the new toolbar review button to have a trailing action", () => {
    document.body.innerHTML = `
      <section>
        <h2>Pull request toolbar</h2>
        <button data-component="Button" type="button" data-variant="primary">
          <span data-component="text"><span>Submit review</span><span>Review</span></span>
        </button>
      </section>`;

    expect(findReviewOpener(document)).toBeNull();
  });

  it("does not click a native Submit review submit control", async () => {
    document.body.innerHTML = '<button type="submit">Submit review</button>';

    let clickCount = 0;
    document.querySelector("button")?.addEventListener("click", () => {
      clickCount += 1;
    });

    expect(findReviewOpener(document)).toBeNull();
    expect(
      await prepareApprovalReview(document, {
        text: "Prepared review",
        cursorOffset: 9,
      }),
    ).toEqual({ ok: false, error: "review-button-not-found" });
    expect(clickCount).toBe(0);
  });

  it("does not click a plain Submit review button without popup state", async () => {
    document.body.innerHTML = '<button type="button">Submit review</button>';

    let clickCount = 0;
    document.querySelector("button")?.addEventListener("click", () => {
      clickCount += 1;
    });

    expect(findReviewOpener(document)).toBeNull();
    expect(
      await prepareApprovalReview(document, {
        text: "Prepared review",
        cursorOffset: 9,
      }),
    ).toEqual({ ok: false, error: "review-button-not-found" });
    expect(clickCount).toBe(0);
  });

  it("does not treat a role button as the native Submit review popup control", async () => {
    document.body.innerHTML = '<div role="button" aria-haspopup="dialog">Submit review</div>';

    let clickCount = 0;
    document.querySelector("[role=button]")?.addEventListener("click", () => {
      clickCount += 1;
    });

    expect(findReviewOpener(document)).toBeNull();
    expect(
      await prepareApprovalReview(document, {
        text: "Prepared review",
        cursorOffset: 9,
      }),
    ).toEqual({ ok: false, error: "review-button-not-found" });
    expect(clickCount).toBe(0);
  });

  it("does not treat an expanded control without aria-haspopup as the opener", async () => {
    document.body.innerHTML =
      '<button type="button" aria-expanded="false" aria-controls="review-menu">Submit review</button>';

    let clickCount = 0;
    document.querySelector("button")?.addEventListener("click", () => {
      clickCount += 1;
    });

    expect(findReviewOpener(document)).toBeNull();
    expect(
      await prepareApprovalReview(document, {
        text: "Prepared review",
        cursorOffset: 9,
      }),
    ).toEqual({ ok: false, error: "review-button-not-found" });
    expect(clickCount).toBe(0);
  });

  it("does not treat an unrelated popup type as the review control", () => {
    document.body.innerHTML =
      '<button type="button" aria-haspopup="listbox">Submit review</button>';

    expect(findReviewOpener(document)).toBeNull();
  });
});

describe("prepareApprovalReview", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens the review form, selects Approve, and focuses the prepared body", async () => {
    document.body.innerHTML = '<button data-testid="review-changes-button">Review changes</button>';

    const reviewButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="review-changes-button"]',
    );
    reviewButton?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form data-testid="review-form"><label><input type="radio" name="event" value="approve">Approve</label><textarea name="body">Existing draft</textarea></form>',
      );
    });

    const result = await prepareApprovalReview(document, {
      text: "BeforeAfter",
      cursorOffset: 6,
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="approve"]')?.checked).toBe(true);
    const textarea = document.querySelector<HTMLTextAreaElement>('textarea[name="body"]');
    expect(textarea?.value).toBe("BeforeAfter");
    expect(textarea?.selectionStart).toBe(6);
    expect(textarea?.selectionEnd).toBe(6);
    expect(document.activeElement).toBe(textarea);
  });

  it("leaves the review form open and reports when Approve is unavailable", async () => {
    document.body.innerHTML = '<button data-testid="review-changes-button">Review changes</button>';

    const reviewButton = document.querySelector<HTMLButtonElement>(
      '[data-testid="review-changes-button"]',
    );
    reviewButton?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form data-testid="review-form"><textarea name="body">Draft</textarea></form>',
      );
    });

    const result = await prepareApprovalReview(document, {
      text: "Replacement",
      cursorOffset: 11,
    });

    expect(result).toEqual({ ok: false, error: "approve-option-not-found" });
    expect(document.querySelector('[data-testid="review-form"]')).not.toBeNull();
    expect(document.querySelector<HTMLTextAreaElement>('textarea[name="body"]')?.value).toBe(
      "Draft",
    );
  });

  it("reuses an already open review panel without clicking its opener", async () => {
    document.body.innerHTML =
      '<button data-testid="review-changes-button">Review changes</button><form data-testid="review-form"><label><input type="radio" name="pull_request_review[event]" value="approve">Approve</label><textarea name="pull_request_review[body]">Existing draft</textarea></form>';

    let openerClicks = 0;
    document
      .querySelector<HTMLButtonElement>('[data-testid="review-changes-button"]')
      ?.addEventListener("click", () => {
        openerClicks += 1;
      });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(openerClicks).toBe(0);
  });

  it("waits for the review panel when GitHub renders it after the opener click", async () => {
    document.body.innerHTML = '<button data-hotkey="v">Review changes</button>';

    document
      .querySelector<HTMLButtonElement>('[data-hotkey="v"]')
      ?.addEventListener("click", () => {
        window.setTimeout(() => {
          document.body.insertAdjacentHTML(
            "beforeend",
            '<section data-testid="review-panel"><label><input type="radio" name="pull_request_review[event]" value="approve">Approve</label><textarea name="pull_request_review[body]">Old review</textarea></section>',
          );
        }, 0);
      });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="approve"]')?.checked).toBe(true);
    expect(
      document.querySelector<HTMLTextAreaElement>('textarea[name="pull_request_review[body]"]')
        ?.value,
    ).toBe("Prepared review");
  });

  it("supports the accessible Finish your review opener used by newer GitHub pages", async () => {
    document.body.innerHTML = "<button>Finish your review 2</button>";

    document.querySelector<HTMLButtonElement>("button")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form><label><input type="radio" name="pull_request_review[event]" value="approve">Approve</label><textarea name="pull_request_review[body]"></textarea></form>',
      );
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
  });

  it("prepares a review opened by the current Submit review popup control", async () => {
    document.body.innerHTML = '<button type="button" aria-haspopup="dialog">Submit review</button>';

    let openerClicks = 0;
    document.querySelector<HTMLButtonElement>("button")?.addEventListener("click", () => {
      openerClicks += 1;
      window.setTimeout(() => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<section data-testid="review-panel"><label><input type="radio" name="pull_request_review[event]" value="approve">Approve</label><textarea name="pull_request_review[body]">Existing draft</textarea><button type="submit">Submit review</button></section>',
        );
      }, 0);
    });

    const result = await prepareApprovalReview(document, {
      text: "LGTM!!\n\n\n![LGTM](https://example.com/lgtm.gif)",
      cursorOffset: 8,
    });

    expect(result.ok).toBe(true);
    expect(openerClicks).toBe(1);
    expect(document.querySelector<HTMLInputElement>('input[value="approve"]')?.checked).toBe(true);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      'textarea[name="pull_request_review[body]"]',
    );
    expect(textarea?.value).toBe("LGTM!!\n\n\n![LGTM](https://example.com/lgtm.gif)");
    expect(textarea?.selectionStart).toBe(8);
    expect(textarea?.selectionEnd).toBe(8);
    expect(document.activeElement).toBe(textarea);
  });

  it("prepares the current Finish your review panel with a generic body textarea", async () => {
    document.body.innerHTML = `
      <section>
        <h2>Finish your review</h2>
        <div>
          <input type="radio" name="review-event" value="APPROVE">
          <span>Approve</span>
        </div>
        <textarea placeholder="Leave a comment">Existing draft</textarea>
        <button type="submit">Submit review</button>
      </section>`;

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>('input[value="APPROVE"]')?.checked).toBe(true);
    expect(
      document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Leave a comment"]')?.value,
    ).toBe("Prepared review");
  });

  it("does not treat a generic comment textarea without a review panel as the review body", async () => {
    document.body.innerHTML = `
      <section aria-label="Comment on line">
        <textarea placeholder="Leave a comment">Inline draft</textarea>
      </section>`;

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result).toEqual({ ok: false, error: "review-button-not-found" });
    expect(
      document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Leave a comment"]')?.value,
    ).toBe("Inline draft");
  });

  it("reports an unavailable approval when the Approve radio does not become selected", async () => {
    document.body.innerHTML =
      '<section data-testid="review-panel"><div role="radio" aria-checked="false">Approve</div><textarea name="pull_request_review[body]">Existing draft</textarea></section>';

    const approve = document.querySelector<HTMLElement>('[role="radio"]');
    approve?.addEventListener("click", () => {
      // A custom control can receive the click without changing its state.
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result).toEqual({ ok: false, error: "approve-option-not-found" });
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Existing draft");
  });

  it("accepts an accessible-name radio control when it reports the selected state", async () => {
    document.body.innerHTML =
      '<section data-testid="review-panel"><div role="radio" aria-label="Approve" aria-checked="false"></div><textarea name="pull_request_review[body]"></textarea></section>';

    document.querySelector<HTMLElement>('[role="radio"]')?.addEventListener("click", (event) => {
      (event.currentTarget as HTMLElement).setAttribute("aria-checked", "true");
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
  });

  it("handles an in-page panel with GitHub’s classic review textarea class", async () => {
    document.body.innerHTML =
      '<section data-testid="review-panel"><input type="radio" name="pull_request_review[event]" value="approve"><textarea class="js-comment-field" aria-label="Review body">Existing draft</textarea></section>';

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>("textarea.js-comment-field")?.value).toBe(
      "Prepared review",
    );
  });

  it("does not treat an unrelated inline comment textarea as an open review panel", async () => {
    document.body.innerHTML =
      '<section data-testid="diff-comment"><textarea class="js-comment-field" aria-label="Comment on line"></textarea></section><button data-testid="review-changes-button">Review changes</button>';

    document
      .querySelector<HTMLButtonElement>('[data-testid="review-changes-button"]')
      ?.addEventListener("click", () => {
        document.body.insertAdjacentHTML(
          "beforeend",
          '<section data-testid="review-panel"><input type="radio" name="pull_request_review[event]" value="approve"><textarea class="js-comment-field" aria-label="Review body"></textarea></section>',
        );
      });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="diff-comment"] textarea')?.value,
    ).toBe("");
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="review-panel"] textarea')?.value,
    ).toBe("Prepared review");
  });

  it("reports when the review body cannot be read back after replacement", async () => {
    document.body.innerHTML =
      '<section data-testid="review-panel"><input type="radio" name="pull_request_review[event]" value="approve"><textarea name="pull_request_review[body]">Existing draft</textarea></section>';

    const textarea = document.querySelector<HTMLTextAreaElement>("textarea");
    if (!textarea) {
      throw new Error("Test review body was not created");
    }

    Object.defineProperty(textarea, "value", {
      configurable: true,
      get: () => "Existing draft",
      set: () => undefined,
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result).toEqual({ ok: false, error: "review-body-update-failed" });
  });

  it("skips a review form hidden by an ancestor and prepares the visible form", async () => {
    document.body.innerHTML =
      '<div style="display: none"><form><input type="radio" name="pull_request_review[event]" value="approve"><textarea name="pull_request_review[body]">Hidden draft</textarea></form></div><form><input type="radio" name="pull_request_review[event]" value="approve"><textarea name="pull_request_review[body]">Visible draft</textarea></form>';

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    const textareas = document.querySelectorAll<HTMLTextAreaElement>(
      'textarea[name="pull_request_review[body]"]',
    );
    expect(result.ok).toBe(true);
    expect(textareas[0]?.value).toBe("Hidden draft");
    expect(textareas[1]?.value).toBe("Prepared review");
  });

  it("never clicks an Approve control that would submit the review", async () => {
    document.body.innerHTML =
      '<form><button type="submit">Approve</button><textarea name="pull_request_review[body]">Existing draft</textarea></form>';

    let submitCount = 0;
    document.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      submitCount += 1;
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result).toEqual({ ok: false, error: "approve-option-not-found" });
    expect(submitCount).toBe(0);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Existing draft");
  });

  it("opens a classic review panel from a visible summary in closed details", async () => {
    document.body.innerHTML = "<details><summary>Review changes</summary></details>";
    document.querySelector("summary")?.addEventListener("click", () => {
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form><input type="radio" name="pull_request_review[event]" value="approve"><textarea name="pull_request_review[body]"></textarea></form>',
      );
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Prepared review");
  });

  it("does not mistake an inline comment form for the review submission panel", async () => {
    document.body.innerHTML =
      '<form data-testid="inline-comment"><textarea class="js-comment-field">Inline draft</textarea><button type="submit">Add review comment</button></form><button data-testid="review-changes-button">Review changes</button>';

    let openerClicks = 0;
    document
      .querySelector<HTMLButtonElement>('[data-testid="review-changes-button"]')
      ?.addEventListener("click", () => {
        openerClicks += 1;
        document.body.insertAdjacentHTML(
          "beforeend",
          '<form data-testid="review-panel"><input type="radio" name="pull_request_review[event]" value="approve"><textarea class="js-comment-field">Review draft</textarea><button type="submit">Submit review</button></form>',
        );
      });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result.ok).toBe(true);
    expect(openerClicks).toBe(1);
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="inline-comment"] textarea')?.value,
    ).toBe("Inline draft");
    expect(
      document.querySelector<HTMLTextAreaElement>('[data-testid="review-panel"] textarea')?.value,
    ).toBe("Prepared review");
  });

  it("does not click a plain Approve button whose selected state cannot be verified", async () => {
    document.body.innerHTML =
      '<form><button type="button">Approve</button><textarea name="pull_request_review[body]">Existing draft</textarea></form>';

    let clickCount = 0;
    document.querySelector("button")?.addEventListener("click", () => {
      clickCount += 1;
    });

    const result = await prepareApprovalReview(document, {
      text: "Prepared review",
      cursorOffset: 9,
    });

    expect(result).toEqual({ ok: false, error: "approve-option-not-found" });
    expect(clickCount).toBe(0);
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("Existing draft");
  });
});

it("does not edit or open a review after the feature is disabled", async () => {
  document.body.innerHTML =
    '<button type="button" data-testid="review-changes-button">Review changes</button><textarea>keep</textarea>';
  let clicked = false;
  document.querySelector("button")!.addEventListener("click", () => {
    clicked = true;
  });
  const result = await prepareApprovalReview(
    document,
    { text: "replace", cursorOffset: 0 },
    () => false,
  );
  expect(result.ok).toBe(false);
  expect(clicked).toBe(false);
  expect(document.querySelector("textarea")!.value).toBe("keep");
});
