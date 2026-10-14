const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function observer(fetchImpl) {
  const messages = [];
  let time = Date.now();
  class Clock extends Date { static now() { time += 200; return time; } }
  class Xhr { open() {} setRequestHeader() {} send() {} addEventListener() {} }
  const sandbox = { Headers, Request, URL, URLSearchParams, AbortController, XMLHttpRequest: Xhr,
    location: { href: "https://www.instagram.com/owner/" }, Date: Clock,
    setTimeout: (callback, milliseconds) => milliseconds === 100 ? setImmediate(callback) : setTimeout(callback, milliseconds),
    clearTimeout: (handle) => { clearImmediate(handle); clearTimeout(handle); },
  };
  sandbox.window = { fetch: fetchImpl, TakipAtlasiNative: { postMessage: (value) => messages.push(JSON.parse(value)) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../android/app/src/main/assets/instagram-web-observer.js"), "utf8"), sandbox);
  return { window: sandbox.window, messages };
}

test("Android web gözlemcisi doğru profil ve sorgu şablonunu normal web yanıtından hazırlar", async () => {
  const profile = (id, username) => ({ data: { user: { id, username, follower_count: 80, following_count: 538, media_count: 5, profile_pic_url: "https://scontent.cdninstagram.com/a.jpg" } } });
  const state = observer(async (input, options = {}) => {
    const body = options.body || await input.clone().text();
    const vars = JSON.parse(new URLSearchParams(body).get("variables"));
    const payload = vars.id === "999" ? profile("999", "owner") : profile("123", "alpha");
    return { status: 200, type: "basic", headers: new Headers(), json: async () => payload, clone: () => ({ json: async () => payload }) };
  });
  await state.window.fetch(new Request("https://www.instagram.com/api/graphql", {
    method: "POST",
    headers: { "x-asbd-id": "129477", "x-fb-friendly-name": "PolarisProfilePageContentQuery", "x-fb-lsd": "private-test-token" },
    body: new URLSearchParams({ variables: JSON.stringify({ id: "999" }), doc_id: "document" }).toString(),
  }));
  await new Promise((resolve) => setImmediate(resolve));
  const ready = state.messages.find((message) => message.type === "web-profile");
  assert.ok(ready);
  assert.equal(ready.account.userId, "999");
  assert.equal(ready.account.followingCount, 538);
  assert.equal(ready.hasTemplate, true);
  assert.doesNotMatch(JSON.stringify(state.messages), /private-test-token/);

  await state.window.__TAKIP_WEB_OBSERVER__.queryMetadata(7, [{ username: "alpha", instagramUserId: "123" }], 0);
  const result = state.messages.find((message) => message.type === "metadata-result");
  assert.equal(result.requestId, 7);
  assert.equal(result.records[0].username, "alpha");
  assert.equal(result.records[0].postCount, 5);
});
