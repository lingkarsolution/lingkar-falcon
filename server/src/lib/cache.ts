// Simple in-memory TTL cache for connector/search responses.
type Entry<T> = { value: T; expiresAt: number };

class TtlCache {
  private store = new Map<string, Entry<unknown>>();

  get<T>(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (e.expiresAt < Date.now()) {
      this.store.delete(key);
      return null;
    }
    return e.value as T;
  }

  set<T>(key: string, value: T, ttlSec: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlSec * 1000 });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  size(): number {
    return this.store.size;
  }

  // Sweep expired entries (called occasionally).
  sweep(): void {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt < now) this.store.delete(k);
    }
  }
}

export const cache = new TtlCache();

setInterval(() => cache.sweep(), 60_000).unref();
