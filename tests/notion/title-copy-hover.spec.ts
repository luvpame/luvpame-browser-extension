import { describe, expect, it, vi } from "vite-plus/test";
import { JSDOM } from "jsdom";

import {
  createCopyTitleHoverController,
  registerCopyTitleHoverButtons,
  type CopyTitleHoverButtonApi,
} from "../../lib/notion/title-copy-hover";

const createDocument = (url = "https://www.notion.so/page-title?foo=bar#section"): Document => {
  const { window } = new JSDOM(
    `<!doctype html><html><head></head><body><main><h1>  [タイトル](Notion)  </h1></main></body></html>`,
    { url },
  );

  return window.document;
};

const setupMutationObserverMock = (): typeof globalThis.MutationObserver => {
  return vi.fn().mockImplementation(function () {
    return {
      observe: vi.fn(),
      disconnect: vi.fn(),
    };
  }) as unknown as typeof globalThis.MutationObserver;
};

const setElementRect = (
  element: Element,
  rect: Partial<DOMRect> & Pick<DOMRect, "left" | "top" | "width" | "height">,
): void => {
  Object.defineProperty(element, "getBoundingClientRect", {
    value: () =>
      ({
        x: rect.left,
        y: rect.top,
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        right: rect.right ?? rect.left + rect.width,
        bottom: rect.bottom ?? rect.top + rect.height,
        toJSON: () => "",
      }) satisfies DOMRect,
    configurable: true,
  });
};

const setPanelSize = (panel: HTMLElement, width: number, height: number): void => {
  Object.defineProperty(panel, "offsetWidth", {
    value: width,
    configurable: true,
  });
  Object.defineProperty(panel, "offsetHeight", {
    value: height,
    configurable: true,
  });
};

const setupTitleHoverDom = (
  document: Document,
): {
  restore: () => void;
  writeText: ReturnType<typeof vi.fn>;
} => {
  const originalDocument = globalThis.document;
  const originalMutationObserver = globalThis.MutationObserver;
  const originalWindow = globalThis.window;
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const targetNavigator = document.defaultView?.navigator;
  const clipboardDescriptor = targetNavigator
    ? Object.getOwnPropertyDescriptor(targetNavigator, "clipboard")
    : undefined;
  const writeText = vi.fn().mockResolvedValue(undefined);

  Object.assign(globalThis, {
    document,
    window: document.defaultView,
    MutationObserver: setupMutationObserverMock(),
  });
  Object.defineProperty(targetNavigator ?? {}, "clipboard", {
    value: {
      writeText,
    },
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: targetNavigator,
    configurable: true,
  });

  return {
    restore: () => {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
      if (targetNavigator) {
        if (clipboardDescriptor) {
          Object.defineProperty(targetNavigator, "clipboard", clipboardDescriptor);
        } else {
          delete (targetNavigator as { clipboard?: unknown }).clipboard;
        }
      }
    },
    writeText,
  };
};

describe("copy title hover controller", () => {
  it("adds and removes the hover panel", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const mutationObserver = setupMutationObserverMock();

    Object.assign(globalThis, {
      document,
      window: document.defaultView,
      MutationObserver: mutationObserver,
    });

    const controller = createCopyTitleHoverController();
    try {
      controller.setEnabled(true);
      expect(document.getElementById("notion-enhancer-title-copy-hover")).not.toBeNull();
      expect(document.body?.querySelector("main h1:first-of-type")).not.toBeNull();

      controller.setEnabled(false);
      expect(document.getElementById("notion-enhancer-title-copy-hover")).toBeNull();
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
      controller.dispose();
    }
  });

  it("adds the hover panel for a sidebar page title", () => {
    const { window } = new JSDOM(
      `<!doctype html><html><head></head><body>
        <main><h1>Parent page</h1></main>
        <div role="dialog" aria-label="Side peek">
          <section class="notion-page-block">
            <h1>  Sidebar Page  </h1>
          </section>
        </div>
      </body></html>`,
      { url: "https://www.notion.so/parent-page?p=abcdef1234567890" },
    );
    const { restore } = setupTitleHoverDom(window.document);
    const controller = createCopyTitleHoverController();

    try {
      controller.setEnabled(true);

      const sidebarTitle = window.document.querySelector('[role="dialog"] h1:first-of-type');
      const panel = window.document.getElementById("notion-enhancer-title-copy-hover");
      expect(sidebarTitle).not.toBeNull();
      expect(panel).not.toBeNull();

      sidebarTitle?.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
      expect(panel?.hidden).toBe(false);
    } finally {
      controller.dispose();
      restore();
    }
  });

  it("adds the hover panel for a Notion peek renderer page title", () => {
    const { window } = new JSDOM(
      `<!doctype html><html><head></head><body>
        <main><h1>Parent page</h1></main>
        <div role="region" aria-label="サイドピーク" class="notion-peek-renderer">
          <div class="layout">
            <section class="notion-page-block">
              <h1>  Peek Page  </h1>
            </section>
          </div>
        </div>
      </body></html>`,
      { url: "https://www.notion.so/parent-page?p=abcdef1234567890" },
    );
    const { restore } = setupTitleHoverDom(window.document);
    const controller = createCopyTitleHoverController();

    try {
      controller.setEnabled(true);

      const peekTitle = window.document.querySelector(".notion-peek-renderer h1:first-of-type");
      const panel = window.document.getElementById("notion-enhancer-title-copy-hover");
      expect(peekTitle).not.toBeNull();
      expect(panel).not.toBeNull();

      peekTitle?.dispatchEvent(new window.MouseEvent("mouseenter", { bubbles: true }));
      expect(panel?.hidden).toBe(false);
    } finally {
      controller.dispose();
      restore();
    }
  });
});

