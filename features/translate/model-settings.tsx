import { useEffect, useState } from "react";
import { errorText } from "../../lib/copy-protocol";
import { readTranslationModel, saveTranslationModel } from "./settings";
import type { TranslationModel } from "./shared";

export function TranslationModelSettings() {
  const [model, setModel] = useState<TranslationModel>("2b");
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void readTranslationModel()
      .then((value) => {
        setModel(value);
        setReady(true);
      })
      .catch((error) => setStatus(errorText(error)));
  }, []);
  const save = async (next: TranslationModel) => {
    setReady(false);
    try {
      await saveTranslationModel(next);
      setModel(next);
      setStatus("翻訳モデルを保存しました。次の翻訳から使用します。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setReady(true);
    }
  };
  return (
    <fieldset className="model-settings">
      <legend>翻訳モデル</legend>
      <p className="hint section-description">モデルを選ぶと保存され、次の翻訳から使われます。</p>
      <label htmlFor="translation-model">3つの翻訳機能で使うモデル</label>
      <select
        id="translation-model"
        value={model}
        disabled={!ready}
        onChange={(event) => {
          const value = event.target.value;
          if (value === "0.8b" || value === "2b") void save(value);
        }}
      >
        <option value="2b">PLaMo 3 Translate 2B（約1.81GB）</option>
        <option value="0.8b">PLaMo 3 Translate 0.8B（約573MB）</option>
      </select>
      <p className="hint">
        初回の翻訳時にモデルをダウンロードし、この端末に保存します。翻訳する文章は外部に送信しません。WebGPUが使えない場合も、同じモデルをCPUで処理します。
      </p>
      <p className="hint">
        原文下の翻訳はOption+Aで開始・解除できます。他の拡張と競合する場合は
        chrome://extensions/shortcuts で変更してください。
      </p>
      <p role="status">{status}</p>
    </fieldset>
  );
}
