import { watchFeatures } from "../../../lib/features";
import { readUrlPolicy, watchUrlPolicy } from "./url-settings";
import type { UrlPolicy } from "./url-policy";

export const watchVimSettings = (
  onEnabled: (enabled: boolean) => void,
  onPolicy: (policy: UrlPolicy) => void,
): (() => void) => {
  let disposed = false;
  let changed = false;
  const stopFeatures = watchFeatures((settings) => onEnabled(settings.vimEnabled));
  const stopPolicy = watchUrlPolicy((policy) => {
    changed = true;
    onPolicy(policy);
  });
  void readUrlPolicy()
    .then((policy) => {
      if (!disposed && !changed) onPolicy(policy);
    })
    .catch(console.error);
  return () => {
    disposed = true;
    stopFeatures();
    stopPolicy();
  };
};
