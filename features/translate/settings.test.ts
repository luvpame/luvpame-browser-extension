import { afterEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import {
  readTranslationSettings,
  readTranslationModel,
  saveTranslationProvider,
  readTranslationMode,
  saveTranslationMode,
} from "./settings";

afterEach(() => vi.restoreAllMocks());
it.each([{}, { translationModel: "invalid", translationBackend: "invalid" }])(
  "defaults to browser 0.8B for legacy or invalid settings (%j)",
  async (stored) => {
    vi.spyOn(browser.storage.local, "get").mockImplementation(async () => stored);
    expect(await readTranslationSettings()).toEqual({ kind: "browser", model: "0.8b" });
  },
);
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

it.each([undefined, null, "invalid", "below"])(
  "defaults invalid or missing mode %j to below",
  async (translationMode) => {
    vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({ translationMode }));
    expect(await readTranslationMode()).toBe("below");
  },
);
it("saves and reloads replacement mode", async () => {
  let stored = {};
  vi.spyOn(browser.storage.local, "set").mockImplementation(async (value) => {
    stored = value;
  });
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => stored);
  await saveTranslationMode("replace");
  expect(await readTranslationMode()).toBe("replace");
});

it("preserves an explicitly saved 2B model", async () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationModel: "2b",
  }));
  expect(await readTranslationSettings()).toEqual({ kind: "browser", model: "2b" });
});

it("defaults a removed experimental model selection to browser 0.8B", async () => {
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({
    translationModel: "2b-speculative",
  }));
  expect(await readTranslationModel()).toBe("0.8b");
  expect(await readTranslationSettings()).toEqual({ kind: "browser", model: "0.8b" });
});
