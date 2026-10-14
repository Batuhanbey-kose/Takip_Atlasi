(function startTakipAtlasiAndroidCollector() {
  "use strict";

  if (window.__TAKIP_ATLASI_NATIVE_RUNNING__) {
    return;
  }

  const bridge = window.TakipAtlasiNative;
  if (!bridge || typeof bridge.postMessage !== "function") {
    return;
  }

  window.__TAKIP_ATLASI_NATIVE_RUNNING__ = true;
  window.__TAKIP_ATLASI_NATIVE_CANCELLED__ = false;

  const APP_ID = "936619743392459";
  const MAX_PAGES = 300;
  const MAX_COUNT_DRIFT = 25;
  const scanTempos = {
    slow: { minDelay: 2000, maxDelay: 3000 },
    original: { minDelay: 1100, maxDelay: 2000 },
    steady: { minDelay: 900, maxDelay: 1500 },
  };
  const tempoName = ["slow", "original", "steady"].includes(window.__TAKIP_ATLASI_SCAN_TEMPO__)
    ? window.__TAKIP_ATLASI_SCAN_TEMPO__ : "slow";
  const scanTempo = scanTempos[tempoName];
  const pageSize = [12, 25, 50].includes(window.__TAKIP_ATLASI_PAGE_SIZE__)
    ? window.__TAKIP_ATLASI_PAGE_SIZE__ : 50;
  let requestedOnce = false;
  const requestedUsername = normalizeUsername(
    window.__TAKIP_ATLASI_REQUESTED_USERNAME__,
  );
  const sessionUserId = normalizeUserId(window.__TAKIP_ATLASI_SESSION_USER_ID__) ||
    normalizeUserId(readCookie("ds_user_id"));
  let latestStatus = {
    phase: "profile",
    message: "Instagram hesabı doğrulanıyor...",
    progress: 16,
    followersCount: 0,
    followingCount: 0,
  };

  function send(type, payload) {
    bridge.postMessage(JSON.stringify({ type, ...(payload || {}) }));
  }

  function update(patch) {
    latestStatus = { ...latestStatus, ...patch };
    send("progress", latestStatus);
  }

  function pause(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  }

  function randomPause() {
    return pause(scanTempo.minDelay + Math.floor(Math.random() * (scanTempo.maxDelay - scanTempo.minDelay + 1)));
  }

  function ensureActive() {
    if (window.__TAKIP_ATLASI_NATIVE_CANCELLED__) {
      const error = new Error("Tarama durduruldu.");
      error.code = "CANCELLED";
      throw error;
    }
  }

  function normalizeUsername(value) {
    const username = String(value || "").trim().replace(/^@/, "").toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(username) ? username : "";
  }

  function normalizeUserId(value) {
    // Instagram also returns numeric IDs. Once a JSON number exceeds 2^53 - 1,
    // converting it to a string silently changes the ID and breaks verification.
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      return "";
    }
    const userId = String(value || "").trim();
    return /^\d{1,30}$/.test(userId) ? userId : "";
  }

  function userIdFrom(user) {
    if (!user) {
      return "";
    }
    return normalizeUserId(user.pk_id) || normalizeUserId(user.id) || normalizeUserId(user.pk);
  }

  function normalizeCount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : null;
  }

  function normalizeProfilePicUrl(value) {
    try {
      const url = new URL(String(value || ""));
      const hostname = url.hostname.toLowerCase();
      const allowed =
        hostname === "instagram.com" ||
        hostname.endsWith(".instagram.com") ||
        hostname.endsWith(".cdninstagram.com") ||
        hostname.endsWith(".fbcdn.net");
      return url.protocol === "https:" && allowed && url.href.length <= 3000
        ? url.href
        : "";
    } catch (error) {
      return "";
    }
  }

  function readCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
    try {
      return match ? decodeURIComponent(match[1]) : "";
    } catch (error) {
      return "";
    }
  }

  function requestDiagnostic(error) {
    if (Number.isInteger(error && error.httpStatus)) {
      const reason = error.responseKind === "json" ? "/JSON yok" :
        error.responseKind === "fail" ? "/başarısız" : "";
      return `HTTP ${error.httpStatus}${reason}`;
    }
    return error && /zaman aşımına/i.test(error.message) ? "zaman aşımı" : "bağlantı hatası";
  }

  function retryDelay(response) {
    const value = response.headers && response.headers.get("Retry-After");
    const seconds = /^\d+(?:\.\d+)?$/.test(String(value || "")) ? Number(value) : NaN;
    const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
    return Number.isFinite(milliseconds) && milliseconds > 0
      ? Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.ceil(milliseconds)))
      : 15 * 60 * 1000;
  }

  function responseError(response, payload) {
    const status = response.status;
    // Never echo the raw server message: it can contain private values. Keep only
    // known error categories so a rejected client is not mistaken for a bad username.
    const signal = `${payload && payload.error_type || ""} ${payload && payload.message || ""}`.toLowerCase();
    let code = "REQUEST_REJECTED";
    let message = `Instagram isteği reddetti (HTTP ${status}).`;
    if (status === 429 || /rate_limit|feedback_required|please wait|too many requests/.test(signal)) {
      code = "RATE_LIMITED";
      message = `Instagram istekleri geçici olarak sınırladı (HTTP ${status}). Tarama durduruldu; bekleme süresi dolmadan yeni istek gönderilmeyecek.`;
    } else if (/challenge_required|checkpoint_required/.test(signal)) {
      code = "VERIFICATION_REQUIRED";
      message = `Instagram ek hesap doğrulaması istiyor (HTTP ${status}). Instagram giriş ekranında doğrulamayı tamamla.`;
    } else if (status === 401 || /login_required/.test(signal)) {
      code = "SESSION_REQUIRED";
      message = `Instagram oturumu kabul etmedi (HTTP ${status}). Instagram girişini yeniden tamamla.`;
    } else if (status === 403) {
      code = "REQUEST_DENIED";
      message = "Instagram bu isteğe erişimi reddetti (HTTP 403). Tarama durduruldu.";
    } else if (/useragent mismatch|user.agent mismatch|unsupported client/.test(signal)) {
      code = "UNSUPPORTED_CLIENT";
      message = `Instagram uygulamanın bağlantı türünü kabul etmedi (HTTP ${status}, istemci uyumsuzluğu). Kullanıcı adını değiştirmek bu hatayı çözmez.`;
    } else if (!payload && status === 200) {
      code = "RESPONSE_FORMAT";
      message = "Instagram hesap verisi yerine farklı bir sayfa döndürdü (HTTP 200, JSON yok).";
    }
    const error = new Error(message);
    error.code = code;
    error.httpStatus = status;
    error.responseKind = code === "RATE_LIMITED" ? "http" :
      !payload ? "json" : payload.status === "fail" ? "fail" : "http";
    if (code === "RATE_LIMITED") {
      error.retryAfterMs = retryDelay(response);
    }
    return error;
  }

  async function instagramRequest(pathname) {
    ensureActive();
    if (requestedOnce) {
      await randomPause();
      ensureActive();
    }
    requestedOnce = true;
    const csrfToken = readCookie("csrftoken");
    const headers = {
      Accept: "*/*",
      "X-IG-App-ID": APP_ID,
      "X-Requested-With": "XMLHttpRequest",
    };
    const websiteHeaders = window.__TAKIP_ATLASI_WEBSITE_HEADERS__ || {};
    ["X-IG-App-ID", "X-ASBD-ID", "X-IG-WWW-Claim", "X-Web-Session-ID", "X-CSRFToken"].forEach((name) => {
      const value = websiteHeaders[name];
      if (typeof value === "string" && value.length <= 4000) headers[name] = value;
    });
    if (csrfToken) {
      headers["X-CSRFToken"] = csrfToken;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45000);
    try {
      let response;
      try {
        response = await fetch(pathname, {
          method: "GET",
          credentials: "include",
          redirect: "manual",
          headers,
          signal: controller.signal,
        });
      } catch (cause) {
        ensureActive();
        const error = new Error(cause && cause.name === "AbortError"
          ? "Instagram isteği zaman aşımına uğradı. İnternet bağlantını kontrol et."
          : "Instagram'a bağlantı kurulamadı. İnternet bağlantını kontrol et.");
        error.code = cause && cause.name === "AbortError" ? "TIMEOUT" : "NETWORK_ERROR";
        throw error;
      }
      ensureActive();
      if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400)) {
        const error = new Error("Instagram veri isteğini API yanıtı yerine başka bir sayfaya yönlendirdi. Bu sorgu geçerli veri döndürmüyor.");
        error.code = "API_REDIRECT";
        throw error;
      }
      // Respect a rate limit immediately, even when the response body is HTML.
      if (response.status === 429) {
        throw responseError(response, null);
      }
      let payload = null;
      try {
        payload = await response.json();
      } catch (cause) {
        payload = null;
      }
      ensureActive();
      if (!response.ok || !payload || payload.status === "fail") {
        throw responseError(response, payload);
      }
      return payload;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function currentAccount() {
    const prepared = window.__TAKIP_ATLASI_VERIFIED_ACCOUNT__;
    if (prepared && sessionUserId && normalizeUserId(prepared.userId) === sessionUserId &&
      normalizeUsername(prepared.username) && (!requestedUsername || normalizeUsername(prepared.username) === requestedUsername) &&
      normalizeCount(prepared.followerCount) !== null && normalizeCount(prepared.followingCount) !== null) {
      return { userId: sessionUserId, username: normalizeUsername(prepared.username),
        profilePicUrl: normalizeProfilePicUrl(prepared.profilePicUrl),
        followerCount: normalizeCount(prepared.followerCount), followingCount: normalizeCount(prepared.followingCount) };
    }
    let user = null;
    const checks = [];
    async function accountRequest(label, path) {
      update({ phase: "profile", message: `Instagram hesap sorgusu: ${label}...` });
      try {
        const payload = await instagramRequest(path);
        checks.push(`${label}:OK`);
        return payload;
      } catch (error) {
        if (["RATE_LIMITED", "SESSION_REQUIRED", "REQUEST_DENIED", "VERIFICATION_REQUIRED",
          "UNSUPPORTED_CLIENT", "API_REDIRECT", "TIMEOUT", "NETWORK_ERROR", "CANCELLED"].includes(error.code)) {
          error.message += ` (${label}:${requestDiagnostic(error)})`;
          throw error;
        }
        checks.push(`${label}:${requestDiagnostic(error)}`);
        return null;
      }
    }
    const current = await accountRequest("hesap", "/api/v1/accounts/current_user/?edit=true");
    if (current) {
      user = current.user || current.form_data || current;
    }
    if (!userIdFrom(user) || !normalizeUsername(user && user.username) ||
      profileCount(user, "follower_count", "edge_followed_by") === null ||
      profileCount(user, "following_count", "edge_follow") === null) {
      const basic = await accountRequest("temel", "/api/v1/accounts/current_user/");
      const basicUser = basic && (basic.user || basic.form_data || basic);
      const previousId = userIdFrom(user);
      const basicId = userIdFrom(basicUser);
      if (basicUser && (!previousId || !basicId || previousId === basicId)) {
        user = { ...(user || {}), ...basicUser };
      } else if (basicUser) {
        checks.push("temel:kimlik farklı");
      }
    }

    const initialUserId = userIdFrom(user) || sessionUserId;
    // The current-user endpoint already includes counts on some Instagram versions.
    // Avoid a second request unless the account identity or totals are missing.
    if (initialUserId && (!normalizeUsername(user && user.username) ||
      profileCount(user, "follower_count", "edge_followed_by") === null ||
      profileCount(user, "following_count", "edge_follow") === null)) {
      const payload = await accountRequest(
        "detay",
        `/api/v1/users/${encodeURIComponent(initialUserId)}/info/`,
      );
      const detailedUser = payload && (payload.user || payload);
      if (detailedUser && userIdFrom(detailedUser) === initialUserId &&
        normalizeUsername(detailedUser.username)) {
        user = { ...(user || {}), ...detailedUser };
      } else if (detailedUser) {
        checks.push("detay:kimlik farklı");
      }
    }

    const userId = userIdFrom(user) || sessionUserId;
    let username = normalizeUsername(user && user.username);
    if (!userId) {
      throw new Error(`Instagram hesap kimliği okunamadı (${checks.join(", ")}). Oturumu kapatıp yeniden giriş yap.`);
    }
    if (!username && requestedUsername) {
      const payload = await accountRequest(
        "profil",
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(requestedUsername)}`,
      );
      const webUser = payload && (payload.data?.user || payload.graphql?.user || payload.user);
      if (webUser && userIdFrom(webUser) === userId &&
        normalizeUsername(webUser.username) === requestedUsername) {
        user = { ...(user || {}), ...webUser };
        username = requestedUsername;
      } else if (payload) {
        checks.push("profil:kimlik farklı veya kullanıcı yok");
      }
    }
    if (!username) {
      throw new Error(requestedUsername
        ? `Instagram kullanıcı adı doğrulanamadı (${checks.join(", ")}). Hesap API'si reddedildiyse Instagram oturumunu yenile.`
        : `Instagram kullanıcı adı okunamadı (${checks.join(", ")}). Profil alanına kullanıcı adını yazıp tekrar dene.`);
    }

    let followerCount = profileCount(user, "follower_count", "edge_followed_by");
    let followingCount = profileCount(user, "following_count", "edge_follow");
    if (followerCount === null || followingCount === null) {
      const payload = await accountRequest(
        "sayaç",
        `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
      );
      const webUser = payload && (payload.data?.user || payload.graphql?.user || payload.user);
      const webUserId = userIdFrom(webUser);
      if (webUser && normalizeUsername(webUser.username) === username &&
        (!webUserId || webUserId === userId)) {
        followerCount ??= profileCount(webUser, "follower_count", "edge_followed_by");
        followingCount ??= profileCount(webUser, "following_count", "edge_follow");
        user = { ...webUser, ...user };
      } else if (payload) {
        checks.push("sayaç:kimlik farklı veya kullanıcı yok");
      }
    }
    if (followerCount === null || followingCount === null) {
      throw new Error(`Instagram liste toplamlarını doğrulayamadı (${checks.join(", ")}); eksik veri kaydedilmedi.`);
    }

    return {
      userId,
      username,
      profilePicUrl: normalizeProfilePicUrl(
        user &&
          (user.profile_pic_url_hd ||
            user.profile_pic_url ||
            user.hd_profile_pic_url_info?.url),
      ),
      followerCount,
      followingCount,
    };
  }

  function profileCount(user, directKey, edgeKey) {
    return normalizeCount(user && user[directKey]) ??
      normalizeCount(user && user[edgeKey]?.count);
  }

  function pageUsers(payload) {
    let users;
    if (Array.isArray(payload && payload.users)) {
      users = payload.users;
    } else if (Array.isArray(payload && payload.items)) {
      users = payload.items;
    } else {
      throw new Error("Instagram liste biçimini değiştirdi; eksik veri kaydedilmedi.");
    }

    const records = users
      .map((user) => {
        const username = normalizeUsername(user && user.username);
        if (!username) {
          return null;
        }
        return {
          username,
          timestamp: 0,
          instagramUserId: userIdFrom(user),
          followerCount: normalizeCount(
            user.follower_count ?? user.edge_followed_by?.count,
          ),
          followingCount: normalizeCount(
            user.following_count ?? user.edge_follow?.count,
          ),
          postCount: normalizeCount(
            user.media_count ?? user.edge_owner_to_timeline_media?.count,
          ),
          profilePicUrl: normalizeProfilePicUrl(
            user.profile_pic_url_hd ||
              user.profile_pic_url ||
              user.hd_profile_pic_url_info?.url,
          ),
        };
      })
      .filter(Boolean);
    if (records.length !== users.length) {
      throw new Error("Instagram listesindeki bir hesap doğrulanamadı; eksik veri kaydedilmedi.");
    }
    return { records, rawCount: users.length };
  }

  function nextPageId(payload) {
    const value =
      payload &&
      (payload.next_max_id ?? payload.next_max_id_str ?? payload.next_cursor);
    return value === undefined || value === null || value === "" || value === 0
      ? ""
      : String(value);
  }

  function allowedCountDrift(expectedTotal) {
    return Math.min(
      MAX_COUNT_DRIFT,
      Math.max(3, Math.ceil(expectedTotal * 0.01)),
    );
  }

  async function collectRelationship(account, relationship, followerTotal, expectedTotal) {
    const isFollowers = relationship === "followers";
    const label = isFollowers ? "takipçi" : "takip edilen";
    const usernames = new Set();
    const seenPages = new Set();
    let pageId = "";

    for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber += 1) {
      ensureActive();
      const query = new URLSearchParams({
        count: String(pageSize),
        search_surface: "follow_list_page",
      });
      if (pageId) {
        query.set("max_id", pageId);
      }

      const payload = await instagramRequest(
        `/api/v1/friendships/${encodeURIComponent(account.userId)}/${relationship}/?${query.toString()}`,
      );
      const page = pageUsers(payload);
      const users = page.records;
      users.forEach((user) => usernames.add(user.username));
      send("page", { relationship, users });

      const progress = Math.min(
        isFollowers ? 54 : 94,
        (isFollowers ? 22 : 58) + pageNumber * 3,
      );
      update({
        phase: relationship,
        message: `${usernames.size} ${label} bulundu, tarama sürüyor...`,
        progress,
        followersCount: isFollowers ? usernames.size : followerTotal,
        followingCount: isFollowers ? 0 : usernames.size,
      });

      const nextId = nextPageId(payload);
      if (!nextId) {
        if (payload.has_more === true) {
          throw new Error("Instagram liste sayfalarını tamamlamadı; eksik veri kaydedilmedi.");
        }
        const missingCount = Math.max(0, expectedTotal - usernames.size);
        if (missingCount > allowedCountDrift(expectedTotal)) {
          throw new Error(
            `Instagram ${label} listesini eksik döndürdü (${usernames.size}/${expectedTotal}); veri kaydedilmedi.`,
          );
        }
        if (missingCount > 0) {
          update({
            message: `Instagram ${missingCount} erişilemeyen ${label} hesabını listede göstermedi; ${usernames.size} hesapla devam ediliyor.`,
          });
        }
        return usernames.size;
      }
      if (!page.rawCount || !users.length) {
        throw new Error("Instagram boş bir ara sayfa döndürdü; eksik veri kaydedilmedi.");
      }
      if (seenPages.has(nextId)) {
        throw new Error("Instagram aynı liste sayfasını tekrarladı; eksik veri kaydedilmedi.");
      }
      seenPages.add(nextId);
      pageId = nextId;
    }

    throw new Error("Liste beklenenden uzun olduğu için güvenlik sınırında durduruldu.");
  }

  async function run() {
    try {
      update({
        phase: "profile",
        message: "Oturum çerezi bulundu, Instagram hesabı sorgulanıyor...",
        progress: 17,
      });
      const account = await currentAccount();
      if (requestedUsername && account.username !== requestedUsername) {
        throw new Error(
          `@${requestedUsername} yerine @${account.username} hesabı açık. Doğru hesapla yeniden giriş yap.`,
        );
      }
      send("account", account);
      update({
        phase: "followers",
        message: `@${account.username} için takipçiler toplanıyor...`,
        progress: 21,
      });
      const followersCount = await collectRelationship(
        account,
        "followers",
        0,
        account.followerCount,
      );
      update({
        phase: "following",
        message: "Takip ettiklerin toplanıyor...",
        progress: 57,
        followersCount,
      });
      const followingCount = await collectRelationship(
        account,
        "following",
        followersCount,
        account.followingCount,
      );
      update({
        phase: "saving",
        message: "Listeler cihazında hazırlanıyor...",
        progress: 97,
        followersCount,
        followingCount,
      });
      send("complete", {
        username: account.username,
        userId: account.userId,
        profilePicUrl: account.profilePicUrl,
        followersCount,
        followingCount,
      });
    } catch (error) {
      send("error", {
        message: error && error.message
          ? String(error.message).slice(0, 500)
          : "Instagram taraması tamamlanamadı.",
        code: error && error.code || "COLLECTION_FAILED",
        retryAfterMs: error && error.retryAfterMs || 0,
      });
    }
  }

  run();
})();
