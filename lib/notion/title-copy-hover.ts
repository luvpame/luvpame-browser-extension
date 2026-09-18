import {
  getCopyTitleHoverEnabled,
  getCopyTitleHoverEnabledFromChanges,
  type StorageAreaLike,
  type StorageChangeEventLike,
  type StorageChangeLike,
} from "../notion-enhancer-settings";

type ButtonKey = "title" | "markdown";
type ButtonState = "idle" | "copying" | "success" | "error";
type TransientButtonState = Exclude<ButtonState, "idle">;

type CopyTextByKey = Record<ButtonKey, string>;
type ButtonStyleByState = Record<
  ButtonState,
  { background: string; borderColor: string; color: string }
>;
type ButtonStateLabelByState = Record<TransientButtonState, string>;

const panelId = "notion-enhancer-title-copy-hover";
const pageTitleSelector = "main h1:first-of-type, .notion-page-block:first-child h1:first-of-type";
const sidebarTitleSelector =
  '.notion-peek-renderer h1:first-of-type, [role="dialog"] h1:first-of-type';
const hideDelayMs = 50;
const flashDurationMs = 1800;
const viewportMarginPx = 8;
const panelGapPx = 8;

const copyButtonIcon: Record<ButtonKey, string> = {
  title: "🧾",
  markdown: "🔗",
};

const copyButtonIdleLabel: CopyTextByKey = {
  title: "タイトルをコピー",
  markdown: "Markdownリンクをコピー",
};

const copyButtonStateLabel: ButtonStateLabelByState = {
  copying: "コピー中…",
  success: "コピー済み",
  error: "失敗",
};

const buttonStyleByState: ButtonStyleByState = {
  idle: {
    background: "rgba(255, 255, 255, 0.94)",
    borderColor: "rgba(55, 53, 47, 0.18)",
    color: "#2f3437",
  },
  copying: {
    background: "rgba(35, 131, 226, 0.12)",
    borderColor: "rgba(35, 131, 226, 0.35)",
    color: "#175b98",
  },
  success: {
    background: "rgba(15, 123, 108, 0.12)",
    borderColor: "rgba(15, 123, 108, 0.28)",
    color: "#0f6b5f",
  },
  error: {
    background: "rgba(224, 98, 80, 0.12)",
    borderColor: "rgba(224, 98, 80, 0.28)",
    color: "#b23d2f",
  },
};

export interface CopyTitleHoverButtonApi {
  storage: {
    local: StorageAreaLike;
    onChanged: StorageChangeEventLike;
  };
}

const normalizeMarkdownTitle = (value: string): string =>
  value
    .trim()
    .replaceAll("[", "【")
    .replaceAll("]", "】")
    .replaceAll("(", "（")
    .replaceAll(")", "）");

const isVisibleElement = (element: HTMLElement): boolean => {
  if (element.hidden || element.getAttribute("aria-hidden") === "true") {
    return false;
  }

  const style = window.getComputedStyle(element);
  return style.display !== "none" && style.visibility !== "hidden";
};

const findTitle = (): HTMLHeadingElement | null => {
  const sidebarTitle = [
    ...document.querySelectorAll<HTMLHeadingElement>(sidebarTitleSelector),
  ].find(isVisibleElement);

  if (sidebarTitle) {
    return sidebarTitle;
  }

  const pageTitle = document.querySelector<HTMLHeadingElement>(pageTitleSelector);
  return pageTitle?.tagName === "H1" ? pageTitle : null;
};

const buildStandalonePageUrl = (): string => {
  const locationUrl = new URL(window.location.href);
  const sidebarPageId = locationUrl.searchParams.get("p")?.trim();

  if (sidebarPageId) {
    return `${locationUrl.origin}/p/${sidebarPageId}`;
  }

  locationUrl.search = "";
  locationUrl.hash = "";
  return `${locationUrl.origin}${locationUrl.pathname}`;
};

const buildMarkdownLink = (): string => {
  const title = buildTitleCopyText();
  return `[${title}](${buildStandalonePageUrl()})`;
};

const buildTitleCopyText = (): string =>
  normalizeMarkdownTitle(findTitle()?.textContent?.trim() ?? "");

const createCopyText = (key: ButtonKey): string =>
  key === "title" ? buildTitleCopyText() : buildMarkdownLink();

