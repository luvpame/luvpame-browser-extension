import { act } from "react";
import type { Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";

let root: Root;
vi.mock("react-dom/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-dom/client")>();
  return {
    ...actual,
    createRoot: (...args: Parameters<typeof actual.createRoot>) => {
      root = actual.createRoot(...args);
      return root;
    },
  };
});
let container: HTMLDivElement;
let translationMode: string;
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  container.id = "root";
  document.body.append(container);
  translationMode = "replace";
  vi.spyOn(browser.tabs, "query").mockImplementation(async () => [{ id: 1 }]);
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({ translationMode }));
  vi.spyOn(browser.storage.local, "set").mockImplementation(async (value) => {
    if ("translationMode" in value && typeof value.translationMode === "string")
      translationMode = value.translationMode;
  });
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("restores and saves the shared display mode, waiting for storage before enabling translation", async () => {
  await act(async () => {
    await import("../entrypoints/popup/main");
  });
  const select = container.querySelector<HTMLSelectElement>("#translation-mode")!;
  const buttons = [...container.querySelectorAll<HTMLButtonElement>(".translation-actions button")];
  expect(select.value).toBe("replace");
  expect(buttons.every((button) => !button.disabled)).toBe(true);
  let finishSave!: () => void;
  vi.mocked(browser.storage.local.set).mockImplementationOnce(
    (value) =>
      new Promise<void>((resolve) => {
        finishSave = () => {
          if ("translationMode" in value && typeof value.translationMode === "string")
            translationMode = value.translationMode;
          resolve();
        };
      }),
  );
  await act(async () => {
    select.value = "below";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(browser.storage.local.set).toHaveBeenCalledWith({ translationMode: "below" });
  expect(select.disabled).toBe(true);
  expect(select.value).toBe("replace");
  expect(buttons.every((button) => button.disabled)).toBe(true);
  await act(async () => finishSave());
  expect(select.value).toBe("below");
  expect(buttons.every((button) => !button.disabled)).toBe(true);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("次の翻訳から使用");
  await act(async () => root.unmount());
  vi.resetModules();
  await act(async () => {
    await import("../entrypoints/popup/main");
  });
  expect(container.querySelector<HTMLSelectElement>("#translation-mode")?.value).toBe("below");
});

it("keeps the saved mode when saving fails and reports the error", async () => {
  await act(async () => {
    await import("../entrypoints/popup/main");
  });
  vi.mocked(browser.storage.local.set).mockRejectedValueOnce(new Error("保存できません"));
  const select = container.querySelector<HTMLSelectElement>("#translation-mode")!;
  await act(async () => {
    select.value = "below";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(select.value).toBe("replace");
  expect(select.disabled).toBe(false);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("保存できません");
});