describe("registerCopyTitleHoverButtons", () => {
  it("applies the stored setting and reacts to storage updates", async () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const mutationObserver = setupMutationObserverMock();
    const get = vi.fn().mockResolvedValue({ copyTitleHoverEnabled: true });
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const api: CopyTitleHoverButtonApi = {
      storage: {
        local: {
          get,
          set: vi.fn(),
        },
        onChanged: {
          addListener,
          removeListener,
        },
      },
    };

    Object.assign(globalThis, {
      document,
      window: document.defaultView,
      MutationObserver: mutationObserver,
    });

    const controller = await registerCopyTitleHoverButtons(api);
    expect(document.getElementById("notion-enhancer-title-copy-hover")).not.toBeNull();
    expect(addListener).toHaveBeenCalledTimes(1);

    const handleStorageChange = addListener.mock.calls[0]?.[0] as (
      changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
      areaName: string,
    ) => void;

    handleStorageChange(
      {
        copyTitleHoverEnabled: {
          oldValue: true,
          newValue: false,
        },
      },
      "local",
    );
    expect(document.getElementById("notion-enhancer-title-copy-hover")).toBeNull();

    controller.dispose();
    expect(removeListener).toHaveBeenCalledWith(handleStorageChange);

    Object.assign(globalThis, {
      document: originalDocument,
      window: originalWindow,
      MutationObserver: originalMutationObserver,
    });
  });
});

