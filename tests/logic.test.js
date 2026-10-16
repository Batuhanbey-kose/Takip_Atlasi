const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const logic = require("../www/logic.js");

async function runAndroidCollector(fetchImpl, options = {}) {
  const script = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/assets/instagram-collector.js"),
    "utf8",
  );
  const result = new Promise((resolve) => {
    const sandbox = {
      AbortController,
      URL,
      URLSearchParams,
      document: { cookie: options.cookie ?? "ds_user_id=999; csrftoken=test-token" },
      fetch: fetchImpl,
    };
    sandbox.window = {
      __TAKIP_ATLASI_REQUESTED_USERNAME__: options.requestedUsername ?? "owner",
      __TAKIP_ATLASI_SESSION_USER_ID__: options.sessionUserId ?? "",
      __TAKIP_ATLASI_SCAN_TEMPO__: options.tempo,
      __TAKIP_ATLASI_VERIFIED_ACCOUNT__: options.preparedAccount,
      __TAKIP_ATLASI_WEBSITE_HEADERS__: options.websiteHeaders,
      __TAKIP_ATLASI_PAGE_SIZE__: options.pageSize,
      __TAKIP_WEB_OBSERVER__: options.observer,
      setTimeout: (callback, milliseconds) => {
        if (options.onTimer) {
          options.onTimer(milliseconds);
        }
        return setImmediate(callback);
      },
      clearTimeout: (handle) => clearImmediate(handle),
      TakipAtlasiNative: {
        postMessage: (rawMessage) => {
          const message = JSON.parse(rawMessage);
          if (options.onMessage) {
            options.onMessage(message, sandbox.window);
          }
          if (message.type === "complete" || message.type === "error") {
            resolve(message);
          }
        },
      },
    };
    vm.runInNewContext(script, sandbox, { filename: "instagram-collector.js" });
  });
  return Promise.race([
    result,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Android toplayıcı zaman aşımı")), 2000)),
  ]);
}

test("takip kategorilerini ve yenileme farklarını doğru hesaplar", () => {
  const current = {
    followers: [
      { username: "alice", timestamp: 4 },
      { username: "bob", timestamp: 3 },
      { username: "carol", timestamp: 2 },
    ],
    following: [
      { username: "bob", timestamp: 4 },
      { username: "dora", timestamp: 3 },
      { username: "eve", timestamp: 2 },
    ],
  };
  const previous = {
    followers: [
      { username: "alice", timestamp: 2 },
      { username: "bob", timestamp: 2 },
      { username: "zoe", timestamp: 2 },
    ],
    following: [
      { username: "bob", timestamp: 2 },
      { username: "dora", timestamp: 2 },
    ],
  };

  const analysis = logic.analyzeDataset(current, previous);
  assert.deepEqual(analysis.mutual.map((record) => record.username), ["bob"]);
  assert.deepEqual(
    analysis.notFollowingBack.map((record) => record.username),
    ["dora", "eve"],
  );
  assert.deepEqual(
    analysis.youDontFollowBack.map((record) => record.username),
    ["alice", "carol"],
  );
  assert.deepEqual(analysis.newFollowers.map((record) => record.username), ["carol"]);
  assert.deepEqual(analysis.lostFollowers.map((record) => record.username), ["zoe"]);
});

test("kullanıcı adı ve profil bağlantısını güvenli biçimde normalleştirir", () => {
  assert.equal(logic.normalizeUsername(" @My.Profile "), "my.profile");
  assert.equal(logic.normalizeUsername("https://instagram.com/My_Profile/?hl=tr"), "my_profile");
  assert.equal(logic.normalizeUsername("<script>"), "");
  assert.equal(logic.normalizeInstagramUserId("12345678901234567890"), "12345678901234567890");
  assert.equal(logic.normalizeInstagramUserId(12345678901234567890), "");
});

test("profil fotoğrafını güvenli CDN adresiyle korur ve analiz kaydına taşır", () => {
  const photoUrl = "https://scontent.cdninstagram.com/profile/alpha.jpg?token=1";
  assert.equal(logic.normalizeProfilePicUrl(photoUrl), photoUrl);
  assert.equal(logic.normalizeProfilePicUrl("javascript:alert(1)"), "");
  assert.equal(logic.normalizeProfilePicUrl("https://example.com/avatar.jpg"), "");

  const records = logic.dedupeRecords([
    { username: "alpha", timestamp: 1 },
    { username: "alpha", timestamp: 0, profilePicUrl: photoUrl },
  ]);
  assert.equal(records[0].profilePicUrl, photoUrl);

  const analysis = logic.analyzeDataset(
    { followers: records, following: [], profilePicUrl: "" },
    null,
  );
  assert.equal(analysis.followers[0].profilePicUrl, photoUrl);
});

