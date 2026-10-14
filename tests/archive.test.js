const test = require("node:test");
const assert = require("node:assert/strict");
const { zipSync, strToU8 } = require("fflate");
const archive = require("../www/archive.js");
const server = require("../scripts/serve.js");

function file(name, bytes) {
  return {
    name,
    size: bytes.length,
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

function json(name, value) {
  return file(name, strToU8(JSON.stringify(value)));
}

test("Instagram JSON ZIP arşivi PC ve Android için aynı kodla iki listeyi çıkarır", async () => {
  const prefix = "instagram_export/connections/followers_and_following/";
  const bytes = zipSync({
    [`${prefix}followers_1.json`]: strToU8(JSON.stringify([
      { string_list_data: [{ value: "alice", timestamp: 100 }] },
      { string_list_data: [{ value: "bob", timestamp: 200 }] },
    ])),
    [`${prefix}followers_2.json`]: strToU8(JSON.stringify([
      { string_list_data: [{ value: "alice", timestamp: 300 }] },
    ])),
    [`${prefix}following.json`]: strToU8(JSON.stringify({ relationships_following: [
      { title: "bob", string_list_data: [{ value: "bob", timestamp: 180 }] },
      { title: "carol", string_list_data: [{ value: "carol", timestamp: 250 }] },
    ] })),
    "instagram_export/media/photo.jpg": new Uint8Array(1000),
  });
  const result = await archive.importFiles([file("instagram-export.zip", bytes)]);

  assert.deepEqual(result.followers.map((record) => record.username), ["alice", "bob"]);
  assert.equal(result.followers[0].timestamp, 300);
  assert.deepEqual(result.following.map((record) => record.username), ["carol", "bob"]);
});

test("Ayrı Instagram JSON dosyaları da içe aktarılabilir", async () => {
  const result = await archive.importFiles([
    json("followers_1.json", [{ string_list_data: [{ value: "https://www.instagram.com/Alice/", timestamp: 100 }] }]),
    json("following.json", { relationships_following: [{ title: "bob", string_list_data: [{ value: "bob", timestamp: 200 }] }] }),
  ]);
  assert.equal(result.followers[0].username, "alice");
  assert.equal(result.following[0].username, "bob");
});

test("Eksik veya bozuk takip listesi yanlış takipten çıkanlar kaydı oluşturmaz", async () => {
  const onlyFollowers = zipSync({ "followers_1.json": strToU8("[]") });
  await assert.rejects(archive.importFiles([file("only-one.zip", onlyFollowers)]), /hem followers_1.json hem following.json/);
  await assert.rejects(archive.importFiles([
    json("followers_1.json", [{ string_list_data: [{ value: "<script>" }] }]),
    json("following.json", { relationships_following: [] }),
  ]), /geçersiz bir hesap/);
  await assert.rejects(archive.importFiles([json("following.json", { relationships_following: [] })]), /hem followers_1.json/);
});

test("ZIP içindeki aşırı büyük JSON sıkıştırılmış olsa bile açılmaz", async () => {
  const tooLarge = zipSync({ "followers_1.json": strToU8(" ".repeat(10 * 1024 * 1024 + 1)) });
  await assert.rejects(archive.importFiles([file("large.zip", tooLarge)]), /çok büyük/);
});

test("PC yerel sunucusu arayüzü ve ZIP çözücüyü sunar", async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(base);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Instagram ZIP \/ JSON arşivini seç/);
    const vendor = await fetch(`${base}/vendor/fflate.js`);
    assert.equal(vendor.status, 200);
    assert.match(await vendor.text(), /unzipSync/);
    assert.equal((await fetch(`${base}/package.json`)).status, 404);
    const blocked = await fetch(`${base}/api/instagram/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://outside.example" },
      body: JSON.stringify({ username: "owner" }),
    });
    assert.equal(blocked.status, 403);
    const health = await fetch(`${base}/api/instagram/health`);
    assert.equal(health.status, 200);
    assert.equal(typeof (await health.json()).available, "boolean");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
