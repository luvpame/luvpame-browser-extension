import { PROMPT_VERSION } from "./prompt";
import type {
  TargetLanguage,
  TranslationOptions,
  TranslationProvider,
  TranslationResult,
} from "./shared";

type Output = Omit<Extract<TranslationResult, { ok: true }>, "ok">;
type Resource = { group: string; capacity: () => number };
type Job = Resource & { priority: number; run: () => Promise<void> };
const pending: Job[] = [];
let active = 0;
let activeGroup = "";
const priorities = { selection: 0, page: 1, article: 2 };

function drain() {
  pending.sort((a, b) => a.priority - b.priority);
  while (pending.length) {
    const next = pending[0];
    if (!next || (active && (next.group !== activeGroup || active >= next.capacity()))) return;
    pending.shift();
    activeGroup = next.group;
    active += 1;
    void next.run().finally(() => {
      active -= 1;
      notifyTranslationReady();
    });
  }
}
export const notifyTranslationReady = () => queueMicrotask(drain);

export function scheduleTranslation<T>(
  options: TranslationOptions,
  run: () => Promise<T>,
  resource: Resource = { group: "serial", capacity: () => 1 },
): Promise<T> {
  options.signal.throwIfAborted();
  options.onProgress("翻訳の順番を待っています…");
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(options.signal.reason);
    options.signal.addEventListener("abort", onAbort, { once: true });
    pending.push({
      ...resource,
      priority: priorities[options.priority ?? "page"],
      run: async () => {
        try {
          options.signal.throwIfAborted();
          resolve(await run());
        } catch (error) {
          reject(error);
        } finally {
          options.signal.removeEventListener("abort", onAbort);
        }
      },
    });
    notifyTranslationReady();
  });
}

export class TranslationCache {
  private entries = new Map<string, { value: Output; size: number; expires: number }>();
  private characters = 0;
  constructor(
    private maxEntries = 100,
    private maxCharacters = 200_000,
  ) {}
  get(key: string): Output | undefined {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    this.characters -= entry.size;
    if (entry.expires <= Date.now()) return;
    this.entries.set(key, entry);
    this.characters += entry.size;
    return entry.value;
  }
  set(key: string, value: Output, ttl = 300_000): void {
    const previous = this.entries.get(key);
    if (previous) {
      this.characters -= previous.size;
      this.entries.delete(key);
    }
    const size = key.length + value.text.length;
    if (size > this.maxCharacters) return;
    this.entries.set(key, { value, size, expires: Date.now() + ttl });
    this.characters += size;
    while (this.entries.size > this.maxEntries || this.characters > this.maxCharacters) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) break;
      this.entries.delete(oldest[0]);
      this.characters -= oldest[1].size;
    }
  }
}
export const translationCache = new TranslationCache();
export const translationCacheKey = (
  provider: TranslationProvider,
  target: TargetLanguage,
  text: string,
): string => JSON.stringify([PROMPT_VERSION, provider.kind, provider.model, target, text]);
