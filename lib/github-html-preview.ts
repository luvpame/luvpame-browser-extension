export const HTML_PREVIEW_BUTTON_CLASS = "github-enhancer-html-preview-button";
export const HTML_PREVIEW_PANEL_CLASS = "github-enhancer-html-preview-panel";
export const HTML_PREVIEW_STYLE_ID = "github-enhancer-html-preview-style";

export interface RawUrlInput {
  owner: string;
  repo: string;
  ref: string;
  path: string;
}

export interface HtmlPreviewContext {
  owner: string;
  repo: string;
  ref?: string;
  sourceOwner?: string;
  sourceRepo?: string;
  fetchHtml?: (url: string) => Promise<string>;
}

export interface ChangedFile {
  element: HTMLElement;
  header: HTMLElement;
  buttonTarget: HTMLElement;
  panelTarget: HTMLElement;
  viewTarget?: HTMLElement;
  path: string;
  ref?: string;
  sourceUrl?: string;
}

const FILE_SELECTORS = ["[data-file-path]", "[data-testid='file']", ".file"] as const;
const REACT_DIFF_HEADER_SELECTOR = "[data-diff-header-wrapper='true']";
const REPLACED_VIEW_CLASS = "github-enhancer-html-preview-replaced-view";
const DIFF_BODY_SELECTOR = ".js-file-content, .blob-wrapper";

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const fetchText = async (url: string): Promise<string> => {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
};

export const buildBlobUrlFromRawUrl = (url: string): string => url.replace("/raw/", "/blob/");

export const extractHtmlFromBlobPage = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const embeddedData = doc.querySelector<HTMLScriptElement>(
    "script[data-target='react-app.embeddedData']",
  )?.textContent;
  if (!embeddedData) {
    return "";
  }

  const payload = JSON.parse(embeddedData) as {
    payload?: { "codeViewBlobLayoutRoute.StyledBlob"?: { rawLines?: string[] } };
  };
  return payload.payload?.["codeViewBlobLayoutRoute.StyledBlob"]?.rawLines?.join("\n") ?? "";
};

const defaultFetchHtml = async (url: string): Promise<string> => {
  try {
    return await fetchText(url);
  } catch (rawError) {
    try {
      const html = extractHtmlFromBlobPage(await fetchText(buildBlobUrlFromRawUrl(url)));
      if (!html) {
        throw new Error(`Could not extract raw lines from ${buildBlobUrlFromRawUrl(url)}`);
      }

      return html;
    } catch (blobError) {
      throw new Error(`${getErrorMessage(rawError)}; ${getErrorMessage(blobError)}`);
    }
  }
};

export const buildRawUrl = ({ owner, repo, ref, path }: RawUrlInput): string =>
  `https://github.com/${owner}/${repo}/raw/${getRawUrlRef(ref)}/${path}`;

export const buildRawUrlFromBlobUrl = (url: string): string =>
  new URL(url.replace("/blob/", "/raw/"), "https://github.com").href;

const getRawUrlRef = (ref: string): string =>
  /^[0-9a-f]{40}$/i.test(ref) || ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;

const getFileBlobUrl = (element: HTMLElement, path: string): string | undefined =>
  getFileBlobLink(element, path)?.getAttribute("href") ?? undefined;

const getFilePath = (element: HTMLElement): string => {
  const fromDataset = element.dataset.filePath;
  if (fromDataset) {
    return fromDataset;
  }

  const reactFileName = element.querySelector<HTMLElement>("[class*='file-name'] code");
  const reactFileNameText = reactFileName?.textContent?.replaceAll("\u200E", "").trim();
  if (reactFileNameText) {
    return reactFileNameText;
  }

  const titledLink = element.querySelector<HTMLElement>("[title]");
  return titledLink?.getAttribute("title")?.trim() ?? "";
};

