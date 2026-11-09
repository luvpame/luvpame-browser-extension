import { isRecord } from "../../lib/copy-protocol";

export const TRANSLATE = "luvpame:translate";
export const CANCEL_TRANSLATION = "luvpame:cancel-translation";
export const TRANSLATION_PROGRESS = "luvpame:translation-progress";
export const PAGE_TRANSLATION = "luvpame:page-translation";
export const TRANSLATION_READY = "luvpame:translation-ready";
export const ARTICLE_REQUEST = "luvpame:article-request";
export const OFFSCREEN_TRANSLATE = "luvpame:offscreen-translate";
export const OFFSCREEN_CANCEL = "luvpame:offscreen-cancel-translation";
export type TargetLanguage = "ja" | "ja-easy";
export type TranslationModel = "0.8b" | "2b";
export type TranslationDevice = "gpu" | "cpu";
export type TranslationResult =
  | { ok: true; text: string; device: TranslationDevice }
  | { ok: false; error: string };
export type TranslationRequest = {
  type: typeof TRANSLATE;
  text: string;
  target: TargetLanguage;
  sessionId: string;
};
export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
export const isTranslationRequest = (value: unknown): value is TranslationRequest =>
  isRecord(value) &&
  value.type === TRANSLATE &&
  typeof value.text === "string" &&
  value.text.trim().length > 0 &&
  value.text.length <= 20000 &&
  (value.target === "ja" || value.target === "ja-easy") &&
  isSessionId(value.sessionId);
export const isTranslationResult = (value: unknown): value is TranslationResult =>
  isRecord(value) &&
  ((value.ok === true &&
    typeof value.text === "string" &&
    (value.device === "gpu" || value.device === "cpu")) ||
    (value.ok === false && typeof value.error === "string"));
