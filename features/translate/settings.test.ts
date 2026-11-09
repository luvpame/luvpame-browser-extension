import { afterEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { readTranslationSettings, saveTranslationProvider } from "./settings";

afterEach(() => vi.restoreAllMocks());
it.each([
  {},
  { translationModel: "2b" },
  { translationModel: "invalid", translationBackend: "invalid" },
])("preserves the default browser 2B for legacy or invalid settings (%j)", async (stored) => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => stored);
  expect(await readTranslationSettings()).toEqual({ kind: "browser", model: "2b" });
});
it("keeps a legacy 0.8B selection and saves each backend without overwriting the other model", async () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationModel: "0.8b",
  }));
  expect(await readTranslationSettings()).toEqual({ kind: "browser", model: "0.8b" });
  const save = vi.spyOn(browser.storage.local, "set").mockResolvedValue();
  await saveTranslationProvider({ kind: "ollama", model: "custom-plamo:local" });
  expect(save).toHaveBeenLastCalledWith({
    translationBackend: "ollama",
    translationOllamaModel: "custom-plamo:local",
  });
  await saveTranslationProvider({ kind: "browser", model: "0.8b" });
  expect(save).toHaveBeenLastCalledWith({
    translationBackend: "browser",
    translationModel: "0.8b",
  });
});
it("reads an explicitly chosen Ollama model", async () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationBackend: "ollama",
    translationOllamaModel: "local-plamo:latest",
  }));
  expect(await readTranslationSettings()).toEqual({ kind: "ollama", model: "local-plamo:latest" });
});
