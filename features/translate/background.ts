import { browser } from "wxt/browser";
import { errorText, isRecord } from "../../lib/copy-protocol";
import { readFeatures } from "../../lib/features";
import { ensureOffscreen } from "../../lib/offscreen";
import { readTranslationSettings } from "./settings";
import { sendPageTranslationMessage } from "./page-bridge";
import {
  PREPARE_TRANSLATION,
  OFFSCREEN_PREPARE_TRANSLATION,
  OFFSCREEN_PREWARM_TRANSLATION,
  isPrepareTranslationResult,
  isTranslationModel,
  type PrepareTranslationResult,
  TRANSLATE,
  TRANSLATE_BATCH,
  CANCEL_TRANSLATION,
  CANCEL_TRANSLATION_REQUEST,
  REPRIORITIZE_TRANSLATIONS,
  TRANSLATION_PROGRESS,
  PAGE_TRANSLATION,
  OFFSCREEN_TRANSLATE,
  OFFSCREEN_TRANSLATE_BATCH,
  OFFSCREEN_CANCEL_REQUEST,
  OFFSCREEN_REPRIORITIZE,
  OFFSCREEN_CANCEL,
  isSessionId,
  isOffscreenSessionId,
  isTranslationRequest,
  isTranslationBatchRequest,
  isTranslationBatchResult,
  isReprioritizeTranslationsRequest,
  isTranslationResult,
  isTranslationUpdate,
  type TranslationResult,
  type TranslationBatchResult,
  type TargetLanguage,
} from "./shared";

