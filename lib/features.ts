import { browser } from "wxt/browser";

export const featureLabels = {
  urlCopyEnabled: "URLをMarkdownでコピー",
  bodyCopyEnabled: "本文をMarkdownでコピー",
  vimEnabled: "TextareaVim",
  lgtmEnabled: "GitHub: LGTM",
  tableEnabled: "GitHub: 表挿入",
  prCopyEnabled: "GitHub: PRコピー",
  htmlPreviewEnabled: "GitHub: HTMLプレビュー",
  devinRedirectEnabled: "GitHub: Devin系リンク",
  copyMarkdownButtonEnabled: "Notion: ページ内本文コピーボタン",
  copyTitleHoverEnabled: "Notion: タイトルホバー操作",
  headingMarkerEnabled: "Notion: 見出しマーカー",
  mergeGuardEnabled: "Devin Review: マージボタン非表示",
} as const;
export type FeatureKey = keyof typeof featureLabels;
export type Features = Record<FeatureKey, boolean>;
export const featureKeys = Object.keys(featureLabels) as FeatureKey[];
export const normalizeFeatures = (values: Record<string, unknown>): Features =>
  Object.fromEntries(
    featureKeys.map((key) => [key, typeof values[key] === "boolean" ? values[key] : true]),
  ) as Features;
export const readFeatures = async (): Promise<Features> =>
  normalizeFeatures(await browser.storage.local.get(featureKeys));
export const saveFeature = (key: FeatureKey, value: boolean): Promise<void> =>
  browser.storage.local.set({ [key]: value });

// Read once, then merge storage events. Changes that arrive during the initial read win.
export const watchFeatures = (
  apply: (settings: Features) => void,
  onError: (error: unknown) => void = console.error,
): (() => void) => {
  let disposed = false;
  let values: Record<string, unknown> = {};
  let pending: Record<string, unknown> = {};
  let loaded = false;
  const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area !== "local") return;
    const updates = Object.fromEntries(
      featureKeys.filter((key) => key in changes).map((key) => [key, changes[key]?.newValue]),
    );
    if (!Object.keys(updates).length) return;
    if (!loaded) {
      pending = { ...pending, ...updates };
      return;
    }
    values = { ...values, ...updates };
    apply(normalizeFeatures(values));
  };
  browser.storage.onChanged.addListener(onChanged);
  void browser.storage.local
    .get(featureKeys)
    .then((stored) => {
      if (disposed) return;
      values = { ...stored, ...pending };
      loaded = true;
      apply(normalizeFeatures(values));
    })
    .catch((error) => {
      if (!disposed) onError(error);
    });
  return () => {
    disposed = true;
    browser.storage.onChanged.removeListener(onChanged);
  };
};
