export type PreparedReviewTemplate = {
  text: string;
  cursorOffset: number;
};

export type ApprovalReviewResult =
  | {
      ok: true;
      textarea: HTMLTextAreaElement;
    }
  | {
      ok: false;
      error:
        | "review-button-not-found"
        | "review-body-not-found"
        | "review-body-update-failed"
        | "approve-option-not-found";
    };

const REVIEW_BUTTON_SELECTORS = [
  'button[type="button"][data-dd-action-name="pull_requests.review.open"]',
  'button[type="button"][data-dd-action-name="pull_requests.review.cancel"][data-variant="primary"]',
  '[data-testid="review-changes-button"]',
  "button.js-review-changes",
  ".js-review-changes",
  ".pr-review-tools .js-reviews-toggle",
  'button[data-hotkey="v"]',
];

const REVIEW_TOOLBAR_BUTTON_SELECTOR =
  'button[data-component="Button"][data-variant="primary"][type="button"]';
const REVIEW_TOOLBAR_HEADING = "pull request toolbar";
const REVIEW_LABELS = new Set(["review", "submit review"]);

const APPROVE_SELECTORS = [
  'input[name="pull_request_review[event]"][value="approve"]',
  'input[name="pull_request_review[event]"][value="APPROVE"]',
  'input[type="radio"][value="approve"]',
  'input[type="radio"][value="APPROVE"]',
  '[data-review-event="approve"]',
  '[data-value="approve"]',
];

const STRONG_REVIEW_BODY_SELECTORS = [
  'textarea[name="pull_request_review[body]"]',
  "#pull_request_review_body",
];

const GENERIC_REVIEW_BODY_SELECTORS = [
  "textarea.js-comment-field",
  'textarea[aria-label*="review" i]',
  'textarea[name="body"]',
];

const REVIEW_BODY_SELECTORS = [...STRONG_REVIEW_BODY_SELECTORS, ...GENERIC_REVIEW_BODY_SELECTORS];

const REVIEW_PANEL_SELECTORS = [
  '[data-testid="review-form"]',
  '[data-testid="review-panel"]',
  "#pull_requests_submit_review",
  "dialog[open]",
  '[role="dialog"]',
  "details[open] > details-dialog",
  "[popover]:not([hidden])",
];

const REVIEW_PANEL_CONTAINER_SELECTOR =
  'form, dialog, [role="dialog"], section, [data-testid="review-form"], [data-testid="review-panel"]';

const REVIEW_POPUP_VALUES = new Set(["menu", "dialog", "true"]);
const REVIEW_PANEL_HEADING = "finish your review";

export async function prepareApprovalReview(
  document: Document,
  template: PreparedReviewTemplate,
  isActive: () => boolean = () => true,
): Promise<ApprovalReviewResult> {
  if (!isActive()) return { ok: false, error: "review-button-not-found" };
  let panel = findExistingReviewPanel(document);
  if (!panel) {
    const reviewButton = findReviewOpener(document);
    if (!reviewButton) {
      return { ok: false, error: "review-button-not-found" };
    }

    reviewButton.click();
    panel = await waitForElement(document, () => findExistingReviewPanel(document));
  }

  if (!panel) {
    return { ok: false, error: "review-body-not-found" };
  }

  if (!isActive()) return { ok: false, error: "review-body-not-found" };
  const textarea = findReviewBody(panel);
  if (!textarea) {
    return { ok: false, error: "review-body-not-found" };
  }

  const approveOption = findElement(panel, APPROVE_SELECTORS) ?? findApproveByText(panel);
  if (!approveOption) {
    return { ok: false, error: "approve-option-not-found" };
  }

  if (!selectApproveOption(approveOption, panel)) {
    return { ok: false, error: "approve-option-not-found" };
  }

  if (!setTextareaValue(textarea, template.text)) {
    return { ok: false, error: "review-body-update-failed" };
  }
  textarea.focus({ preventScroll: true });

  const cursorOffset = Math.min(Math.max(template.cursorOffset, 0), template.text.length);
  textarea.setSelectionRange(cursorOffset, cursorOffset);

  return { ok: true, textarea };
}

