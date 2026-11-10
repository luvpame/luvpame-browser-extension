import { isRecord } from "../../lib/copy-protocol";

export const PREPARE_TRANSLATION = "luvpame:prepare-translation";
export const OFFSCREEN_PREPARE_TRANSLATION = "luvpame:offscreen-prepare-translation";
export const TRANSLATE = "luvpame:translate";
export const TRANSLATE_BATCH = "luvpame:translate-batch";
export const CANCEL_TRANSLATION = "luvpame:cancel-translation";
export const CANCEL_TRANSLATION_REQUEST = "luvpame:cancel-translation-request";
export const REPRIORITIZE_TRANSLATIONS = "luvpame:reprioritize-translations";
export const TRANSLATION_PROGRESS = "luvpame:translation-progress";
export const PAGE_TRANSLATION = "luvpame:page-translation";
export const TRANSLATION_READY = "luvpame:translation-ready";
export const OFFSCREEN_TRANSLATE = "luvpame:offscreen-translate";
export const OFFSCREEN_TRANSLATE_BATCH = "luvpame:offscreen-translate-batch";
export const OFFSCREEN_CANCEL = "luvpame:offscreen-cancel-translation";
export const OFFSCREEN_CANCEL_REQUEST = "luvpame:offscreen-cancel-translation-request";
export const OFFSCREEN_REPRIORITIZE = "luvpame:offscreen-reprioritize";
export type TranslationMode = "below" | "replace";
export type TargetLanguage = "ja" | "ja-easy";
export type TranslationModel = "0.8b" | "2b" | "2b-speculative";
export type TranslationDevice = "gpu" | "cpu";
export type TranslationProvider =
  | { kind: "browser"; model: TranslationModel }
  | { kind: "ollama"; model: string };
export type TranslationPriority = "selection" | "page";
export type TranslationUpdate =
  | { kind: "status"; message: string }
  | { kind: "text"; text: string }
  | { kind: "append"; offset: number; text: string };
export type TranslationOptions = {
  signal: AbortSignal;
  onProgress: (message: string) => void;
  onText?: (text: string) => void;
  priority?: TranslationPriority;
  viewportDistance?: () => number;
};
type TranslationOutput = { device: TranslationDevice } | { provider: "ollama"; device: "unknown" };
export type PrepareTranslationResult =
  | { ok: true; device: TranslationDevice }
  | { ok: false; error: string };
export type TranslationResult =
  | ({ ok: true; text: string } & TranslationOutput)
  | { ok: false; error: string };
export type TranslationBatchOutput = { texts: string[] } & TranslationOutput;
export type TranslationBatchResult =
  | ({ ok: true } & TranslationBatchOutput)
  | { ok: false; error: string };
export type TranslationRequest = {
  type: typeof TRANSLATE;
  text: string;
  target: TargetLanguage;
  sessionId: string;
  requestId: string;
  priority: TranslationPriority;
  viewportDistance?: number;
};
export type TranslationBatchRequest = Omit<TranslationRequest, "type" | "text" | "priority"> & {
  type: typeof TRANSLATE_BATCH;
  texts: string[];
  priority: "page";
};
export type ReprioritizeTranslationsRequest = {
  type: typeof REPRIORITIZE_TRANSLATIONS;
  sessionId: string;
  updates: { requestId: string; distance: number }[];
};
export const isSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9:_-]{1,160}$/.test(value);
export const isOffscreenSessionId = (value: unknown): value is string =>
  typeof value === "string" && /^tab-[0-9]+:[a-zA-Z0-9:_-]{1,160}$/.test(value);
export const isViewportDistance = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 10_000_000;
const isText = (value: unknown, maxLength: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
const hasRequestFields = (value: Record<string, unknown>): boolean =>
  (value.target === "ja" || value.target === "ja-easy") &&
  isSessionId(value.sessionId) &&
  isSessionId(value.requestId) &&
  (value.viewportDistance === undefined || isViewportDistance(value.viewportDistance));
export const isTranslationRequest = (value: unknown): value is TranslationRequest =>
  isRecord(value) &&
  value.type === TRANSLATE &&
  isText(value.text, 20000) &&
  hasRequestFields(value) &&
  (value.priority === "selection" || value.priority === "page");
export const isTranslationBatchRequest = (value: unknown): value is TranslationBatchRequest =>
  isRecord(value) &&
  value.type === TRANSLATE_BATCH &&
  hasRequestFields(value) &&
  value.priority === "page" &&
  Array.isArray(value.texts) &&
  value.texts.length >= 2 &&
  value.texts.length <= 8 &&
  value.texts.every((text: unknown) => isText(text, 160)) &&
  value.texts.reduce((total: number, text: string) => total + text.length, 0) <= 640;
const hasOutputDevice = (value: Record<string, unknown>): boolean =>
  value.device === "gpu" ||
  value.device === "cpu" ||
  (value.provider === "ollama" && value.device === "unknown");
export const isPrepareTranslationResult = (value: unknown): value is PrepareTranslationResult =>
  isRecord(value) &&
  ((value.ok === true && (value.device === "gpu" || value.device === "cpu")) ||
    (value.ok === false && typeof value.error === "string"));
export const isTranslationResult = (value: unknown): value is TranslationResult =>
  isRecord(value) &&
  ((value.ok === true && typeof value.text === "string" && hasOutputDevice(value)) ||
    (value.ok === false && typeof value.error === "string"));
export const isTranslationBatchResult = (
  value: unknown,
  count?: number,
): value is TranslationBatchResult =>
  isRecord(value) &&
  ((value.ok === true &&
    Array.isArray(value.texts) &&
    value.texts.length >= 2 &&
    value.texts.length <= 8 &&
    (count === undefined || value.texts.length === count) &&
    value.texts.every((text: unknown) => typeof text === "string" && text.trim().length > 0) &&
    hasOutputDevice(value)) ||
    (value.ok === false && typeof value.error === "string"));
export const isReprioritizeTranslationsRequest = (
  value: unknown,
): value is ReprioritizeTranslationsRequest =>
  isRecord(value) &&
  value.type === REPRIORITIZE_TRANSLATIONS &&
  isSessionId(value.sessionId) &&
  Array.isArray(value.updates) &&
  value.updates.length <= 64 &&
  value.updates.every(
    (update: unknown) =>
      isRecord(update) && isSessionId(update.requestId) && isViewportDistance(update.distance),
  );
export const isTranslationModel = (value: unknown): value is TranslationModel =>
  value === "0.8b" || value === "2b" || value === "2b-speculative";
export const isTranslationProvider = (value: unknown): value is TranslationProvider =>
  isRecord(value) &&
  ((value.kind === "browser" && isTranslationModel(value.model)) ||
    (value.kind === "ollama" && isOllamaModel(value.model)));
export const isOllamaModel = (value: unknown): value is string =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,199}$/.test(value);
export const isTranslationUpdate = (value: unknown): value is TranslationUpdate =>
  isRecord(value) &&
  ((value.kind === "status" && typeof value.message === "string") ||
    (value.kind === "text" && typeof value.text === "string") ||
    (value.kind === "append" &&
      Number.isSafeInteger(value.offset) &&
      typeof value.offset === "number" &&
      value.offset >= 0 &&
      typeof value.text === "string"));