const getFileRef = (element: HTMLElement, path: string): string | undefined => {
  const blobLink = getFileBlobLink(element, path);
  const [, ref] = blobLink?.pathname.match(/\/blob\/([^/]+)\//) ?? [];

  return ref;
};

const getFileBlobLink = (element: HTMLElement, path: string): HTMLAnchorElement | undefined =>
  Array.from(element.querySelectorAll<HTMLAnchorElement>("a[href*='/blob/']")).find((link) =>
    link.pathname.endsWith(`/${path}`),
  );

const getChangedFileHeader = (element: HTMLElement): HTMLElement | null => {
  if (element.matches(REACT_DIFF_HEADER_SELECTOR)) {
    return element;
  }

  return (
    element.querySelector<HTMLElement>(".file-header") ??
    element.querySelector<HTMLElement>("[data-testid='file-header']")
  );
};

const getButtonTarget = (header: HTMLElement): HTMLElement =>
  header.querySelector<HTMLElement>(".file-info .Truncate") ??
  header.querySelector<HTMLElement>("[class*='file-path-section']") ??
  header;

const getFileElement = (element: HTMLElement): HTMLElement => {
  if (!element.matches(REACT_DIFF_HEADER_SELECTOR)) {
    return element;
  }

  return element.closest<HTMLElement>("[role='region']") ?? element;
};

const getPanelTarget = (element: HTMLElement, header: HTMLElement): HTMLElement => {
  if (element.matches(REACT_DIFF_HEADER_SELECTOR)) {
    return header;
  }

  return element;
};

const getViewTarget = (fileElement: HTMLElement, header: HTMLElement): HTMLElement | undefined => {
  const nextElement = header.nextElementSibling;
  if (!(nextElement instanceof HTMLElement)) {
    return fileElement.querySelector<HTMLElement>(DIFF_BODY_SELECTOR) ?? undefined;
  }

  if (!nextElement.classList.contains(HTML_PREVIEW_PANEL_CLASS)) {
    return nextElement;
  }

  const replacedNextElement = nextElement.nextElementSibling;
  if (replacedNextElement instanceof HTMLElement) {
    return replacedNextElement;
  }

  return fileElement.querySelector<HTMLElement>(DIFF_BODY_SELECTOR) ?? undefined;
};

const createChangedFile = (element: HTMLElement): ChangedFile | null => {
  const path = getFilePath(element);
  const header = getChangedFileHeader(element);
  if (!path || !header) {
    return null;
  }

  const fileElement = getFileElement(element);

  return {
    element: fileElement,
    header,
    buttonTarget: getButtonTarget(header),
    panelTarget: getPanelTarget(element, header),
    viewTarget: getViewTarget(fileElement, header),
    path,
    ref: getFileRef(fileElement, path),
    sourceUrl: getFileBlobUrl(fileElement, path),
  };
};

const getChangedFileElements = (doc: Document): HTMLElement[] => {
  const elements = [
    ...FILE_SELECTORS.flatMap((selector) =>
      Array.from(doc.querySelectorAll<HTMLElement>(selector)),
    ),
    ...Array.from(doc.querySelectorAll<HTMLElement>(REACT_DIFF_HEADER_SELECTOR)),
  ];

  return [...new Set(elements)];
};

export const findChangedFiles = (doc: Document = document): ChangedFile[] => {
  return getChangedFileElements(doc).flatMap((element) => {
    const file = createChangedFile(element);
    return file ? [file] : [];
  });
};

const ensureHtmlPreviewStyle = (doc: Document): void => {
  if (doc.getElementById(HTML_PREVIEW_STYLE_ID)) {
    return;
  }

  const styleElement = doc.createElement("style");
  styleElement.id = HTML_PREVIEW_STYLE_ID;
  styleElement.textContent = `
    .${HTML_PREVIEW_BUTTON_CLASS} {
      margin-left: 8px;
    }

    .${HTML_PREVIEW_PANEL_CLASS} {
      border-top: 1px solid var(--borderColor-default, #d0d7de);
      background: var(--bgColor-default, #ffffff);
      padding: 12px;
    }

    .${HTML_PREVIEW_PANEL_CLASS} iframe {
      width: 100%;
      height: calc(100vh - 160px);
      min-height: 640px;
      border: 1px solid var(--borderColor-default, #d0d7de);
      border-radius: 6px;
      background: #ffffff;
    }
  `;

  (doc.head ?? doc.body).appendChild(styleElement);
};

const createPanel = (doc: Document): HTMLDivElement => {
  const panel = doc.createElement("div");
  panel.classList.add(HTML_PREVIEW_PANEL_CLASS);

  return panel;
};

const renderIframe = (doc: Document, html: string): HTMLDivElement => {
  const panel = createPanel(doc);
  const iframe = doc.createElement("iframe");
  iframe.setAttribute("sandbox", "");
  iframe.srcdoc = html;
  panel.appendChild(iframe);

  return panel;
};

const renderMessage = (doc: Document, message: string): HTMLDivElement => {
  const panel = createPanel(doc);
  panel.textContent = message;

  return panel;
};

const restoreViewTarget = (element: HTMLElement): void => {
  element.hidden = false;
  element.classList.remove(REPLACED_VIEW_CLASS);
};

const toggleExistingPanel = (file: ChangedFile): boolean => {
  const sibling = file.panelTarget.nextElementSibling;
  const existingPanel =
    file.element.querySelector(`.${HTML_PREVIEW_PANEL_CLASS}`) ??
    (!file.viewTarget && sibling?.classList.contains(HTML_PREVIEW_PANEL_CLASS) ? sibling : null);
  if (!(existingPanel instanceof HTMLElement)) {
    return false;
  }

  existingPanel.remove();
  if (file.viewTarget) {
    restoreViewTarget(file.viewTarget);
  }

  return true;
};

const insertPreviewPanel = (file: ChangedFile, panel: HTMLDivElement): void => {
  if (!file.viewTarget) {
    file.panelTarget.insertAdjacentElement("afterend", panel);
    return;
  }

  file.viewTarget.hidden = true;
  file.viewTarget.classList.add(REPLACED_VIEW_CLASS);
  file.viewTarget.insertAdjacentElement("beforebegin", panel);
};

const resolvePreviewUrl = (file: ChangedFile, context: HtmlPreviewContext): string | null => {
  if (file.sourceUrl) {
    return buildRawUrlFromBlobUrl(file.sourceUrl);
  }

  const ref = context.ref ?? file.ref;
  if (!ref) {
    return null;
  }

  return buildRawUrl({
    owner: context.sourceOwner ?? context.owner,
    repo: context.sourceRepo ?? context.repo,
    ref,
    path: file.path,
  });
};

const previewGenerations = new WeakMap<Document, number>();

const loadPreview = async (
  doc: Document,
  file: ChangedFile,
  context: HtmlPreviewContext & { fetchHtml: (url: string) => Promise<string> },
): Promise<void> => {
  if (toggleExistingPanel(file)) {
    return;
  }

  const generation = previewGenerations.get(doc) ?? 0;
  const isCurrent = () =>
    generation === (previewGenerations.get(doc) ?? 0) && file.buttonTarget.isConnected;
  const previewUrl = resolvePreviewUrl(file, context);
  if (!previewUrl) {
    insertPreviewPanel(file, renderMessage(doc, "Could not resolve HTML preview source."));
    return;
  }

  try {
    const html = await context.fetchHtml(previewUrl);
    if (!isCurrent()) return;
    const panel = html ? renderIframe(doc, html) : renderMessage(doc, "HTML preview is empty.");
    insertPreviewPanel(file, panel);
  } catch (error: unknown) {
    if (!isCurrent()) return;
    console.error(error);
    insertPreviewPanel(
      file,
      renderMessage(doc, `Could not load HTML preview: ${getErrorMessage(error)}`),
    );
  }
};

const createPreviewButton = (
  doc: Document,
  file: ChangedFile,
  context: HtmlPreviewContext & { fetchHtml: (url: string) => Promise<string> },
): HTMLButtonElement => {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = "Preview HTML";
  button.classList.add("btn", "btn-sm", HTML_PREVIEW_BUTTON_CLASS);
  button.addEventListener("click", () => {
    if (button.disabled) return;
    button.disabled = true;
    void loadPreview(doc, file, context).finally(() => {
      button.disabled = false;
    });
  });

  return button;
};

const hasPreviewButton = (file: ChangedFile): boolean =>
  file.buttonTarget.querySelector(`.${HTML_PREVIEW_BUTTON_CLASS}`) !== null;

export const ensureHtmlPreviewButtons = (
  doc: Document = document,
  context: HtmlPreviewContext,
): void => {
  ensureHtmlPreviewStyle(doc);

  const previewContext = {
    ...context,
    fetchHtml: context.fetchHtml ?? defaultFetchHtml,
  };

  for (const file of findChangedFiles(doc)) {
    if (!file.path.endsWith(".html") || hasPreviewButton(file)) {
      continue;
    }

    file.buttonTarget.appendChild(createPreviewButton(doc, file, previewContext));
  }
};

export const removeHtmlPreviews = (doc: Document = document): void => {
  previewGenerations.set(doc, (previewGenerations.get(doc) ?? 0) + 1);
  doc.querySelectorAll(`.${HTML_PREVIEW_BUTTON_CLASS}`).forEach((element) => element.remove());
  doc.querySelectorAll(`.${HTML_PREVIEW_PANEL_CLASS}`).forEach((element) => element.remove());
  doc.querySelectorAll(`.${REPLACED_VIEW_CLASS}`).forEach((element) => {
    if (element instanceof HTMLElement) {
      restoreViewTarget(element);
    }
  });
};
