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
  class BrowserRequest {
    constructor(url, options = {}) { this.url = url; this.headers = new Headers(options.headers); this.body = options.body || ""; }
    clone() { return new BrowserRequest(this.url, { headers: this.headers, body: this.body }); }
    async text() { return this.body; }
  }
  const sandbox = { Headers, Request: BrowserRequest, URL, URLSearchParams, AbortController, XMLHttpRequest: Xhr,
    location: { href: "https://www.instagram.com/owner/" }, Date: Clock,
    setTimeout,
    clearTimeout,
  };
  sandbox.window = { fetch: fetchImpl, TakipAtlasiNative: { postMessage: (value) => messages.push(JSON.parse(value)) } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../android/app/src/main/assets/instagram-web-observer.js"), "utf8"), sandbox);
  return { window: sandbox.window, messages, Request: BrowserRequest };
}

test("Android web gözlemcisi doğru profil ve sorgu şablonunu normal web yanıtından hazırlar", async () => {
  const profile = (id, username) => ({ data: { user: { id, username, follower_count: 80, following_count: 538, media_count: 5, profile_pic_url: "https://scontent.cdninstagram.com/a.jpg" } } });
  const state = observer(async (input, options = {}) => {
    const body = options.body || await input.text();
    const vars = JSON.parse(new URLSearchParams(body).get("variables"));
    const payload = vars.id === "999" ? profile("999", "owner") : profile("123", "alpha");
    return { status: 200, type: "basic", headers: new Headers(), json: async () => payload, clone: () => ({ json: async () => payload }) };
  });
  await state.window.fetch(new state.Request("https://www.instagram.com/api/graphql", {
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

test("Takipçi odaklı Android sorgusu diğer sayaçlar yokken profil sayısını kabul eder", async () => {
  const state = observer(async () => {
    const payload = { data: { user: { id: "123", username: "alpha", follower_count: 27 } } };
    return { status: 200, type: "basic", headers: new Headers(), json: async () => payload };
  });
  state.window.__TAKIP_WEB_OBSERVER__.template = { endpoint: "/api/graphql", body: "variables=%7B%22id%22%3A%22999%22%7D", variables: { id: "999" }, identities: [{ path: ["id"], kind: "id" }], headers: {} };
  await state.window.__TAKIP_WEB_OBSERVER__.queryMetadata(9, [{ username: "alpha", instagramUserId: "123" }], 0, true);
  const result = state.messages.find((message) => message.type === "metadata-result");
  assert.equal(result.records[0].followerCount, 27);
  assert.equal(result.records[0].postCount, null);
});

test("Tarama profil sorgusu ortak istek kapısını kullanır ve aynı sayacı tekrar istemez", async () => {
  const state = observer(() => { throw new Error("Bağımsız fetch kullanılmamalı"); });
  const api = state.window.__TAKIP_WEB_OBSERVER__;
  api.template = { endpoint: "/api/graphql", body: "doc_id=profile", variables: { id: "999", options: { surface: "PROFILE" } }, identities: [{ path: ["id"], kind: "id" }], headers: { "x-asbd-id": "site" } };
  let calls = 0;
  const gate = async (endpoint, options) => {
    calls += 1;
    assert.equal(endpoint, "/api/graphql");
    assert.equal(options.method, "POST");
    const variables = JSON.parse(new URLSearchParams(options.body).get("variables"));
    assert.equal(variables.id, "12345678901234567890");
    assert.equal(variables.options.surface, "PROFILE");
    return { data: { user: { id: variables.id, username: "alpha", follower_count: 0 } } };
  };
  const record = { username: "alpha", instagramUserId: "12345678901234567890" };
  assert.equal((await api.readProfile(record, gate)).followerCount, 0);
  assert.equal((await api.readProfile(record, gate)).followerCount, 0);
  assert.equal(calls, 1);
  assert.equal(api.template.variables.id, "999");
  assert.ok(state.messages.every((message) => message.type !== "metadata-result"));
});

test("Kimlik isteyen profil şablonuna boş kimlik gönderilmez", async () => {
  const state = observer(async () => {});
  const api = state.window.__TAKIP_WEB_OBSERVER__;
  api.template = { identities: [{ path: ["id"], kind: "id" }] };
  const result = await api.readProfile({ username: "alpha" }, () => { throw new Error("Boş kimlik sorgusu gönderilmemeli"); });
  assert.equal(result, null);
});

test("Ortak kapının 429 hatası tarama çağrısına değiştirilmeden iletilir", async () => {
  const state = observer(async () => {});
  const api = state.window.__TAKIP_WEB_OBSERVER__;
  api.template = { endpoint: "/api/graphql", body: "", variables: { id: "999" }, identities: [{ path: ["id"], kind: "id" }], headers: {} };
  const error = Object.assign(new Error("HTTP 429"), { code: "RATE_LIMITED", retryAfterMs: 30000 });
  await assert.rejects(api.readProfile({ username: "alpha", instagramUserId: "123" }, async () => { throw error; }), (caught) => caught === error);
});
