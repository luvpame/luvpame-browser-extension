import { dispatchTargetInput } from "./target.js";

export type OverlayPositionObserver = {
  disconnect(): void;
};

export function dispatchTargetInputAndUpdateOverlay(
  target: HTMLTextAreaElement,
  host: HTMLDivElement,
): void {
  dispatchTargetInput(target);
  updateOverlayPosition(target, host);
}

export function updateOverlayPosition(target: HTMLTextAreaElement, host: HTMLDivElement): void {
  if (!target.isConnected) {
    return;
  }

  const rectangle = target.getBoundingClientRect();
  const left = `${rectangle.left}px`;
  const top = `${rectangle.top}px`;
  const width = `${rectangle.width}px`;
  const height = `${rectangle.height}px`;

  if (host.style.left !== left) {
    host.style.left = left;
  }
  if (host.style.top !== top) {
    host.style.top = top;
  }
  if (host.style.width !== width) {
    host.style.width = width;
  }
  if (host.style.height !== height) {
    host.style.height = height;
  }
}

export function observeOverlayPosition(
  target: HTMLTextAreaElement,
  host: HTMLDivElement,
): OverlayPositionObserver {
  let stopped = false;
  let animationFrameId = requestAnimationFrame(function trackOverlayPosition(): void {
    if (stopped || !target.isConnected) {
      return;
    }

    updateOverlayPosition(target, host);
    animationFrameId = requestAnimationFrame(trackOverlayPosition);
  });
  return {
    disconnect(): void {
      stopped = true;
      cancelAnimationFrame(animationFrameId);
    },
  };
}
