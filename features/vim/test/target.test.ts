import { beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  dispatchTargetChange,
  dispatchTargetInput,
  isMultilineTextarea,
  isSupportedTarget,
  isTextarea,
  readTargetSelection,
  writeNativeValue,
} from "../src/target.js";

function createTextarea(rows: string | null, clientHeight: number): HTMLTextAreaElement {
  const textarea = document.createElement("textarea");
  if (rows !== null) {
    textarea.setAttribute("rows", rows);
  }
  textarea.style.fontSize = "16px";
  textarea.style.lineHeight = "16px";
  textarea.style.padding = "2px 0";
  Object.defineProperty(textarea, "clientHeight", { configurable: true, value: clientHeight });
  document.body.appendChild(textarea);
  return textarea;
}

beforeEach(function resetDocument(): void {
  document.body.replaceChildren();
});

describe("textareaの対象判定", function describeTargetDetection(): void {
  test("rows=1は対象外、rows=2は対象になる", function testExplicitRows(): void {
    expect(isMultilineTextarea(createTextarea("1", 80))).toBe(false);
    expect(isMultilineTextarea(createTextarea("2", 16))).toBe(true);
  });

  test("rows未指定時は実寸で複数行か判定する", function testMeasuredRows(): void {
    expect(isMultilineTextarea(createTextarea(null, 20))).toBe(false);
    expect(isMultilineTextarea(createTextarea(null, 40))).toBe(true);
  });

  test("inputとcontenteditableは対象外にする", function testUnsupportedElements(): void {
    expect(isSupportedTarget(document.createElement("input"))).toBe(false);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    expect(isSupportedTarget(editable)).toBe(false);
    expect(isTextarea(document.createElement("textarea"))).toBe(true);
  });

  test("readonlyとdisabledのtextareaは対象外にする", function testDisabledTextareas(): void {
    const readonly = createTextarea("2", 40);
    readonly.readOnly = true;
    const disabled = createTextarea("2", 40);
    disabled.disabled = true;
    expect(isSupportedTarget(readonly)).toBe(false);
    expect(isSupportedTarget(disabled)).toBe(false);
  });
});

test("値、選択範囲、input/changeイベントをDOMの経路で同期する", function testTargetSync(): void {
  const textarea = createTextarea("2", 40);
  const inputListener = vi.fn();
  const changeListener = vi.fn();
  textarea.addEventListener("input", inputListener);
  textarea.addEventListener("change", changeListener);

  writeNativeValue(textarea, "updated");
  textarea.setSelectionRange(2, 5);
  dispatchTargetInput(textarea);
  dispatchTargetChange(textarea);

  expect(textarea.value).toBe("updated");
  expect(readTargetSelection(textarea)).toEqual({ start: 2, end: 5 });
  expect(inputListener).toHaveBeenCalledOnce();
  expect(changeListener).toHaveBeenCalledOnce();
});