test("arayüz kodunun kullandığı bütün element kimlikleri HTML içinde bulunur", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../www/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../www/index.html"), "utf8");
  const cacheList = appSource.match(/const ids = \[([\s\S]*?)\];/);

  assert.ok(cacheList, "Element kimliği listesi bulunamadı");
  const ids = Array.from(cacheList[1].matchAll(/"([A-Za-z][A-Za-z0-9]+)"/g), (match) => match[1]);
  ids.forEach((id) => assert.match(html, new RegExp(`id=["']${id}["']`), `${id} HTML içinde yok`));
});

test("Android yapılandırma dosyaları geçerli JSON içerir", () => {
  const files = [
    path.join(__dirname, "../capacitor.config.json"),
    path.join(__dirname, "../package.json"),
  ];

  files.forEach((file) => assert.doesNotThrow(() => JSON.parse(fs.readFileSync(file, "utf8"))));
});

test("PC arşiv analizi ve Android yerel toplayıcı ayrı çalışma yollarına sahiptir", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../www/app.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "../www/index.html"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../package.json"), "utf8"));

  assert.match(appSource, /getPlatform\?\.\(\) === "android"/);
  assert.match(appSource, /archive\.importFiles\(files\)/);
  assert.doesNotMatch(appSource, /\/api\/(?:health|extension|instagram|profile|follower)/);
  assert.match(html, /id="archiveInput" type="file"/);
  assert.doesNotMatch(html, /manifest\.webmanifest|Chrome köprüsü/);
  assert.equal(packageJson.scripts.start, "node scripts/serve.js");
});

test("sayaç sıralaması bütün listeyi kapsar ve hesap istekleri tek işçiyle sınırlıdır", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../www/app.js"), "utf8");
  const repositorySource = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/java/com/takipatlasi/app/InstagramAccountRepository.java"),
    "utf8",
  );

  assert.match(appSource, /queryMatches\.filter\(\(person\) => !visibleNames\.has\(person\.username\)\)/);
  assert.doesNotMatch(appSource, /queryMatches\.slice\(0, state\.limit\)/);
  assert.match(repositorySource, /MAX_METADATA_BATCH = 4/);
  assert.match(repositorySource, /METADATA_WORKERS = 1/);
});

test("Android yerel Instagram toplayıcısı sayfalı listeleri telefonda birleştirir", async () => {
  const script = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/assets/instagram-collector.js"),
    "utf8",
  );
  const messages = [];
  const requests = [];
  let finish;
  let fail;
  const completed = new Promise((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  const response = (payload, status = 200) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
  });
  const sandbox = {
    AbortController,
    URL,
    URLSearchParams,
    document: { cookie: "ds_user_id=999; csrftoken=test-token" },
    fetch: async (pathname) => {
      requests.push(pathname);
      if (pathname.startsWith("/api/v1/accounts/current_user/")) {
        return response({
          user: {
            pk: "999",
            username: "owner",
            follower_count: 3,
            following_count: 1,
            profile_pic_url: "https://scontent.cdninstagram.com/owner.jpg",
          },
        });
      }
      if (pathname.includes("/followers/")) {
        return pathname.includes("max_id=cursor-2")
          ? response({ users: [{ username: "beta" }, { username: "gamma" }] })
          : response({
              users: [{ username: "alpha" }, { username: "beta" }],
              next_max_id: "cursor-2",
            });
      }
      if (pathname.includes("/following/")) {
        return response({ users: [{ username: "beta" }] });
      }
      return response({}, 404);
    },
  };
  sandbox.window = {
    __TAKIP_ATLASI_REQUESTED_USERNAME__: "owner",
    setTimeout: (callback) => setImmediate(callback),
    clearTimeout: (handle) => clearImmediate(handle),
    TakipAtlasiNative: {
      postMessage: (rawMessage) => {
        const message = JSON.parse(rawMessage);
        messages.push(message);
        if (message.type === "complete") {
          finish(message);
        } else if (message.type === "error") {
          fail(new Error(message.message));
        }
      },
    },
  };

  vm.runInNewContext(script, sandbox, { filename: "instagram-collector.js" });
  const result = await Promise.race([
    completed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("Android toplayıcı zaman aşımı")), 2000)),
  ]);

  assert.equal(result.username, "owner");
  assert.equal(result.followersCount, 3);
  assert.equal(result.followingCount, 1);
  assert.equal(messages.filter((message) => message.type === "page").length, 3);
  assert.ok(requests.some((request) => request.includes("/friendships/999/followers/")));
  assert.ok(requests.some((request) => request.includes("max_id=cursor-2")));
  assert.ok(requests.every((request) => !request.includes("/users/999/info/")));
  assert.ok(requests.some((request) => request.includes("count=50")));
});