export function findReviewOpener(document: Document): HTMLElement | null {
  const selected = findElement<HTMLElement>(document, REVIEW_BUTTON_SELECTORS);
  if (selected && !isSubmitControl(selected)) {
    return selected;
  }

  const candidates = document.querySelectorAll<HTMLElement>('button, summary, [role="button"]');
  for (const candidate of candidates) {
    if (!isVisible(candidate) || isSubmitControl(candidate)) {
      continue;
    }

    const accessibleName = getAccessibleName(candidate);
    if (/^(?:Review changes|Finish your review)(?:\s+\d+)?$/i.test(accessibleName)) {
      return candidate;
    }

    if (/^Submit review$/i.test(accessibleName) && isReviewPopupControl(candidate)) {
      return candidate;
    }
  }

  return findReviewToolbarButton(document);
}

function findReviewToolbarButton(document: Document): HTMLElement | null {
  for (const toolbar of document.querySelectorAll<HTMLElement>("section")) {
    if (!isPullRequestToolbar(toolbar)) {
      continue;
    }

    const candidates = toolbar.querySelectorAll<HTMLElement>(REVIEW_TOOLBAR_BUTTON_SELECTOR);
    for (const candidate of candidates) {
      if (isVisible(candidate) && hasReviewToolbarShape(candidate)) {
        return candidate;
      }
    }
  }

  return null;
}

function isPullRequestToolbar(section: HTMLElement): boolean {
  return Array.from(section.children).some(
    (child) =>
      child.tagName === "H2" && normalizeText(child.textContent ?? "") === REVIEW_TOOLBAR_HEADING,
  );
}

function hasReviewToolbarShape(button: HTMLElement): boolean {
  const labelContainer = button.querySelector('[data-component="text"]');
  const trailingAction = button.querySelector('[data-component="trailingAction"]');
  if (!labelContainer || !trailingAction) {
    return false;
  }

  const labels = [labelContainer, ...labelContainer.querySelectorAll("*")];
  return labels.some((label) => REVIEW_LABELS.has(normalizeText(label.textContent ?? "")));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

function isReviewPopupControl(element: HTMLElement): boolean {
  if (element.tagName !== "BUTTON") {
    return false;
  }

  const type = element.getAttribute("type")?.trim().toLowerCase();
  const popup = element.getAttribute("aria-haspopup")?.trim().toLowerCase();
  return type === "button" && popup !== undefined && REVIEW_POPUP_VALUES.has(popup);
}

function findElement<TElement extends Element = HTMLElement>(
  root: ParentNode,
  selectors: string[],
): TElement | null {
  for (const selector of selectors) {
    const elements = root.querySelectorAll<TElement>(selector);
    for (const element of elements) {
      if (isVisible(element)) {
        return element;
      }
    }
  }

  return null;
}

function findExistingReviewPanel(document: Document): Element | null {
  const strongTextarea = findElement<HTMLTextAreaElement>(document, STRONG_REVIEW_BODY_SELECTORS);
  if (strongTextarea) {
    return strongTextarea.closest(REVIEW_PANEL_CONTAINER_SELECTOR) ?? strongTextarea.parentElement;
  }

  const explicitPanels = document.querySelectorAll<HTMLElement>(REVIEW_PANEL_SELECTORS.join(", "));
  for (const panel of explicitPanels) {
    if (!isVisible(panel)) {
      continue;
    }

    if (findElement<HTMLTextAreaElement>(panel, REVIEW_BODY_SELECTORS)) {
      return panel;
    }

    if (hasReviewControl(panel) && findVisibleTextarea(panel)) {
      return panel;
    }
  }

  const headingPanel = findReviewPanelByHeading(document);
  if (headingPanel) {
    return headingPanel;
  }

  const genericTextareas = document.querySelectorAll<HTMLTextAreaElement>(
    GENERIC_REVIEW_BODY_SELECTORS.join(", "),
  );
  for (const textarea of genericTextareas) {
    const panel = textarea.closest("form, section");
    if (panel && isVisible(panel) && hasReviewControl(panel)) {
      return panel;
    }
  }

  return null;
}

function findReviewBody(root: ParentNode): HTMLTextAreaElement | null {
  return findElement<HTMLTextAreaElement>(root, REVIEW_BODY_SELECTORS) ?? findVisibleTextarea(root);
}

function findVisibleTextarea(root: ParentNode): HTMLTextAreaElement | null {
  const textareas = root.querySelectorAll<HTMLTextAreaElement>("textarea");
  for (const textarea of textareas) {
    if (isVisible(textarea)) {
      return textarea;
    }
  }

  return null;
}

function findReviewPanelByHeading(document: Document): Element | null {
  const headings = document.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6, [role=heading]");

  for (const heading of headings) {
    if (!isVisible(heading) || normalizeText(heading.textContent ?? "") !== REVIEW_PANEL_HEADING) {
      continue;
    }

    for (
      let panel = heading.parentElement;
      panel && panel !== document.body;
      panel = panel.parentElement
    ) {
      if (isVisible(panel) && hasReviewControl(panel) && findVisibleTextarea(panel)) {
        return panel;
      }
    }
  }

  return null;
}

function hasReviewControl(root: ParentNode): boolean {
  const approveControl = findElement(root, APPROVE_SELECTORS) ?? findApproveByText(root);
  return Boolean(
    (approveControl && canVerifyApproveSelection(approveControl)) || findSubmitReviewControl(root),
  );
}

function findSubmitReviewControl(root: ParentNode): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>('button, input[type="submit"]');
  for (const candidate of candidates) {
    if (
      isVisible(candidate) &&
      isSubmitControl(candidate) &&
      /^Submit review$/i.test(getAccessibleName(candidate))
    ) {
      return candidate;
    }
  }

  return null;
}

