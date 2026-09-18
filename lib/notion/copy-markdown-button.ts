import { extractPageMarkdown } from "./markdown-extractor";
import {
  getCopyMarkdownButtonEnabled,
  getCopyMarkdownButtonEnabledFromChanges,
  type StorageAreaLike,
  type StorageChangeEventLike,
  type StorageChangeLike,
} from "../notion-enhancer-settings";

const buttonId = "notion-enhancer-copy-md-btn";
const injectSelector = ".notion-topbar-action-buttons, .notion-topbar__action-buttons";

export interface CopyMarkdownButtonApi {
  storage: {
    local: StorageAreaLike;
    onChanged: StorageChangeEventLike;
  };
}

type ButtonState = "idle" | "copying" | "success" | "extract-error" | "clipboard-error";

const buttonLabels: Record<ButtonState, string> = {
  idle: "Markdownをコピー",
  copying: "Markdownを抽出中…",
  success: "コピー完了",
  "extract-error": "抽出できませんでした",
  "clipboard-error": "コピーに失敗しました",
};

const buttonTitles: Record<ButtonState, string> = {
  idle: "このページの内容をMarkdownとしてクリップボードにコピー",
  copying: "ページ内容をMarkdownへ変換しています",
  success: "Markdownをクリップボードへコピーしました",
  "extract-error": "ページ内のNotionコンテンツを抽出できませんでした",
  "clipboard-error": "クリップボードへの書き込みに失敗しました",
};

const buttonStyle = {
  idle: {
    background: "rgba(255, 255, 255, 0.74)",
    borderColor: "rgba(55, 53, 47, 0.16)",
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
  "extract-error": {
    background: "rgba(224, 98, 80, 0.12)",
    borderColor: "rgba(224, 98, 80, 0.28)",
    color: "#b23d2f",
  },
  "clipboard-error": {
    background: "rgba(224, 98, 80, 0.12)",
    borderColor: "rgba(224, 98, 80, 0.28)",
    color: "#b23d2f",
  },
} satisfies Record<ButtonState, { background: string; borderColor: string; color: string }>;

const applyButtonState = (button: HTMLButtonElement, state: ButtonState): void => {
  const style = buttonStyle[state];

  button.dataset.state = state;
  button.textContent = buttonLabels[state];
  button.title = buttonTitles[state];
  button.disabled = state === "copying";
  button.style.background = style.background;
  button.style.borderColor = style.borderColor;
  button.style.color = style.color;
};

const createCopyButton = (): HTMLButtonElement => {
  const button = document.createElement("button");
  let resetTimer: number | undefined;

  button.id = buttonId;
  button.type = "button";
  button.style.cssText = [
    "margin-left: 8px",
    "padding: 6px 12px",
    "border: 1px solid rgba(55,53,47,0.16)",
    "border-radius: 999px",
    "background: rgba(255,255,255,0.74)",
    "color: #2f3437",
    "font-size: 13px",
    "font-weight: 600",
    "line-height: 1.2",
    "cursor: pointer",
    "white-space: nowrap",
    "transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease, opacity 120ms ease",
  ].join(";");

  const queueReset = (): void => {
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      applyButtonState(button, "idle");
    }, 2200);
  };

  button.addEventListener("mouseenter", () => {
    if (button.dataset.state === "idle") {
      button.style.background = "rgba(255, 255, 255, 0.92)";
    }
  });

  button.addEventListener("mouseleave", () => {
    if (button.dataset.state === "idle") {
      button.style.background = buttonStyle.idle.background;
    }
  });

  button.addEventListener("click", async () => {
    applyButtonState(button, "copying");

    const result = extractPageMarkdown();
    if (!result.success) {
      applyButtonState(button, "extract-error");
      queueReset();
      return;
    }

    try {
      await navigator.clipboard.writeText(result.markdown);
      applyButtonState(button, "success");
    } catch {
      applyButtonState(button, "clipboard-error");
    }

    queueReset();
  });

  applyButtonState(button, "idle");

  return button;
};

const injectButton = (): boolean => {
  if (document.getElementById(buttonId)) {
    return true;
  }

  const toolbar = document.querySelector(injectSelector);
  if (!toolbar) {
    return false;
  }

  toolbar.appendChild(createCopyButton());
  return true;
};

const removeButton = (): void => {
  document.getElementById(buttonId)?.remove();
};

const observeAndInjectButton = (): MutationObserver => {
  injectButton();
  const observer = new MutationObserver(() => {
    injectButton();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
};

export const createCopyMarkdownButtonController = () => {
  let isEnabled = false;
  let observer: MutationObserver | undefined;

  const stopObserving = (): void => {
    observer?.disconnect();
    observer = undefined;
  };

  const setEnabled = (enabled: boolean): void => {
    isEnabled = enabled;

    if (enabled) {
      stopObserving();
      observer = observeAndInjectButton();
      return;
    }

    stopObserving();
    removeButton();
  };

  const refresh = (): void => {
    if (isEnabled) {
      stopObserving();
      observer = observeAndInjectButton();
    }
  };

  const dispose = (): void => {
    isEnabled = false;
    stopObserving();
    removeButton();
  };

  return {
    setEnabled,
    refresh,
    dispose,
  };
};

export const registerCopyMarkdownButton = async (
  api: CopyMarkdownButtonApi,
  controller = createCopyMarkdownButtonController(),
): Promise<typeof controller> => {
  controller.setEnabled(await getCopyMarkdownButtonEnabled(api.storage.local));

  const handleStorageChanged = (
    changes: Record<string, StorageChangeLike>,
    areaName: string,
  ): void => {
    if (areaName !== "local") {
      return;
    }

    const nextEnabled = getCopyMarkdownButtonEnabledFromChanges(changes);
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