test("Android toplayıcı eksik sayaçları tamamlar ve sunucunun döndürdüğü sayfaları birleştirir", async () => {
  const requests = [];
  const response = (payload, status = 200) => ({
    ok: status === 200,
    status,
    json: async () => payload,
  });
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.startsWith("/api/v1/accounts/current_user/")) {
      return response({ user: { pk: "999", username: "owner" } });
    }
    if (pathname.includes("/users/999/info/")) {
      return response({}, 404);
    }
    if (pathname.includes("/users/web_profile_info/")) {
      return response({ data: { user: { id: "999", username: "owner", edge_followed_by: { count: 101 }, edge_follow: { count: 0 } } } });
    }
    if (pathname.includes("/followers/")) {
      return pathname.includes("max_id=next")
        ? response({ users: [{ username: "final.person" }] })
        : response({ users: Array.from({ length: 100 }, (_, index) => ({ username: `person.${index}` })), next_max_id: "next" });
    }
    return response({ users: [] });
  });

  assert.equal(result.type, "complete");
  assert.equal(result.followersCount, 101);
  assert.equal(result.followingCount, 0);
  assert.ok(requests.some((request) => request.includes("count=50")));
  assert.ok(requests.some((request) => request.includes("max_id=next")));
});

test("Dengeli ve hızlı tempolar liste sayfalarına ve istek aralıklarına uygulanır", async () => {
  for (const [tempo, minimum, maximum, size] of [
    [undefined, 600, 1000, 50], ["slow", 2000, 3000, 25], ["original", 1100, 2000, 50],
    ["steady", 600, 1000, 50], ["fast", 350, 600, 100], ["toString", 600, 1000, 50],
  ]) {
    const pauses = [];
    const requests = [];
    const result = await runAndroidCollector(async (pathname) => {
      requests.push(pathname);
      if (pathname.includes("/accounts/current_user/")) {
        return { ok: true, status: 200, json: async () => ({ user: { pk: "999", username: "owner", follower_count: 2, following_count: 0 } }) };
      }
      if (pathname.includes("/followers/")) {
        return { ok: true, status: 200, json: async () => pathname.includes("max_id=next")
          ? { users: [{ username: "beta" }] }
          : { users: [{ username: "alpha" }], next_max_id: "next" } };
      }
      return { ok: true, status: 200, json: async () => ({ users: [] }) };
    }, { tempo, onTimer: (milliseconds) => { if (milliseconds < 45000) pauses.push(milliseconds); } });

    assert.equal(result.type, "complete");
    assert.equal(requests.length, 4);
    assert.equal(pauses.length, 3, "Hesap sorgusu ile iki liste arasındaki geçişler de beklemeli");
    assert.ok(pauses.every((duration) => duration >= minimum && duration <= maximum));
    assert.ok(requests.filter((request) => request.includes("/friendships/")).every((request) => request.includes(`count=${size}`)));
  }
});

test("Doğrulanmış web profili eski hesap sorgularını atlar ve yalnızca izinli başlıkları kullanır", async () => {
  const requests = [];
  const result = await runAndroidCollector(async (pathname, options) => {
    requests.push(pathname);
    assert.ok(pathname.includes("/friendships/999/"));
    assert.ok(pathname.includes("count=50"));
    assert.equal(options.headers["X-ASBD-ID"], "test-asbd");
    assert.equal(options.headers["X-IG-WWW-Claim"], "test-claim");
    assert.equal(options.headers.Cookie, undefined);
    assert.equal(options.headers["User-Agent"], undefined);
    assert.equal(options.redirect, "manual");
    return { ok: true, status: 200, json: async () => ({ users: [{ username: "alpha" }] }) };
  }, {
    preparedAccount: { userId: "999", username: "owner", followerCount: 1, followingCount: 1 },
    websiteHeaders: { "X-ASBD-ID": "test-asbd", "X-IG-WWW-Claim": "test-claim", Cookie: "ignored", "User-Agent": "ignored" },
    pageSize: 12,
  });
  assert.equal(result.type, "complete");
  assert.equal(requests.length, 2);
});

