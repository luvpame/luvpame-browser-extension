import { suspendVim } from "../../../lib/editor-bridge";
const toolbarSelector = "markdown-toolbar[for]";
const enhancedToolbarFlag = "gmtiEnhanced";
const zeroIndex = 0;
const incrementByOne = 1;

export interface MarkdownToolbarElement {
  dataset: Record<string, string | undefined>;
  getAttribute: (attributeName: string) => string | null | undefined;
}

export interface MarkdownTextareaElement extends TextInsertionTarget {
  tagName: string;
}

export interface MarkdownEditorTarget {
  toolbar: MarkdownToolbarElement;
  textarea: MarkdownTextareaElement;
}

interface RootWithQuery {
  querySelectorAll: (selector: string) => Iterable<unknown>;
}

interface RootWithDocument {
  getElementById?: (elementId: string) => unknown;
  ownerDocument?: {
    getElementById: (elementId: string) => unknown;
  } | null;
}

type MarkdownEditorRoot = RootWithQuery & RootWithDocument;

const hasStringTagName = (value: unknown): value is { tagName: string } =>
  typeof value === "object" &&
  value !== null &&
  "tagName" in value &&
  typeof (value as { tagName: unknown }).tagName === "string";

const isToolbarElement = (value: unknown): value is MarkdownToolbarElement =>
  typeof value === "object" &&
  value !== null &&
  "dataset" in value &&
  "getAttribute" in value &&
  typeof (value as { getAttribute: unknown }).getAttribute === "function";

const isHtmlTextAreaElement = (value: unknown): value is MarkdownTextareaElement =>
  hasStringTagName(value) && value.tagName.toUpperCase() === "TEXTAREA";

const resolveGetElementById = (
  root: MarkdownEditorRoot,
): ((elementId: string) => unknown) | undefined => {
  if (typeof root.getElementById === "function") {
    return root.getElementById.bind(root);
  }

  return root.ownerDocument?.getElementById.bind(root.ownerDocument);
};

const toMarkdownEditorTarget = (
  toolbar: unknown,
  getElementById: (elementId: string) => unknown,
): MarkdownEditorTarget | undefined => {
  if (!isToolbarElement(toolbar)) {
    return undefined;
  }

  const textareaId = toolbar.getAttribute("for") ?? undefined;
  if (!textareaId) {
    return undefined;
  }

  const textarea = getElementById(textareaId);
  if (!isHtmlTextAreaElement(textarea)) {
    return undefined;
  }

  return { toolbar, textarea };
};

export const findMarkdownEditors = (root: MarkdownEditorRoot): MarkdownEditorTarget[] => {
  const getElementById = resolveGetElementById(root);
  if (getElementById === undefined) {
    return [];
  }

  return [...root.querySelectorAll(toolbarSelector)].flatMap((toolbar) => {
    const target = toMarkdownEditorTarget(toolbar, getElementById);
    if (target === undefined) {
      return [];
    }

    return [target];
  });
};

export const isToolbarEnhanced = (toolbar: MarkdownToolbarElement): boolean =>
  toolbar.dataset[enhancedToolbarFlag] === "true";

export const markToolbarEnhanced = (toolbar: MarkdownToolbarElement): void => {
  toolbar.dataset[enhancedToolbarFlag] = "true";
};

export const enhanceMarkdownEditors = (
  root: MarkdownEditorRoot,
  attachControl: (target: MarkdownEditorTarget) => void,
): number => {
  let attachedCount = 0;

  for (const target of findMarkdownEditors(root)) {
    if (!isToolbarEnhanced(target.toolbar)) {
      markToolbarEnhanced(target.toolbar);
      attachControl(target);
      attachedCount += incrementByOne;
    }
  }

  return attachedCount;
};

export interface TextInsertionTarget {
  value: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  dispatchEvent: (event: Event) => boolean;
  focus: () => void;
  setRangeText?: (
    ...parameters: [
      replacement: string,
      start: number,
      end: number,
      selectionMode?: "select" | "start" | "end" | "preserve",
    ]
  ) => void;
}

export const replaceTextareaSelection = (
  textarea: TextInsertionTarget,
  replacement: string,
  createEvent: (type: string) => Event = (type) => new Event(type, { bubbles: true }),
): string => {
  const resume = suspendVim();
  try {
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    const nextValue =
      textarea.value.slice(zeroIndex, selectionStart) +
      replacement +
      textarea.value.slice(selectionEnd);

    textarea.focus();

    if (typeof textarea.setRangeText === "function") {
      textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
    } else {
      textarea.value = nextValue;
    }

    textarea.dispatchEvent(createEvent("input"));
    textarea.dispatchEvent(createEvent("change"));

    return nextValue;
  } finally {
    resume(textarea instanceof HTMLTextAreaElement ? textarea : undefined);
  }
};
