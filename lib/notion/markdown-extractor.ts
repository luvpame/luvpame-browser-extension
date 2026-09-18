// @ts-ignore europa ships types for the public entrypoint, not this ESM subpath.
import Europa from "europa/lib/esm/europa.mjs";

const NOTION_PAGE_SELECTORS = [
  ".notion-page-content",
  '[data-block-id][class*="notion-"][class*="-block"]',
  ".notion-scroller.vertical",
];

const NOTION_BLOCK_SELECTOR = "[data-block-id]";
const CHECKBOX_SELECTOR = 'input[type="checkbox"], [role="checkbox"][aria-checked]';
const BLOCK_TYPE_CLASS_PATTERN = /\bnotion-([a-z0-9_]+)-block\b/i;
const INLINE_WRAPPER_SELECTOR = "div";
const BLOCK_LEVEL_CHILD_SELECTOR = [
  NOTION_BLOCK_SELECTOR,
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "pre",
  "blockquote",
  "table",
].join(", ");
const HIDDEN_SELECTORS = [
  "[hidden]",
  '[aria-hidden="true"]',
  "script",
  "style",
  "noscript",
  "template",
];

export type ExtractResult = { success: true; markdown: string } | { success: false; error: string };

type NotionListType = "bulleted_list" | "numbered_list" | "to_do";

const findPageContent = (doc: Document): Element | null => {
  for (const selector of NOTION_PAGE_SELECTORS) {
    const el = doc.querySelector(selector);
    if (el) return el;
  }

  return null;
};

const isHiddenByStyle = (element: HTMLElement): boolean => {
  const { display, visibility } = element.style;
  return display === "none" || visibility === "hidden";
};

const readCheckboxState = (element: Element): boolean => {
  if (element.tagName === "INPUT" && element.getAttribute("type") === "checkbox") {
    return (element as HTMLInputElement).checked;
  }

  return element.getAttribute("aria-checked") === "true";
};

const getBlockType = (element: Element): NotionListType | null => {
  const className = element.getAttribute("class");
  if (!className) {
    return null;
  }

  const match = className.match(BLOCK_TYPE_CLASS_PATTERN);
  if (!match) {
    return null;
  }

  const blockType = match[1]?.toLowerCase();
  if (blockType === "bulleted_list" || blockType === "numbered_list" || blockType === "to_do") {
    return blockType;
  }

  return null;
};

const removeHiddenAndNoise = (root: HTMLElement): void => {
  root.querySelectorAll(HIDDEN_SELECTORS.join(", ")).forEach((element) => {
    element.remove();
  });

  root.querySelectorAll<HTMLElement>("*").forEach((element) => {
    if (isHiddenByStyle(element)) {
      element.remove();
    }
  });
};

const hasOwnCheckbox = (element: Element): boolean =>
  Array.from(element.querySelectorAll(CHECKBOX_SELECTOR)).some(
    (checkbox) => checkbox.closest(NOTION_BLOCK_SELECTOR) === element,
  );

const getBlockId = (element: Element): string | null => element.getAttribute("data-block-id");

const hasAncestorBlockWithSameId = (element: Element): boolean => {
  const blockId = getBlockId(element);
  if (!blockId) {
    return false;
  }

  let ancestor = element.parentElement?.closest(NOTION_BLOCK_SELECTOR);
  while (ancestor) {
    if (getBlockId(ancestor) === blockId) {
      return true;
    }

    ancestor = ancestor.parentElement?.closest(NOTION_BLOCK_SELECTOR);
  }

  return false;
};

const removeMirroredDescendantBlocks = (root: HTMLElement, blockId: string | null): void => {
  if (!blockId) {
    return;
  }

  root.querySelectorAll<HTMLElement>(NOTION_BLOCK_SELECTOR).forEach((element) => {
    if (getBlockId(element) === blockId) {
      element.remove();
    }
  });
};

const flattenInlineWrappers = (root: HTMLElement): void => {
  Array.from(root.querySelectorAll<HTMLElement>(INLINE_WRAPPER_SELECTOR)).forEach((element) => {
    if (element.hasAttribute("data-block-id")) {
      return;
    }

    if (element.querySelector(BLOCK_LEVEL_CHILD_SELECTOR)) {
      return;
    }

    const inlineWrapper = root.ownerDocument.createElement("span");
    Array.from(element.attributes).forEach((attribute) => {
      inlineWrapper.setAttribute(attribute.name, attribute.value);
    });

    while (element.firstChild) {
      inlineWrapper.append(element.firstChild);
    }

    element.replaceWith(inlineWrapper);
  });
};

