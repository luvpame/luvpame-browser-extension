import { browser } from "wxt/browser";
import { errorText, isRecord } from "../../lib/copy-protocol";
import { readFeatures } from "../../lib/features";
import { ensureOffscreen } from "../../lib/offscreen";
import { readTranslationModel } from "./settings";
import {
  TRANSLATE,
  CANCEL_TRANSLATION,
  TRANSLATION_PROGRESS,
  PAGE_TRANSLATION,
  OFFSCREEN_TRANSLATE,
  OFFSCREEN_CANCEL,
  isSessionId,
  isTranslationRequest,
  isTranslationResult,
  type TranslationResult,
} from "./shared";

export const registerTranslationBackground = (): void => {
  const sessions = new Map<string, { tabId?: number; localId: string; cancelled: boolean }>();
  browser.runtime.onMessage.addListener((message: unknown, sender, respond) => {
    if (sender.id !== browser.runtime.id || !isRecord(message)) return;
    if (message.type === TRANSLATION_PROGRESS && !sender.tab) {
      const route =
        typeof message.sessionId === "string" ? sessions.get(message.sessionId) : undefined;
      if (!route || route.cancelled || typeof message.message !== "string") return;
      const progress = {
        type: TRANSLATION_PROGRESS,
        sessionId: route.localId,
        message: message.message,
      };
      if (route.tabId !== undefined)
        void browser.tabs.sendMessage(route.tabId, progress).catch(() => {});
      else void browser.runtime.sendMessage(progress).catch(() => {});
      return;
    }
    const content =
      sender.tab?.id !== undefined && sender.frameId === 0 && /^https?:\/\//.test(sender.url ?? "");
    const panel = !sender.tab && sender.url === browser.runtime.getURL("/sidepanel.html");
    if (!content && !panel) return;
    if (!isSessionId(message.sessionId)) return;
    const sessionId = `${content ? `tab-${sender.tab?.id}` : "panel"}:${message.sessionId}`;
    if (message.type === CANCEL_TRANSLATION) {
      const route = sessions.get(sessionId);
      if (route) route.cancelled = true;
      void browser.offscreen
        .hasDocument()
        .then((exists) => {
          if (exists) return browser.runtime.sendMessage({ type: OFFSCREEN_CANCEL, sessionId });
        })
        .catch(console.error);
      respond({ ok: true });
      return;
    }
    if (message.type !== TRANSLATE) return;
    if (!isTranslationRequest(message)) {
      respond({ ok: false, error: "翻訳する文章または翻訳先が不正です。" });
      return;
    }
    const route = {
      tabId: content ? sender.tab?.id : undefined,
      localId: message.sessionId,
      cancelled: false,
    };
    sessions.set(sessionId, route);
    void (async (): Promise<TranslationResult> => {
      try {
        if (!(await readFeatures()).translationEnabled) throw new Error("翻訳機能はOFFです。");
        const model = await readTranslationModel();
        await ensureOffscreen();
        if (route.cancelled) throw new Error("翻訳を停止しました。");
        const requestId = crypto.randomUUID();
        const result: unknown = await browser.runtime.sendMessage({
          type: OFFSCREEN_TRANSLATE,
          requestId,
          sessionId,
          text: message.text,
          target: message.target,
          model,
        });
        if (!isRecord(result) || result.requestId !== requestId || !isTranslationResult(result))
          throw new Error("翻訳の応答を受け取れませんでした。もう一度実行してください。");
        return route.cancelled ? { ok: false, error: "翻訳を停止しました。" } : result;
      } catch (error) {
        return { ok: false, error: errorText(error) };
      } finally {
        if (sessions.get(sessionId) === route) sessions.delete(sessionId);
      }
    })().then(respond);
    return true;
  });

  const toggle = async (tabId: number) => {
    try {
      if (!(await readFeatures()).translationEnabled) throw new Error("翻訳機能はOFFです。");
      const result: unknown = await browser.tabs.sendMessage(tabId, { type: PAGE_TRANSLATION });
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
  browser.commands.onCommand.addListener((command) => {
    if (command !== "toggle-page-translation") return;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (tab?.id !== undefined) return toggle(tab.id);
      })
      .catch(console.error);
  });
  let menuSync = Promise.resolve();
  const syncMenus = () => {
    menuSync = menuSync
      .then(async () => {
        const { translationEnabled: enabled } = await readFeatures();
        const menus = [
          {
            id: PAGE_TRANSLATION,
            title: "原文下の日本語訳を開始／解除（Option+A）",
            contexts: ["all"],
            documentUrlPatterns: ["http://*/*", "https://*/*"],
            enabled,
          },
          {
            id: "luvpame:easy-article",
            title: "本文をやさしい日本語で読む",
            contexts: ["all"],
            documentUrlPatterns: ["http://*/*", "https://*/*"],
            enabled,
          },
        ] satisfies Parameters<typeof browser.contextMenus.create>[0][];
        for (const { id, ...properties } of menus) {
          try {
            await browser.contextMenus.update(id, properties);
          } catch (error) {
            if (!errorText(error).startsWith("Cannot find menu item with id")) throw error;
            await new Promise<void>((resolve, reject) => {
              browser.contextMenus.create({ id, ...properties }, () => {
                const error = browser.runtime.lastError;
                if (error) reject(new Error(error.message));
                else resolve();
              });
            });
          }
        }
      })
      .catch(console.error);
  };
  browser.runtime.onInstalled.addListener(syncMenus);
  browser.runtime.onStartup.addListener(syncMenus);
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !("translationEnabled" in changes)) return;
    syncMenus();
  });
  syncMenus();
  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (tab?.id === undefined) return;
    if (info.menuItemId === PAGE_TRANSLATION) void toggle(tab.id);
    if (info.menuItemId === "luvpame:easy-article")
      void browser.sidePanel.open({ tabId: tab.id }).catch(console.error);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    for (const [sessionId, route] of sessions) {
      if (route.tabId !== tabId) continue;
      route.cancelled = true;
      void browser.runtime.sendMessage({ type: OFFSCREEN_CANCEL, sessionId }).catch(() => {});
    }
  });
};
