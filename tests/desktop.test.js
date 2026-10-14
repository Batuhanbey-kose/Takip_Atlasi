const test = require("node:test");
const assert = require("node:assert/strict");
const { DesktopCollector, readyUrl } = require("../scripts/instagram-desktop.js");
const { DesktopEnrichment, allowedPhoto, findProfile, replaceIdentity } = require("../scripts/desktop-enrichment.js");

test("Profil sayaçları yalnızca istenen hesaba ait web yanıtından alınır", () => {
  const data = { data: { user: { username: "alpha", id: "123", follower_count: 20, following_count: 30, media_count: 0 } } };
  assert.equal(findProfile(data, "alpha", "123").postCount, 0);
  assert.equal(findProfile(data, "alpha", "456"), null);
  assert.equal(findProfile(data, "other", "123"), null);
  const vars = { username: "owner", options: { render_surface: "PROFILE" } };
  const updated = replaceIdentity(vars, [{ path: ["username"], kind: "username" }], { username: "alpha" });
  assert.equal(updated.username, "alpha");
  assert.equal(updated.options.render_surface, "PROFILE");
  assert.equal(vars.username, "owner");
});

test("Fotoğraf önbelleği çerez göndermez ve API/yerel adreslere gitmez", async () => {
  assert.equal(allowedPhoto("https://scontent.cdninstagram.com/a.jpg"), true);
  assert.equal(allowedPhoto("http://scontent.cdninstagram.com/a.jpg"), false);
  assert.equal(allowedPhoto("https://www.instagram.com/api/v1/users/1/info/"), false);
  assert.equal(allowedPhoto("https://127.0.0.1/a.jpg"), false);
  assert.equal(allowedPhoto("https://scontent.cdninstagram.com.evil.example/a.jpg"), false);
  let fetched = 0;
  const service = new DesktopEnrichment({}, { fetchImage: async (url, options) => {
    fetched += 1;
    assert.equal(options.credentials, "omit");
    assert.equal(options.headers.Cookie, undefined);
    return new Response(new Uint8Array([255, 216, 255, 217]), { status: 200, headers: { "Content-Type": "image/jpeg" } });
  } });
  const records = [{ username: "alpha", profilePicUrl: "https://scontent.cdninstagram.com/a.jpg" }];
  const first = await service.requestPhotos(records);
  assert.match(first.records[0].photoUrl, /^\/api\/instagram\/photo\/[a-f0-9]{64}$/);
  assert.equal(service.photo(first.records[0].photoUrl.split("/").pop()).bytes.length, 4);
  await service.requestPhotos(records);
  assert.equal(fetched, 1);
  assert.equal((await service.requestPhotos([{ username: "alpha", profilePicUrl: "https://www.instagram.com/api/" }])).records.length, 0);
});

test("PC giriş ara ekranları taramaya hazır kabul edilmez", () => {
  assert.equal(readyUrl("https://www.instagram.com/accounts/onetap/"), false);
  assert.equal(readyUrl("https://www.instagram.com/challenge/"), false);
  assert.equal(readyUrl("https://www.instagram.com:444/"), false);
  assert.equal(readyUrl("https://www.instagram.com.evil.example/"), false);
  assert.equal(readyUrl("https://www.instagram.com/owner/"), true);
});

test("PC köprüsü tamamlanan sayfaları aktarır, eksik sayımı kabul etmez", () => {
  const collector = new DesktopCollector({ stateFile: null });
  collector.active = true;
  collector.scanning = true;
  collector.requestedUsername = "owner";
  const send = (value) => collector.handleMessage(JSON.stringify(value));
  send({ type: "page", relationship: "followers", users: [{ username: "alice" }] });
  send({ type: "page", relationship: "following", users: [{ username: "bob" }] });
  send({ type: "complete", username: "owner", userId: "999", followersCount: 1, followingCount: 1 });
  assert.equal(collector.summary.followersCount, 1);
  assert.equal(collector.readResult("followers", 0, 250).records[0].username, "alice");
  assert.equal(collector.readResult("following", 0, 250).records[0].username, "bob");

  collector.active = true;
  collector.scanning = true;
  send({ type: "complete", username: "owner", userId: "999", followersCount: 2, followingCount: 1 });
  assert.equal(collector.state.error.code, "INCOMPLETE_RESULT");
  assert.throws(() => collector.readResult("followers"), /henüz tamamlanmadı/);
});

test("PC köprüsü 429 beklemesini uygular ve yeni tarama başlatmaz", () => {
  const collector = new DesktopCollector({ stateFile: null });
  collector.active = true;
  collector.scanning = true;
  collector.handleMessage(JSON.stringify({ type: "error", code: "RATE_LIMITED", retryAfterMs: 120000, message: "HTTP 429" }));
  assert.equal(collector.state.error.code, "RATE_LIMITED");
  assert.ok(collector.blockedUntil > Date.now());
  assert.throws(() => collector.start({ username: "owner" }), (error) => error.code === "RATE_LIMITED");
  collector.clearResult();
  assert.equal(collector.state.phase, "error");
  assert.equal(collector.state.error.code, "RATE_LIMITED");
});
