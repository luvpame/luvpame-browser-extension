import { PROMPT_VERSION } from "./prompt";
import type {
  TargetLanguage,
  TranslationOptions,
  TranslationProvider,
  TranslationResult,
} from "./shared";

type Output = Omit<Extract<TranslationResult, { ok: true }>, "ok">;
type Resource = { group: string; capacity: () => number; size?: number; rank?: () => number };
type Job = Resource & {
  priority: number;
  order: number;
  queuedAt: number;
  run: () => Promise<void>;
};
const pending: Job[] = [];
let active = 0;
let sequence = 0;
const priorities = { selection: 0, page: 1 };

function drain() {
  if (active) return;
  const now = Date.now();
  const aged = (job: Job) => now - job.queuedAt >= 15_000;
  const rank = (job: Job) => job.rank?.() ?? 0;
  const sameBand = (a: Job, b: Job) =>
    a.priority === b.priority && aged(a) === aged(b) && (aged(a) || rank(a) === rank(b));
  pending.sort(
    (a, b) =>
      a.priority - b.priority ||
      Number(aged(b)) - Number(aged(a)) ||
      (aged(a) ? 0 : rank(a) - rank(b)) ||
      a.order - b.order,
  );
  const first = pending[0];
  if (!first) return;
  const capacity = first.capacity();
  const wave: Job[] = [];
  let pair: Job | undefined;
  while (wave.length < capacity && pending[0]?.group === first.group) {
    let index = 0;
    const head = pending[0];
    if (!pair || !sameBand(pair, head)) {
      pair = head;
    } else if (pair.size !== undefined && head.size !== undefined) {
      let distance = Math.abs(head.size - pair.size);
      for (let i = 1; i < pending.length; i += 1) {
        const candidate = pending[i];
        if (!candidate || candidate.group !== first.group || !sameBand(candidate, head)) {
          break;
        }
        if (candidate.size === undefined) break;
        const candidateDistance = Math.abs(candidate.size - pair.size);
        if (candidateDistance < distance) {
          index = i;
          distance = candidateDistance;
        }
      }
    }
    const [next] = pending.splice(index, 1);
    if (next) wave.push(next);
  }
  active = wave.length;
  for (const job of wave) {
    void job.run().finally(() => {
      active -= 1;
      notifyTranslationReady();
    });
  }
}
const notifyTranslationReady = () => queueMicrotask(drain);

export function scheduleTranslation<T>(
  options: TranslationOptions,
  run: () => Promise<T>,
  resource: Resource = { group: "serial", capacity: () => 1 },
): Promise<T> {
  options.signal.throwIfAborted();
  options.onProgress("翻訳の順番を待っています…");
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      const index = pending.indexOf(job);
      if (index !== -1) pending.splice(index, 1);
      reject(options.signal.reason);
      notifyTranslationReady();
    };
    const job: Job = {
      ...resource,
      priority: priorities[options.priority ?? "page"],
      order: sequence++,
      queuedAt: Date.now(),
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
    };
    options.signal.addEventListener("abort", onAbort, { once: true });
    pending.push(job);
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
