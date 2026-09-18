import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import { watchFeatures, type Features } from "../../lib/features";
import { COPY_REQUEST, type CopyKind, isRecord, errorText } from "../../lib/copy-protocol";
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
  return (
    <main className="popup">
      <h1>Luvpame</h1>
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
      <button
        onClick={() =>
          void browser.runtime.openOptionsPage().catch((error) => setStatus(errorText(error)))
        }
      >
        設定
      </button>
      <p role="status">{status}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Popup />);
