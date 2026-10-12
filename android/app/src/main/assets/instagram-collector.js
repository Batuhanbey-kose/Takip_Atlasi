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
  const requestedUsername = normalizeUsername(
    window.__TAKIP_ATLASI_REQUESTED_USERNAME__,
  );
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
    return pause(500 + Math.floor(Math.random() * 350));
  }

  function ensureActive() {
    if (window.__TAKIP_ATLASI_NATIVE_CANCELLED__) {
      throw new Error("Tarama durduruldu.");
    }
  }

  function normalizeUsername(value) {
    const username = String(value || "").trim().replace(/^@/, "").toLowerCase();
    return /^[a-z0-9._]{1,30}$/.test(username) ? username : "";
  }

  function normalizeUserId(value) {
    const userId = String(value || "").trim();
    return /^\d{1,30}$/.test(userId) ? userId : "";
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
    return match ? decodeURIComponent(match[1]) : "";
  }

  async function instagramRequest(pathname, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      ensureActive();
      const csrfToken = readCookie("csrftoken");
      const headers = {
        Accept: "*/*",
        "X-IG-App-ID": APP_ID,
        "X-Requested-With": "XMLHttpRequest",
      };
      if (csrfToken) {
        headers["X-CSRFToken"] = csrfToken;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 45000);
      let response;
      try {
        response = await fetch(pathname, {
          method: "GET",
          credentials: "include",
          headers,
          signal: controller.signal,
        });
      } catch (error) {
        if (error && error.name === "AbortError") {
          throw new Error("Instagram isteği zaman aşımına uğradı. İnternet bağlantını kontrol et.");
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
      }

      if (response.status === 429 && attempt < retries) {
        const waitSeconds = 15 * (attempt + 1);
        update({
          message: `Instagram kısa bir mola istedi; ${waitSeconds} saniye bekleniyor...`,
        });
        await pause(waitSeconds * 1000);
        continue;
      }

      let payload = null;
      try {
        payload = await response.json();
      } catch (error) {
        payload = null;
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error("Instagram oturumu doğrulanamadı. Yeniden giriş yapmayı dene.");
      }
      if (!response.ok || !payload) {
        throw new Error(`Instagram liste isteğini reddetti (HTTP ${response.status}).`);
      }
      if (payload.status === "fail") {
        throw new Error(
          payload.message || payload.error_type || "Instagram isteği başarısız oldu.",
        );
      }
      return payload;
    }

    throw new Error("Instagram isteği tamamlanamadı.");
  }

  async function currentAccount() {
    let user = null;
    const cookieUserId = normalizeUserId(readCookie("ds_user_id"));
    try {
      const payload = await instagramRequest(
        "/api/v1/accounts/current_user/?edit=true",
        0,
      );
      user = payload.user || payload.form_data || payload;
    } catch (error) {
      user = null;
    }

    const initialUserId = normalizeUserId(
      (user && (user.pk || user.pk_id || user.id)) || cookieUserId,
    );
    // The current-user endpoint already includes counts on some Instagram versions.
    // Avoid a second request unless the account identity or totals are missing.
    if (initialUserId && (!normalizeUsername(user && user.username) ||
      profileCount(user, "follower_count", "edge_followed_by") === null ||
      profileCount(user, "following_count", "edge_follow") === null)) {
      try {
        const payload = await instagramRequest(
          `/api/v1/users/${encodeURIComponent(initialUserId)}/info/`,
          0,
        );
        const detailedUser = payload.user || payload;
        if (detailedUser && normalizeUserId(detailedUser.pk || detailedUser.pk_id || detailedUser.id) === initialUserId &&
          normalizeUsername(detailedUser.username)) {
          user = { ...(user || {}), ...detailedUser };
        }
      } catch (error) {
        // The current-user response remains usable if the detail endpoint is unavailable.
      }
    }

    let userId = normalizeUserId((user && (user.pk || user.pk_id || user.id)) || cookieUserId);
    const username = normalizeUsername(user && user.username);
    if (!userId) {
      throw new Error("Instagram hesap kimliği okunamadı. Oturumu kapatıp yeniden giriş yap.");
    }
    if (!username) {
      throw new Error("Instagram kullanıcı adı okunamadı.");
    }

    let followerCount = profileCount(user, "follower_count", "edge_followed_by");
    let followingCount = profileCount(user, "following_count", "edge_follow");
    if (followerCount === null || followingCount === null) {
      try {
        const payload = await instagramRequest(
          `/api/v1/users/web_profile_info/?username=${encodeURIComponent(username)}`,
          0,
        );
        const webUser = payload.data?.user || payload.graphql?.user || payload.user;
        const webUserId = normalizeUserId(webUser && (webUser.pk || webUser.pk_id || webUser.id));
        if (webUser && normalizeUsername(webUser.username) === username &&
          (!webUserId || webUserId === userId)) {
          followerCount ??= profileCount(webUser, "follower_count", "edge_followed_by");
          followingCount ??= profileCount(webUser, "following_count", "edge_follow");
          user = { ...webUser, ...user };
        }
      } catch (error) {
        // Never use guessed totals: a truncated relationship list must not be saved.
      }
    }
    if (followerCount === null || followingCount === null) {
      throw new Error("Instagram liste toplamlarını doğrulayamadı. Bir süre sonra yeniden giriş yapıp dene; eksik veri kaydedilmedi.");
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
    return normalizeCount(user && (user[directKey] ?? user[edgeKey]?.count));
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
          instagramUserId: normalizeUserId(user.pk || user.pk_id || user.id),
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
        count: "100",
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
      await randomPause();
    }

    throw new Error("Liste beklenenden uzun olduğu için güvenlik sınırında durduruldu.");
  }

  async function run() {
    try {
      update({
        phase: "profile",
        message: "Oturum doğrulandı, hesap bilgisi okunuyor...",
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
      });
    }
  }

  run();
})();
