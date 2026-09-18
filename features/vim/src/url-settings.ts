import { type Browser, browser } from "wxt/browser";
import {
  normalizeUrlPolicy,
  parseUrlPatterns,
  type UrlPolicy,
  UrlPolicyValidationError,
} from "./url-policy.js";

export const URL_POLICY_STORAGE_KEY = "urlPolicy";

type StorageChanges = Record<string, Browser.storage.StorageChange>;

function validatePolicy(policy: UrlPolicy): UrlPolicy {
  if (policy.mode !== "blocklist" && policy.mode !== "allowlist") {
    throw new Error("URLポリシーのモードが不正です");
  }

  const result = parseUrlPatterns(policy.patterns.join("\n"));
  if (result.errors.length > 0) {
    throw new UrlPolicyValidationError(result.errors);
  }
  return { mode: policy.mode, patterns: result.patterns };
}

export async function readUrlPolicy(): Promise<UrlPolicy> {
  const values = await browser.storage.sync.get<Record<string, unknown>>([URL_POLICY_STORAGE_KEY]);
  return normalizeUrlPolicy(values[URL_POLICY_STORAGE_KEY]);
}

export async function saveUrlPolicy(policy: UrlPolicy): Promise<void> {
  const normalized = validatePolicy(policy);
  await browser.storage.sync.set({ [URL_POLICY_STORAGE_KEY]: normalized });
}

export function watchUrlPolicy(onChange: (policy: UrlPolicy) => void): () => void {
  function handleStorageChange(changes: StorageChanges): void {
    const change = changes[URL_POLICY_STORAGE_KEY];
    if (!change) {
      return;
    }
    onChange(normalizeUrlPolicy(change.newValue));
  }

  browser.storage.sync.onChanged.addListener(handleStorageChange);
  return function unwatchUrlPolicy(): void {
    browser.storage.sync.onChanged.removeListener(handleStorageChange);
  };
}
