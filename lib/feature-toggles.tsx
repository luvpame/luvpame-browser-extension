import { useState } from "react";
import {
  featureKeys,
  featureLabels,
  saveFeature,
  type Features,
  type FeatureKey,
} from "./features";
import { errorText } from "./copy-protocol";

export function FeatureToggles({
  features,
  onStatus,
}: {
  features?: Features;
  onStatus: (message: string) => void;
}) {
  const [pending, setPending] = useState<FeatureKey[]>([]);
  const toggle = async (key: FeatureKey, value: boolean) => {
    setPending((keys) => [...keys, key]);
    try {
      await saveFeature(key, value);
      onStatus("機能設定を保存しました。");
    } catch (error) {
      onStatus(errorText(error));
    } finally {
      setPending((keys) => keys.filter((k) => k !== key));
    }
  };
  return (
    <fieldset className="feature-toggles">
      <legend>機能のON/OFF</legend>
      {featureKeys.map((key) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={features?.[key] ?? false}
            disabled={!features || pending.includes(key)}
            onChange={(event) => void toggle(key, event.target.checked)}
          />
          <span>{featureLabels[key]}</span>
        </label>
      ))}
    </fieldset>
  );
}
