import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { watchFeatures, type Features } from "../../lib/features";
import { FeatureToggles } from "../../lib/feature-toggles";
import { TranslationModelSettings } from "../../features/translate/model-settings";
import { reviewTemplate } from "../../features/lgtm/shared/storage";
import { prepareTemplate } from "../../features/lgtm/shared/template";
import { errorText } from "../../lib/copy-protocol";
import "../../lib/ui.css";

function Options() {
  const [features, setFeatures] = useState<Features>();
  const [template, setTemplate] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void reviewTemplate
      .getValue()
      .then((text) => {
        setTemplate(text);
        setLoaded(true);
      })
      .catch((error) => setStatus(errorText(error)));
    return watchFeatures(setFeatures, (error) => setStatus(errorText(error)));
  }, []);
  const save = async () => {
    const prepared = prepareTemplate(template);
    if (!prepared.ok) {
      setStatus(
        prepared.error === "required"
          ? "テンプレートに本文を入力してください。"
          : "{{cursor}}は1つまでです。",
      );
      return;
    }
    setSaving(true);
    try {
      await reviewTemplate.setValue(template);
      setStatus("テンプレートを保存しました。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <main>
      <h1>Luvpame 設定</h1>
      <p className="hint">
        機能のON/OFFはこのブラウザに保存され、開いているタブにも反映されます。OFFにしてもサイトへのアクセス権限は解除されません。
      </p>
      <FeatureToggles features={features} onStatus={setStatus} />
      <TranslationModelSettings />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <fieldset disabled={!loaded || saving}>
          <legend>同期する設定</legend>
          <label htmlFor="template">LGTMテンプレート</label>
          <textarea
            id="template"
            rows={7}
            value={template}
            onChange={(e) => setTemplate(e.target.value)}
          />
          <p className="hint">
            {"{{cursor}}"}
            は省略可能です。指定すると、その位置から編集を開始します。レビューは自動送信しません。
          </p>
          <button type="submit">保存</button>
        </fieldset>
      </form>
      <p role="status">{status}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
