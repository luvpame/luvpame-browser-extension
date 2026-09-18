export const HEADER_SELECTORS = [
  "#partial-discussion-header h1",
  "h1.gh-header-title",
  "main h1",
] as const;
export const TITLE_SELECTORS = ["[data-testid='issue-title']", ".markdown-title", "bdi"] as const;
export const TITLE_NOISE_PATTERNS = [/^#\d+$/, /^Edit title$/i] as const;

export const ACTIONS_CONTAINER_CLASS = "github-enhancer-pr-copy-actions";
export const COPY_BUTTON_CLASS = "github-enhancer-pr-copy-button";
export const COPIED_BUTTON_CLASS = "is-copied";
export const FEEDBACK_STYLE_ID = "github-enhancer-pr-copy-style";
export const COPIED_LABEL = "✓ Copied";
export const FEEDBACK_DURATION_MS = 1000;

const buttonRestoreTimers = new WeakMap<HTMLButtonElement, number>();

export interface CopyButtonSpec {
  label: "Title" | "Url" | "Textlink";
  text: string;
}

export const isTitleNoise = (text: string): boolean =>
  TITLE_NOISE_PATTERNS.some((pattern) => pattern.test(text));

const getCleanText = (text: string | null | undefined): string => text?.trim() ?? "";

export const getHeaderElement = (root: ParentNode = document): HTMLElement | null => {
  for (const selector of HEADER_SELECTORS) {
    const headerElement = root.querySelector(selector);
    if (headerElement instanceof HTMLElement) {
      return headerElement;
    }
  }

  return null;
};

const getTitleFromSelectors = (headerElement: ParentNode): string => {
  for (const selector of TITLE_SELECTORS) {
    const titleText = getCleanText(headerElement.querySelector(selector)?.textContent);
    if (titleText && !isTitleNoise(titleText)) {
      return titleText;
    }
  }

  return "";
};

const getTitleFromTextNodes = (headerElement: ParentNode): string =>
  Array.from(headerElement.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => getCleanText(node.textContent))
    .filter(Boolean)
    .filter((text) => !isTitleNoise(text))
    .join(" ")
    .trim();

export const getTitleText = (headerElement: ParentNode): string => {
  const selectedTitle = getTitleFromSelectors(headerElement);
  if (selectedTitle) {
    return selectedTitle;
  }

  return getTitleFromTextNodes(headerElement);
};

export const sanitizeTitleForMarkdownLink = (title: string): string =>
  title.replaceAll("[", "【").replaceAll("]", "】").replaceAll("(", "（").replaceAll(")", "）");

export const createCopyButtonSpecs = (title: string, url: string): CopyButtonSpec[] => [
  { label: "Title", text: title },
  { label: "Url", text: url },
  {
    label: "Textlink",
    text: `[${sanitizeTitleForMarkdownLink(title)}](${url})`,
  },
];

const ensureFeedbackStyle = (doc: Document): void => {
  if (doc.getElementById(FEEDBACK_STYLE_ID)) {
    return;
  }

  const styleElement = doc.createElement("style");
  styleElement.id = FEEDBACK_STYLE_ID;
  styleElement.textContent = `
    .${ACTIONS_CONTAINER_CLASS} {
      display: inline-flex;
      gap: 10px;
      margin-left: 10px;
      vertical-align: middle;
    }

    .${COPY_BUTTON_CLASS}.${COPIED_BUTTON_CLASS} {
      border-color: var(--fgColor-success, #1a7f37);
      box-shadow: inset 0 0 0 1px var(--fgColor-success, #1a7f37);
      color: var(--fgColor-success, #1a7f37);
    }
  `;

  (doc.head ?? doc.body).appendChild(styleElement);
};

const showCopiedFeedback = (button: HTMLButtonElement, initialLabel: string): void => {
  const existingTimer = buttonRestoreTimers.get(button);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  button.textContent = COPIED_LABEL;
  button.classList.add(COPIED_BUTTON_CLASS);

  const restoreTimer = window.setTimeout(() => {
    button.textContent = initialLabel;
    button.classList.remove(COPIED_BUTTON_CLASS);
    buttonRestoreTimers.delete(button);
  }, FEEDBACK_DURATION_MS);

  buttonRestoreTimers.set(button, restoreTimer);
};

const createButton = (doc: Document, { label, text }: CopyButtonSpec): HTMLButtonElement => {
  const button = doc.createElement("button");
  button.textContent = label;
  button.classList.add("btn", "btn-sm", COPY_BUTTON_CLASS);
  button.addEventListener("click", async () => {
    if (!text) {
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showCopiedFeedback(button, label);
    } catch (error: unknown) {
      console.error(error);
    }
  });

  return button;
};

const createActionsContainer = (doc: Document, title: string, url: string): HTMLSpanElement => {
  const container = doc.createElement("span");
  container.classList.add(ACTIONS_CONTAINER_CLASS);
  container.dataset.copyTitle = title;
  container.dataset.copyUrl = url;

  for (const buttonSpec of createCopyButtonSpecs(title, url)) {
    container.appendChild(createButton(doc, buttonSpec));
  }

  return container;
};

const isCurrentActionsContainer = (element: Element | null, title: string, url: string): boolean =>
  element instanceof HTMLElement &&
  element.dataset.copyTitle === title &&
  element.dataset.copyUrl === url;

export const ensurePrCopyButtons = (
  doc: Document = document,
  url: string = window.location.href,
): boolean => {
  ensureFeedbackStyle(doc);

  const headerElement = getHeaderElement(doc);
  if (!headerElement) {
    return false;
  }

  const title = getTitleText(headerElement);
  if (!title) {
    return false;
  }

  const existingContainer = headerElement.querySelector(`.${ACTIONS_CONTAINER_CLASS}`);
  if (isCurrentActionsContainer(existingContainer, title, url)) {
    return false;
  }

  if (existingContainer instanceof HTMLElement) {
    existingContainer.remove();
  }

  headerElement.appendChild(createActionsContainer(doc, title, url));

  return true;
};

export const removePrCopyButtons = (doc: Document = document): void => {
  doc.querySelectorAll(`.${ACTIONS_CONTAINER_CLASS}`).forEach((element) => element.remove());
};