function scanResponse(payload, status = 200) {
  return { ok: status === 200, status, headers: { get: () => status === 429 ? "30" : null }, json: async () => payload };
}

async function integratedScan(followers, following, profileReply, options = {}) {
  const messages = [];
  const requests = [];
  const result = await runAndroidCollector(async (pathname, request) => {
    requests.push({ pathname, ...request });
    if (pathname === "/api/graphql") return profileReply(request.body);
    return scanResponse({ users: pathname.includes("/followers/") ? followers : following });
  }, {
    preparedAccount: { userId: "999", username: "owner", followerCount: followers.length, followingCount: following.length },
    websiteHeaders: { "X-ASBD-ID": "site-asbd" },
    observer: { readProfile: async (record, request) => (await request("/api/graphql", {
      method: "POST", body: record.username, headers: { "x-asbd-id": "site-asbd", "x-csrftoken": "test-token" },
    })).user },
    ...options,
    onMessage: (message, window) => { messages.push(message); options.onMessage?.(message, window); },
  });
  const records = (relationship) => new Map(messages.filter((message) => message.type === "page" && message.relationship === relationship)
    .flatMap((message) => message.users).map((record) => [record.username, record]));
  return { result, requests, messages, records };
}

test("Liste yanıtındaki takipçi sayıları ve sıfır değerleri aynı taramada ek sorgusuz korunur", async () => {
  const scan = await integratedScan(
    [{ username: "alpha", pk: "1", follower_count: 25 }, { username: "beta", pk: "2", follower_count: 0 }],
    [{ username: "alpha", pk: "1" }],
    () => { throw new Error("Liste sayacı varken profil isteği gönderilmemeli"); },
  );
  assert.equal(scan.result.type, "complete");
  assert.equal(scan.requests.length, 2);
  assert.equal(scan.records("following").get("alpha").followerCount, 25);
  assert.equal(scan.records("followers").get("beta").followerCount, 0);
  assert.equal(scan.result.profilesReady, 2);
  assert.equal(scan.result.profilesTotal, 2);
});

