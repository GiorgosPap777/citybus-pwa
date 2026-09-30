import fs from 'node:fs';
import path from 'node:path';

// Expired entries are dropped this often. Reading a key dropped only that key, so
// every stop, timetable and line ever asked for stayed in memory until a restart —
// and stop codes are user input.
const SWEEP_MS = 60_000;

/**
 * TTL cache with three properties that matter here:
 *
 *  - single-flight: concurrent misses on the same key share one upstream call,
 *    so twenty people opening the same stop at once produce one request, not twenty.
 *  - failures are cached too, briefly (`failureTtl`), so they collapse the same way.
 *    Without it an outage sent every poll from every user upstream, exactly when
 *    the upstream was struggling, and a name that does not exist was looked up
 *    again on every request.
 *  - optional disk persistence: survives restarts, so a redeploy does not re-fetch
 *    every city's stop list. Only worth it for slow-moving data; leave `dir` unset
 *    for hot caches (live arrivals) so we are not writing to disk every 10 seconds.
 *    Failures are never persisted.
 *
 * `maxEntries` bounds memory: past it, the entry written longest ago goes.
 */
export class TtlCache {
  constructor({ name, dir = null, maxEntries = Infinity, failureTtl = () => 0 } = {}) {
    this.name = name;
    this.dir = dir;
    this.file = dir ? path.join(dir, `${name}.json`) : null;
    this.maxEntries = maxEntries;
    this.failureTtl = failureTtl;
    this.entries = new Map(); // key -> { value, expiresAt }
    this.failures = new Map(); // key -> { error, expiresAt }
    this.inflight = new Map(); // key -> Promise
    this.#load();
    setInterval(() => this.#sweep(), SWEEP_MS).unref();
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

  #sweep() {
    const now = Date.now();
    for (const map of [this.entries, this.failures]) {
      for (const [key, entry] of map) if (entry.expiresAt <= now) map.delete(key);
    }
  }

  // Maps iterate in insertion order, and a write re-inserts its key, so the first
  // key is the one written longest ago.
  #store(map, key, entry) {
    map.delete(key);
    map.set(key, entry);
    while (map.size > this.maxEntries) map.delete(map.keys().next().value);
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
    this.#store(this.entries, key, { value, expiresAt: Date.now() + ttlMs });
    this.failures.delete(key);
    this.#persist();
  }

  delete(key) {
    this.entries.delete(key);
    this.failures.delete(key);
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

    const failure = this.failures.get(key);
    if (failure && failure.expiresAt > Date.now()) throw failure.error;

    const pending = this.inflight.get(key);
    if (pending) return pending;

    const promise = (async () => {
      try {
        const value = await producer();
        const ttlMs = typeof ttl === 'function' ? ttl(value) : ttl;
        if (ttlMs > 0) this.set(key, value, ttlMs);
        return value;
      } catch (err) {
        const ttlMs = this.failureTtl(err);
        if (ttlMs > 0) this.#store(this.failures, key, { error: err, expiresAt: Date.now() + ttlMs });
        throw err;
      }
    })().finally(() => this.inflight.delete(key));

    this.inflight.set(key, promise);
    return promise;
  }
}
