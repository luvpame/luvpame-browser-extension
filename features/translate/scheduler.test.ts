import { expect, it, vi } from "vite-plus/test";
import { scheduleTranslation, TranslationCache, translationCacheKey } from "./scheduler";

it.each([
  {
    name: "pairs the oldest job with the closest size",
    jobs: [{ size: 100 }, { size: 400 }, { size: 110 }, { size: 390 }],
    order: [0, 2, 1, 3],
  },
  {
    name: "keeps FIFO order when size distances tie",
    jobs: [{ size: 100 }, { size: 90 }, { size: 110 }],
    order: [0, 1, 2],
  },
  {
    name: "keeps FIFO order when the oldest size is absent",
    jobs: [{}, { size: 400 }, { size: 110 }],
    order: [0, 1, 2],
  },
  {
    name: "keeps an unsized queued job in FIFO order",
    jobs: [{ size: 100 }, {}, { size: 100 }],
    order: [0, 1, 2],
  },
  {
    name: "does not cross a different model group to find a closer size",
    jobs: [{ size: 100 }, { size: 400 }, { size: 200, group: "other" }, { size: 100 }],
    order: [0, 1, 2, 3],
  },
  {
    name: "keeps selection priority ahead of similarly sized page work",
    jobs: [
      { size: 100, priority: "selection" },
      { size: 400, priority: "selection" },
      { size: 100 },
      { size: 110, priority: "selection" },
    ],
    order: [0, 3, 1, 2],
  },
  {
    name: "does not pair an offscreen job ahead of visible work",
    jobs: [
      { size: 100, rank: 0 },
      { size: 400, rank: 0 },
      { size: 100, rank: 100 },
    ],
    order: [0, 1, 2],
  },
] as const)("$name", async ({ jobs, order }) => {
  const started: number[] = [];
  await Promise.all(
    jobs.map((job, index) =>
      scheduleTranslation(
        {
          signal: new AbortController().signal,
          onProgress: vi.fn(),
          priority: "priority" in job ? job.priority : "page",
        },
        async () => {
          started.push(index);
        },
        {
          group: "group" in job ? job.group : "gpu",
          capacity: () => 2,
          ...("size" in job ? { size: job.size } : {}),
          ...("rank" in job ? { rank: () => job.rank } : {}),
        },
      ),
    ),
  );
  expect(started).toEqual(order);
});

it.each([
  {
    name: "rereads queued viewport distances before the next wave",
    initial: [0, 10, 20],
    updated: [0, 20, 0],
    order: [0, 2, 1],
  },
  {
    name: "restores original FIFO order when queued distances become equal",
    initial: [30, 10, 20],
    updated: [0, 0, 0],
    order: [1, 0, 2],
  },
])("$name", async ({ initial, updated, order }) => {
  const started: number[] = [];
  let ranks = initial;
  let finish = () => {};
  let ready = () => {};
  const active = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const jobs = initial.map((_, index) =>
    scheduleTranslation(
      { signal: new AbortController().signal, onProgress: vi.fn() },
      async () => {
        started.push(index);
        if (started.length === 1) {
          ready();
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        }
      },
      { group: "gpu", capacity: () => 1, rank: () => ranks[index] ?? 0 },
    ),
  );
  await active;
  ranks = updated;
  finish();
  await Promise.all(jobs);
  expect(started).toEqual(order);
});

it.each([
  { waited: 14_999, order: ["active", "selection", "visible", "offscreen"] },
  { waited: 15_000, order: ["active", "selection", "offscreen", "visible"] },
])(
  "rescues distant page work after $waited ms while preserving selection priority",
  async ({ waited, order }) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(0);
      const started: string[] = [];
      let finish = () => {};
      let ready = () => {};
      const active = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const enqueue = (name: string, rank: number, priority: "selection" | "page" = "page") =>
        scheduleTranslation(
          { signal: new AbortController().signal, onProgress: vi.fn(), priority },
          async () => {
            started.push(name);
            if (name === "active") {
              ready();
              await new Promise<void>((resolve) => {
                finish = resolve;
              });
            }
          },
          { group: "gpu", capacity: () => 1, rank: () => rank },
        );
      const first = enqueue("active", 0);
      await active;
      const offscreen = enqueue("offscreen", 100);
      vi.setSystemTime(waited);
      const visible = enqueue("visible", 0);
      const selection = enqueue("selection", 1000, "selection");
      finish();
      await Promise.all([first, offscreen, visible, selection]);
      expect(started).toEqual(order);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("waits for an aborted active job to finish before starting another wave", async () => {
  const started: string[] = [];
  const controller = new AbortController();
  let finish = () => {};
  const resource = { group: "gpu", capacity: () => 2, size: 100 };
  const active = scheduleTranslation(
    { signal: controller.signal, onProgress: vi.fn() },
    async () => {
      started.push("active");
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    },
    resource,
  );
  await vi.waitFor(() => expect(started).toEqual(["active"]));
  const queued = scheduleTranslation(
    { signal: new AbortController().signal, onProgress: vi.fn() },
    async () => {
      started.push("queued");
    },
    resource,
  );
  const rejected = expect(active).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejected;
  await new Promise<void>((resolve) => queueMicrotask(resolve));
  expect(started).toEqual(["active"]);
  finish();
  await queued;
  expect(started).toEqual(["active", "queued"]);
});

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