const createListItem = (
  root: HTMLElement,
  block: HTMLElement,
  listType: NotionListType,
): HTMLLIElement => {
  const item = root.ownerDocument.createElement("li");
  const itemContent = block.cloneNode(true) as HTMLElement;
  const blockId = getBlockId(block);

  itemContent.querySelectorAll("button, svg").forEach((element) => {
    element.remove();
  });

  removeMirroredDescendantBlocks(itemContent, blockId);

  if (listType === "to_do") {
    const checkbox = Array.from(block.querySelectorAll(CHECKBOX_SELECTOR)).find(
      (candidate) => candidate.closest(NOTION_BLOCK_SELECTOR) === block,
    );

    itemContent.querySelectorAll(CHECKBOX_SELECTOR).forEach((element) => {
      element.remove();
    });

    item.append(`${checkbox && readCheckboxState(checkbox) ? "[x]" : "[ ]"} `);
  }

  flattenInlineWrappers(itemContent);

  while (itemContent.firstChild) {
    item.append(itemContent.firstChild);
  }

  return item;
};

const normalizeListBlocks = (root: HTMLElement): void => {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>(NOTION_BLOCK_SELECTOR)).filter(
    (block) => !hasAncestorBlockWithSameId(block),
  );
  let currentList: HTMLOListElement | HTMLUListElement | null = null;
  let currentListType: NotionListType | null = null;

  blocks.forEach((block) => {
    const blockType = getBlockType(block) ?? (hasOwnCheckbox(block) ? "to_do" : null);
    if (!blockType) {
      currentList = null;
      currentListType = null;
      return;
    }

    const shouldReuseList = currentList !== null && currentListType === blockType;

    if (!shouldReuseList) {
      currentList = root.ownerDocument.createElement(blockType === "numbered_list" ? "ol" : "ul");
      currentListType = blockType;
      block.replaceWith(currentList);
    } else {
      block.remove();
    }

    const list = currentList;
    if (!list) {
      return;
    }

    list.append(createListItem(root, block, blockType));
  });
};

const normalizeInlineCheckboxes = (root: HTMLElement): void => {
  root.querySelectorAll(CHECKBOX_SELECTOR).forEach((element) => {
    element.replaceWith(`${readCheckboxState(element) ? "[x]" : "[ ]"} `);
  });
};

const normalizeMarkdown = (markdown: string): string =>
  markdown
    .replace(/^\* /gm, "- ")
    .replace(/\\\[(x| )\\\]/gi, "[$1]")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const createNormalizedRoot = (content: Element): HTMLElement => {
  const root = content.cloneNode(true) as HTMLElement;

  removeHiddenAndNoise(root);
  normalizeListBlocks(root);
  normalizeInlineCheckboxes(root);

  return root;
};

const createEuropa = (doc: Document): Europa =>
  new Europa({
    baseUri: doc.baseURI,
    eol: "\n",
    inline: true,
  });

const withDocumentGlobals = <T>(doc: Document, callback: () => T): T => {
  const view = doc.defaultView;
  if (!view || (globalThis.window === view && globalThis.document === doc)) {
    return callback();
  }

  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousNode = globalThis.Node;

  globalThis.window = view;
  globalThis.document = doc;
  globalThis.Node = view.Node;

  try {
    return callback();
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.Node = previousNode;
  }
};

export const extractPageMarkdown = (doc: Document = document): ExtractResult => {
  const content = findPageContent(doc);
  if (!content) {
    return {
      success: false,
      error:
        "Notion のページコンテンツが見つかりませんでした。ページを開いた状態で実行してください。",
    };
  }

  const normalizedRoot = createNormalizedRoot(content);
  const markdown = withDocumentGlobals(doc, () =>
    normalizeMarkdown(createEuropa(doc).convert(normalizedRoot)),
  );

  if (!markdown) {
    return { success: false, error: "ページにコンテンツがありません。" };
  }

  return { success: true, markdown };
};
