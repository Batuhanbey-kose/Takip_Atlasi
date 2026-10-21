(function attachCounters(root, factory) {
  const logic = typeof module === "object" && module.exports ? require("./logic.js") : root.TakipLogic;
  const api = factory(logic);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.TakipCounters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function createCounters(logic) {
  "use strict";

  const CACHE_AGE = 24 * 60 * 60 * 1000;

  function reuseCached(dataset, previous, now = Date.now()) {
    if (!previous) return dataset;
    const cache = new Map();
    for (const record of [...(previous.followers || []), ...(previous.following || [])]) {
      const observedAt = Number(record.countsUpdatedAt) || Number(previous.importedAt) || 0;
      if (record.instagramUserId && logic.normalizeAccountCount(record.followerCount) !== null &&
        observedAt <= now && now - observedAt < CACHE_AGE) {
        cache.set(record.instagramUserId, { ...record, countsUpdatedAt: observedAt });
      }
    }
    const merge = (record) => {
      if (logic.normalizeAccountCount(record.followerCount) !== null) return { ...record, countsUpdatedAt: Number(record.countsUpdatedAt) || now };
      const cached = cache.get(record.instagramUserId);
      if (!cached || cached.username !== record.username) return record;
      return { ...record, followerCount: cached.followerCount,
        followingCount: logic.normalizeAccountCount(record.followingCount) ?? cached.followingCount,
        postCount: logic.normalizeAccountCount(record.postCount) ?? cached.postCount, countsUpdatedAt: cached.countsUpdatedAt };
    };
    return { ...dataset, followers: (dataset.followers || []).map(merge), following: (dataset.following || []).map(merge) };
  }

  function createLoader(options) {
    let current = null;
    let generation = 0;
    let cancelling = Promise.resolve();
    const now = options.now || Date.now;
    const batchSize = 1;
    const delay = options.delay ?? 200;

    function status() {
      if (!current) return { scope: "", phase: "idle", total: 0, ready: 0, pending: 0, unavailable: 0, blockedUntil: 0 };
      return { scope: current.scope, phase: current.phase, total: current.records.size, ready: current.known.size,
        pending: current.records.size - current.known.size - current.unavailable.size,
        unavailable: current.unavailable.size, blockedUntil: current.blockedUntil };
    }
    function emit() { options.onStatus?.(status()); }
    function enqueue(run, names) {
      run.pending = Array.from(new Set([...names, ...run.pending])).filter((name) => !run.known.has(name));
    }
    function pause() {
      generation += 1;
      if (!current) return cancelling;
      const run = current;
      run.running = false;
      clearTimeout(run.timer);
      if (run.inFlight) {
        enqueue(run, run.inFlight);
        cancelling = cancelling.then(() => options.cancel?.()).catch(() => {});
      }
      run.phase = "paused";
      emit();
      return cancelling;
    }
    function configure(records, scope) {
      if (current?.scope === scope) return false;
      pause();
      const clean = logic.dedupeRecords(records).filter((record) => record.username.length <= 30);
      current = { scope, records: new Map(clean.map((record) => [record.username, record])), known: new Set(),
        unavailable: new Set(), pending: [], inFlight: null, running: false, phase: "idle", blockedUntil: 0, timer: null };
      for (const record of clean) {
        if (logic.normalizeAccountCount(record.followerCount) !== null) current.known.add(record.username);
        else current.pending.push(record.username);
      }
      emit();
      return true;
    }
    function prioritize(records) {
      if (!current) return;
      const pending = new Set(current.pending);
      const priority = records.map((record) => record.username).filter((name) => pending.has(name));
      enqueue(current, priority);
    }
    function schedule(run) {
      clearTimeout(run.timer);
      run.timer = setTimeout(() => pump(run), delay);
    }
    function start(retryUnavailable = false) {
      if (!current || current.running) return;
      if (retryUnavailable) {
        enqueue(current, Array.from(current.unavailable));
        current.unavailable.clear();
      }
      current.running = true;
      current.phase = "loading";
      emit();
      schedule(current);
    }
    async function pump(run) {
      if (run !== current || !run.running || run.inFlight) return;
      const token = generation;
      await cancelling;
      if (run !== current || !run.running || token !== generation) return;
      if (!run.pending.length) { run.running = false; run.phase = run.unavailable.size ? "partial" : "complete"; emit(); return; }
      const blockedUntil = Math.max(run.blockedUntil, Number(options.blockedUntil?.()) || 0);
      if (blockedUntil > now()) { run.blockedUntil = blockedUntil; run.running = false; run.phase = "blocked"; emit(); return; }
      const batch = run.pending.splice(0, batchSize);
      run.inFlight = batch;
      try {
        const result = await options.fetchBatch(batch.map((name) => run.records.get(name)));
        if (run !== current || token !== generation || !run.running) return;
        const accepted = [];
        for (const entry of Array.isArray(result?.records) ? result.records : []) {
          const username = logic.normalizeUsername(entry?.username);
          const expected = run.records.get(username);
          const id = logic.normalizeInstagramUserId(entry?.instagramUserId);
          const count = logic.normalizeAccountCount(entry?.followerCount);
          if (!expected || !batch.includes(username) || count === null ||
            (expected.instagramUserId && id !== expected.instagramUserId) || run.known.has(username)) continue;
          run.known.add(username);
          const updatedAt = Number(entry.updatedAt);
          accepted.push({ ...entry, username, instagramUserId: id, followerCount: count,
            countsUpdatedAt: Number.isSafeInteger(updatedAt) && updatedAt > 0 && updatedAt <= now() ? updatedAt : now() });
        }
        if (accepted.length) options.onRecords?.(accepted, run.scope);
        const missing = batch.filter((name) => !run.known.has(name));
        if (Number(result?.retryAfterMs) > 0 || result?.sessionRequired || result?.connectionFailed || result?.requestRejected || result?.profileError) {
          enqueue(run, missing);
          run.running = false;
          if (Number(result.retryAfterMs) > 0) {
            run.blockedUntil = now() + Math.min(86400000, Number(result.retryAfterMs));
            run.phase = "blocked";
          } else run.phase = result.sessionRequired ? "session" : "error";
        } else missing.forEach((name) => run.unavailable.add(name));
      } catch (error) {
        if (run === current && token === generation) {
          enqueue(run, batch.filter((name) => !run.known.has(name)));
          run.running = false;
          run.phase = "error";
        }
      } finally {
        if (run.inFlight === batch) run.inFlight = null;
        if (run === current) {
          if (run.running) schedule(run);
          emit();
        }
      }
    }
    function recordState(username) {
      if (current?.known.has(username)) return "ready";
      return current?.unavailable.has(username) ? "unavailable" : "pending";
    }
    return { configure, start, pause, prioritize, status, recordState };
  }
  return { createLoader, reuseCached, CACHE_AGE };
});
