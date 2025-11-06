class SimpleCache {
    constructor() { this.store = new Map(); }
    get(key) {
        const v = this.store.get(key);
        if (!v) return null;
        if (Date.now() > v.exp) { this.store.delete(key); return null; }
        return v.val;
    }
    set(key, val, ttlMs) {
        const exp = Date.now() + ttlMs;
        this.store.set(key, { val, exp });
    }
    async getOrSet(key, ttlMs, fn) {
        const cached = this.get(key);
        if (cached != null) return cached;
        const val = await fn();
        this.set(key, val, ttlMs);
        return val;
    }
}

module.exports = new SimpleCache();
