export class SessionResultCache {
  constructor(ttlMs = 5 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.items = new Map();
  }
  get(key) {
    const hit = this.items.get(key);
    if (!hit) return null;
    if (Date.now() - hit.savedAt > this.ttlMs) {
      this.items.delete(key);
      return null;
    }
    return hit.value;
  }
  set(key, value) {
    this.items.set(key, { value, savedAt: Date.now() });
    return value;
  }
  clear() { this.items.clear(); }
}