async function waitForElement<TElement>(
  document: Document,
  find: () => TElement | null,
): Promise<TElement | null> {
  const initial = find();
  if (initial) {
    return initial;
  }

  const ownerWindow = document.defaultView;
  const MutationObserverConstructor = ownerWindow?.MutationObserver;
  const root = document.documentElement;
  if (!MutationObserverConstructor || !root) {
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    let timeoutId: number;
    const finish = (element: TElement | null): void => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        ownerWindow.clearTimeout(timeoutId);
        resolve(element);
      }
    };
    const observer = new MutationObserverConstructor(() => {
      const element = find();
      if (element) {
        finish(element);
      }
    });
    timeoutId = ownerWindow.setTimeout(() => finish(null), 3000);

    observer.observe(root, {
      attributeFilter: ["aria-hidden", "class", "hidden", "open", "style"],
      attributes: true,
      childList: true,
      subtree: true,
    });
  });
}

function findApproveByText(root: ParentNode): HTMLElement | null {
  const candidates = root.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="menuitemradio"], [role="radio"], label',
  );

  for (const candidate of candidates) {
    if (
      isVisible(candidate) &&
      !isSubmitControl(candidate) &&
      getAccessibleName(candidate).toLowerCase() === "approve"
    ) {
      return candidate;
    }
  }

  return null;
}

