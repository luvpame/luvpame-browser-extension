import { beforeEach, expect, test, vi } from "vite-plus/test";
import {
  dispatchTargetInputAndUpdateOverlay,
  observeOverlayPosition,
  updateOverlayPosition,
} from "../src/overlay-position.js";

let animationFrameCallback: FrameRequestCallback | null = null;
let requestedFrameCount = 0;
let cancelledFrameId: number | null = null;

beforeEach(function resetDocument(): void {
  document.body.replaceChildren();
  animationFrameCallback = null;
  requestedFrameCount = 0;
  cancelledFrameId = null;
  vi.stubGlobal(
    "requestAnimationFrame",
    function captureAnimationFrame(callback: FrameRequestCallback): number {
      animationFrameCallback = callback;
      requestedFrameCount += 1;
      return requestedFrameCount;
    },
  );
  vi.stubGlobal("cancelAnimationFrame", function captureCancelledAnimationFrame(id: number): void {
    cancelledFrameId = id;
  });
});

test("textarea自身の高さが変わるとオーバーレイも追従する", function testOverlayFollowsTargetResize(): void {
  const target = document.createElement("textarea");
  const host = document.createElement("div");
  document.body.append(target, host);

  let height = 40;
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(function readTargetRectangle() {
    return DOMRect.fromRect({ x: 12, y: 24, width: 450, height });
  });

  observeOverlayPosition(target, host);
  height = 88;
  animationFrameCallback?.(0);

  expect(host.style.left).toBe("12px");
  expect(host.style.top).toBe("24px");
  expect(host.style.width).toBe("450px");
  expect(host.style.height).toBe("88px");
});

test("inputでtextareaが伸びた直後にオーバーレイの高さも更新する", function testOverlayUpdatesSynchronouslyAfterInput(): void {
  const target = document.createElement("textarea");
  const host = document.createElement("div");
  document.body.append(target, host);

  let height = 40;
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(function readTargetRectangle() {
    return DOMRect.fromRect({ width: 450, height });
  });
  target.addEventListener("input", function growTarget(): void {
    height = 64;
  });

  updateOverlayPosition(target, host);
  dispatchTargetInputAndUpdateOverlay(target, host);

  expect(host.style.height).toBe("64px");
});

test("textareaが寸法を変えず横へ移動してもオーバーレイが追従する", function testOverlayFollowsHorizontalMovement(): void {
  const target = document.createElement("textarea");
  const host = document.createElement("div");
  document.body.append(target, host);

  let left = 12;
  vi.spyOn(target, "getBoundingClientRect").mockImplementation(function readTargetRectangle() {
    return DOMRect.fromRect({ x: left, y: 24, width: 450, height: 88 });
  });

  updateOverlayPosition(target, host);
  observeOverlayPosition(target, host);
  left = 52;
  animationFrameCallback?.(0);

  expect(host.style.left).toBe("52px");
});

test("disconnectで次のフレームを停止する", function testDisconnectStopsAnimationFrame(): void {
  const target = document.createElement("textarea");
  const host = document.createElement("div");
  document.body.append(target, host);

  const observer = observeOverlayPosition(target, host);
  observer.disconnect();
  animationFrameCallback?.(0);

  expect(cancelledFrameId).toBe(1);
  expect(requestedFrameCount).toBe(1);
});
