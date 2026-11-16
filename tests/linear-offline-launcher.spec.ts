import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

const { restore, save } = vi.hoisted(() => ({ restore: vi.fn(), save: vi.fn() }));
vi.mock("../features/linear-review-guide/offline-persistence", () => ({
  restoreSavedOfflineGuide: restore,
  saveOfflineAssets: save,
}));

beforeEach(() => {
  vi.resetModules();
  restore.mockReset().mockResolvedValue("missing-assets");
  save.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("location", { origin: "https://linear.app" });
  document.body.innerHTML = `<div id="root" style="height:100%">Linear content</div>
    <div data-agent-toolbar-bounds><div><div data-native-spacer></div><div><button aria-label="Agent">Agent</button></div><div><button aria-label="Chat history">履歴</button></div></div></div>`;
});
afterEach(() => {
  globalThis.luvpameLinearOfflineGuide = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("実行中はモデルと操作を維持したままステータスバーへ変更する", async () => {
  const panel = document.createElement("div");
  panel.dataset.luvpameTranslation = "offline-guide";
  panel.innerHTML =
    '<label>モデル<input type="file" disabled></label><output role="status">Guideの説明を自動翻訳中（GPU）</output><button>停止</button>';
  const stop = vi.fn(async () => {});
  const click = vi.fn();
  const button = panel.querySelector("button")!;
  const input = panel.querySelector("input")!;
  button.addEventListener("click", click);
  document.body.append(panel);
  globalThis.luvpameLinearOfflineGuide = { stop };
  await import("../scripts/linear-offline/launcher");
  expect(panel.hasAttribute("data-luvpame-status-bar")).toBe(true);
  expect(panel.parentElement).toBe(document.querySelector("[data-native-spacer]"));
  expect(document.querySelector('[data-luvpame-translation="offline-guide"]')).toBe(panel);
  expect(panel.querySelector("input")).toBe(input);
  expect(panel.querySelector('[role="status"]')?.textContent).toBe(
    "Guideの説明を自動翻訳中（GPU）",
  );
  expect(stop).not.toHaveBeenCalled();
  expect(document.querySelectorAll("[data-agent-toolbar-bounds]")).toHaveLength(1);
  expect(document.querySelectorAll("[data-agent-toolbar-bounds] > div > div")).toHaveLength(3);
  expect(document.getElementById("luvpame-offline-loader")).toBeNull();
  button.click();
  expect(click).toHaveBeenCalledOnce();
});

it("未起動ならファイル選択も同じバーに置き、閉じると取り除く", async () => {
  await import("../scripts/linear-offline/launcher");
  await vi.waitFor(() => expect(document.getElementById("luvpame-offline-loader")).not.toBeNull());
  const panel = document.getElementById("luvpame-offline-loader")!;
  expect(panel.hasAttribute("data-luvpame-status-bar")).toBe(true);
  expect(panel.parentElement).toBe(document.querySelector("[data-native-spacer]"));
  const input = panel.querySelector("input")!;
  expect(input.multiple).toBe(true);
  expect(input.getAttribute("aria-label")).toContain("linear-offline.js");
  expect(document.querySelectorAll("[data-luvpame-status-bar]")).toHaveLength(1);
  panel.querySelector("button")!.click();
  expect(document.querySelectorAll("[data-luvpame-status-bar]")).toHaveLength(0);
  expect(document.getElementById("root")?.getAttribute("style")).toBe("height:100%");
});

it("保存済みのファイルを復元できればファイル選択を開かない", async () => {
  restore.mockResolvedValue("started");
  await import("../scripts/linear-offline/launcher");
  await vi.waitFor(() => expect(restore).toHaveBeenCalledOnce());
  expect(document.getElementById("luvpame-offline-loader")).toBeNull();
});

it("保存済みファイルが壊れていても選び直せる", async () => {
  restore.mockRejectedValue(new Error("保存データが不正です。"));
  await import("../scripts/linear-offline/launcher");
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "自動復元できませんでした",
    ),
  );
  expect(document.querySelector("input")?.disabled).toBe(false);
});

it("初回保存の失敗を表示し、選択の再試行を残す", async () => {
  save.mockRejectedValue(new DOMException("容量不足", "QuotaExceededError"));
  const install = vi.fn();
  const revoke = vi.fn();
  vi.stubGlobal("offlineTestInstall", install);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () =>
        "data:text/javascript,export function installOfflineGuideApp(options){globalThis.offlineTestInstall(options)}";
      static override revokeObjectURL = revoke;
    },
  );
  await import("../scripts/linear-offline/launcher");
  await vi.waitFor(() => expect(document.querySelector("input")).not.toBeNull());
  const input = document.querySelector("input")!;
  const bundle = { name: "linear-offline.js", text: async () => "export {}" };
  const model = { name: "model.gguf" };
  Object.defineProperty(input, "files", { value: [bundle, model] });
  input.dispatchEvent(new Event("change"));
  await vi.waitFor(() =>
    expect(document.querySelector('[role="status"]')?.textContent).toContain("初回設定は未完了"),
  );
  expect(save).toHaveBeenCalledWith({ bundle, model });
  expect(install).not.toHaveBeenCalled();
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("");
  expect(revoke).toHaveBeenCalledOnce();
});