const createCopyButton = (key: ButtonKey): HTMLButtonElement => {
  const idleShadow = "0 1px 2px rgba(31, 42, 46, 0.06)";
  const hoverShadow = "0 8px 18px rgba(31, 42, 46, 0.14)";
  const button = document.createElement("button");
  const icon = document.createElement("span");
  const label = document.createElement("span");
  const style = buttonStyleByState;
  let resetTimer: number | undefined;
  let isHovered = false;

  button.type = "button";
  button.dataset.key = key;
  button.style.cssText = [
    "display:inline-flex",
    "align-items:center",
    "gap:7px",
    "padding:7px 12px",
    "border-width:1px",
    "border-style:solid",
    "border-radius:999px",
    "font-size:13px",
    "font-weight:600",
    "line-height:1.3",
    "cursor:pointer",
    "white-space:nowrap",
    "font-family:inherit",
    "transform:translateY(0) scale(1)",
    `box-shadow:${idleShadow}`,
    `background:${style.idle.background}`,
    `border-color:${style.idle.borderColor}`,
    `color:${style.idle.color}`,
    "transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease, transform 160ms ease, box-shadow 160ms ease",
  ].join(";");
  icon.textContent = copyButtonIcon[key];
  label.textContent = copyButtonIdleLabel[key];
  button.append(icon, label);
  button.title = copyButtonIdleLabel[key];

  const applyHoverMotion = (): void => {
    const canAnimate = isHovered && !button.disabled;
    button.style.transform = canAnimate ? "translateY(-1px) scale(1.02)" : "translateY(0) scale(1)";
    button.style.boxShadow = canAnimate ? hoverShadow : idleShadow;
  };

  const setState = (state: ButtonState): void => {
    const current = buttonStyleByState[state];
    const stateLabel = state === "idle" ? copyButtonIdleLabel[key] : copyButtonStateLabel[state];

    button.dataset.state = state;
    label.textContent = stateLabel;
    button.title = `${copyButtonIdleLabel[key]}（状態: ${stateLabel}）`;
    button.disabled = state === "copying";
    button.style.background = current.background;
    button.style.borderColor = current.borderColor;
    button.style.color = current.color;
    applyHoverMotion();
  };

  button.addEventListener("mouseenter", () => {
    isHovered = true;
    applyHoverMotion();
  });
  button.addEventListener("mouseleave", () => {
    isHovered = false;
    applyHoverMotion();
  });
  button.addEventListener("focus", () => {
    isHovered = true;
    applyHoverMotion();
  });
  button.addEventListener("blur", () => {
    isHovered = false;
    applyHoverMotion();
  });

  button.addEventListener("click", async () => {
    const copyText = createCopyText(key);
    setState("copying");

    try {
      await navigator.clipboard.writeText(copyText);
      setState("success");
    } catch {
      setState("error");
    }

    if (resetTimer !== undefined) {
      window.clearTimeout(resetTimer);
    }
    resetTimer = window.setTimeout(() => {
      setState("idle");
    }, flashDurationMs);
  });

  setState("idle");
  return button;
};

