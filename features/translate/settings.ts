import { browser } from "wxt/browser";
import type { TranslationModel } from "./shared";

export const TRANSLATION_MODEL_KEY = "translationModel";
export const readTranslationModel = async (): Promise<TranslationModel> => {
  const stored = await browser.storage.local.get(TRANSLATION_MODEL_KEY);
  return stored[TRANSLATION_MODEL_KEY] === "0.8b" ? "0.8b" : "2b";
};
export const saveTranslationModel = (model: TranslationModel): Promise<void> =>
  browser.storage.local.set({ [TRANSLATION_MODEL_KEY]: model });