describe("copy actions", () => {
  it("pins the panel above the title and does not follow mousemove", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const targetWindow = document.defaultView;
    const mutationObserver = setupMutationObserverMock();

    Object.assign(globalThis, {
      document,
      window: targetWindow,
      MutationObserver: mutationObserver,
    });

    Object.defineProperty(targetWindow ?? {}, "innerWidth", {
      value: 1280,
      configurable: true,
    });
    Object.defineProperty(targetWindow ?? {}, "innerHeight", {
      value: 720,
      configurable: true,
    });

    const controller = createCopyTitleHoverController();
    try {
      controller.setEnabled(true);

      const title = document.querySelector("main h1:first-of-type");
      const panel = document.getElementById("notion-enhancer-title-copy-hover");
      expect(title).not.toBeNull();
      expect(panel).not.toBeNull();

      setElementRect(title!, {
        left: 120,
        top: 200,
        width: 360,
        height: 48,
      });
      setPanelSize(panel as HTMLElement, 180, 40);

      title!.dispatchEvent(
        new targetWindow!.MouseEvent("mouseenter", {
          bubbles: true,
          clientX: 140,
          clientY: 220,
        }),
      );
      expect(panel?.style.left).toBe("120px");
      expect(panel?.style.top).toBe("152px");

      title!.dispatchEvent(
        new targetWindow!.MouseEvent("mousemove", {
          bubbles: true,
          clientX: 520,
          clientY: 420,
        }),
      );
      expect(panel?.style.left).toBe("120px");
      expect(panel?.style.top).toBe("152px");
    } finally {
      controller.dispose();
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
    }
  });

  it("falls back below the title when there is no room above", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const targetWindow = document.defaultView;
    const mutationObserver = setupMutationObserverMock();

    Object.assign(globalThis, {
      document,
      window: targetWindow,
      MutationObserver: mutationObserver,
    });

    Object.defineProperty(targetWindow ?? {}, "innerWidth", {
      value: 360,
      configurable: true,
    });
    Object.defineProperty(targetWindow ?? {}, "innerHeight", {
      value: 240,
      configurable: true,
    });

    const controller = createCopyTitleHoverController();
    try {
      controller.setEnabled(true);

      const title = document.querySelector("main h1:first-of-type");
      const panel = document.getElementById("notion-enhancer-title-copy-hover");
      expect(title).not.toBeNull();
      expect(panel).not.toBeNull();

      setElementRect(title!, {
        left: 320,
        top: 18,
        width: 120,
        height: 32,
      });
      setPanelSize(panel as HTMLElement, 140, 44);

      title!.dispatchEvent(
        new targetWindow!.MouseEvent("mouseenter", {
          bubbles: true,
          clientX: 325,
          clientY: 24,
        }),
      );
      expect(panel?.style.left).toBe("212px");
      expect(panel?.style.top).toBe("58px");
    } finally {
      controller.dispose();
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
    }
  });

  it("copies title text and markdown title link with hover-only title target", async () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    const document = createDocument();
    const targetWindow = document.defaultView;
    const targetNavigator = targetWindow?.navigator;
    const clipboardDescriptor = targetNavigator
      ? Object.getOwnPropertyDescriptor(targetNavigator, "clipboard")
      : undefined;
    const mutationObserver = setupMutationObserverMock();
    const writeText = vi.fn().mockResolvedValue(undefined);

    Object.assign(globalThis, {
      document,
      window: document.defaultView,
      MutationObserver: mutationObserver,
    });
    Object.defineProperty(targetNavigator ?? {}, "clipboard", {
      value: {
        writeText,
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, "navigator", {
      value: targetNavigator,
      configurable: true,
    });

    const controller = createCopyTitleHoverController();
    try {
      controller.setEnabled(true);

      const buttons = document.querySelectorAll<HTMLButtonElement>("button[data-key]");
      const titleButton = [...buttons].find(
        (button) => button.getAttribute("data-key") === "title",
      );
      const markdownButton = [...buttons].find(
        (button) => button.getAttribute("data-key") === "markdown",
      );
      expect(titleButton).not.toBeUndefined();
      expect(markdownButton).not.toBeUndefined();

      titleButton?.click();
      markdownButton?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith("【タイトル】（Notion）");
      expect(writeText).toHaveBeenCalledWith(
        "[【タイトル】（Notion）](https://www.notion.so/page-title)",
      );
    } finally {
      controller.dispose();

      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, "navigator", originalNavigatorDescriptor);
      } else {
        delete (globalThis as { navigator?: Navigator }).navigator;
      }
      if (targetNavigator) {
        if (clipboardDescriptor) {
          Object.defineProperty(targetNavigator, "clipboard", clipboardDescriptor);
        } else {
          delete (targetNavigator as { clipboard?: unknown }).clipboard;
        }
      }
    }
  });

  it("copies sidebar title text and a standalone page link from the p query parameter", async () => {
    const pageId = "abcdef1234567890abcdef1234567890";
    const { window } = new JSDOM(
      `<!doctype html><html><head></head><body>
        <main><h1>Parent page</h1></main>
        <div role="dialog" aria-label="Side peek">
          <section class="notion-page-block">
            <h1>  [Sidebar](Page)  </h1>
          </section>
        </div>
      </body></html>`,
      { url: `https://www.notion.so/parent-page?p=${pageId}` },
    );
    const { restore, writeText } = setupTitleHoverDom(window.document);
    const controller = createCopyTitleHoverController();

    try {
      controller.setEnabled(true);

      const buttons = window.document.querySelectorAll<HTMLButtonElement>("button[data-key]");
      const titleButton = [...buttons].find(
        (button) => button.getAttribute("data-key") === "title",
      );
      const markdownButton = [...buttons].find(
        (button) => button.getAttribute("data-key") === "markdown",
      );
      expect(titleButton).not.toBeUndefined();
      expect(markdownButton).not.toBeUndefined();

      titleButton?.click();
      markdownButton?.click();
      await Promise.resolve();
      await Promise.resolve();

      expect(writeText).toHaveBeenCalledWith("【Sidebar】（Page）");
      expect(writeText).toHaveBeenCalledWith(
        `[【Sidebar】（Page）](https://www.notion.so/p/${pageId})`,
      );
    } finally {
      controller.dispose();
      restore();
    }
  });
});
