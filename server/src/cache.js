import fs from 'node:fs';
import path from 'node:path';

/**
 * TTL cache with two properties that matter here:
 *
 *  - single-flight: concurrent misses on the same key share one upstream call,
 *    so twenty people opening the same stop at once produce one request, not twenty.
 *  - optional disk persistence: survives restarts, so a redeploy does not re-fetch
 *    every city's stop list. Only worth it for slow-moving data; leave `dir` unset
 *    for hot caches (live arrivals) so we are not writing to disk every 10 seconds.
 */
export class TtlCache {
  constructor({ name, dir = null } = {}) {
    this.name = name;
    this.dir = dir;
    this.file = dir ? path.join(dir, `${name}.json`) : null;
    this.entries = new Map(); // key -> { value, expiresAt }
    this.inflight = new Map(); // key -> Promise
    this.#load();
  }

  #load() {
    if (!this.file) return;
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const now = Date.now();
      for (const [key, entry] of Object.entries(raw)) {
        if (entry?.expiresAt > now) this.entries.set(key, entry);
      }
    } catch {
      // No cache file yet, or it is unreadable/corrupt. A cold start is always safe.
    }
  }

  #persist() {
    if (!this.file) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(Object.fromEntries(this.entries)));
    } catch (err) {
      console.warn(`[cache:${this.name}] could not persist: ${err.message}`);
    }
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMs) {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    this.#persist();
  }

  delete(key) {
    this.entries.delete(key);
    this.#persist();
  }

  /**
   * Return the cached value, or run `producer` to make one.
   * `ttl` may be a number of ms, or a function of the produced value — the token
   * cache needs the latter, since its lifetime comes from the JWT's own exp claim.
   */
  async wrap(key, ttl, producer) {
    const hit = this.get(key);
    if (hit !== undefined) return hit;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      const value = await producer();
      const ttlMs = typeof ttl === 'function' ? ttl(value) : ttl;
      if (ttlMs > 0) this.set(key, value, ttlMs);
      return value;
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }
}
