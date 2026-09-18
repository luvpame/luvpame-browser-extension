import { describe, expect, it, vi } from "vite-plus/test";
import { JSDOM } from "jsdom";

import {
  createCopyMarkdownButtonController,
  registerCopyMarkdownButton,
  type CopyMarkdownButtonApi,
} from "../../lib/notion/copy-markdown-button";

const createDocument = (): Document => {
  const { window } = new JSDOM(
    '<!doctype html><html><head></head><body><div class="notion-topbar-action-buttons"></div></body></html>',
  );

  return window.document;
};

describe("copy markdown button controller", () => {
  it("adds and removes the copy button", () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const mutationObserver = vi.fn().mockImplementation(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });

    Object.assign(globalThis, {
      document,
      window: document.defaultView,
      MutationObserver: mutationObserver,
    });

    const controller = createCopyMarkdownButtonController();
    try {
      controller.setEnabled(true);
      expect(document.getElementById("notion-enhancer-copy-md-btn")).not.toBeNull();

      controller.setEnabled(false);
      expect(document.getElementById("notion-enhancer-copy-md-btn")).toBeNull();
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
    }
  });
});

describe("registerCopyMarkdownButton", () => {
  it("applies the stored setting and reacts to storage updates", async () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const mutationObserver = vi.fn().mockImplementation(function () {
      return { observe: vi.fn(), disconnect: vi.fn() };
    });
    const get = vi.fn().mockResolvedValue({ copyMarkdownButtonEnabled: true });
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const api: CopyMarkdownButtonApi = {
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

    try {
      const controller = await registerCopyMarkdownButton(api);
      expect(document.getElementById("notion-enhancer-copy-md-btn")).not.toBeNull();
      expect(addListener).toHaveBeenCalledTimes(1);

      const handleStorageChange = addListener.mock.calls[0]?.[0] as (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void;

      handleStorageChange(
        {
          copyMarkdownButtonEnabled: {
            oldValue: true,
            newValue: false,
          },
        },
        "local",
      );

      expect(document.getElementById("notion-enhancer-copy-md-btn")).toBeNull();

      controller.dispose();
      expect(removeListener).toHaveBeenCalledWith(handleStorageChange);
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
    }
  });
});

it("restores the copy button after Notion replaces its toolbar, and stops when OFF", async () => {
  document.body.innerHTML = '<div class="notion-topbar-action-buttons"></div>';
  const controller = createCopyMarkdownButtonController();
  try {
    controller.setEnabled(true);
    document.body.innerHTML = '<div class="notion-topbar-action-buttons"></div>';
    await Promise.resolve();
    expect(document.getElementById("notion-enhancer-copy-md-btn")).not.toBeNull();
    controller.setEnabled(false);
    document.body.innerHTML = '<div class="notion-topbar-action-buttons"></div>';
    await Promise.resolve();
    expect(document.getElementById("notion-enhancer-copy-md-btn")).toBeNull();
  } finally {
    controller.dispose();
  }
});
