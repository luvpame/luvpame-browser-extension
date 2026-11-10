import { useEffect, useState } from "react";
import { browser } from "wxt/browser";
import { errorText } from "../../lib/copy-protocol";
import {
  DEFAULT_OLLAMA_MODEL,
  readOllamaModel,
  readTranslationMode,
  saveTranslationMode,
  readTranslationModel,
  readTranslationSettings,
  saveTranslationProvider,
} from "./settings";
import {
  isOllamaModel,
  isTranslationModel,
  isPrepareTranslationResult,
  PREPARE_TRANSLATION,
  type TranslationMode,
  type TranslationModel,
  type TranslationProvider,
} from "./shared";

export function TranslationModelSettings() {
  const [mode, setMode] = useState<TranslationMode>("below");
  const [model, setModel] = useState<TranslationModel>("0.8b");
  const [backend, setBackend] = useState<TranslationProvider["kind"]>("browser");
  const [ollamaModel, setOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [savedOllamaModel, setSavedOllamaModel] = useState(DEFAULT_OLLAMA_MODEL);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void Promise.all([
      readTranslationSettings(),
      readTranslationModel(),
      readOllamaModel(),
      readTranslationMode(),
    ])
      .then(([provider, model, ollama, mode]) => {
        setMode(mode);
        setBackend(provider.kind);
        setModel(model);
        setOllamaModel(ollama);
        setSavedOllamaModel(ollama);
        setReady(true);
      })
      .catch((error) => setStatus(errorText(error)));
  }, []);
  const save = async (next: TranslationProvider) => {
    setReady(false);
    try {
      await saveTranslationProvider(next);
      setBackend(next.kind);
      if (next.kind === "browser") setModel(next.model);
      else {
        setOllamaModel(next.model);
        setSavedOllamaModel(next.model);
      }
      setStatus("翻訳モデルを保存しました。次の翻訳から使用します。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setReady(true);
    }
  };
  const prepare = async () => {
    setReady(false);
    setStatus("翻訳モデルを準備しています…");
    try {
      const result: unknown = await browser.runtime.sendMessage({
        type: PREPARE_TRANSLATION,
        model,
      });
      if (!isPrepareTranslationResult(result))
        throw new Error("モデルを準備できませんでした。再試行してください。");
      if (!result.ok) throw new Error(result.error);
      setStatus("モデルの準備が完了しました。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setReady(true);
    }
  };
  return (
    <fieldset className="model-settings">
      <legend>翻訳設定</legend>
      <label htmlFor="translation-mode">ページ翻訳の表示方式</label>
      <select
        id="translation-mode"
        value={mode}
        disabled={!ready}
        onChange={(event) => {
          const next = event.target.value;
          if (next !== "below" && next !== "replace") return;
          setReady(false);
          void saveTranslationMode(next)
            .then(() => {
              setMode(next);
              setStatus("表示方式を保存しました。次の翻訳から使用します。");
            })
            .catch((error) => setStatus(errorText(error)))
            .finally(() => setReady(true));
        }}
      >
        <option value="below">原文＋翻訳の二段表示</option>
        <option value="replace">原文を翻訳に置き換え</option>
      </select>
      <p className="hint">通常の日本語とやさしい日本語に共通で、次の翻訳から使用します。</p>
      <p className="hint section-description">モデルを選ぶと保存され、次の翻訳から使われます。</p>
      <label htmlFor="translation-backend">翻訳の実行方法</label>
      <select
        id="translation-backend"
        value={backend}
        disabled={!ready}
        onChange={(event) => {
          const kind = event.target.value;
          if (kind === "browser") void save({ kind, model });
          if (kind === "ollama") void save({ kind, model: savedOllamaModel });
        }}
      >
        <option value="browser">ブラウザで実行</option>
        <option value="ollama">この端末のOllamaで実行</option>
      </select>
      {backend === "browser" ? (
        <>
          <label htmlFor="translation-model">翻訳に使うモデル</label>
          <select
            id="translation-model"
            value={model}
            disabled={!ready}
            onChange={(event) => {
              const value = event.target.value;
              if (isTranslationModel(value)) void save({ kind: "browser", model: value });
            }}
          >
            <option value="2b">PLaMo 3 Translate 2B（約1.81GB）</option>
            <option value="0.8b">PLaMo 3 Translate 0.8B（約573MB）</option>
          </select>
          <button type="button" disabled={!ready} onClick={() => void prepare()}>
            モデルを準備
          </button>
          <p className="hint">
            準備時または初回の翻訳時にモデルをダウンロードし、この端末に保存します。翻訳する文章は外部に送信しません。WebGPUが使えない場合も、同じモデルをCPUで処理します。
          </p>
        </>
      ) : (
        <>
          <label htmlFor="translation-ollama-model">端末内のPLaMoモデル名</label>
          <input
            id="translation-ollama-model"
            list="translation-ollama-models"
            value={ollamaModel}
            disabled={!ready}
            onChange={(event) => setOllamaModel(event.target.value)}
          />
          <datalist id="translation-ollama-models">
            <option value={DEFAULT_OLLAMA_MODEL} />
            <option value="hf.co/pfnet/plamo-3-translate-2b-GGUF:Q4_K_M" />
          </datalist>
          <button
            type="button"
            disabled={!ready || !isOllamaModel(ollamaModel)}
            onClick={() => void save({ kind: "ollama", model: ollamaModel })}
          >
            Ollamaモデルを保存
          </button>
          <p className="hint">
            文章はこの端末のOllama（localhost:11434）に送信します。PLaMo
            TranslateのGGUFモデルを事前に取得してください。ブラウザ実行への自動切替はしません。
          </p>
        </>
      )}
      <p className="hint">
        日本語訳はOption+A、やさしい日本語訳はOption+Shift+Aで開始・解除できます。他の拡張と競合する場合は
        chrome://extensions/shortcuts で変更してください。
      </p>
      <p role="status">{status}</p>
    </fieldset>
  );
}
