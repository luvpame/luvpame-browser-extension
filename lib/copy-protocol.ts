export const COPY_REQUEST = "luvpame:copy";
export const OFFSCREEN_REQUEST = "luvpame:offscreen-copy";
export const NOTION_REQUEST = "luvpame:notion-extract";
export type CopyKind = "url" | "body";
export type CopyResult = { ok: true } | { ok: false; error: string };
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
export const isCopyRequest = (
  value: unknown,
): value is { type: typeof COPY_REQUEST; kind: CopyKind; tabId: number } =>
  isRecord(value) &&
  value.type === COPY_REQUEST &&
  (value.kind === "url" || value.kind === "body") &&
  Number.isInteger(value.tabId) &&
  Number(value.tabId) >= 0;
export type OffscreenRequest = {
  type: typeof OFFSCREEN_REQUEST;
  requestId: string;
  mode: "text" | "html";
  text: string;
  url: string;
};
export const isOffscreenRequest = (value: unknown): value is OffscreenRequest =>
  isRecord(value) &&
  value.type === OFFSCREEN_REQUEST &&
  typeof value.requestId === "string" &&
  (value.mode === "text" || value.mode === "html") &&
  typeof value.text === "string" &&
  typeof value.url === "string";
export const isNotionUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "www.notion.so" ||
        url.hostname === "app.notion.com" ||
        url.hostname.endsWith(".notion.site"))
    );
  } catch {
    return false;
  }
};
export const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
