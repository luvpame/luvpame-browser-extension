import { isRecord } from "../../lib/copy-protocol";
import {
  CANCEL_TRANSLATION,
  CANCEL_TRANSLATION_REQUEST,
  isTranslationBatchRequest,
  isTranslationRequest,
  isReprioritizeTranslationsRequest,
} from "../translate/shared";
import { createLinearReviewGuideController } from "./content";
import { createOfflinePlamo } from "./offline-engine";
import { scheduleTranslation } from "../translate/scheduler";
import { applyStatusBar } from "./status-bar";

type Engine = Awaited<ReturnType<typeof createOfflinePlamo>>;
type OfflineGuideApp = { stop(): Promise<void> };
type State =
  | { kind: "waiting" }
  | { kind: "loading" }
  | { kind: "ready"; engine: Engine }
  | { kind: "stopped" };
type Request = {
  sessionId: string;
  abort: AbortController;
  distance: number;
  state: "queued" | "running";
  count: number;
};
type SessionProgress = {
  sessionId: string;
  completed: number;
  failed: number;
  lastError?: string;
};

declare global {
  var luvpameLinearOfflineGuide: OfflineGuideApp | undefined;
}

export async function installOfflineGuideApp({
  doc = document,
  createEngine = createOfflinePlamo,
  model,
}: {
  doc?: Document;
  createEngine?: typeof createOfflinePlamo;
  model?: Blob;
} = {}): Promise<OfflineGuideApp> {
  while (globalThis.luvpameLinearOfflineGuide) await globalThis.luvpameLinearOfflineGuide.stop();
  const win = doc.defaultView;
  if (!win) throw new Error("ページのウィンドウが見つかりません。");
  let state: State = { kind: "waiting" };
  const group = crypto.randomUUID();
  let stopping: Promise<void> | undefined;
  const requests = new Map<string, Request>();
  let activeSession: SessionProgress | undefined;
  const panel = doc.createElement("div");
  panel.dataset.luvpameTranslation = "offline-guide";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-label", "Guideのオフライン翻訳");
  const label = doc.createElement("label");
  label.textContent = "モデルを選択（PLaMo GGUF）";
  const input = doc.createElement("input");
  input.type = "file";
  label.append(input);
  const status = doc.createElement("output");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  const stopButton = doc.createElement("button");
  stopButton.type = "button";
  const setStatus = (message: string, title = message) => {
    if (state.kind === "stopped") return;
    status.textContent = message;
    status.title = title;
    stopButton.textContent =
      state.kind === "waiting" ? "閉じる" : state.kind === "loading" ? "準備を中止" : "翻訳を停止";
    stopButton.title =
      state.kind === "waiting"
        ? "翻訳パネルを閉じます。"
        : state.kind === "loading"
          ? "モデルの読み込み終了後にモデルを終了し、パネルを閉じます。"
          : "翻訳を停止し、原文に戻します。モデルも終了します。";
  };
  setStatus("GGUFモデルを選ぶとGuideの説明を自動翻訳します。");
  const renderProgress = () => {
    if (state.kind !== "ready") return;
    const { engine } = state;
    const device = engine.device === "gpu" ? "GPU" : "CPU・GPU利用不可";
    let running = 0;
    let queued = 0;
    for (const request of requests.values()) {
      if (request.sessionId !== activeSession?.sessionId || request.abort.signal.aborted) continue;
      if (request.state === "running") running += request.count;
      else queued += request.count;
    }
    const completed = activeSession?.completed ?? 0;
    const failed = activeSession?.failed ?? 0;
    const result = `完了${completed}件${failed ? `・失敗${failed}件` : ""}`;
    const message = !activeSession
      ? "Guide待機"
      : running || queued
        ? `翻訳中 ${result} / 処理中${running}件 / 待機${queued}件`
        : failed
          ? result
          : `翻訳完了 ${completed}件`;
    const visible = `${message} · ${device}`;
    setStatus(
      visible,
      `${visible}\nモデル: ${engine.modelName}\nデバイス: ${device}\n件数は翻訳要求のテキスト数です。リンク断片・分割テキスト・一括要求内の各テキストを含みます。${activeSession?.lastError ? `\n最新のエラー: ${activeSession.lastError}` : ""}`,
    );
  };
  panel.append(label, status, stopButton);
  applyStatusBar(panel);

  const controller = createLinearReviewGuideController({
    doc,
    async send(message) {
      if (isRecord(message) && message.type === CANCEL_TRANSLATION) {
        for (const request of requests.values())
          if (request.sessionId === message.sessionId) request.abort.abort();
        if (activeSession?.sessionId === message.sessionId) activeSession = undefined;
        renderProgress();
        return { ok: true };
      }
      if (isRecord(message) && message.type === CANCEL_TRANSLATION_REQUEST) {
        const request =
          typeof message.requestId === "string" ? requests.get(message.requestId) : undefined;
        if (request && request.sessionId === message.sessionId) request.abort.abort();
        renderProgress();
        return { ok: true };
      }
      if (isReprioritizeTranslationsRequest(message)) {
        for (const update of message.updates) {
          const request = requests.get(update.requestId);
          if (request?.sessionId === message.sessionId) request.distance = update.distance;
        }
        return { ok: true };
      }
      if (!isTranslationRequest(message) && !isTranslationBatchRequest(message))
        return { ok: true };
      if (state.kind !== "ready") return { ok: false, error: "モデルの準備ができていません。" };
      const { engine } = state;
      if (activeSession?.sessionId !== message.sessionId)
        activeSession = { sessionId: message.sessionId, completed: 0, failed: 0 };
      const session = activeSession;
      const abort = new AbortController();
      const { signal } = abort;
      const request: Request = {
        sessionId: message.sessionId,
        abort,
        distance: message.viewportDistance ?? 0,
        state: "queued",
        count: isTranslationRequest(message) ? 1 : message.texts.length,
      };
      requests.set(message.requestId, request);
      renderProgress();
      const task = scheduleTranslation(
        { signal, priority: message.priority, onProgress: () => {} },
        async () => {
          signal.throwIfAborted();
          request.state = "running";
          renderProgress();
          if (isTranslationRequest(message)) {
            const text = await engine.translate(message.text, {
              signal,
              onText(text) {
                if (!signal.aborted)
                  controller.progress(message.sessionId, message.requestId, { kind: "text", text });
              },
            });
            signal.throwIfAborted();
            return { ok: true, text, device: engine.device };
          }
          const texts: string[] = [];
          for (const text of message.texts) {
            signal.throwIfAborted();
            texts.push(await engine.translate(text, { signal }));
          }
          signal.throwIfAborted();
          return { ok: true, texts, device: engine.device };
        },
        { group, capacity: () => (engine.device === "gpu" ? 2 : 1), rank: () => request.distance },
      );
      try {
        const result = await task;
        if (activeSession === session && !signal.aborted) session.completed += request.count;
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (activeSession === session && !signal.aborted) {
          session.failed += request.count;
          session.lastError = message;
        }
        return { ok: false, error: message };
      } finally {
        requests.delete(message.requestId);
        renderProgress();
      }
    },
  });

  const isStopped = () => state.kind === "stopped";
  const selectModel = async (model: Blob) => {
    if (state.kind !== "waiting") return;
    state = { kind: "loading" };
    input.disabled = true;
    input.value = "";
    setStatus("モデル準備中");
    try {
      const engine = await createEngine(model, (message) => {
        if (state.kind === "loading") setStatus(message);
      });
      if (isStopped()) {
        await engine.dispose();
        return;
      }
      state = { kind: "ready", engine };
      renderProgress();
      controller.setEnabled(true);
    } catch (error) {
      if (isStopped()) return;
      state = { kind: "waiting" };
      input.disabled = false;
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const onModelChange = () => {
    const model = input.files?.[0];
    if (model) void selectModel(model);
  };
  const onStop = () => void app.stop().catch(() => {});
  const onNavigation = () => controller.refresh();
  const navigation = "navigation" in win ? win.navigation : undefined;
  const navigationEvents = navigation instanceof EventTarget ? navigation : undefined;
  const app: OfflineGuideApp = {
    stop() {
      if (stopping) return stopping;
      const previous = state;
      state = { kind: "stopped" };
      for (const request of requests.values()) request.abort.abort();
      requests.clear();
      activeSession = undefined;
      controller.dispose();
      input.removeEventListener("change", onModelChange);
      stopButton.removeEventListener("click", onStop);
      navigationEvents?.removeEventListener("currententrychange", onNavigation);
      win.removeEventListener("pagehide", onStop);
      panel.remove();
      if (globalThis.luvpameLinearOfflineGuide === app)
        globalThis.luvpameLinearOfflineGuide = undefined;
      stopping = previous.kind === "ready" ? previous.engine.dispose() : Promise.resolve();
      return stopping;
    },
  };
  input.addEventListener("change", onModelChange);
  stopButton.addEventListener("click", onStop);
  navigationEvents?.addEventListener("currententrychange", onNavigation);
  win.addEventListener("pagehide", onStop);
  globalThis.luvpameLinearOfflineGuide = app;
  if (model) void selectModel(model);
  return app;
}
