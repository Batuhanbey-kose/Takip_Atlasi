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
      setTimeout: (callback) => setImmediate(callback),
      clearTimeout: (handle) => clearImmediate(handle),
      TakipAtlasiNative: {
        postMessage: (rawMessage) => {
          const message = JSON.parse(rawMessage);
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

test("sayaç sıralaması listedeki bütün hesapları paralel işler", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "../www/app.js"), "utf8");
  const repositorySource = fs.readFileSync(
    path.join(__dirname, "../android/app/src/main/java/com/takipatlasi/app/InstagramAccountRepository.java"),
    "utf8",
  );

  assert.match(appSource, /metadataSort \|\| metadataFilter \? queryMatches : visible/);
  assert.doesNotMatch(appSource, /queryMatches\.slice\(0, state\.limit\)/);
  assert.match(repositorySource, /MAX_METADATA_BATCH = 24/);
  assert.match(repositorySource, /METADATA_WORKERS = 4/);
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
  assert.ok(requests.some((request) => request.includes("count=100")));
});

test("Android toplayıcı eksik sayaçları doğrulanmış web profilinden tamamlar ve 100 kişilik sayfaları okur", async () => {
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
      return response({}, 403);
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
  assert.ok(requests.some((request) => request.includes("count=100")));
  assert.ok(requests.some((request) => request.includes("max_id=next")));
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
      return response({}, 403);
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
      return { ok: false, status: 403, json: async () => ({}) };
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
    return { ok: false, status: 403, json: async () => ({}) };
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
    return { ok: false, status: 403, json: async () => ({}) };
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
  assert.match(result.message, /hesap:HTTP 403/);
  assert.match(result.message, /temel:HTTP 403/);
  assert.match(result.message, /profil:HTTP 403/);
  assert.doesNotMatch(result.message, /ds_user_id|sessionid|test-token/);
});

test("Android toplayıcı çerezde kullanıcı kimliği yokken doğrulanmış hesap yanıtını kullanır", async () => {
  const response = (payload, status = 200) => ({ ok: status === 200, status, json: async () => payload });
  const result = await runAndroidCollector(async (pathname) => {
    if (pathname.includes("/accounts/current_user/")) {
      return response({ user: { pk: "999" } });
    }
    if (pathname.includes("/users/999/info/")) {
      return response({}, 403);
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
    return response({}, 403);
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
    return response({}, 403);
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