function selectApproveOption(option: HTMLElement, root: ParentNode): boolean {
  if (isSubmitControl(option) || !canVerifyApproveSelection(option)) {
    return false;
  }

  option.click();

  if (option.tagName === "INPUT" && option.getAttribute("type")?.toLowerCase() === "radio") {
    return (option as HTMLInputElement).checked;
  }

  const role = option.getAttribute("role");
  if (role === "radio" || role === "menuitemradio") {
    return option.getAttribute("aria-checked") === "true";
  }

  if (option.hasAttribute("aria-checked")) {
    return option.getAttribute("aria-checked") === "true";
  }

  if (option.hasAttribute("aria-pressed")) {
    return option.getAttribute("aria-pressed") === "true";
  }

  if (
    option.getAttribute("data-selected") === "true" ||
    ["active", "checked", "selected"].includes(option.getAttribute("data-state") ?? "")
  ) {
    return true;
  }

  if (option.tagName === "LABEL") {
    const control = (option as HTMLLabelElement).control;
    if (control?.tagName === "INPUT" && control.getAttribute("type")?.toLowerCase() === "radio") {
      return (control as HTMLInputElement).checked;
    }
  }

  const selectedInput = Array.from(
    root.querySelectorAll<HTMLInputElement>('input[type="radio"][value]'),
  ).find((input) => input.value.toLowerCase() === "approve" && input.checked);
  if (selectedInput) {
    return true;
  }

  return Array.from(
    root.querySelectorAll<HTMLElement>('[role="radio"], [role="menuitemradio"]'),
  ).some(
    (candidate) =>
      getAccessibleName(candidate).toLowerCase() === "approve" &&
      candidate.getAttribute("aria-checked") === "true",
  );
}

function canVerifyApproveSelection(option: HTMLElement): boolean {
  if (option.tagName === "INPUT" && option.getAttribute("type")?.toLowerCase() === "radio") {
    return true;
  }

  if (option.tagName === "LABEL") {
    const control = (option as HTMLLabelElement).control;
    if (control?.tagName === "INPUT" && control.getAttribute("type")?.toLowerCase() === "radio") {
      return true;
    }
  }

  const role = option.getAttribute("role");
  if (role === "radio" || role === "menuitemradio") {
    return option.hasAttribute("aria-checked");
  }

  return ["aria-checked", "aria-pressed", "data-selected", "data-state"].some((attribute) =>
    option.hasAttribute(attribute),
  );
}

function isSubmitControl(element: HTMLElement): boolean {
  const button = element.closest<HTMLButtonElement>("button");
  if (button) {
    const type = button.getAttribute("type")?.trim().toLowerCase();
    if (type === "submit" || (!type && button.closest("form"))) {
      return true;
    }
  }

  const input = element.closest<HTMLInputElement>("input");
  return input?.getAttribute("type")?.trim().toLowerCase() === "submit";
}

function isVisible(element: Element): boolean {
  if (element.closest('[hidden], [aria-hidden="true"]')) {
    return false;
  }

  for (let current = element.parentElement; current; current = current.parentElement) {
    if (current.tagName !== "DETAILS" || current.hasAttribute("open")) {
      continue;
    }

    const summary = Array.from(current.children).find((child) => child.tagName === "SUMMARY");
    if (!summary?.contains(element)) {
      return false;
    }
  }

  const ownerWindow = element.ownerDocument.defaultView;
  if (!ownerWindow) {
    return true;
  }

  for (let current: Element | null = element; current; current = current.parentElement) {
    const styles = ownerWindow.getComputedStyle(current);
    if (
      styles.display === "none" ||
      styles.visibility === "hidden" ||
      styles.visibility === "collapse"
    ) {
      return false;
    }
  }

  return true;
}

function getAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }

  if (element instanceof HTMLInputElement) {
    return element.value.trim();
  }

  return element.textContent?.trim() ?? "";
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string): boolean {
  const textareaConstructor = textarea.ownerDocument.defaultView?.HTMLTextAreaElement;
  const setter = textareaConstructor
    ? Object.getOwnPropertyDescriptor(textareaConstructor.prototype, "value")?.set
    : undefined;
  if (setter) {
    setter.call(textarea, value);
  } else {
    textarea.value = value;
  }

  const eventConstructor = textarea.ownerDocument.defaultView?.Event ?? Event;
  textarea.dispatchEvent(new eventConstructor("input", { bubbles: true }));
  textarea.dispatchEvent(new eventConstructor("change", { bubbles: true }));
  return textarea.value === value;
}
