import { beforeEach, expect, it, vi } from "vite-plus/test";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  watch: vi.fn(),
  features: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("../src/url-settings", () => ({ readUrlPolicy: mocks.read, watchUrlPolicy: mocks.watch }));
vi.mock("../../../lib/features", () => ({ watchFeatures: mocks.features }));
import { watchVimSettings } from "../src/settings-observer";
import type { UrlPolicy } from "../src/url-policy";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.watch.mockReturnValue(mocks.stop);
  mocks.features.mockReturnValue(mocks.stop);
});
it("starts the feature watcher before the URL read finishes and ignores stale URL results", async () => {
  let resolve!: (value: UrlPolicy) => void;
  mocks.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const onEnabled = vi.fn();
  const onPolicy = vi.fn();
  const stop = watchVimSettings(onEnabled, onPolicy);
  mocks.features.mock.calls[0]?.[0]?.({ vimEnabled: false });
  expect(onEnabled).toHaveBeenCalledWith(false);
  const latest: UrlPolicy = { mode: "allowlist", patterns: [] };
  mocks.watch.mock.calls[0]?.[0]?.(latest);
  resolve({ mode: "blocklist", patterns: [] });
  await Promise.resolve();
  expect(onPolicy).toHaveBeenCalledExactlyOnceWith(latest);
  stop();
  expect(mocks.stop).toHaveBeenCalledTimes(2);
});
it("does not apply an initial URL read after disposal", async () => {
  let resolve!: (value: UrlPolicy) => void;
  mocks.read.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const apply = vi.fn();
  const stop = watchVimSettings(vi.fn(), apply);
  stop();
  resolve({ mode: "blocklist", patterns: [] });
  await Promise.resolve();
  expect(apply).not.toHaveBeenCalled();
});