test("Eksik profil sayaçları sayfalar arasında alınır; karşılıklı kişi tekrar sorgulanmaz", async () => {
  const scan = await integratedScan(
    [{ username: "alpha", pk: "1" }, { username: "beta", pk: "2" }], [{ username: "alpha", pk: "1" }],
    (name) => scanResponse({ user: { username: name, instagramUserId: name === "alpha" ? "1" : "2", followerCount: name === "alpha" ? 42 : 0 } }),
  );
  assert.equal(scan.result.type, "complete");
  assert.deepEqual(scan.requests.map((request) => request.pathname === "/api/graphql" ? request.body : /\/(followers|following)\//.exec(request.pathname)[1]),
    ["followers", "alpha", "beta", "following"]);
  assert.equal(scan.records("followers").get("alpha").followerCount, 42);
  assert.equal(scan.records("following").get("alpha").followerCount, 42);
  assert.equal(scan.result.profilesReady, 2);
  for (const request of scan.requests) {
    assert.equal(Object.keys(request.headers).filter((name) => name.toLowerCase() === "x-asbd-id").length, 1);
  }
});

test("Tarama içindeki profil sorgusu 429 alırsa başka listeye veya profile geçilmez", async () => {
  const scan = await integratedScan([{ username: "alpha", pk: "1" }, { username: "beta", pk: "2" }], [{ username: "alpha", pk: "1" }], () => scanResponse({}, 429));
  assert.equal(scan.result.code, "RATE_LIMITED");
  assert.equal(scan.result.retryAfterMs, 30000);
  assert.equal(scan.requests.length, 2);
  assert.ok(scan.messages.every((message) => message.type !== "complete"));
});

test("Erişilemeyen tek profil sıfır yapılmaz ve diğer profil sayaçlarını engellemez", async () => {
  const scan = await integratedScan([{ username: "alpha", pk: "1" }, { username: "beta", pk: "2" }], [{ username: "alpha", pk: "1" }],
    (name) => name === "alpha" ? scanResponse({}, 404) : scanResponse({ user: { username: name, instagramUserId: "2", followerCount: 19 } }));
  assert.equal(scan.result.type, "complete");
  assert.equal(scan.result.profilesReady, 1);
  assert.equal(scan.records("followers").get("alpha").followerCount, null);
  assert.equal(scan.records("following").get("alpha").followerCount, null);
  assert.equal(scan.records("followers").get("beta").followerCount, 19);
  assert.equal(scan.requests.filter((request) => request.body === "alpha").length, 1);
});

test("Başka kimliğin profil sayacı listeye eklenmez", async () => {
  const scan = await integratedScan([{ username: "alpha", pk: "1" }], [],
    () => scanResponse({ user: { username: "alpha", instagramUserId: "77", followerCount: 900 } }));
  assert.equal(scan.result.type, "complete");
  assert.equal(scan.result.profilesReady, 0);
  assert.equal(scan.records("followers").get("alpha").followerCount, null);
});

test("Sayaç toplarken durdurma yeni profil isteğini ve tamamlandı mesajını engeller", async () => {
  const scan = await integratedScan([{ username: "alpha", pk: "1" }, { username: "beta", pk: "2" }], [],
    (name) => scanResponse({ user: { username: name, instagramUserId: "1", followerCount: 5 } }), {
      onMessage: (message, window) => { if (message.type === "progress" && message.profilesReady === 1) window.__TAKIP_ATLASI_NATIVE_CANCELLED__ = true; },
    });
  assert.equal(scan.result.code, "CANCELLED");
  assert.equal(scan.requests.length, 2);
});

test("100 hesap istenirken sunucunun küçük sayfaları eksiksiz birleştirilir", async () => {
  const requests = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    const offset = Number(new URL(pathname, "https://www.instagram.com").searchParams.get("max_id")) || 0;
    const users = pathname.includes("/followers/") ? Array.from({ length: Math.min(12, 61 - offset) }, (_, index) => ({ username: `person.${offset + index}`, pk: String(offset + index + 1), follower_count: 0 })) : [];
    return scanResponse({ users, ...(offset + users.length < 61 && users.length ? { next_max_id: String(offset + users.length) } : {}) });
  }, { tempo: "fast", preparedAccount: { userId: "999", username: "owner", followerCount: 61, followingCount: 0 } });
  assert.equal(result.type, "complete");
  assert.equal(result.followersCount, 61);
  assert.equal(result.profilesReady, 61);
  assert.equal(requests.length, 7);
  assert.ok(requests.every((request) => request.includes("count=100")));
});

test("API yönlendirmesi HTML veya kullanıcı adı hatası diye gizlenmez", async () => {
  let requests = 0;
  const result = await runAndroidCollector(async () => {
    requests += 1;
    return { status: 0, type: "opaqueredirect", ok: false };
  });
  assert.equal(result.code, "API_REDIRECT");
  assert.equal(requests, 1);
});

test("Android toplayıcı hesap uçları reddedilince oturum kimliğiyle eşleşen kullanıcı adını doğrular", async () => {
  const requests = [];
  const response = (payload, status = 200) => ({
    ok: status === 200,
    status,
    json: async () => payload,
  });
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("/accounts/current_user/") || pathname.includes("/users/999/info/")) {
      return response({}, 404);
    }
    if (pathname.includes("/users/web_profile_info/")) {
      return response({ data: { user: { id: "999", username: "owner", edge_followed_by: { count: 1 }, edge_follow: { count: 1 } } } });
    }
    return response({ users: [{ username: "alpha" }] });
  });

  assert.equal(result.type, "complete");
  assert.equal(result.username, "owner");
  assert.equal(result.followersCount, 1);
  assert.equal(result.followingCount, 1);
  assert.ok(requests.some((request) => request.includes("web_profile_info/?username=owner")));
  assert.ok(requests.some((request) => request.includes("/followers/")));
});

test("Android toplayıcı düzenleme uç noktası kapalıyken temel hesap yanıtını dener", async () => {
  const requests = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("edit=true")) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    if (pathname === "/api/v1/accounts/current_user/") {
      return { ok: true, status: 200, json: async () => ({ user: { pk_id: "999", username: "owner", follower_count: 0, following_count: 0 } }) };
    }
    return { ok: true, status: 200, json: async () => ({ users: [] }) };
  });

  assert.equal(result.type, "complete");
  assert.ok(requests.includes("/api/v1/accounts/current_user/"));
  assert.ok(requests.every((request) => !request.includes("/users/web_profile_info/")));
});

