import { expect, test, vi } from "vite-plus/test";
import { containKeyboardEvents } from "../src/keyboard-boundary.js";

test("エディター内のキーボードイベントを文書へ伝播させない", function testKeyboardBoundary(): void {
  const host = document.createElement("div");
  document.body.appendChild(host);
  containKeyboardEvents(host);
  const documentListener = vi.fn();
  document.addEventListener("keydown", documentListener, { once: true });

  host.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "j" }));

  expect(documentListener).not.toHaveBeenCalled();
});
