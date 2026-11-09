import { browser } from "wxt/browser";
import { isOllamaModel, type TranslationModel, type TranslationProvider } from "./shared";

export const TRANSLATION_MODEL_KEY = "translationModel";
export const readTranslationModel = async (): Promise<TranslationModel> => {
  const stored = await browser.storage.local.get(TRANSLATION_MODEL_KEY);
  return stored[TRANSLATION_MODEL_KEY] === "0.8b" ? "0.8b" : "2b";
};
export const saveTranslationModel = (model: TranslationModel): Promise<void> =>
  browser.storage.local.set({ [TRANSLATION_MODEL_KEY]: model });

export const TRANSLATION_BACKEND_KEY = "translationBackend";
export const OLLAMA_MODEL_KEY = "translationOllamaModel";
export const DEFAULT_OLLAMA_MODEL = "plamo3-translate-ja:latest";
export const readTranslationSettings = async (): Promise<TranslationProvider> => {
  const stored = await browser.storage.local.get([
    TRANSLATION_MODEL_KEY,
    TRANSLATION_BACKEND_KEY,
    OLLAMA_MODEL_KEY,
  ]);
  return stored[TRANSLATION_BACKEND_KEY] === "ollama"
    ? {
        kind: "ollama",
        model: isOllamaModel(stored[OLLAMA_MODEL_KEY])
          ? stored[OLLAMA_MODEL_KEY]
          : DEFAULT_OLLAMA_MODEL,
      }
    : { kind: "browser", model: stored[TRANSLATION_MODEL_KEY] === "0.8b" ? "0.8b" : "2b" };
};
export const saveTranslationProvider = (provider: TranslationProvider): Promise<void> =>
  provider.kind === "browser"
    ? browser.storage.local.set({
        [TRANSLATION_BACKEND_KEY]: provider.kind,
        [TRANSLATION_MODEL_KEY]: provider.model,
      })
    : browser.storage.local.set({
        [TRANSLATION_BACKEND_KEY]: provider.kind,
        [OLLAMA_MODEL_KEY]: provider.model,
      });

export const readOllamaModel = async (): Promise<string> => {
  const stored = await browser.storage.local.get(OLLAMA_MODEL_KEY);
  return isOllamaModel(stored[OLLAMA_MODEL_KEY]) ? stored[OLLAMA_MODEL_KEY] : DEFAULT_OLLAMA_MODEL;
};
