import {
  getHeadingMarkerEnabled,
  getHeadingMarkerEnabledFromChanges,
  type StorageChangeEventLike,
  type StorageChangeLike,
  type StorageAreaLike,
} from "../notion-enhancer-settings";

const headingSelector = "h1, h2, h3, h4";
const styleElementId = "notion-enhancer-heading-marker-style";

export interface HeadingMarkerApi {
  storage: {
    local: StorageAreaLike;
    onChanged: StorageChangeEventLike;
  };
}

const createStyleText = (): string => `
${headingSelector} {
  position: relative;
}

${headingSelector}::before {
  margin-right: 0.4em;
  font-weight: inherit;
  white-space: pre;
  display: inline-block;
  user-select: none;
}

main h1:first-of-type::before,
main .notion-page-block:first-child h1:first-of-type::before {
  content: none !important;
}

h1::before {
  content: "# ";
}

h2::before {
  content: "# ";
}

h3::before {
  content: "## ";
}

h4::before {
  content: "### ";
}
`;

const ensureStyleElement = (doc: Document): void => {
  if (doc.getElementById(styleElementId) || !doc.head) {
    return;
  }

  const style = doc.createElement("style");
  style.id = styleElementId;
  style.textContent = createStyleText();
  doc.head.append(style);
};

const removeStyleElement = (doc: Document): void => {
  doc.getElementById(styleElementId)?.remove();
};

export const createHeadingMarkerController = (doc: Document = document) => {
  let isEnabled = false;
  let observer: MutationObserver | undefined;

  const restoreStyleIfMissing = (): void => {
    if (isEnabled) {
      ensureStyleElement(doc);
    }
  };

  const stopObserving = (): void => {
    observer?.disconnect();
    observer = undefined;
  };

  const startObserving = (): void => {
    if (observer) {
      return;
    }

    if (!doc.body) {
      window.requestAnimationFrame(() => {
        if (isEnabled) {
          startObserving();
        }
      });
      return;
    }

    observer = new MutationObserver(() => {
      restoreStyleIfMissing();
    });

    observer.observe(doc.body, {
      subtree: true,
      childList: true,
    });
  };

  const setEnabled = (enabled: boolean): void => {
    isEnabled = enabled;

    if (enabled) {
      ensureStyleElement(doc);
      startObserving();
      return;
    }

    stopObserving();
    removeStyleElement(doc);
  };

  const dispose = (): void => {
    isEnabled = false;
    stopObserving();
    removeStyleElement(doc);
  };

  return {
    setEnabled,
    dispose,
  };
};

export const registerHeadingMarker = async (
  api: HeadingMarkerApi,
  doc: Document = document,
): Promise<() => void> => {
  const controller = createHeadingMarkerController(doc);
  controller.setEnabled(await getHeadingMarkerEnabled(api.storage.local));

  const handleStorageChanged = (
    changes: Record<string, StorageChangeLike>,
    areaName: string,
  ): void => {
    if (areaName !== "local") {
      return;
    }

    const nextEnabled = getHeadingMarkerEnabledFromChanges(changes);
    if (nextEnabled !== undefined) {
      controller.setEnabled(nextEnabled);
    }
  };

  api.storage.onChanged.addListener(handleStorageChanged);

  return () => {
    api.storage.onChanged.removeListener(handleStorageChanged);
    controller.dispose();
  };
};
