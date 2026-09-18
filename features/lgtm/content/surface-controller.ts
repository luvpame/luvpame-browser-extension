import { findReviewControlsAnchor } from "./surface";
import { isPullRequestPage } from "./route";

type ReviewSurfaceControllerOptions = {
  document: Document;
  initialUrl: URL;
  mount: (anchor: HTMLElement) => ReviewSurfaceMount;
};

type ReviewSurfaceMount = {
  unmount(): void;
  isConnected(): boolean;
};

export function createReviewSurfaceController({
  document,
  initialUrl,
  mount,
}: ReviewSurfaceControllerOptions): {
  syncUrl: (url: URL) => void;
  dispose: () => void;
} {
  let activeUrl = initialUrl;
  let disposed = false;
  let mounted: { anchor: HTMLElement; surface: ReviewSurfaceMount } | null = null;
  const MutationObserverConstructor = document.defaultView?.MutationObserver;
  const observer = MutationObserverConstructor
    ? new MutationObserverConstructor(() => reconcile())
    : null;

  function unmount(): void {
    if (!mounted) {
      return;
    }

    const current = mounted;
    mounted = null;
    current.surface.unmount();
  }

  function reconcile(): void {
    if (disposed) {
      return;
    }

    const anchor = findReviewControlsAnchor(document, activeUrl);
    if (!anchor) {
      unmount();
      return;
    }

    if (mounted?.anchor === anchor && anchor.isConnected && mounted.surface.isConnected()) {
      return;
    }

    unmount();
    mounted = { anchor, surface: mount(anchor) };
  }

  function observe(): void {
    observer?.disconnect();
    const root = document.documentElement;
    if (!observer || !root) {
      return;
    }

    observer.observe(root, {
      attributeFilter: [
        "aria-hidden",
        "aria-haspopup",
        "aria-label",
        "class",
        "data-hotkey",
        "data-testid",
        "hidden",
        "open",
        "role",
        "style",
        "type",
      ],
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
  }

  function syncUrl(url: URL): void {
    if (disposed) {
      return;
    }

    const routeChanged = url.href !== activeUrl.href;
    activeUrl = url;

    if (!isPullRequestPage(activeUrl)) {
      observer?.disconnect();
      unmount();
      return;
    }

    if (routeChanged) {
      unmount();
    }

    observe();
    reconcile();
  }

  function dispose(): void {
    if (disposed) {
      return;
    }

    disposed = true;
    observer?.disconnect();
    unmount();
  }

  syncUrl(initialUrl);
  return { dispose, syncUrl };
}