export const createCopyTitleHoverController = (): {
  setEnabled: (enabled: boolean) => void;
  refresh: () => void;
  dispose: () => void;
} => {
  const eventWindow = window;
  let isEnabled = false;
  let observer: MutationObserver | undefined;
  let currentTitle: HTMLHeadingElement | null = null;
  let currentTitleEnter: (() => void) | undefined;
  let currentTitleLeave: (() => void) | undefined;
  let hoverTimer: number | null = null;
  let titleHovered = false;
  let panelHovered = false;
  const panel = document.createElement("div");
  panel.id = panelId;
  panel.style.cssText = [
    "position: fixed",
    "display: flex",
    "gap: 6px",
    "padding: 6px 8px",
    "border: 1px solid rgba(55, 53, 47, 0.16)",
    "border-radius: 999px",
    "background: rgba(255, 255, 255, 0.94)",
    "box-shadow: 0 6px 18px rgba(31, 42, 46, 0.16)",
    "z-index: 9999",
    "opacity: 0",
    "pointer-events: none",
    "transform: translateY(2px)",
    "transition: opacity 120ms ease, transform 120ms ease",
  ].join(";");
  panel.hidden = true;

  const titleButton = createCopyButton("title");
  const markdownButton = createCopyButton("markdown");
  panel.append(titleButton, markdownButton);

  const clearHoverTimer = (): void => {
    if (hoverTimer === null) {
      return;
    }

    eventWindow.clearTimeout(hoverTimer);
    hoverTimer = null;
  };

  const applyPanelVisibility = (): void => {
    if (!panel.parentElement && document.body) {
      document.body.append(panel);
    }

    if (titleHovered || panelHovered) {
      panel.hidden = false;
      panel.style.opacity = "1";
      panel.style.pointerEvents = "auto";
      panel.style.transform = "translateY(0)";
      return;
    }

    clearHoverTimer();
    hoverTimer = eventWindow.setTimeout(() => {
      panel.hidden = true;
      panel.style.opacity = "0";
      panel.style.pointerEvents = "none";
      panel.style.transform = "translateY(2px)";
      hoverTimer = null;
    }, hideDelayMs);
  };

  const clampPanelPosition = (value: number, panelSize: number, viewportSize: number): number =>
    Math.max(viewportMarginPx, Math.min(viewportSize - panelSize - viewportMarginPx, value));

  const updatePanelPosition = (): void => {
    if (panel.hidden || currentTitle === null) {
      return;
    }

    const titleRect = currentTitle.getBoundingClientRect();
    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const left = clampPanelPosition(titleRect.left, panelWidth, eventWindow.innerWidth);
    const preferredTop = titleRect.top - panelHeight - panelGapPx;
    const fallbackTop = titleRect.bottom + panelGapPx;
    const topBase = preferredTop >= viewportMarginPx ? preferredTop : fallbackTop;
    const top = clampPanelPosition(topBase, panelHeight, eventWindow.innerHeight);

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  };

  const attachTitleHandlers = (title: HTMLHeadingElement): void => {
    if (currentTitle === title) {
      return;
    }

    detachTitleHandlers();
    currentTitle = title;
    currentTitleEnter = () => {
      titleHovered = true;
      clearHoverTimer();
      applyPanelVisibility();
      updatePanelPosition();
    };

    currentTitleLeave = () => {
      titleHovered = false;
      applyPanelVisibility();
    };

    title.addEventListener("mouseenter", currentTitleEnter);
    title.addEventListener("mouseleave", currentTitleLeave);
  };

  const detachTitleHandlers = (): void => {
    if (currentTitle === null) {
      return;
    }

    if (currentTitleEnter !== undefined) {
      currentTitle.removeEventListener("mouseenter", currentTitleEnter);
    }
    if (currentTitleLeave !== undefined) {
      currentTitle.removeEventListener("mouseleave", currentTitleLeave);
    }
    currentTitle = null;
    currentTitleEnter = undefined;
    currentTitleLeave = undefined;
  };

  const install = (): boolean => {
    const title = findTitle();
    if (!title) {
      detachTitleHandlers();
      return false;
    }

    attachTitleHandlers(title);
    return true;
  };

  const startObserver = (): void => {
    if (observer || !document.body) {
      return;
    }

    observer = new MutationObserver(() => {
      install();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  const stopObserver = (): void => {
    observer?.disconnect();
    observer = undefined;
  };

  panel.addEventListener("mouseenter", () => {
    panelHovered = true;
    titleHovered = false;
    clearHoverTimer();
    applyPanelVisibility();
  });
  panel.addEventListener("mouseleave", () => {
    panelHovered = false;
    applyPanelVisibility();
  });
  eventWindow.addEventListener("scroll", updatePanelPosition, true);
  eventWindow.addEventListener("resize", updatePanelPosition);

  const setEnabled = (enabled: boolean): void => {
    isEnabled = enabled;
    if (enabled) {
      if (document.body) {
        install();
        if (!panel.parentElement) {
          document.body.append(panel);
        }
        startObserver();
        return;
      }

      eventWindow.requestAnimationFrame(() => {
        if (isEnabled) {
          setEnabled(true);
        }
      });
      return;
    }

    stopObserver();
    detachTitleHandlers();
    titleHovered = false;
    panelHovered = false;
    panel.hidden = true;
    panel.style.opacity = "0";
    panel.style.pointerEvents = "none";
    panel.style.transform = "translateY(2px)";
    panel.remove();
    clearHoverTimer();
  };

  const refresh = (): void => {
    if (!isEnabled) {
      return;
    }
    install();
  };

  const dispose = (): void => {
    setEnabled(false);
    eventWindow.removeEventListener("scroll", updatePanelPosition, true);
    eventWindow.removeEventListener("resize", updatePanelPosition);
    panel.remove();
  };

  return {
    setEnabled,
    refresh,
    dispose,
  };
};

export const registerCopyTitleHoverButtons = async (
  api: CopyTitleHoverButtonApi,
  controller: {
    setEnabled: (enabled: boolean) => void;
    refresh: () => void;
    dispose: () => void;
  } = createCopyTitleHoverController(),
): Promise<{
  setEnabled: (enabled: boolean) => void;
  refresh: () => void;
  dispose: () => void;
}> => {
  controller.setEnabled(await getCopyTitleHoverEnabled(api.storage.local));

  const handleStorageChanged = (
    changes: Record<string, StorageChangeLike>,
    areaName: string,
  ): void => {
    if (areaName !== "local") {
      return;
    }

    const nextEnabled = getCopyTitleHoverEnabledFromChanges(changes);
    if (nextEnabled !== undefined) {
      controller.setEnabled(nextEnabled);
    }
  };

  api.storage.onChanged.addListener(handleStorageChanged);

  return {
    ...controller,
    dispose: () => {
      api.storage.onChanged.removeListener(handleStorageChanged);
      controller.dispose();
    },
  };
};
