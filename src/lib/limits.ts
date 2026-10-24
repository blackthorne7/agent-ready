// In-memory caching and rate limits for the expensive endpoints (/api/agent, /api/fix-link).
// In memory is enough here: the site runs as a single instance, and a restart only costs a fresh run.

/** A time-limited cache that also shares in-flight work: concurrent callers for one key get one run. */
export class TtlCache<T> {
  private done = new Map<string, { at: number; value: T }>();
  private inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** True if a fresh value is cached or a run is in progress, so asking for it costs nothing new. */
  has(key: string): boolean {
    return this.inFlight.has(key) || this.fresh(key) !== undefined;
  }

  /**
   * The cached value, or `run()`'s; `cached` is false only for the caller that did the run. Failures
   * aren't cached. `refresh` skips a cached value (but still joins a run already in progress).
   */
  async get(key: string, run: () => Promise<T>, { refresh = false } = {}): Promise<{ value: T; cached: boolean }> {
    const hit = refresh ? undefined : this.fresh(key);
    if (hit !== undefined) return { value: hit, cached: true };
    const pending = this.inFlight.get(key);
    if (pending) return { value: await pending, cached: true };

    const promise = run();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      this.done.delete(key); // re-insert so Map order stays oldest-first for eviction
      this.done.set(key, { at: this.now(), value });
      while (this.done.size > this.maxEntries) this.done.delete(this.done.keys().next().value!);
      return { value, cached: false };
    } finally {
      this.inFlight.delete(key);
    }
  }

  private fresh(key: string): T | undefined {
    const entry = this.done.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.at > this.ttlMs) {
      this.done.delete(key);
      return undefined;
    }
    return entry.value;
  }
}

/** Sliding-window limit: at most `limit` takes per key within `windowMs`. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a use and returns true, or returns false (recording nothing) if the key is over its limit. */
  take(key: string): boolean {
    const now = this.now();
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    for (const [key, times] of this.hits) if (times.every((t) => now - t >= this.windowMs)) this.hits.delete(key);
  }
}

/** The visitor's IP from the proxy headers, or null when there's none to go on. */
export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || req.headers.get("cf-connecting-ip") || null;
}
