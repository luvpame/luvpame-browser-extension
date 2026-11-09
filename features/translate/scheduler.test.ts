import { expect, it, vi } from "vite-plus/test";
import { scheduleTranslation, TranslationCache, translationCacheKey } from "./scheduler";

it("waits for the whole wave before running a queued selection ahead of page work", async () => {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const capacity = vi.fn(() => 2);
  const resource = { group: "gpu", capacity };
  const enqueue = (name: string, priority: "page" | "selection" = "page") =>
    scheduleTranslation(
      { signal: new AbortController().signal, onProgress: vi.fn(), priority },
      async () => {
        started.push(name);
        await new Promise<void>((resolve) => finish.set(name, resolve));
      },
      resource,
    );
  const first = enqueue("first");
  const second = enqueue("second");
  await vi.waitFor(() => expect(started).toEqual(["first", "second"]));
  const page = enqueue("page");
  finish.get("first")?.();
  await first;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(started).toEqual(["first", "second"]);
  expect(capacity).toHaveBeenCalledTimes(1);
  const selection = enqueue("selection", "selection");
  finish.get("second")?.();
  await vi.waitFor(() => expect(started).toEqual(["first", "second", "selection", "page"]));
  expect(capacity).toHaveBeenCalledTimes(2);
  finish.get("selection")?.();
  finish.get("page")?.();
  await Promise.all([first, second, page, selection]);
});

it("removes an aborted queued model so the next GPU wave can fill both slots", async () => {
  const started: string[] = [];
  const finish = new Map<string, () => void>();
  const resource = { group: "gpu", capacity: () => 2 };
  const options = { signal: new AbortController().signal, onProgress: vi.fn() };
  const enqueue = (name: string) =>
    scheduleTranslation(
      options,
      async () => {
        started.push(name);
        await new Promise<void>((resolve) => finish.set(name, resolve));
      },
      resource,
    );
  const active = enqueue("active");
  await vi.waitFor(() => expect(started).toEqual(["active"]));
  const first = enqueue("first");
  const controller = new AbortController();
  const cancelledRun = vi.fn();
  const cancelled = scheduleTranslation({ ...options, signal: controller.signal }, cancelledRun, {
    group: "other-model",
    capacity: () => 1,
  });
  const rejected = expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
  const second = enqueue("second");
  controller.abort();
  await rejected;
  finish.get("active")?.();
  await vi.waitFor(() => expect(started).toEqual(["active", "first", "second"]));
  expect(cancelledRun).not.toHaveBeenCalled();
  finish.get("first")?.();
  finish.get("second")?.();
  await Promise.all([active, first, second]);
});

it("lets a queued selection overtake page work without interrupting the active chunk", async () => {
  const order: string[] = [];
  let finish: () => void = () => {};
  let started: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const options = { signal: new AbortController().signal, onProgress: vi.fn() };
  const first = scheduleTranslation(options, async () => {
    order.push("active");
    started();
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    order.push("finished");
  });
  await ready;
  const page = scheduleTranslation({ ...options, priority: "page" }, async () => {
    order.push("page");
  });
  const selection = scheduleTranslation({ ...options, priority: "selection" }, async () => {
    order.push("selection");
  });
  expect(order).toEqual(["active"]);
  finish();
  await Promise.all([first, page, selection]);
  expect(order).toEqual(["active", "finished", "selection", "page"]);
});

it("separates provider, model, target and exact source in cache keys", () => {
  const values = [
    translationCacheKey({ kind: "browser", model: "2b" }, "ja", "source"),
    translationCacheKey({ kind: "browser", model: "0.8b" }, "ja", "source"),
    translationCacheKey({ kind: "browser", model: "2b" }, "ja-easy", "source"),
    translationCacheKey({ kind: "ollama", model: "2b" }, "ja", "source"),
    translationCacheKey({ kind: "browser", model: "2b" }, "ja", "other source"),
  ];
  expect(new Set(values).size).toBe(5);
});

it("evicts least recently used results by both count and total characters", () => {
  const cache = new TranslationCache(2, 20);
  const result = { text: "1234", device: "gpu" as const };
  cache.set("a", result);
  cache.set("b", result);
  expect(cache.get("a")).toEqual(result);
  cache.set("c", result);
  expect(cache.get("b")).toBeUndefined();
  cache.set("long-key", result);
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("c")).toEqual(result);
  cache.set("too-long-key-for-cache", result);
  expect(cache.get("too-long-key-for-cache")).toBeUndefined();
  cache.set("expired", result, -1);
  expect(cache.get("expired")).toBeUndefined();
});

it("bounds character retention independently of the entry count", () => {
  const cache = new TranslationCache(100, 10);
  cache.set("a", { text: "1234", device: "gpu" });
  cache.set("b", { text: "12345", device: "cpu" });
  expect(cache.get("a")).toBeUndefined();
  expect(cache.get("b")?.text).toBe("12345");
});
