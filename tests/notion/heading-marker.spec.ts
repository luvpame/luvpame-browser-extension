import { describe, expect, it, vi } from "vite-plus/test";
import { JSDOM } from "jsdom";

import {
  createHeadingMarkerController,
  registerHeadingMarker,
  type HeadingMarkerApi,
} from "../../lib/notion/heading-marker";

const createDocument = (): Document => {
  const { window } = new JSDOM(
    "<!doctype html><html><head></head><body><main><h1>Title</h1></main></body></html>",
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

describe("heading marker controller", () => {
  it("adds and removes the style element", () => {
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

    const controller = createHeadingMarkerController(document);
    try {
      controller.setEnabled(true);
      expect(document.getElementById("notion-enhancer-heading-marker-style")).not.toBeNull();

      controller.setEnabled(false);
      expect(document.getElementById("notion-enhancer-heading-marker-style")).toBeNull();
    } finally {
      Object.assign(globalThis, {
        document: originalDocument,
        window: originalWindow,
        MutationObserver: originalMutationObserver,
      });
      controller.dispose();
    }
  });
});

describe("registerHeadingMarker", () => {
  it("applies the stored setting and reacts to storage updates", async () => {
    const originalDocument = globalThis.document;
    const originalMutationObserver = globalThis.MutationObserver;
    const originalWindow = globalThis.window;
    const document = createDocument();
    const mutationObserver = setupMutationObserverMock();
    const get = vi.fn().mockResolvedValue({ headingMarkerEnabled: true });
    const addListener = vi.fn();
    const removeListener = vi.fn();
    const api: HeadingMarkerApi = {
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
      const dispose = await registerHeadingMarker(api, document);
      expect(document.getElementById("notion-enhancer-heading-marker-style")).not.toBeNull();
      expect(addListener).toHaveBeenCalledTimes(1);

      const handleStorageChange = addListener.mock.calls[0]?.[0] as (
        changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
        areaName: string,
      ) => void;

      handleStorageChange(
        {
          headingMarkerEnabled: {
            oldValue: true,
            newValue: false,
          },
        },
        "local",
      );

      expect(document.getElementById("notion-enhancer-heading-marker-style")).toBeNull();

      dispose();
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