test("Ekrandaki 400, 400, 429 akışı kullanıcı adı hatasına dönüştürülmez ve durur", async () => {
  const requests = [];
  const messages = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("/users/999/info/")) {
      return {
        ok: false, status: 429,
        headers: { get: () => "120" },
        json: async () => { throw new Error("HTML yanıtı JSON olarak okunmamalı"); },
      };
    }
    return { ok: false, status: 400, json: async () => ({}) };
  }, { requestedUsername: "", onMessage: (message) => messages.push(message) });

  assert.equal(result.type, "error");
  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(result.retryAfterMs, 120000);
  assert.match(result.message, /HTTP 429/);
  assert.doesNotMatch(result.message, /kullanıcı adını yaz|JSON yok/);
  assert.equal(requests.length, 3);
  assert.ok(messages.every((message) => !["page", "complete"].includes(message.type)));
});

test("Liste isteğindeki 429 tek istekten sonra durur ve diğer listeye geçmez", async () => {
  const requests = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("/accounts/current_user/")) {
      return { ok: true, status: 200, json: async () => ({ user: { pk: "999", username: "owner", follower_count: 1, following_count: 0 } }) };
    }
    return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) };
  });

  assert.equal(result.code, "RATE_LIMITED");
  assert.equal(result.retryAfterMs, 900000);
  assert.equal(requests.filter((request) => request.includes("/followers/")).length, 1);
  assert.ok(requests.every((request) => !request.includes("/following/")));
});

test("Retry-After HTTP tarihi desteklenir, aşırı bekleme süresi sınırlandırılır", async () => {
  const future = new Date(Date.now() + 120000).toUTCString();
  const result = await runAndroidCollector(async () => ({
    ok: false, status: 429, headers: { get: () => future }, json: async () => ({}),
  }));
  assert.equal(result.code, "RATE_LIMITED");
  assert.ok(result.retryAfterMs > 110000 && result.retryAfterMs <= 120000);
  const excessive = await runAndroidCollector(async () => ({
    ok: false, status: 429, headers: { get: () => "999999999999" }, json: async () => ({}),
  }));
  assert.equal(excessive.retryAfterMs, 86400000);
});

test("Geçersiz oturum yanıtından sonra alternatif uçlara istek gönderilmez", async () => {
  let count = 0;
  const result = await runAndroidCollector(async () => {
    count += 1;
    return { ok: false, status: 401, json: async () => ({ message: "login_required" }) };
  });
  assert.equal(result.code, "SESSION_REQUIRED");
  assert.equal(count, 1);
});

test("400 yanıtındaki istemci uyumsuzluğu kullanıcı adı hatası diye gösterilmez", async () => {
  let count = 0;
  const result = await runAndroidCollector(async () => {
    count += 1;
    return { ok: false, status: 400, json: async () => ({ status: "fail", message: "useragent mismatch; sessionid=private-value" }) };
  });
  assert.equal(result.code, "UNSUPPORTED_CLIENT");
  assert.match(result.message, /istemci uyumsuzluğu/);
  assert.doesNotMatch(result.message, /private-value|sessionid/);
  assert.equal(count, 1);
});

test("Android toplayıcı büyük hesap numarasını yuvarlamaz ve yerel WebView kimliğini doğrular", async () => {
  const exactId = "12345678901234567890";
  const requests = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("/users/web_profile_info/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { user: { pk: Number(exactId), id: exactId, username: "owner", follower_count: 0, following_count: 0 } } }),
      };
    }
    if (pathname.includes("/friendships/")) {
      return { ok: true, status: 200, json: async () => ({ users: [] }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }, { cookie: "csrftoken=test-token", sessionUserId: exactId });

  assert.equal(result.type, "complete");
  assert.ok(requests.some((request) => request.includes(`/friendships/${exactId}/followers/`)));
  assert.ok(requests.every((request) => !request.includes(`/friendships/${Number(exactId)}/`)));
});

test("Android toplayıcı yuvarlanmış hesap numarasını kimlik doğrulaması saymaz", async () => {
  const exactId = "12345678901234567890";
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.includes("/users/web_profile_info/")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { user: { pk: Number(exactId), username: "owner", follower_count: 0, following_count: 0 } } }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  }, { cookie: "csrftoken=test-token", sessionUserId: exactId });

  assert.equal(result.type, "error");
  assert.match(result.message, /profil:kimlik farklı/);
});

