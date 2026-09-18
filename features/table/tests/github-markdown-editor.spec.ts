import { describe, expect, it, vi } from "vite-plus/test";

import {
  enhanceMarkdownEditors,
  findMarkdownEditors,
  type MarkdownTextareaElement,
  type MarkdownToolbarElement,
  replaceTextareaSelection,
  type TextInsertionTarget,
} from "../lib/github-markdown-editor";

const attachedEditorCount = 2;
const noAdditionalEditors = 0;
const selectionStartIndex = 7;
const selectionEndIndex = 12;
const firstToolbarId = "first";
const secondToolbarId = "second";
const commentBodyId = "comment-body";

const createToolbar = (textareaId: string): MarkdownToolbarElement => ({
  dataset: {},
  getAttribute: (attributeName: string) => {
    if (attributeName === "for") {
      return textareaId;
    }

    return undefined;
  },
});

const createTextarea = (): MarkdownTextareaElement => ({
  dispatchEvent: () => true,
  focus: () => {},
  selectionEnd: selectionStartIndex,
  selectionStart: selectionStartIndex,
  tagName: "TEXTAREA",
  value: "",
});

const createElementLookup =
  (
    entries: Record<string, MarkdownTextareaElement>,
  ): ((elementId: string) => MarkdownTextareaElement | undefined) =>
  (elementId) =>
    entries[elementId];

const createRoot = (
  toolbars: MarkdownToolbarElement[],
  textareas: Record<string, MarkdownTextareaElement>,
) => ({
  getElementById: createElementLookup(textareas),
  querySelectorAll: () => toolbars,
});

const createDynamicRoot = (entries: Record<string, MarkdownTextareaElement>) => {
  let toolbars = [createToolbar(firstToolbarId)];

  return {
    addToolbar: (toolbar: MarkdownToolbarElement): void => {
      toolbars = [...toolbars, toolbar];
    },
    root: {
      getElementById: createElementLookup(entries),
      querySelectorAll: () => toolbars,
    },
  };
};

const applyRangeText = function applyRangeText(
  this: TextInsertionTarget,
  ...[replacement, start, end]: [string, number, number]
): void {
  this.value = this.value.slice(0, start) + replacement + this.value.slice(end);
};

describe("findMarkdownEditors", () => {
  it("pairs markdown toolbars with matching textareas", () => {
    const toolbar = createToolbar(commentBodyId);
    const textarea = createTextarea();
    const root = createRoot([toolbar], { [commentBodyId]: textarea });

    expect(findMarkdownEditors(root)).toEqual([{ toolbar, textarea }]);
  });
});

describe("enhanceMarkdownEditors", () => {
  it("attaches controls only once per toolbar", () => {
    const firstToolbar = createToolbar(firstToolbarId);
    const secondToolbar = createToolbar(secondToolbarId);
    const firstTextarea = createTextarea();
    const secondTextarea = createTextarea();
    const attachControl = vi.fn();
    const root = createRoot([firstToolbar, secondToolbar], {
      [firstToolbarId]: firstTextarea,
      [secondToolbarId]: secondTextarea,
    });

    expect(enhanceMarkdownEditors(root, attachControl)).toBe(attachedEditorCount);
    expect(enhanceMarkdownEditors(root, attachControl)).toBe(noAdditionalEditors);
    expect(attachControl).toHaveBeenCalledTimes(attachedEditorCount);
  });

  it("enhances editors added after the initial scan", () => {
    const secondToolbar = createToolbar(secondToolbarId);
    const firstTextarea = createTextarea();
    const secondTextarea = createTextarea();
    const attachControl = vi.fn();
    const { addToolbar, root } = createDynamicRoot({
      [firstToolbarId]: firstTextarea,
      [secondToolbarId]: secondTextarea,
    });

    enhanceMarkdownEditors(root, attachControl);
    addToolbar(secondToolbar);
    enhanceMarkdownEditors(root, attachControl);

    expect(attachControl).toHaveBeenCalledTimes(attachedEditorCount);
    expect(attachControl).toHaveBeenLastCalledWith({
      toolbar: secondToolbar,
      textarea: secondTextarea,
    });
  });
});

describe("replaceTextareaSelection", () => {
  it("replaces the selected range and dispatches update events", () => {
    const dispatchedEvents: string[] = [];
    const textarea: TextInsertionTarget = {
      value: "before after",
      selectionStart: selectionStartIndex,
      selectionEnd: selectionEndIndex,
      dispatchEvent: (event) => {
        dispatchedEvents.push(event.type);
        return true;
      },
      focus: vi.fn(),
      setRangeText: vi.fn(applyRangeText),
    };

    const nextValue = replaceTextareaSelection(textarea, "table", (type) => new Event(type));

    expect(nextValue).toBe("before table");
    expect(textarea.value).toBe("before table");
    expect(dispatchedEvents).toEqual(["input", "change"]);
  });
});
