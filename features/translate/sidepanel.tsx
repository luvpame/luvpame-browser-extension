import { useEffect, useState } from "react";
import "./sidepanel.css";
import "./loading.css";
import { browser } from "wxt/browser";
import { watchFeatures } from "../../lib/features";
import { isRecord, errorText } from "../../lib/copy-protocol";
import { splitTranslationText } from "./content";
import { sendPageTranslationMessage } from "./page-bridge";
import {
  ARTICLE_REQUEST,
  CANCEL_TRANSLATION,
  TRANSLATE,
  TRANSLATION_PROGRESS,
  isTranslationResult,
} from "./shared";

type Page = { id: number; url: string; title: string; paragraphs: string[] };

export function Sidepanel() {
  const [enabled, setEnabled] = useState(false);
  const [page, setPage] = useState<Page>();
  const [title, setTitle] = useState("");
  const [paragraphs, setParagraphs] = useState<string[]>([]);
  const [status, setStatus] = useState("現在のページを確認しています…");
  const [cpu, setCpu] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [articleError, setArticleError] = useState("");
  useEffect(() => {
    let disposed = false;
    let queryVersion = 0;
    const syncTab = async () => {
      const version = ++queryVersion;
      try {
        const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
        if (disposed || version !== queryVersion) return;
        if (tab?.id === undefined) {
          setArticleError("");
          setPage(undefined);
          setStatus("HTTP/HTTPSの通常のWebページを開いてください。");
          return;
        }
        const article: unknown = await sendPageTranslationMessage(tab.id, ARTICLE_REQUEST);
        if (disposed || version !== queryVersion) return;
        if (
          !isRecord(article) ||
          article.ok !== true ||
          typeof article.url !== "string" ||
          !/^https?:\/\//.test(article.url) ||
          typeof article.title !== "string" ||
          !Array.isArray(article.paragraphs) ||
          !article.paragraphs.every((text: unknown) => typeof text === "string")
        )
          throw new Error(
            isRecord(article) && typeof article.error === "string"
              ? article.error
              : "記事本文を取得できません。ページを再読み込みしてください。",
          );
        setArticleError("");
        const next: Page = {
          id: tab.id,
          url: article.url,
          title: article.title,
          paragraphs: article.paragraphs,
        };
        setPage((previous) =>
          previous && previous.id === next.id && previous.url === next.url ? previous : next,
        );
      } catch (error) {
        if (!disposed && version === queryVersion) {
          setPage(undefined);
          setArticleError(errorText(error));
        }
      }
    };
    const onActivated = () => {
      void syncTab();
    };
    const onUpdated = (id: number, change: { url?: string; status?: string }) => {
      if (change.status === "loading") {
        queryVersion += 1;
        setPage((previous) => (previous?.id === id ? undefined : previous));
      }
      if (change.url || change.status === "complete") void syncTab();
    };
    browser.tabs.onActivated.addListener(onActivated);
    browser.tabs.onUpdated.addListener(onUpdated);
    const stop = watchFeatures(
      (settings) => {
        setEnabled(settings.translationEnabled);
        if (settings.translationEnabled) void syncTab();
      },
      (error) => setStatus(errorText(error)),
    );
    return () => {
      disposed = true;
      stop();
      browser.tabs.onActivated.removeListener(onActivated);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [attempt]);
  useEffect(() => {
    let disposed = false;
    const sessionId = crypto.randomUUID();
    const cancel = () => {
      disposed = true;
      void browser.runtime.sendMessage({ type: CANCEL_TRANSLATION, sessionId }).catch(() => {});
    };
    setTitle("");
    setParagraphs([]);
    setCpu(false);
    setFailed(false);
    if (!enabled) {
      setStatus("翻訳は共通設定でOFFになっています。");
      return;
    }
    if (!page) {
      setFailed(Boolean(articleError));
      setStatus(articleError || "HTTP/HTTPSの通常のWebページを開いてください。");
      return;
    }
    const onProgress = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (
        sender.id === browser.runtime.id &&
        !sender.tab &&
        isRecord(message) &&
        message.type === TRANSLATION_PROGRESS &&
        message.sessionId === sessionId &&
        typeof message.message === "string" &&
        !disposed
      )
        setStatus(message.message);
    };
    browser.runtime.onMessage.addListener(onProgress);
    window.addEventListener("pagehide", cancel);
    const run = async () => {
      const texts = page.paragraphs;
      if (!texts.length) throw new Error("読み取れる本文がありません。");
      setTitle(page.title);
      const translated: string[] = [];
      for (const [index, text] of texts.entries()) {
        const parts: string[] = [];
        for (const chunk of splitTranslationText(text)) {
          if (disposed) return;
          setStatus(`やさしい日本語に訳しています… ${index + 1}/${texts.length}`);
          const result: unknown = await browser.runtime.sendMessage({
            type: TRANSLATE,
            text: chunk,
            target: "ja-easy",
            sessionId,
          });
          if (disposed) return;
          if (!isTranslationResult(result)) throw new Error("翻訳の応答を読み取れませんでした。");
          if (!result.ok) throw new Error(result.error);
          if (result.device === "cpu") setCpu(true);
          parts.push(result.text);
        }
        translated.push(parts.join("\n"));
        setParagraphs([...translated]);
      }
      if (!disposed) setStatus("記事全体の翻訳が完了しました。");
    };
    void run().catch((error) => {
      if (disposed) return;
      setFailed(true);
      setStatus(errorText(error));
    });
    return () => {
      cancel();
      window.removeEventListener("pagehide", cancel);
      browser.runtime.onMessage.removeListener(onProgress);
    };
  }, [enabled, page, attempt, articleError]);
  const busy = Boolean(enabled && page && !failed && paragraphs.length < page.paragraphs.length);
  return (
    <main className="reading-pane">
      <header className="reading-header">
        <div className="reading-brand">
          <img src="/icon/48.png" width="32" height="32" alt="" />
          <span>Luvpame</span>
        </div>
        <h1>やさしい日本語で読む</h1>
        <p className="hint">記事全体をこの端末で翻訳します。</p>
        <p className="hint">初回はモデルのダウンロードに時間がかかります。</p>
      </header>
      <div className="reading-status" data-failed={failed}>
        <p role="status" aria-busy={busy}>
          <span className="translation-spinner" aria-hidden="true" />
          <span>{status}</span>
        </p>
        {cpu && <p className="hint">CPUで翻訳しています。完了まで時間がかかる場合があります。</p>}
        {failed && <button onClick={() => setAttempt((value) => value + 1)}>再試行</button>}
      </div>
      {title && <h2 className="reading-title">{title}</h2>}
      <article lang="ja">
        {paragraphs.map((text, index) => (
          <p key={index}>{text}</p>
        ))}
      </article>
    </main>
  );
}