test("Android toplayıcı API engelini tanılanabilir ama çerezsiz mesajla bildirir", async () => {
  const result = await runAndroidCollector(async () => ({
    ok: false,
    status: 403,
    json: async () => ({}),
  }));

  assert.equal(result.type, "error");
  assert.equal(result.code, "REQUEST_DENIED");
  assert.match(result.message, /hesap:HTTP 403/);
  assert.doesNotMatch(result.message, /temel:|profil:/);
  assert.doesNotMatch(result.message, /ds_user_id|sessionid|test-token/);
});

test("Android toplayıcı çerezde kullanıcı kimliği yokken doğrulanmış hesap yanıtını kullanır", async () => {
  const response = (payload, status = 200) => ({ ok: status === 200, status, json: async () => payload });
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.includes("/accounts/current_user/")) {
      return response({ user: { pk: "999" } });
    }
    if (pathname.includes("/users/999/info/")) {
      return response({}, 404);
    }
    if (pathname.includes("/users/web_profile_info/")) {
      return response({ data: { user: { id: "999", username: "owner", follower_count: 0, following_count: 0 } } });
    }
    return response({ users: [] });
  }, { cookie: "csrftoken=test-token" });

  assert.equal(result.type, "complete");
  assert.equal(result.username, "owner");
});

test("Android toplayıcı başka hesaba ait web profilini oturum sahibi saymaz", async () => {
  const response = (payload, status = 200) => ({ ok: status === 200, status, json: async () => payload });
  const requests = [];
  const result = await runAndroidCollector(async (pathname) => {
    requests.push(pathname);
    if (pathname.includes("/users/web_profile_info/")) {
      return response({ data: { user: { id: "123", username: "owner", follower_count: 1, following_count: 1 } } });
    }
    return response({}, 404);
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /profil:kimlik farklı/);
  assert.ok(requests.every((request) => !request.includes("/followers/")));
});

test("Android toplayıcı kullanıcı adı boşken doğrulanamayan hesabı tahmin etmez", async () => {
  const response = (payload, status = 200) => ({ ok: status === 200, status, json: async () => payload });
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.includes("/accounts/current_user/")) {
      return response({ user: { pk: "999" } });
    }
    return response({}, 404);
  }, { requestedUsername: "" });

  assert.equal(result.type, "error");
  assert.match(result.message, /Profil alanına kullanıcı adını yazıp tekrar dene/);
});

test("Android toplayıcı başka hesaba ait web sayaçlarını kabul etmez", async () => {
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.startsWith("/api/v1/accounts/current_user/")) {
      return response({ user: { pk: "999", username: "owner" } });
    }
    if (pathname.includes("/users/web_profile_info/")) {
      return response({ data: { user: { id: "123", username: "owner", follower_count: 0, following_count: 0 } } });
    }
    return response({});
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /liste toplamlarını doğrulayamadı/);
});

test("Android toplayıcı has_more işaretli son sayfayı tamamlanmış saymaz", async () => {
  const response = (payload) => ({ ok: true, status: 200, json: async () => payload });
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.startsWith("/api/v1/accounts/current_user/")) {
      return response({ user: { pk: "999", username: "owner", follower_count: 1, following_count: 0 } });
    }
    return response({ users: [{ username: "alpha" }], has_more: true });
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /sayfalarını tamamlamadı/);
});

test("IndexedDB kayıt hatası sessizce farklı bir depoya geçip listeyi kaybettirmez", async () => {
  const script = fs.readFileSync(path.join(__dirname, "../www/storage.js"), "utf8");
  let failWrite = true;
  let fallbackWrites = 0;
  let savedProfile = null;
  const database = {
    transaction: () => {
      const transaction = {
        objectStore: () => ({
          put: (entry) => {
            setImmediate(() => {
              if (failWrite) {
                transaction.error = new Error("storage full");
                transaction.onabort();
              } else {
                savedProfile = entry.value;
                transaction.oncomplete();
              }
            });
          },
        }),
      };
      return transaction;
    },
  };
  const sandbox = {
    indexedDB: {
      open: () => {
        const request = { result: database };
        setImmediate(() => request.onsuccess());
        return request;
      },
    },
    localStorage: { setItem: () => { fallbackWrites += 1; } },
  };
  vm.runInNewContext(script, sandbox, { filename: "storage.js" });

  failWrite = false;
  await sandbox.TakipStorage.saveProfile({ username: "owner" });
  failWrite = true;
  await assert.rejects(sandbox.TakipStorage.addSnapshot({ id: "first", username: "owner" }), /storage full/);
  await assert.rejects(sandbox.TakipStorage.saveProfile({ username: "owner" }), /storage full/);
  failWrite = false;
  await sandbox.TakipStorage.saveProfile({ username: "owner" });
  assert.equal(savedProfile.username, "owner");
  assert.equal(fallbackWrites, 0);
});

