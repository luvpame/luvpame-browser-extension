import { Blob as NodeBlob } from "node:buffer";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  clearOfflineAssets,
  readOfflineAssets,
  restoreSavedOfflineGuide,
  saveOfflineAssets,
} from "./offline-persistence";

function databaseWith(value: unknown) {
  const result = { result: value };
  const store = { get: vi.fn(() => result), put: vi.fn(() => result), delete: vi.fn(() => result) };
  const transaction: {
    error: DOMException | null;
    oncomplete: (() => void) | null;
    onerror: (() => void) | null;
    onabort: (() => void) | null;
    objectStore: () => typeof store;
  } = { error: null, oncomplete: null, onerror: null, onabort: null, objectStore: () => store };
  const database = { transaction: vi.fn(() => transaction), close: vi.fn(), onversionchange: null };
  const opening: { result: typeof database; onsuccess: (() => void) | null } = {
    result: database,
    onsuccess: null,
  };
  const open = vi.fn(() => {
    queueMicrotask(() => opening.onsuccess?.());
    return opening;
  });
  vi.stubGlobal("indexedDB", { open });
  return { transaction, database, store, open };
}

beforeEach(() => {
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("location", { origin: "https://linear.app" });
  document.body.innerHTML = "<div data-agent-toolbar-bounds></div>";
});

afterEach(() => {
  globalThis.luvpameLinearOfflineRestore = undefined;
  globalThis.luvpameLinearOfflineGuide = undefined;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("bundleとmodelを1レコードに保存し、transaction完了までは成功を返さない", async () => {
  const { store, database, transaction, open } = databaseWith(undefined);
  const assets = { bundle: new Blob(["export {}"]), model: new Blob(["GGUF model"]) };
  const completed = vi.fn();
  const pending = saveOfflineAssets(assets).then(completed);
  await vi.waitFor(() => expect(store.put).toHaveBeenCalledOnce());
  expect(open).toHaveBeenCalledWith("luvpame-linear-offline", 1);
  expect(database.transaction).toHaveBeenCalledWith("assets", "readwrite");
  expect(store.put).toHaveBeenCalledWith({ schemaVersion: 1, ...assets }, "runtime");
  expect(completed).not.toHaveBeenCalled();
  transaction.oncomplete?.();
  await pending;
  expect(database.close).toHaveBeenCalledOnce();
});

it("容量不足でabortした保存を失敗として返し接続を閉じる", async () => {
  const { store, database, transaction } = databaseWith(undefined);
  const pending = saveOfflineAssets({ bundle: new Blob(["export {}"]), model: new Blob(["GGUF"]) });
  const failed = expect(pending).rejects.toThrow("quota");
  await vi.waitFor(() => expect(store.put).toHaveBeenCalledOnce());
  transaction.error = new DOMException("quota", "QuotaExceededError");
  transaction.onabort?.();
  await failed;
  expect(database.close).toHaveBeenCalledOnce();
});

it.each([
  { bundle: new Blob(), model: new Blob(["GGUF"]) },
  { bundle: new Blob(["export {}"]), model: new Blob(["nope"]) },
])("不正な初回ファイルはDBへ保存しない %#", async (assets) => {
  const { open } = databaseWith(undefined);
  await expect(saveOfflineAssets(assets)).rejects.toThrow();
  expect(open).not.toHaveBeenCalled();
});

it.each([
  { schemaVersion: 2, bundle: new NodeBlob(["export {}"]), model: new NodeBlob(["GGUF"]) },
  { schemaVersion: 1, bundle: "export {}", model: new NodeBlob(["GGUF"]) },
  { schemaVersion: 1, bundle: new NodeBlob(["export {}"]), model: new NodeBlob(["nope"]) },
])("壊れた保存データを復元対象にしない %#", async (value) => {
  const { database, transaction } = databaseWith(value);
  const pending = readOfflineAssets();
  const failed = expect(pending).rejects.toThrow();
  await vi.waitFor(() => expect(database.transaction).toHaveBeenCalledOnce());
  transaction.oncomplete?.();
  await failed;
  expect(database.close).toHaveBeenCalledOnce();
});

it("同時復元は1回の読み出しを共有し、未保存ならmissing-assetsを返す", async () => {
  const { database, transaction, open } = databaseWith(undefined);
  const first = restoreSavedOfflineGuide();
  const second = restoreSavedOfflineGuide();
  expect(first).toBe(second);
  await vi.waitFor(() => expect(database.transaction).toHaveBeenCalledOnce());
  transaction.oncomplete?.();
  await expect(first).resolves.toBe("missing-assets");
  expect(open).toHaveBeenCalledOnce();
  expect(globalThis.luvpameLinearOfflineRestore).toBeUndefined();
});

it("保存モデルをinstallへ渡し、UI初期化の開始を返してBlob URLを解放する", async () => {
  const assets = { bundle: new Blob(["export {}"]), model: new Blob(["GGUF model"]) };
  const { database, transaction } = databaseWith({ schemaVersion: 1, ...assets });
  const install = vi.fn(async () => {});
  const revoke = vi.fn();
  vi.stubGlobal("offlineTestInstall", install);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = () =>
        "data:text/javascript,export function installOfflineGuideApp(options){return globalThis.offlineTestInstall(options)}";
      static override revokeObjectURL = revoke;
    },
  );
  const pending = restoreSavedOfflineGuide();
  await vi.waitFor(() => expect(database.transaction).toHaveBeenCalledOnce());
  transaction.oncomplete?.();
  await expect(pending).resolves.toBe("started");
  expect(install).toHaveBeenCalledExactlyOnceWith({ model: assets.model });
  expect(revoke).toHaveBeenCalledOnce();
});

it("実行中のDOMがあればモデルを再読込しない", async () => {
  const { open } = databaseWith(undefined);
  document.body.innerHTML = '<div data-luvpame-translation="offline-guide"></div>';
  await expect(restoreSavedOfflineGuide()).resolves.toBe("already-running");
  expect(open).not.toHaveBeenCalled();
});

it("Linear以外のoriginでは保存データを読み出さない", async () => {
  const { open } = databaseWith(undefined);
  vi.stubGlobal("location", { origin: "https://example.com" });
  await expect(restoreSavedOfflineGuide()).rejects.toThrow("メイン画面");
  expect(open).not.toHaveBeenCalled();
});

it("子フレームでは保存データを読み出さない", async () => {
  const { open } = databaseWith(undefined);
  vi.stubGlobal("window", { top: {} });
  await expect(restoreSavedOfflineGuide()).rejects.toThrow("メイン画面");
  expect(open).not.toHaveBeenCalled();
});

it("削除も専用レコードのtransaction完了を待つ", async () => {
  const { store, database, transaction } = databaseWith(undefined);
  const pending = clearOfflineAssets();
  await vi.waitFor(() => expect(store.delete).toHaveBeenCalledWith("runtime"));
  transaction.oncomplete?.();
  await pending;
  expect(database.close).toHaveBeenCalledOnce();
});
