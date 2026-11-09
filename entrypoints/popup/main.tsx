import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { watchFeatures, type Features } from "../../lib/features";
import { COPY_REQUEST, type CopyKind, isRecord, errorText } from "../../lib/copy-protocol";
import { FeatureToggles } from "../../lib/feature-toggles";
import { PAGE_TRANSLATION } from "../../features/translate/shared";
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
      const result: unknown = await browser.tabs.sendMessage(tabId, { type: PAGE_TRANSLATION });
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
        <h1>Luvpame</h1>
        <button
          onClick={() =>
            void browser.runtime.openOptionsPage().catch((error) => setStatus(errorText(error)))
          }
        >
          設定
        </button>
      </header>
      <div className="popup-actions">
        <button
          disabled={busy || tabId === undefined || !features?.urlCopyEnabled}
          onClick={() => void copy("url")}
        >
          URLをMarkdownでコピー{features?.urlCopyEnabled === false ? "（OFF）" : ""}
        </button>
        <button
          disabled={busy || tabId === undefined || !features?.bodyCopyEnabled}
          onClick={() => void copy("body")}
        >
          本文をMarkdownでコピー{features?.bodyCopyEnabled === false ? "（OFF）" : ""}
        </button>
      </div>
      <div className="popup-actions">
        <button
          disabled={busy || tabId === undefined || !features?.translationEnabled}
          onClick={() => void toggleTranslation()}
        >
          原文下の日本語訳を開始／解除（Option+A）
        </button>
        <button
          disabled={tabId === undefined || !features?.translationEnabled}
          onClick={() => {
            if (tabId !== undefined)
              void browser.sidePanel.open({ tabId }).catch((error) => setStatus(errorText(error)));
          }}
        >
          本文をやさしい日本語で読む
        </button>
      </div>
      <p role="status">{status}</p>
      <FeatureToggles features={features} onStatus={setStatus} />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