test("Android toplayıcı biçimi değişmiş listeyi eksik veri olarak kaydetmez", async () => {
  const result = await runAndroidCollector(async (pathname) => {
    const ok = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    });
    if (pathname.startsWith("/api/v1/accounts/current_user/")) {
      return ok({ user: { pk: "999", username: "owner", follower_count: 10, following_count: 1 } });
    }
    if (pathname.includes("/api/v1/users/999/info/")) {
      return ok({ user: { pk: "999", username: "owner", follower_count: 10, following_count: 1 } });
    }
    return ok({ status: "ok" });
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /liste biçimini değiştirdi/);
});

test("Android toplayıcı cursor kesilince kısmi listeyi tamamlanmış saymaz", async () => {
  const result = await runAndroidCollector(async (pathname) => {
    const ok = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    });
    if (pathname.startsWith("/api/v1/accounts/current_user/") || pathname.includes("/api/v1/users/999/info/")) {
      return ok({
        user: {
          pk: "999",
          username: "owner",
          follower_count: 1000,
          following_count: 1,
        },
      });
    }
    if (pathname.includes("/followers/")) {
      return ok({ users: [{ username: "alpha" }] });
    }
    return ok({ users: [{ username: "beta" }] });
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /listesini eksik döndürdü/);
});

test("Android toplayıcı küçük Instagram sayaç farkını güvenle kabul eder", async () => {
  const result = await runAndroidCollector(async (pathname) => {
    const ok = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    });
    if (pathname.startsWith("/api/v1/accounts/current_user/") || pathname.includes("/api/v1/users/999/info/")) {
      return ok({
        user: {
          pk: "999",
          username: "owner",
          follower_count: 2,
          following_count: 480,
        },
      });
    }
    if (pathname.includes("/followers/")) {
      return ok({ users: [{ username: "alpha" }, { username: "beta" }] });
    }
    return ok({
      users: Array.from({ length: 478 }, (_, index) => ({ username: `account.${index}` })),
    });
  });

  assert.equal(result.type, "complete");
  assert.equal(result.followersCount, 2);
  assert.equal(result.followingCount, 478);
});

test("Android toplayıcı büyük sayaç farkını yine reddeder", async () => {
  const result = await runAndroidCollector(async (pathname) => {
    const ok = (payload) => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => payload,
    });
    if (pathname.startsWith("/api/v1/accounts/current_user/") || pathname.includes("/api/v1/users/999/info/")) {
      return ok({
        user: {
          pk: "999",
          username: "owner",
          follower_count: 2,
          following_count: 480,
        },
      });
    }
    if (pathname.includes("/followers/")) {
      return ok({ users: [{ username: "alpha" }, { username: "beta" }] });
    }
    return ok({
      users: Array.from({ length: 400 }, (_, index) => ({ username: `account.${index}` })),
    });
  });

  assert.equal(result.type, "error");
  assert.match(result.message, /400\/480/);
});

test("Android toplayıcı hesap kimliğini doğrulamadan istenen kullanıcı adına düşmez", async () => {
  const result = await runAndroidCollector(async () => ({
    ok: false,
    status: 500,
    headers: { get: () => null },
    json: async () => ({}),
  }));

  assert.equal(result.type, "error");
  assert.match(result.message, /hesap:HTTP 500/);
});

test("Android toplayıcı eklentisi uygulamaya kayıtlı ve Instagram kökenine sınırlı", () => {
  const mainActivity = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/java/com/takipatlasi/app/MainActivity.java"),
    "utf8",
  );
  const plugin = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/java/com/takipatlasi/app/InstagramCollectorPlugin.java"),
    "utf8",
  );
  const capacitorConfig = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../capacitor.config.json"), "utf8"),
  );

  assert.match(mainActivity, /registerPlugin\(InstagramCollectorPlugin\.class\)/);
  assert.match(plugin, /@CapacitorPlugin\(name = "InstagramCollector"\)/);
  assert.match(plugin, /Collections\.singleton\("https:\/\/www\.instagram\.com"\)/);
  assert.match(plugin, /JSONObject\.quote\(sessionUserId\(\)\)/);
  assert.match(plugin, /MAX_PAGE_USERS = 100/);
  assert.doesNotMatch(plugin, /addJavascriptInterface/);
  assert.equal(capacitorConfig.android.minWebViewVersion, 86);
});
