const test = require("node:test");
const assert = require("node:assert/strict");
const { createLoader, reuseCached, CACHE_AGE } = require("../www/counters.js");
const appearance = require("../www/appearance.js");
const logic = require("../www/logic.js");

const person = (username, id) => ({ username, instagramUserId: id, followerCount: null });
async function until(predicate) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  throw new Error("Sayaç yükleyici beklenen duruma geçmedi");
}

test("Sayaç yükleme listeyi bekletmez; sıfır sayısı kabul edilir, yanlış kimlik reddedilir", async () => {
  let finish;
  let calls = 0;
  const accepted = [];
  const loader = createLoader({ delay: 0, fetchBatch: (records) => {
    calls += 1;
    assert.equal(records.length, 1);
    if (records[0].username === "beta") return Promise.resolve({ records: [{ username: "beta", instagramUserId: "77", followerCount: 100 }] });
    return new Promise((resolve) => { finish = resolve; });
  }, onRecords: (records) => accepted.push(...records) });
  loader.configure([person("alpha", "1"), person("beta", "2")], "owner:first");
  loader.start();
  await until(() => Boolean(finish));
  assert.equal(loader.status().ready, 0);
  assert.equal(loader.status().phase, "loading");
  finish({ records: [{ username: "alpha", instagramUserId: "1", followerCount: 0 }, { username: "beta", instagramUserId: "77", followerCount: 100 }] });
  await until(() => loader.status().phase === "partial");
  assert.equal(calls, 2);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].followerCount, 0);
  assert.equal(loader.recordState("beta"), "unavailable");
  assert.equal(loader.status().unavailable, 1);
  await loader.pause();
});

test("Görünür ve filtreye aday hesaplar önceliklidir; eski dörtlü ayar verilse de her çağrı tek hesap alır", async () => {
  const calls = [];
  const loader = createLoader({ delay: 0, batchSize: 4, fetchBatch: async (records) => {
    calls.push(records.map((record) => record.username));
    return { records: records.map((record) => ({ ...record, followerCount: 25 })) };
  } });
  const records = Array.from({ length: 13 }, (_, index) => person(`person.${index}`, String(index + 1)));
  loader.configure(records, "owner:first");
  loader.prioritize([records[12], records[11]]);
  loader.start();
  await until(() => loader.status().phase === "complete");
  assert.deepEqual(calls.slice(0, 2).flat(), ["person.12", "person.11"]);
  assert.equal(calls.length, 13);
  assert.equal(new Set(calls.flat()).size, 13);
  assert.ok(calls.every((batch) => batch.length === 1));
  await loader.pause();
});

test("Çıkış veya profil değişiminden sonra geç gelen sayaç başka kayda yazılmaz", async () => {
  let oldReply;
  let cancelled = 0;
  const accepted = [];
  const loader = createLoader({ delay: 0, cancel: async () => { cancelled += 1; }, fetchBatch: async (records) => {
    if (records[0].username === "alpha") return new Promise((resolve) => { oldReply = resolve; });
    return { records: records.map((record) => ({ ...record, followerCount: 42 })) };
  }, onRecords: (records, scope) => accepted.push({ records, scope }) });
  loader.configure([person("alpha", "1")], "first-owner");
  loader.start();
  await until(() => Boolean(oldReply));
  await loader.pause();
  loader.configure([person("beta", "2")], "second-owner");
  loader.start();
  oldReply({ records: [{ username: "alpha", instagramUserId: "1", followerCount: 999 }] });
  await until(() => loader.status().phase === "complete");
  assert.ok(cancelled >= 1);
  assert.equal(accepted.length, 1);
  assert.equal(accepted[0].scope, "second-owner");
  assert.equal(accepted[0].records[0].username, "beta");
  await loader.pause();
});

test("429'da kısmi sayaçlar korunur; bekleme bitmeden yeniden istek gönderilmez", async () => {
  let time = 100000;
  let calls = 0;
  const loader = createLoader({ delay: 0, now: () => time, fetchBatch: async (records) => {
    calls += 1;
    return calls === 1 ? { records: [{ ...records[0], followerCount: 9 }], retryAfterMs: 30000 }
      : { records: records.map((record) => ({ ...record, followerCount: 4 })) };
  } });
  loader.configure([person("alpha", "1"), person("beta", "2")], "owner");
  loader.start();
  await until(() => loader.status().phase === "blocked");
  assert.equal(loader.status().ready, 1);
  loader.start();
  await until(() => loader.status().phase === "blocked");
  assert.equal(calls, 1);
  time += 30001;
  loader.start();
  await until(() => loader.status().phase === "complete");
  assert.equal(calls, 2);
  assert.equal(loader.status().ready, 2);
  await loader.pause();
});

test("Oturum yoksa otomatik sorgu döngüsü durur ve kullanıcıya bağlanma durumu verilir", async () => {
  let calls = 0;
  const loader = createLoader({ delay: 0, fetchBatch: async () => { calls += 1; return { records: [], sessionRequired: true }; } });
  loader.configure([person("alpha", "1")], "owner");
  loader.start();
  await until(() => loader.status().phase === "session");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(loader.status().pending, 1);
  await loader.pause();
});

test("Yeni tarama güncel sayaçları doğru kimlikle kullanır; zaman damgası yenilenip bayat veri saklanmaz", () => {
  const time = Date.now();
  const previous = { importedAt: time - 60000, followers: [{ ...person("alpha", "1"), followerCount: 200, countsUpdatedAt: time - 60000 }], following: [] };
  const dataset = { followers: [person("alpha", "1")], following: [] };
  const merged = reuseCached(dataset, previous, time);
  assert.equal(merged.followers[0].followerCount, 200);
  assert.equal(merged.followers[0].countsUpdatedAt, time - 60000);
  assert.equal(dataset.followers[0].followerCount, null);
  const snapshot = logic.createSnapshot("owner", merged, time);
  assert.equal(snapshot.followers[0].countsUpdatedAt, time - 60000);
  assert.equal(reuseCached(dataset, snapshot, time + CACHE_AGE).followers[0].followerCount, null);
  assert.equal(reuseCached({ followers: [person("other", "1")], following: [] }, previous, time).followers[0].followerCount, null);
  assert.equal(reuseCached({ followers: [{ ...person("alpha", "1"), followerCount: 0 }], following: [] }, previous, time).followers[0].followerCount, 0);
  assert.equal(reuseCached({ followers: [{ ...person("alpha", "1"), followingCount: 0 }], following: [] }, previous, time).followers[0].followingCount, 0);
});

test("Tam 10 düzen ve 10 tema vardır; eski seçimler ve bozuk tercihler güvenli eşlenir", () => {
  assert.equal(Object.keys(appearance.layouts).length, 10);
  assert.equal(Object.keys(appearance.themes).length, 10);
  assert.equal(appearance.themeId("cyber"), "midnight");
  assert.equal(appearance.themeId("toString"), "atlas");
  assert.equal(appearance.layoutId("__proto__"), "atlas");
  assert.equal(new Set(Object.values(appearance.layouts).map((entry) => entry.name)).size, 10);
});
