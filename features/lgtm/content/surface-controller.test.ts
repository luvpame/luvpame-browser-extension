import { afterEach, describe, expect, it } from "vite-plus/test";

import { createReviewSurfaceController } from "./surface-controller";

const BASE_URL = new URL("https://github.com/acme/widgets/pull/123");

function waitForMutation(): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, 0);
  });
}

function createReviewOpener(): HTMLButtonElement {
  const opener = document.createElement("button");
  opener.type = "button";
  opener.setAttribute("aria-haspopup", "dialog");
  opener.textContent = "Submit review";
  return opener;
}

describe("createReviewSurfaceController", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("mounts and unmounts as the review surface appears on a base PR URL", async () => {
    const mountedAnchors: HTMLElement[] = [];
    let unmountCount = 0;
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        mountedAnchors.push(anchor);
        return {
          isConnected(): boolean {
            return true;
          },
          unmount(): void {
            unmountCount += 1;
          },
        };
      },
    });

    expect(mountedAnchors).toHaveLength(0);

    const opener = createReviewOpener();
    document.body.append(opener);
    await waitForMutation();
    expect(mountedAnchors).toEqual([opener]);

    opener.remove();
    await waitForMutation();
    expect(unmountCount).toBe(1);

    document.body.append(opener);
    await waitForMutation();
    expect(mountedAnchors).toEqual([opener, opener]);

    controller.dispose();
    expect(unmountCount).toBe(2);
  });

  it("remounts when the mounted container is removed while the anchor remains", async () => {
    const mountedAnchors: HTMLElement[] = [];
    const mountedContainers: HTMLElement[] = [];
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        const container = document.createElement("span");
        anchor.before(container);
        mountedAnchors.push(anchor);
        mountedContainers.push(container);
        return {
          isConnected(): boolean {
            return container.isConnected;
          },
          unmount(): void {
            container.remove();
          },
        };
      },
    });
    const opener = createReviewOpener();
    document.body.append(opener);
    await waitForMutation();
    expect(mountedAnchors).toHaveLength(1);

    mountedContainers[0]?.remove();
    await waitForMutation();
    expect(mountedAnchors).toHaveLength(2);

    controller.dispose();
  });

  it("reconciles when the review opener text node changes", async () => {
    const mountedAnchors: HTMLElement[] = [];
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        mountedAnchors.push(anchor);
        return {
          isConnected(): boolean {
            return true;
          },
          unmount(): void {},
        };
      },
    });
    const opener = document.createElement("button");
    opener.type = "button";
    opener.setAttribute("aria-haspopup", "dialog");
    opener.append(document.createTextNode("Other"));
    document.body.append(opener);

    await waitForMutation();
    expect(mountedAnchors).toHaveLength(0);

    const text = opener.firstChild;
    if (!text) {
      throw new Error("Test review opener text was not created");
    }
    text.nodeValue = "Submit review";
    await waitForMutation();
    expect(mountedAnchors).toHaveLength(1);

    controller.dispose();
  });

  it("reconciles when only the popup attribute changes", async () => {
    const mountedAnchors: HTMLElement[] = [];
    let unmountCount = 0;
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        mountedAnchors.push(anchor);
        return {
          isConnected(): boolean {
            return true;
          },
          unmount(): void {
            unmountCount += 1;
          },
        };
      },
    });
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "Submit review";
    document.body.append(opener);

    await waitForMutation();
    expect(mountedAnchors).toHaveLength(0);

    opener.setAttribute("aria-haspopup", "dialog");
    await waitForMutation();
    expect(mountedAnchors).toEqual([opener]);

    opener.removeAttribute("aria-haspopup");
    await waitForMutation();
    expect(unmountCount).toBe(1);

    controller.dispose();
  });

  it("stops observing on a non-PR URL and resumes on a PR URL", async () => {
    const mountedAnchors: HTMLElement[] = [];
    let unmountCount = 0;
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        mountedAnchors.push(anchor);
        return {
          isConnected(): boolean {
            return true;
          },
          unmount(): void {
            unmountCount += 1;
          },
        };
      },
    });
    const opener = createReviewOpener();
    document.body.append(opener);
    await waitForMutation();
    expect(mountedAnchors).toHaveLength(1);

    controller.syncUrl(new URL("https://github.com/acme/widgets/issues/123"));
    expect(unmountCount).toBe(1);

    opener.remove();
    document.body.append(opener);
    await waitForMutation();
    expect(mountedAnchors).toHaveLength(1);

    controller.syncUrl(BASE_URL);
    expect(mountedAnchors).toHaveLength(2);
    controller.dispose();
    expect(unmountCount).toBe(2);
  });

  it("keeps observing when GitHub replaces the body", async () => {
    const mountedAnchors: HTMLElement[] = [];
    const controller = createReviewSurfaceController({
      document,
      initialUrl: BASE_URL,
      mount: (anchor) => {
        mountedAnchors.push(anchor);
        return {
          isConnected(): boolean {
            return true;
          },
          unmount(): void {},
        };
      },
    });
    const nextBody = document.createElement("body");
    const opener = createReviewOpener();
    nextBody.append(opener);
    document.documentElement.replaceChild(nextBody, document.body);

    await waitForMutation();
    expect(mountedAnchors).toEqual([opener]);
    controller.dispose();
  });
});
