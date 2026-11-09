import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { watchFeatures, type Features } from "../../lib/features";
import { COPY_REQUEST, type CopyKind, isRecord, errorText } from "../../lib/copy-protocol";
import { FeatureToggles } from "../../lib/feature-toggles";
import { PAGE_TRANSLATION } from "../../features/translate/shared";
import { sendPageTranslationMessage } from "../../features/translate/page-bridge";
import "../../lib/ui.css";

function Popup() {
  const [features, setFeatures] = useState<Features>();
  const [tabId, setTabId] = useState<number>();
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        setTabId(tab?.id);
        if (!tab?.id) setStatus("現在のタブが見つかりません。");
      })
      .catch((error) => setStatus(errorText(error)));
    return watchFeatures(setFeatures, (error) => setStatus(errorText(error)));
  }, []);
  const copy = async (kind: CopyKind) => {
    if (tabId === undefined || busy) return;
    setBusy(true);
    setStatus("コピーしています…");
    try {
      const result: unknown = await browser.runtime.sendMessage({
        type: COPY_REQUEST,
        kind,
        tabId,
      });
      if (!isRecord(result) || result.ok !== true)
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "コピーに失敗しました。",
        );
      setStatus("コピーしました。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const toggleTranslation = async () => {
    if (tabId === undefined || busy) return;
    setBusy(true);
    try {
      const result: unknown = await sendPageTranslationMessage(tabId, PAGE_TRANSLATION);
      if (!isRecord(result) || result.ok !== true)
        throw new Error(
          isRecord(result) && typeof result.error === "string"
            ? result.error
            : "翻訳を開始できません。ページを再読み込みしてください。",
        );
      setStatus("原文下の翻訳表示を切り替えました。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="popup">
      <header className="popup-header">
        <div className="brand">
          <img src="/icon/48.png" width="44" height="44" alt="" />
          <div>
            <h1>Luvpame</h1>
            <p>ページのコピーと翻訳</p>
          </div>
        </div>
        <button
          onClick={() =>
            void browser.runtime.openOptionsPage().catch((error) => setStatus(errorText(error)))
          }
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M4 7h16M4 17h16M9 4v6m6 4v6" />
          </svg>
          設定
        </button>
      </header>
      <div className="popup-actions copy-actions">
        <button
          disabled={busy || tabId === undefined || !features?.urlCopyEnabled}
          onClick={() => void copy("url")}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="m10 13 4-4m-6 6-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 3 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
          </svg>
          <span>
            <strong>URLをコピー{features?.urlCopyEnabled === false ? "（OFF）" : ""}</strong>
            <small>ページのリンクをMarkdownで</small>
          </span>
        </button>
        <button
          disabled={busy || tabId === undefined || !features?.bodyCopyEnabled}
          onClick={() => void copy("body")}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect x="8" y="8" width="12" height="13" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
          </svg>
          <span>
            <strong>本文をコピー{features?.bodyCopyEnabled === false ? "（OFF）" : ""}</strong>
            <small>ページの内容をMarkdownで</small>
          </span>
        </button>
      </div>
      <div className="popup-actions translation-actions">
        <button
          className="primary-action"
          disabled={busy || tabId === undefined || !features?.translationEnabled}
          onClick={() => void toggleTranslation()}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <path d="M3 5h12M9 3v2m4 0c-1 6-4 9-9 12m1-9c1 3 3 6 7 8m1 5 5-12 5 12m-8-4h6" />
          </svg>
          <span>
            <strong>原文の下に日本語訳</strong>
            <small>
              開始／解除 <kbd>Option+A</kbd>
            </small>
          </span>
        </button>
        <button
          disabled={tabId === undefined || !features?.translationEnabled}
          onClick={() => {
            if (tabId !== undefined)
              void browser.sidePanel.open({ tabId }).catch((error) => setStatus(errorText(error)));
          }}
        >
          <svg aria-hidden="true" viewBox="0 0 24 24">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <path d="M14 4v16m3-11h1m-1 4h1" />
          </svg>
          <span>
            <strong>やさしい日本語で読む</strong>
            <small>本文をサイドパネルで翻訳</small>
          </span>
        </button>
      </div>
      <p role="status">{status}</p>
      <FeatureToggles features={features} onStatus={setStatus} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
