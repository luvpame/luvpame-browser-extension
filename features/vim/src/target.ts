const MULTILINE_LINE_THRESHOLD = 1.75;

interface WindowLike {
  getComputedStyle: Window["getComputedStyle"];
  HTMLTextAreaElement?: {
    prototype: object;
  };
  Event?: typeof Event;
  ClipboardEvent?: typeof ClipboardEvent;
}

function isElement(value: unknown): value is HTMLElement {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as { nodeType?: unknown; tagName?: unknown };
  return candidate.nodeType === 1 && typeof candidate.tagName === "string";
}

function getTagName(element: unknown): string {
  return isElement(element) ? element.tagName.toLowerCase() : "";
}

function getWindow(element: HTMLElement): WindowLike {
  return (element.ownerDocument.defaultView ?? globalThis) as WindowLike;
}

export function isTextarea(element: unknown): element is HTMLTextAreaElement {
  if (!isElement(element) || getTagName(element) !== "textarea") {
    return false;
  }

  const textarea = element as HTMLTextAreaElement;
  return !textarea.readOnly && !textarea.disabled;
}

function getExplicitRows(element: HTMLTextAreaElement): number | null {
  const value = element.getAttribute("rows");
  if (value === null || !/^\s*\d+\s*$/.test(value)) {
    return null;
  }

  const rows = Number(value);
  return Number.isInteger(rows) && rows > 0 ? rows : null;
}

function parseCssPixels(value: string): number | null {
  const pixels = Number.parseFloat(value);
  return Number.isFinite(pixels) && pixels >= 0 ? pixels : null;
}

function measureMultilineTextarea(element: HTMLTextAreaElement): boolean | null {
  const windowObject = getWindow(element);
  if (
    typeof windowObject.getComputedStyle !== "function" ||
    !Number.isFinite(element.clientHeight)
  ) {
    return null;
  }

  const style = windowObject.getComputedStyle(element);
  if (!style) {
    return null;
  }
  const fontSize = parseCssPixels(style.fontSize);
  const declaredLineHeight = parseCssPixels(style.lineHeight);
  const lineHeight = declaredLineHeight || (fontSize && fontSize * 1.2);
  if (!lineHeight || element.clientHeight <= 0) {
    return null;
  }

  const paddingTop = parseCssPixels(style.paddingTop) || 0;
  const paddingBottom = parseCssPixels(style.paddingBottom) || 0;
  const contentHeight = element.clientHeight - paddingTop - paddingBottom;
  return contentHeight >= lineHeight * MULTILINE_LINE_THRESHOLD;
}

function fallbackMultilineTextarea(element: HTMLTextAreaElement): boolean {
  const rows = Number(element.rows);
  return (Number.isFinite(rows) && rows > 0 ? rows : 2) >= 2;
}

export function isMultilineTextarea(element: unknown): element is HTMLTextAreaElement {
  if (!isTextarea(element)) {
    return false;
  }

  const explicitRows = getExplicitRows(element);
  if (explicitRows !== null) {
    return explicitRows >= 2;
  }

  const measured = measureMultilineTextarea(element);
  return measured === null ? fallbackMultilineTextarea(element) : measured;
}

export function isSupportedTarget(element: unknown): element is HTMLTextAreaElement {
  return isMultilineTextarea(element);
}

export function findTarget(node: EventTarget | null): HTMLTextAreaElement | null {
  let element = isElement(node) ? node : getParentElement(node);

  while (element) {
    if (isSupportedTarget(element)) {
      return element;
    }
    element = element.parentElement;
  }

  return null;
}

function getParentElement(node: unknown): HTMLElement | null {
  if (typeof node !== "object" || node === null || !("parentElement" in node)) {
    return null;
  }

  const parentElement = (node as { parentElement?: unknown }).parentElement;
  return isElement(parentElement) ? parentElement : null;
}

export function readTargetText(element: HTMLTextAreaElement): string {
  return element.value;
}

export function writeNativeValue(element: HTMLTextAreaElement, value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  const windowObject = getWindow(element);
  const prototype = windowObject.HTMLTextAreaElement?.prototype;
  const descriptor =
    prototype === undefined ? undefined : Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor && typeof descriptor.set === "function") {
    descriptor.set.call(element, text);
  } else {
    element.value = text;
  }

  return text;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(value, maximum));
}

export function readTargetSelection(
  element: HTMLTextAreaElement,
  text = readTargetText(element),
): { start: number; end: number } {
  const start = element.selectionStart;
  const end = element.selectionEnd;
  return {
    start: clamp(start, 0, text.length),
    end: clamp(end, 0, text.length),
  };
}

export function setTargetSelection(element: HTMLTextAreaElement, start: number, end = start): void {
  const textLength = readTargetText(element).length;
  element.setSelectionRange(clamp(start, 0, textLength), clamp(end, 0, textLength));
}

function dispatchTargetEvent(element: HTMLTextAreaElement, type: "input" | "change"): void {
  const EventConstructor = getWindow(element).Event ?? globalThis.Event;
  element.dispatchEvent(new EventConstructor(type, { bubbles: true, composed: true }));
}

export function dispatchTargetInput(element: HTMLTextAreaElement): void {
  dispatchTargetEvent(element, "input");
}

export function dispatchTargetChange(element: HTMLTextAreaElement): void {
  dispatchTargetEvent(element, "change");
}

export function dispatchTargetPaste(element: HTMLTextAreaElement, source: ClipboardEvent): boolean {
  const clipboardData = source.clipboardData;
  if (!clipboardData) {
    return false;
  }

  const windowObject = getWindow(element);
  const ClipboardEventConstructor = windowObject.ClipboardEvent ?? globalThis.ClipboardEvent;
  if (typeof ClipboardEventConstructor !== "function") {
    return false;
  }

  element.dispatchEvent(
    new ClipboardEventConstructor("paste", {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData,
    }),
  );
  return true;
}
