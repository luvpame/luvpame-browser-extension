import { describe, expect, it, vi } from "vite-plus/test";

import {
  copyMarkdownButtonEnabledStorageKey,
  defaultNotionEnhancerSettings,
  copyTitleHoverEnabledStorageKey,
  getCopyMarkdownButtonEnabled,
  getCopyMarkdownButtonEnabledFromChanges,
  getHeadingMarkerEnabled,
  getHeadingMarkerEnabledFromChanges,
  getCopyTitleHoverEnabled,
  getCopyTitleHoverEnabledFromChanges,
  headingMarkerEnabledStorageKey,
  setCopyMarkdownButtonEnabled,
  setHeadingMarkerEnabled,
  setCopyTitleHoverEnabled,
} from "../../lib/notion-enhancer-settings";

describe("notion enhancer settings", () => {
  it("reads the default heading marker setting when storage is empty", async () => {
    const get = vi.fn().mockResolvedValue({});

    await expect(getHeadingMarkerEnabled({ get, set: vi.fn() })).resolves.toBe(
      defaultNotionEnhancerSettings.headingMarkerEnabled,
    );
    expect(get).toHaveBeenCalledWith({
      [headingMarkerEnabledStorageKey]: defaultNotionEnhancerSettings.headingMarkerEnabled,
    });
  });

  it("writes the heading marker setting", async () => {
    const set = vi.fn().mockResolvedValue(undefined);

    await setHeadingMarkerEnabled({ get: vi.fn(), set }, false);

    expect(set).toHaveBeenCalledWith({
      [headingMarkerEnabledStorageKey]: false,
    });
  });

  it("reads the default copy button setting when storage is empty", async () => {
    const get = vi.fn().mockResolvedValue({});

    await expect(getCopyMarkdownButtonEnabled({ get, set: vi.fn() })).resolves.toBe(
      defaultNotionEnhancerSettings.copyMarkdownButtonEnabled,
    );
    expect(get).toHaveBeenCalledWith({
      [copyMarkdownButtonEnabledStorageKey]:
        defaultNotionEnhancerSettings.copyMarkdownButtonEnabled,
    });
  });

  it("writes the copy button setting", async () => {
    const set = vi.fn().mockResolvedValue(undefined);

    await setCopyMarkdownButtonEnabled({ get: vi.fn(), set }, false);

    expect(set).toHaveBeenCalledWith({
      [copyMarkdownButtonEnabledStorageKey]: false,
    });
  });

  it("reads the default title hover setting when storage is empty", async () => {
    const get = vi.fn().mockResolvedValue({});

    await expect(getCopyTitleHoverEnabled({ get, set: vi.fn() })).resolves.toBe(
      defaultNotionEnhancerSettings.copyTitleHoverEnabled,
    );
    expect(get).toHaveBeenCalledWith({
      [copyTitleHoverEnabledStorageKey]: defaultNotionEnhancerSettings.copyTitleHoverEnabled,
    });
  });

  it("writes the title hover setting", async () => {
    const set = vi.fn().mockResolvedValue(undefined);

    await setCopyTitleHoverEnabled({ get: vi.fn(), set }, false);

    expect(set).toHaveBeenCalledWith({
      [copyTitleHoverEnabledStorageKey]: false,
    });
  });

  it("extracts the updated setting from storage changes", () => {
    expect(
      getHeadingMarkerEnabledFromChanges({
        [headingMarkerEnabledStorageKey]: {
          oldValue: true,
          newValue: false,
        },
      }),
    ).toBe(false);
  });

  it("returns undefined when unrelated storage keys change", () => {
    expect(
      getHeadingMarkerEnabledFromChanges({
        unrelated: {
          oldValue: true,
          newValue: false,
        },
      }),
    ).toBeUndefined();
  });

  it("extracts the updated copy button setting from storage changes", () => {
    expect(
      getCopyMarkdownButtonEnabledFromChanges({
        [copyMarkdownButtonEnabledStorageKey]: {
          oldValue: true,
          newValue: false,
        },
      }),
    ).toBe(false);
  });

  it("extracts the updated title hover setting from storage changes", () => {
    expect(
      getCopyTitleHoverEnabledFromChanges({
        [copyTitleHoverEnabledStorageKey]: {
          oldValue: true,
          newValue: false,
        },
      }),
    ).toBe(false);
  });
});
