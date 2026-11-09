import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { TranslationModelSettings } from "../features/translate/model-settings";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationBackend: "ollama",
    translationModel: "0.8b",
    translationOllamaModel: "saved-plamo:local",
  }));
  vi.spyOn(browser.storage.local, "set").mockResolvedValue();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps each saved model and recovers from an invalid draft when switching backends", async () => {
  await act(async () => root.render(<TranslationModelSettings />));
  const backend = container.querySelector<HTMLSelectElement>("#translation-backend")!;
  const input = container.querySelector<HTMLInputElement>("#translation-ollama-model")!;
  expect(input.value).toBe("saved-plamo:local");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(container.querySelector<HTMLButtonElement>("button")?.disabled).toBe(true);
  await act(async () => {
    backend.value = "browser";
    backend.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector<HTMLSelectElement>("#translation-model")?.value).toBe("0.8b");
  await act(async () => {
    backend.value = "ollama";
    backend.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(container.querySelector<HTMLInputElement>("#translation-ollama-model")?.value).toBe(
    "saved-plamo:local",
  );
  expect(browser.storage.local.set).toHaveBeenLastCalledWith({
    translationBackend: "ollama",
    translationOllamaModel: "saved-plamo:local",
  });
});
