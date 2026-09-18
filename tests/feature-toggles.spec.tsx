import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { browser } from "wxt/browser";
import { FeatureToggles } from "../lib/feature-toggles";
import { normalizeFeatures, watchFeatures } from "../lib/features";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("shows all twelve switches and disables them until settings load", async () => {
  await act(async () => root.render(<FeatureToggles onStatus={vi.fn()} />));
  const inputs = [...container.querySelectorAll("input")];
  expect(inputs).toHaveLength(12);
  expect(inputs.every((input) => input.disabled)).toBe(true);
  await act(async () =>
    root.render(
      <FeatureToggles features={normalizeFeatures({ vimEnabled: false })} onStatus={vi.fn()} />,
    ),
  );
  expect(inputs.every((input) => !input.disabled)).toBe(true);
  expect(inputs[2]?.checked).toBe(false);
});
it("writes the shared storage key and waits for the save before enabling the switch again", async () => {
  let resolve!: () => void;
  const save = vi.spyOn(browser.storage.local, "set").mockImplementation(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  const status = vi.fn();
  await act(async () =>
    root.render(<FeatureToggles features={normalizeFeatures({})} onStatus={status} />),
  );
  const input = container.querySelector("input")!;
  await act(async () => input.click());
  expect(save).toHaveBeenCalledWith({ urlCopyEnabled: false });
  expect(input.disabled).toBe(true);
  await act(async () => resolve());
  expect(input.disabled).toBe(false);
  expect(status).toHaveBeenCalledWith("機能設定を保存しました。");
});
it("keeps the stored value and reports a failed write", async () => {
  vi.spyOn(browser.storage.local, "set").mockRejectedValue(new Error("保存失敗"));
  const status = vi.fn();
  await act(async () =>
    root.render(<FeatureToggles features={normalizeFeatures({})} onStatus={status} />),
  );
  const input = container.querySelector("input")!;
  await act(async () => input.click());
  expect(input.checked).toBe(true);
  expect(input.disabled).toBe(false);
  expect(status).toHaveBeenCalledWith("保存失敗");
});
it("reflects stored changes in the visible switches through the existing watcher", async () => {
  let listener: Parameters<typeof browser.storage.onChanged.addListener>[0] | undefined;
  vi.spyOn(browser.storage.local, "get").mockImplementation(async () => ({}));
  vi.spyOn(browser.storage.onChanged, "addListener").mockImplementation((callback) => {
    listener = callback;
  });
  let stop!: () => void;
  await act(async () => {
    stop = watchFeatures((features) =>
      root.render(<FeatureToggles features={features} onStatus={vi.fn()} />),
    );
  });
  await act(async () => listener!({ mergeGuardEnabled: { newValue: false } }, "local"));
  expect([...container.querySelectorAll("input")].at(-1)?.checked).toBe(false);
  stop();
});
