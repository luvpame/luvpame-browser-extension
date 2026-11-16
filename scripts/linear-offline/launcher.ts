import { applyStatusBar } from "../../features/linear-review-guide/status-bar";
import {
  restoreSavedOfflineGuide,
  saveOfflineAssets,
} from "../../features/linear-review-guide/offline-persistence";

(async () => {
  if (location.origin !== "https://linear.app" || window.top !== window)
    throw new Error("Linearのメイン画面で実行してください。");
  const previous = document.getElementById("luvpame-offline-loader");
  previous?.remove();
  const activePanel = document.querySelector<HTMLElement>(
    '[data-luvpame-translation="offline-guide"]',
  );
  if (globalThis.luvpameLinearOfflineGuide && activePanel) {
    applyStatusBar(activePanel);
    return;
  }
  let restoreError: string | undefined;
  try {
    if ((await restoreSavedOfflineGuide()) !== "missing-assets") return;
  } catch (error) {
    restoreError = `自動復元できませんでした。ファイルを選び直してください。${error instanceof Error ? error.message : String(error)}`;
  }
  const panel = document.createElement("div");
  panel.id = "luvpame-offline-loader";
  panel.setAttribute("data-luvpame-translation", "offline-loader");
  const label = document.createElement("label");
  label.textContent = "ファイル";
  label.title = "linear-offline.js と model.gguf を選択";
  const input = document.createElement("input");
  input.type = "file";
  input.multiple = true;
  input.accept = ".js,.gguf";
  input.setAttribute("aria-label", "linear-offline.js と model.gguf を選択");
  label.append(input);
  const status = document.createElement("div");
  status.setAttribute("role", "status");
  const setStatus = (message: string) => {
    status.textContent = message;
    status.title = message;
  };
  setStatus(restoreError ?? "初回設定です。実行ファイルとモデルを選択してください。");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = "閉じる";
  close.addEventListener("click", () => panel.remove());
  panel.append(label, status, close);
  applyStatusBar(panel);
  input.addEventListener("change", async () => {
    const files = Array.from(input.files ?? []);
    const bundle = files.find((file) => file.name === "linear-offline.js");
    const model =
      files.find((file) => file.name === "model.gguf") ??
      files.find((file) => file.name.endsWith(".gguf"));
    if (!bundle) {
      setStatus("linear-offline.js を含めて選択してください。");
      return;
    }
    if (!model) {
      setStatus("GGUFモデルを含めて選択してください。");
      return;
    }
    input.disabled = true;
    setStatus("ローカルの実行ファイルを読み込んでいます…");
    let url: string | undefined;
    let installing = false;
    try {
      url = URL.createObjectURL(new Blob([await bundle.text()], { type: "text/javascript" }));
      const module: unknown = await import(/* @vite-ignore */ url);
      if (!panel.isConnected) return;
      if (
        typeof module !== "object" ||
        module === null ||
        !("installOfflineGuideApp" in module) ||
        typeof module.installOfflineGuideApp !== "function"
      )
        throw new Error("実行ファイルの形式が異なります。");
      setStatus("次回の自動復元用に実行ファイルとモデルを保存しています…");
      try {
        await saveOfflineAssets({ bundle, model });
      } catch (error) {
        throw new Error(
          `初回設定は未完了です。保存できませんでした。ファイルを選び直して再試行してください。${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (!panel.isConnected) return;
      installing = true;
      panel.remove();
      await module.installOfflineGuideApp({ model });
    } catch (error) {
      if (
        installing &&
        !document.querySelector('[data-luvpame-translation="offline-guide"]') &&
        !panel.isConnected
      )
        applyStatusBar(panel);
      if (panel.isConnected) setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      if (url) URL.revokeObjectURL(url);
      input.disabled = false;
      input.value = "";
    }
  });
})();