export const registerTranslationBackground = (): void => {
  let prewarming = Promise.resolve();
  let prewarmRevision = 0;
  const prewarm = () => {
    const revision = ++prewarmRevision;
    prewarming = prewarming
      .then(() => menuSync)
      .then(async () => {
        if (revision !== prewarmRevision || !(await readFeatures()).translationEnabled) return;
        const provider = await readTranslationSettings();
        if (provider.kind !== "browser") return;
        await ensureOffscreen();
        if (revision !== prewarmRevision) return;
        await browser.runtime.sendMessage({ type: OFFSCREEN_PREWARM_TRANSLATION, provider });
      })
      .catch(console.error);
  };
  const sessions = new Map<
    string,
    {
      tabId: number;
      localId: string;
      sessionId: string;
      requestId: string;
      cancelled: boolean;
      sent: boolean;
      distance: number | undefined;
    }
  >();
  const routeKey = (sessionId: string, requestId: string) => JSON.stringify([sessionId, requestId]);
  browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== browser.runtime.id || !isRecord(message)) return;
    if (message.type === PREPARE_TRANSLATION) {
      if (!sender.url?.startsWith(browser.runtime.getURL("/"))) return;
      if (!isTranslationModel(message.model)) {
        respond({ ok: false, error: "準備する翻訳モデルが不正です。" });
        return;
      }
      const model = message.model;
      void (async (): Promise<PrepareTranslationResult> => {
        try {
          if (!(await readFeatures()).translationEnabled) throw new Error("翻訳機能はOFFです。");
          const provider = await readTranslationSettings();
          if (provider.kind !== "browser")
            throw new Error("モデルの準備はブラウザ内翻訳で利用できます。");
          if (provider.model !== model)
            throw new Error("設定が変更されました。モデルを選び直してください。");
          await ensureOffscreen();
          const result: unknown = await browser.runtime.sendMessage({
            type: OFFSCREEN_PREPARE_TRANSLATION,
            provider,
          });
          if (!isPrepareTranslationResult(result))
            throw new Error("モデルの準備結果を受け取れませんでした。");
          return result;
        } catch (error) {
          return { ok: false, error: errorText(error) };
        }
      })().then(respond);
      return true;
    }
    if (message.type === TRANSLATION_PROGRESS && !sender.tab) {
      if (
        !isOffscreenSessionId(message.sessionId) ||
        !isSessionId(message.requestId) ||
        !isTranslationUpdate(message.update)
      )
        return;
      const route = sessions.get(routeKey(message.sessionId, message.requestId));
      if (!route || route.cancelled) return;
      const progress = {
        type: TRANSLATION_PROGRESS,
        sessionId: route.localId,
        requestId: route.requestId,
        update: message.update,
      };
      void browser.tabs.sendMessage(route.tabId, progress).catch(() => {});
      return;
    }
    const content =
      sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:\/\//.test(sender.url ?? "");
    if (!content || sender.tab?.id === undefined) return;
    if (!isSessionId(message.sessionId)) return;
    const sessionId = `tab-${sender.tab.id}:${message.sessionId}`;
    if (message.type === CANCEL_TRANSLATION) {
      for (const route of sessions.values())
        if (route.sessionId === sessionId) route.cancelled = true;
      void browser.offscreen
        .hasDocument()
        .then((exists) => {
          if (exists) return browser.runtime.sendMessage({ type: OFFSCREEN_CANCEL, sessionId });
        })
        .catch(console.error);
      respond({ ok: true });
      return;
    }
    if (message.type === CANCEL_TRANSLATION_REQUEST) {
      if (!isSessionId(message.requestId)) return;
      const route = sessions.get(routeKey(sessionId, message.requestId));
      if (route) {
        route.cancelled = true;
        if (route.sent)
          void browser.runtime
            .sendMessage({ type: OFFSCREEN_CANCEL_REQUEST, sessionId, requestId: route.requestId })
            .catch(console.error);
      }
      respond({ ok: true });
      return;
    }
    if (message.type === REPRIORITIZE_TRANSLATIONS) {
      if (!isReprioritizeTranslationsRequest(message)) return;
      const updates = message.updates.filter(({ requestId, distance }) => {
        const route = sessions.get(routeKey(sessionId, requestId));
        if (!route || route.cancelled) return false;
        route.distance = distance;
        return route.sent;
      });
      if (updates.length)
        void browser.runtime
          .sendMessage({ type: OFFSCREEN_REPRIORITIZE, sessionId, updates })
          .catch(console.error);
      respond({ ok: true });
      return;
    }
    if (message.type !== TRANSLATE && message.type !== TRANSLATE_BATCH) return;
    if (!isTranslationRequest(message) && !isTranslationBatchRequest(message)) {
      respond({ ok: false, error: "翻訳する文章または翻訳先が不正です。" });
      return;
    }
    const route = {
      tabId: sender.tab.id,
      localId: message.sessionId,
      sessionId,
      requestId: message.requestId,
      cancelled: false,
      sent: false,
      distance: message.viewportDistance,
    };
    const key = routeKey(sessionId, message.requestId);
    if (sessions.has(key)) {
      respond({ ok: false, error: "同じ翻訳リクエストが処理中です。" });
      return;
    }
    sessions.set(key, route);
    void (async (): Promise<TranslationResult | TranslationBatchResult> => {
      try {
        if (!(await readFeatures()).translationEnabled) throw new Error("翻訳機能はOFFです。");
        const provider = await readTranslationSettings();
        await ensureOffscreen();
        if (route.cancelled) throw new Error("翻訳を停止しました。");
        const requestId = message.requestId;
        route.sent = true;
        const result: unknown = await browser.runtime.sendMessage({
          type: message.type === TRANSLATE_BATCH ? OFFSCREEN_TRANSLATE_BATCH : OFFSCREEN_TRANSLATE,
          requestId,
          sessionId,
          ...(message.type === TRANSLATE_BATCH ? { texts: message.texts } : { text: message.text }),
          target: message.target,
          provider,
          priority: message.priority,
          ...(route.distance === undefined ? {} : { viewportDistance: route.distance }),
        });
        const translated =
          message.type === TRANSLATE_BATCH
            ? isTranslationBatchResult(result, message.texts.length)
              ? result
              : undefined
            : isTranslationResult(result)
              ? result
              : undefined;
        if (!isRecord(result) || result.requestId !== requestId || !translated)
          throw new Error("翻訳の応答を受け取れませんでした。もう一度実行してください。");
        return route.cancelled ? { ok: false, error: "翻訳を停止しました。" } : translated;
      } catch (error) {
        return { ok: false, error: errorText(error) };
      } finally {
        if (sessions.get(key) === route) sessions.delete(key);
      }
    })().then(respond);
    return true;
  });

  const toggle = async (tabId: number, target: TargetLanguage = "ja") => {
    try {
      if (!(await readFeatures()).translationEnabled) throw new Error("翻訳機能はOFFです。");
      const result: unknown = await sendPageTranslationMessage(tabId, target);
      if (isRecord(result) && result.ok === false) throw new Error(String(result.error));
    } catch (error) {
      await browser.notifications.create({
        type: "basic",
        iconUrl: browser.runtime.getURL("/icon/128.png"),
        title: "翻訳を開始できません",
        message: `${errorText(error)} ページを再読み込みしてお試しください。`,
      });
    }
  };
  browser.commands.onCommand.addListener((command, tab) => {
    if (command !== "toggle-page-translation" && command !== "toggle-easy-page-translation") return;
    const target = command === "toggle-easy-page-translation" ? "ja-easy" : "ja";
    if (tab?.id !== undefined) {
      void toggle(tab.id, target);
      return;
    }
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([activeTab]) => {
        if (activeTab?.id !== undefined) return toggle(activeTab.id, target);
      })
      .catch(console.error);
  });
  const menus = [
    {
      id: PAGE_TRANSLATION,
      title: "日本語訳を開始／解除（Option+A）",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
    {
      id: "luvpame:easy-page-translation",
      title: "やさしい日本語訳を開始／解除（Option+Shift+A）",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
      enabled: true,
    },
  ] satisfies Parameters<typeof browser.contextMenus.create>[0][];
  let menuSync = Promise.resolve();
  const syncMenus = () => {
    menuSync = menuSync
      .then(async () => {
        const { translationEnabled: enabled } = await readFeatures();
        await Promise.all(
          menus.map(({ id }) =>
            new Promise<void>((resolve, reject) => {
              browser.contextMenus.update(id, { enabled }, () => {
                const error = browser.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve();
              });
            }).catch(console.error),
          ),
        );
      })
      .catch(console.error);
  };
  const registerMenus = () => {
    // Yabは起動時とonInstalledの同期呼び出しで作成した定義だけを保存する。
    browser.contextMenus.removeAll(() => {
      const error = browser.runtime.lastError;
      if (error) console.error(new Error(error.message));
    });
    const registered = Promise.all(
      menus.map(({ id, ...properties }) =>
        new Promise<void>((resolve, reject) => {
          browser.contextMenus.create({ id, ...properties }, () => {
            const error = browser.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve();
          });
        }).catch(console.error),
      ),
    );
    menuSync = menuSync.then(() => registered).then(() => {});
    syncMenus();
  };
  browser.runtime.onInstalled.addListener(registerMenus);
  browser.runtime.onStartup.addListener(syncMenus);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if ("translationEnabled" in changes) syncMenus();
    if (
      ["translationEnabled", "translationBackend", "translationModel"].some((key) => key in changes)
    )
      prewarm();
  });
  registerMenus();
  prewarm();
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) return;
    if (info.menuItemId === PAGE_TRANSLATION) void toggle(tab.id);
    if (info.menuItemId === "luvpame:easy-page-translation") void toggle(tab.id, "ja-easy");
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    for (const route of sessions.values()) {
      if (route.tabId !== tabId) continue;
      route.cancelled = true;
      void browser.runtime
        .sendMessage({ type: OFFSCREEN_CANCEL, sessionId: route.sessionId })
        .catch(() => {});
    }
  });
};
