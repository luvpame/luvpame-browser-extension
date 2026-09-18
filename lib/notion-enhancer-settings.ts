export const headingMarkerEnabledStorageKey = "headingMarkerEnabled";
export const copyMarkdownButtonEnabledStorageKey = "copyMarkdownButtonEnabled";
export const copyTitleHoverEnabledStorageKey = "copyTitleHoverEnabled";

export interface NotionEnhancerSettings {
  headingMarkerEnabled: boolean;
  copyMarkdownButtonEnabled: boolean;
  copyTitleHoverEnabled: boolean;
}

export interface StorageAreaLike {
  get: (
    keys?: string | string[] | Record<string, unknown> | null,
  ) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
}

export interface StorageChangeLike {
  oldValue?: unknown;
  newValue?: unknown;
}

export interface StorageChangeEventLike {
  addListener: (
    listener: (changes: Record<string, StorageChangeLike>, areaName: string) => void,
  ) => void;
  removeListener: (
    listener: (changes: Record<string, StorageChangeLike>, areaName: string) => void,
  ) => void;
}

export const defaultNotionEnhancerSettings: NotionEnhancerSettings = {
  headingMarkerEnabled: true,
  copyMarkdownButtonEnabled: true,
  copyTitleHoverEnabled: true,
};

const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

const resolveBooleanSetting = (value: unknown, fallback: boolean): boolean =>
  isBoolean(value) ? value : fallback;

const getBooleanSetting = async (
  storage: StorageAreaLike,
  key: keyof NotionEnhancerSettings,
): Promise<boolean> => {
  const fallback = defaultNotionEnhancerSettings[key];
  const result = await storage.get({
    [key]: fallback,
  });

  return resolveBooleanSetting(result[key], fallback);
};

const setBooleanSetting = async (
  storage: StorageAreaLike,
  key: keyof NotionEnhancerSettings,
  enabled: boolean,
): Promise<void> => {
  await storage.set({
    [key]: enabled,
  });
};

const getBooleanSettingFromChanges = (
  changes: Record<string, StorageChangeLike>,
  key: keyof NotionEnhancerSettings,
): boolean | undefined => {
  const change = changes[key];
  if (!change) {
    return undefined;
  }

  return resolveBooleanSetting(change.newValue, defaultNotionEnhancerSettings[key]);
};

export const getHeadingMarkerEnabled = async (storage: StorageAreaLike): Promise<boolean> => {
  return getBooleanSetting(storage, headingMarkerEnabledStorageKey);
};

export const setHeadingMarkerEnabled = async (
  storage: StorageAreaLike,
  enabled: boolean,
): Promise<void> => {
  await setBooleanSetting(storage, headingMarkerEnabledStorageKey, enabled);
};

export const getHeadingMarkerEnabledFromChanges = (
  changes: Record<string, StorageChangeLike>,
): boolean | undefined => {
  return getBooleanSettingFromChanges(changes, headingMarkerEnabledStorageKey);
};

export const getCopyMarkdownButtonEnabled = async (storage: StorageAreaLike): Promise<boolean> => {
  return getBooleanSetting(storage, copyMarkdownButtonEnabledStorageKey);
};

export const setCopyMarkdownButtonEnabled = async (
  storage: StorageAreaLike,
  enabled: boolean,
): Promise<void> => {
  await setBooleanSetting(storage, copyMarkdownButtonEnabledStorageKey, enabled);
};

export const getCopyMarkdownButtonEnabledFromChanges = (
  changes: Record<string, StorageChangeLike>,
): boolean | undefined => {
  return getBooleanSettingFromChanges(changes, copyMarkdownButtonEnabledStorageKey);
};

export const getCopyTitleHoverEnabled = async (storage: StorageAreaLike): Promise<boolean> => {
  return getBooleanSetting(storage, copyTitleHoverEnabledStorageKey);
};

export const setCopyTitleHoverEnabled = async (
  storage: StorageAreaLike,
  enabled: boolean,
): Promise<void> => {
  await setBooleanSetting(storage, copyTitleHoverEnabledStorageKey, enabled);
};

export const getCopyTitleHoverEnabledFromChanges = (
  changes: Record<string, StorageChangeLike>,
): boolean | undefined => {
  return getBooleanSettingFromChanges(changes, copyTitleHoverEnabledStorageKey);
};
