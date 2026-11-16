type OfflineAssets = { bundle: Blob; model: Blob };
type RestoreResult = "started" | "already-running" | "missing-assets";

declare global {
  var luvpameLinearOfflineRestore: Promise<RestoreResult> | undefined;
}

const databaseName = "luvpame-linear-offline";
const storeName = "assets";
const assetsKey = "runtime";

async function validateAssets(value: unknown): Promise<OfflineAssets> {
  if (
    typeof value !== "object" ||
    value === null ||
    !("bundle" in value) ||
    !(value.bundle instanceof Blob) ||
    value.bundle.size === 0 ||
    !("model" in value) ||
    !(value.model instanceof Blob)
  )
    throw new Error("実行ファイルとGGUFモデルの保存データが不正です。選び直してください。");
  const magic = new Uint8Array(await value.model.slice(0, 4).arrayBuffer());
  if (
    magic.length !== 4 ||
    magic[0] !== 71 ||
    magic[1] !== 71 ||
    magic[2] !== 85 ||
    magic[3] !== 70
  )
    throw new Error("GGUF形式のモデルを選択してください。");
  return { bundle: value.bundle, model: value.model };
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, 1);
    let failed = false;
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onerror = () => reject(request.error ?? new Error("保存先を開けませんでした。"));
    request.onblocked = () => {
      failed = true;
      reject(new Error("保存先が使用中です。Linearのほかのウィンドウを閉じて再試行してください。"));
    };
    request.onsuccess = () => {
      const database = request.result;
      if (failed) {
        database.close();
        return;
      }
      database.onversionchange = () => database.close();
      resolve(database);
    };
  });
}

async function accessAssets(
  factory: IDBFactory,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => Pick<IDBRequest<unknown>, "result">,
): Promise<unknown> {
  const database = await openDatabase(factory);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = operation(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () =>
        reject(transaction.error ?? new Error("保存処理に失敗しました。"));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error("保存処理が中断されました。"));
    });
  } finally {
    database.close();
  }
}

export async function saveOfflineAssets(
  assets: OfflineAssets,
  factory: IDBFactory = indexedDB,
): Promise<void> {
  const valid = await validateAssets(assets);
  await accessAssets(factory, "readwrite", (store) =>
    store.put({ schemaVersion: 1, ...valid }, assetsKey),
  );
}

export async function readOfflineAssets(
  factory: IDBFactory = indexedDB,
): Promise<OfflineAssets | undefined> {
  const value = await accessAssets(factory, "readonly", (store) => store.get(assetsKey));
  if (value === undefined) return undefined;
  if (
    typeof value !== "object" ||
    value === null ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  )
    throw new Error("保存データの形式が異なります。実行ファイルとモデルを選び直してください。");
  return validateAssets(value);
}

export async function clearOfflineAssets(factory: IDBFactory = indexedDB): Promise<void> {
  await accessAssets(factory, "readwrite", (store) => store.delete(assetsKey));
}

function isRunning(): boolean {
  return Boolean(
    globalThis.luvpameLinearOfflineGuide ||
    document.querySelector('[data-luvpame-translation="offline-guide"]'),
  );
}

function waitForNativeToolbar(): Promise<void> {
  if (document.querySelector("[data-agent-toolbar-bounds]")) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!document.querySelector("[data-agent-toolbar-bounds]")) return;
      clearTimeout(timeout);
      observer.disconnect();
      resolve();
    });
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(new Error("Linearのツールバーが見つかりません。画面を開いて再試行してください。"));
    }, 30_000);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function restore(): Promise<RestoreResult> {
  if (isRunning()) return "already-running";
  const assets = await readOfflineAssets();
  if (!assets) return "missing-assets";
  await waitForNativeToolbar();
  if (isRunning()) return "already-running";
  const url = URL.createObjectURL(new Blob([assets.bundle], { type: "text/javascript" }));
  try {
    const module: unknown = await import(/* @vite-ignore */ url);
    if (
      typeof module !== "object" ||
      module === null ||
      !("installOfflineGuideApp" in module) ||
      typeof module.installOfflineGuideApp !== "function"
    )
      throw new Error("保存した実行ファイルの形式が異なります。選び直してください。");
    if (isRunning()) return "already-running";
    await module.installOfflineGuideApp({ model: assets.model });
    return "started";
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function restoreSavedOfflineGuide(): Promise<RestoreResult> {
  if (location.origin !== "https://linear.app" || window.top !== window)
    return Promise.reject(new Error("Linearのメイン画面で実行してください。"));
  if (globalThis.luvpameLinearOfflineRestore) return globalThis.luvpameLinearOfflineRestore;
  const pending = restore().finally(() => {
    if (globalThis.luvpameLinearOfflineRestore === pending)
      globalThis.luvpameLinearOfflineRestore = undefined;
  });
  globalThis.luvpameLinearOfflineRestore = pending;
  return pending;
}
