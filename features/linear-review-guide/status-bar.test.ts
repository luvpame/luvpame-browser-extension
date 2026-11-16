import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { applyStatusBar } from "./status-bar";

beforeEach(() => {
  document.body.innerHTML = `<div id="root" style="height: 800px"></div><div data-agent-toolbar-bounds><div style="display: flex; height: 28px"><div style="flex: 1 0 0px"></div><div><div data-agent-panel-anchor></div><button>Agent</button></div><div><button>Chat history</button></div></div></div>`;
});
afterEach(() => document.body.replaceChildren());

describe("Guide翻訳のステータスバー", () => {
  it("再適用しても実行中の入力と操作を保持し、見出しとスタイルを増やさない", () => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<div id="panel" data-luvpame-translation="offline-guide" style="position: fixed; right: 16px; bottom: 16px; max-width: 320px"><label>モデルを選択（ローカルのPLaMo GGUFモデルと実行ファイルをまとめて選択してください）<input type="file" style="display: block; margin-top: 12px"></label><output role="status" aria-live="polite">Guideの説明を自動翻訳中（GPU）</output><button type="button">停止</button></div>`,
    );
    const panel = document.querySelector<HTMLElement>("#panel")!;
    const host = document.querySelector("[data-agent-toolbar-bounds] > div > div:first-child")!;
    const nativeButtons = [...document.querySelectorAll("[data-agent-toolbar-bounds] button")];
    const nativeStyles = [...document.querySelectorAll("[style]")]
      .filter((node) => node !== panel && !panel.contains(node))
      .map((node) => [node, node.getAttribute("style")] as const);
    const label = panel.querySelector("label")!;
    const input = panel.querySelector("input")!;
    const status = panel.querySelector("output")!;
    const button = panel.querySelector("button")!;
    const onStop = vi.fn();
    button.addEventListener("click", onStop);
    input.disabled = true;

    applyStatusBar(panel);
    const style = panel.querySelector("style")!;
    style.textContent =
      "[data-luvpame-status-bar] { position: fixed; height: 34px; } body:has(> [data-luvpame-status-bar]) > #root { height: calc(100dvh - 34px) !important; }";
    applyStatusBar(panel);

    expect(panel.parentElement).toBe(host);
    expect(panel.hasAttribute("style")).toBe(false);
    expect(panel.querySelector("style")).toBe(style);
    expect(style.textContent).not.toContain("position: fixed");
    expect(style.textContent).not.toContain("#root");
    for (const [node, originalStyle] of nativeStyles)
      expect(node.getAttribute("style")).toBe(originalStyle);
    expect([...document.querySelectorAll("[data-agent-toolbar-bounds] button")]).toEqual([
      button,
      ...nativeButtons,
    ]);
    expect(panel.querySelectorAll("[data-luvpame-status-bar-brand]")).toHaveLength(1);
    expect(panel.querySelectorAll("style")).toHaveLength(1);
    expect(panel.querySelector("input")).toBe(input);
    expect(panel.querySelector("output")).toBe(status);
    expect(panel.querySelector("button")).toBe(button);
    expect(button.textContent).toBe("翻訳を停止");
    expect(button.title).toContain("原文に戻します");
    expect(input.disabled).toBe(true);
    expect(input.labels?.[0]).toBe(label);
    expect(label.textContent).toBe(
      "モデルを選択（ローカルのPLaMo GGUFモデルと実行ファイルをまとめて選択してください）",
    );
    expect(label.title).toBe(label.textContent);
    expect(status.textContent).toBe("Guideの説明を自動翻訳中（GPU）");
    button.click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("既存の下部バーがないときはパネルを変更せず、追加のバーを作らない", () => {
    document.querySelector("[data-agent-toolbar-bounds]")!.remove();
    const panel = document.createElement("div");
    panel.style.cssText = "position: fixed; bottom: 16px";
    document.body.append(panel);
    const original = document.body.innerHTML;

    expect(() => applyStatusBar(panel)).toThrow("Linearの下部ステータスバーが見つかりません。");
    expect(document.body.innerHTML).toBe(original);
    expect(document.querySelector("[data-luvpame-status-bar]")).toBeNull();
  });
});
