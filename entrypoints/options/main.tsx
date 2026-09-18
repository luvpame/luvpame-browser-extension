import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { browser } from "wxt/browser";
import {
  featureKeys,
  featureLabels,
  watchFeatures,
  saveFeature,
  type Features,
  type FeatureKey,
} from "../../lib/features";
import { reviewTemplate } from "../../features/lgtm/shared/storage";
import { prepareTemplate } from "../../features/lgtm/shared/template";
import { readUrlPolicy } from "../../features/vim/src/url-settings";
import {
  createUrlPolicy,
  formatUrlPatterns,
  type UrlPolicyMode,
  UrlPolicyValidationError,
} from "../../features/vim/src/url-policy";
import { errorText } from "../../lib/copy-protocol";
import "../../lib/ui.css";

function Options() {
  const [features, setFeatures] = useState<Features>();
  const [pending, setPending] = useState<FeatureKey[]>([]);
  const [template, setTemplate] = useState("");
  const [mode, setMode] = useState<UrlPolicyMode>("blocklist");
  const [patterns, setPatterns] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    void Promise.all([reviewTemplate.getValue(), readUrlPolicy()])
      .then(([text, policy]) => {
        setTemplate(text);
        setMode(policy.mode);
        setPatterns(formatUrlPatterns(policy.patterns));
        setLoaded(true);
      })
      .catch((error) => setStatus(errorText(error)));
    return watchFeatures(setFeatures, (error) => setStatus(errorText(error)));
  }, []);
  const toggle = async (key: FeatureKey, value: boolean) => {
    setPending((keys) => [...keys, key]);
    try {
      await saveFeature(key, value);
      setStatus("機能設定を保存しました。");
    } catch (error) {
      setStatus(errorText(error));
    } finally {
      setPending((keys) => keys.filter((k) => k !== key));
    }
  };
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
      const policy = createUrlPolicy(mode, patterns);
      await browser.storage.sync.set({ reviewTemplate: template, urlPolicy: policy });
      setPatterns(formatUrlPatterns(policy.patterns));
      setStatus("テンプレートとURL設定を保存しました。");
    } catch (error) {
      setStatus(
        error instanceof UrlPolicyValidationError
          ? error.errors.map((e) => `${e.line}行目: ${e.message}`).join("\n")
          : errorText(error),
      );
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
      <fieldset>
        <legend>機能</legend>
        {featureKeys.map((key) => (
          <label key={key}>
            <input
              type="checkbox"
              checked={features?.[key] ?? false}
              disabled={!features || pending.includes(key)}
              onChange={(e) => void toggle(key, e.target.checked)}
            />
            {featureLabels[key]}
          </label>
        ))}
      </fieldset>
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
          <label htmlFor="mode">Vimを有効にするURL</label>
          <select id="mode" value={mode} onChange={(e) => setMode(e.target.value as UrlPolicyMode)}>
            <option value="blocklist">一致するURLを除外</option>
            <option value="allowlist">一致するURLだけ許可</option>
          </select>
          <label htmlFor="patterns">対象サイト・URLパターン（1行に1つ）</label>
          <textarea
            id="patterns"
            rows={6}
            value={patterns}
            onChange={(e) => setPatterns(e.target.value)}
            placeholder="github.com"
          />
          <p className="hint">
            github.com、https://github.com/*
            など。空欄は除外方式なら全サイト有効、許可方式なら全サイト無効です。
          </p>
          <button type="submit">保存</button>
        </fieldset>
      </form>
      <p role="status">{status}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Options />);
