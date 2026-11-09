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
export type TranslationProvider =
  | { kind: "browser"; model: TranslationModel }
  | { kind: "ollama"; model: string };
export type TranslationPriority = "selection" | "page" | "article";
export type TranslationUpdate =
  | { kind: "status"; message: string }
  | { kind: "text"; text: string };
export type TranslationOptions = {
  signal: AbortSignal;
  onProgress: (message: string) => void;
  onText?: (text: string) => void;
  priority?: TranslationPriority;
};
export type TranslationResult =
  | { ok: true; text: string; device: TranslationDevice }
  | { ok: true; text: string; provider: "ollama"; device: "unknown" }
  | { ok: false; error: string };
export type TranslationRequest = {
  type: typeof TRANSLATE;
  text: string;
  target: TargetLanguage;
  sessionId: string;
  requestId: string;
  priority: TranslationPriority;
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
  isSessionId(value.sessionId) &&
  isSessionId(value.requestId) &&
  (value.priority === "selection" || value.priority === "page" || value.priority === "article");
export const isTranslationResult = (value: unknown): value is TranslationResult =>
  isRecord(value) &&
  ((value.ok === true &&
    typeof value.text === "string" &&
    (value.device === "gpu" ||
      value.device === "cpu" ||
      (value.provider === "ollama" && value.device === "unknown"))) ||
    (value.ok === false && typeof value.error === "string"));

export const isTranslationProvider = (value: unknown): value is TranslationProvider =>
  isRecord(value) &&
  ((value.kind === "browser" && (value.model === "0.8b" || value.model === "2b")) ||
    (value.kind === "ollama" && isOllamaModel(value.model)));
export const isOllamaModel = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value);
export const isTranslationUpdate = (value: unknown): value is TranslationUpdate =>
  isRecord(value) &&
  ((value.kind === "status" && typeof value.message === "string") ||
    (value.kind === "text" && typeof value.text === "string"));
