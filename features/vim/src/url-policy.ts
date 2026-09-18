import { MatchPattern } from "wxt/utils/match-patterns";

const URL_PATTERN_EXAMPLE = ["https", ":", "/", "/", "example.com/*"].join("");

export type UrlPolicyMode = "blocklist" | "allowlist";

export type UrlPolicy = {
  mode: UrlPolicyMode;
  patterns: string[];
};

export type UrlPatternError = {
  line: number;
  pattern: string;
  message: string;
};

export type UrlPatternParseResult = {
  patterns: string[];
  errors: UrlPatternError[];
};

export const DEFAULT_URL_POLICY: UrlPolicy = {
  mode: "blocklist",
  patterns: [],
};

export class UrlPolicyValidationError extends Error {
  readonly errors: UrlPatternError[];

  constructor(errors: UrlPatternError[]) {
    super("URLパターンが不正です");
    this.name = "UrlPolicyValidationError";
    this.errors = errors;
  }
}

function isUrlPolicyMode(value: unknown): value is UrlPolicyMode {
  return value === "blocklist" || value === "allowlist";
}

function isHostLabel(value: string): boolean {
  return value.length > 0 && value.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(value);
}

function isIpv4Address(value: string): boolean {
  const octets = value.split(".");
  return (
    octets.length === 4 &&
    octets.every(function isValidOctet(octet): boolean {
      return /^\d{1,3}$/.test(octet) && Number(octet) <= 255;
    })
  );
}

function isShorthandHost(value: string): boolean {
  const includesSubdomains = value.startsWith("*.");
  const host = includesSubdomains ? value.slice(2) : value;
  if (value.includes("*") && !includesSubdomains) {
    return false;
  }
  if (host === "localhost" || isIpv4Address(host)) {
    return !includesSubdomains;
  }

  const labels = host.split(".");
  return labels.length >= 2 && labels.every(isHostLabel) && host.length <= 253;
}

function normalizeHostShorthand(value: string): string | null {
  const host = value.endsWith("/") ? value.slice(0, -1) : value;
  if (!isShorthandHost(host)) {
    return null;
  }
  return host.toLowerCase();
}

export function normalizeUrlPattern(value: string): string {
  const pattern = value.trim();
  const schemeHost = /^(https?|\*):\/\/([^/]+)$/i.exec(pattern);
  if (schemeHost) {
    const scheme = schemeHost[1];
    const rawHost = schemeHost[2];
    if (scheme && rawHost) {
      const host = normalizeHostShorthand(rawHost);
      if (host) {
        return `${scheme.toLowerCase()}://${host}/*`;
      }
    }
  }

  const host = normalizeHostShorthand(pattern);
  return host ? `*://${host}/*` : pattern;
}

function readMatchPatternError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("Incorrect format")) {
    return `URLのscheme、host、pathを確認してください。例: ${URL_PATTERN_EXAMPLE}`;
  }
  if (message.includes("Hostname cannot include a port")) {
    return "ポート番号付きのURLパターンには現在対応していません。ポートを外して入力してください。";
  }
  if (message.includes("If using a wildcard")) {
    return "hostの*は先頭に置き、*.example.comの形で入力してください。";
  }
  return `URLパターンを確認してください。例: ${URL_PATTERN_EXAMPLE}`;
}

function validatePattern(pattern: string): string | null {
  if (pattern !== "<all_urls>") {
    const separator = pattern.indexOf("://");
    const protocol = separator >= 0 ? pattern.slice(0, separator) : "";
    if (!["http", "https", "file", "*"].includes(protocol)) {
      return "対応しているschemeはhttp、https、file、*です";
    }
  }

  try {
    void new MatchPattern(pattern);
    return null;
  } catch (error) {
    return readMatchPatternError(error);
  }
}

export function parseUrlPatterns(value: string): UrlPatternParseResult {
  const patterns: string[] = [];
  const errors: UrlPatternError[] = [];
  const seen = new Set<string>();

  for (const [index, line] of value.split(/\r?\n/).entries()) {
    const pattern = normalizeUrlPattern(line);
    if (!pattern) {
      continue;
    }

    const message = validatePattern(pattern);
    if (message) {
      errors.push({ line: index + 1, pattern, message });
      continue;
    }
    if (!seen.has(pattern)) {
      seen.add(pattern);
      patterns.push(pattern);
    }
  }

  return { patterns, errors };
}

function normalizeUrlPatterns(patterns: readonly unknown[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const value of patterns) {
    if (typeof value !== "string") {
      continue;
    }
    const pattern = normalizeUrlPattern(value);
    if (!pattern || seen.has(pattern) || validatePattern(pattern)) {
      continue;
    }
    seen.add(pattern);
    normalized.push(pattern);
  }

  return normalized;
}

export function normalizeUrlPolicy(value: unknown): UrlPolicy {
  if (!value || typeof value !== "object") {
    return { mode: DEFAULT_URL_POLICY.mode, patterns: [] };
  }

  const candidate = value as { mode?: unknown; patterns?: unknown };
  const mode = isUrlPolicyMode(candidate.mode) ? candidate.mode : DEFAULT_URL_POLICY.mode;
  const patterns = Array.isArray(candidate.patterns)
    ? normalizeUrlPatterns(candidate.patterns)
    : [];
  return { mode, patterns };
}

export function createUrlPolicy(mode: UrlPolicyMode, value: string): UrlPolicy {
  if (!isUrlPolicyMode(mode)) {
    throw new Error("URLポリシーのモードが不正です");
  }
  const result = parseUrlPatterns(value);
  if (result.errors.length > 0) {
    throw new UrlPolicyValidationError(result.errors);
  }
  return { mode, patterns: result.patterns };
}

export function formatUrlPatterns(patterns: readonly string[]): string {
  return patterns.join("\n");
}

function matchesUrl(patternText: string, url: string | URL): boolean {
  try {
    return new MatchPattern(patternText).includes(typeof url === "string" ? url : url.href);
  } catch {
    return false;
  }
}

export function isUrlAllowed(policy: UrlPolicy, url: string | URL): boolean {
  const normalized = normalizeUrlPolicy(policy);
  if (normalized.patterns.length === 0) {
    return normalized.mode === "blocklist";
  }

  const matched = normalized.patterns.some(function checkPattern(patternText): boolean {
    return matchesUrl(patternText, url);
  });

  return normalized.mode === "allowlist" ? matched : !matched;
}
