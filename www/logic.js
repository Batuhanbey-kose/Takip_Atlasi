(function attachTakipLogic(root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }

  if (root) {
    root.TakipLogic = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTakipLogic() {
  "use strict";

  const USERNAME_PATTERN = /^[a-z0-9._]{1,64}$/i;
  const RESERVED_PATHS = new Set([
    "accounts",
    "about",
    "developer",
    "directory",
    "explore",
    "legal",
    "p",
    "reel",
    "reels",
    "stories",
  ]);

  function normalizeUsername(value) {
    if (typeof value !== "string") {
      return "";
    }

    let username = value.trim();
    if (!username) {
      return "";
    }

    username = username
      .replace(/&amp;/gi, "&")
      .replace(/^https?:\/\/(?:www\.)?instagram\.com\//i, "")
      .replace(/^@/, "")
      .split(/[/?#]/)[0]
      .trim()
      .toLowerCase();

    if (!USERNAME_PATTERN.test(username) || RESERVED_PATHS.has(username)) {
      return "";
    }

    return username;
  }

  function normalizeTimestamp(value) {
    const timestamp = Number(value);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return 0;
    }

    return timestamp > 99999999999 ? Math.floor(timestamp / 1000) : Math.floor(timestamp);
  }

  function normalizeProfilePicUrl(value) {
    const rawValue = String(value || "");
    try {
      const profileUrl = new URL(rawValue);
      const hostname = profileUrl.hostname.toLowerCase();
      const allowedHost =
        hostname === "instagram.com" ||
        hostname.endsWith(".instagram.com") ||
        hostname.endsWith(".cdninstagram.com") ||
        hostname.endsWith(".fbcdn.net");
      return profileUrl.protocol === "https:" && allowedHost && profileUrl.href.length <= 3000
        ? profileUrl.href
        : "";
    } catch (error) {
      return "";
    }
  }

  function normalizeInstagramUserId(value) {
    const userId = String(value || "").trim();
    return /^\d{1,30}$/.test(userId) ? userId : "";
  }

  function normalizeAccountCount(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 && count <= 5000000000
      ? count
      : null;
  }

  function dedupeRecords(records) {
    const byUsername = new Map();

    records.forEach((record) => {
      const username = normalizeUsername(record && record.username);
      if (!username) {
        return;
      }

      const timestamp = normalizeTimestamp(record.timestamp);
      const profilePicUrl = normalizeProfilePicUrl(record.profilePicUrl);
      const instagramUserId = normalizeInstagramUserId(record.instagramUserId);
      const followerCount = normalizeAccountCount(record.followerCount);
      const followingCount = normalizeAccountCount(record.followingCount);
      const postCount = normalizeAccountCount(record.postCount);
      const existing = byUsername.get(username);
      if (!existing) {
        byUsername.set(username, {
          username,
          timestamp,
          profilePicUrl,
          instagramUserId,
          followerCount,
          followingCount,
          postCount,
        });
      } else {
        byUsername.set(username, {
          username,
          timestamp: Math.max(timestamp, existing.timestamp),
          profilePicUrl: profilePicUrl || existing.profilePicUrl,
          instagramUserId: instagramUserId || existing.instagramUserId,
          followerCount: followerCount ?? existing.followerCount,
          followingCount: followingCount ?? existing.followingCount,
          postCount: postCount ?? existing.postCount,
        });
      }
    });

    return Array.from(byUsername.values()).sort(sortRecent);
  }

  function sortRecent(a, b) {
    return (b.timestamp || 0) - (a.timestamp || 0) || a.username.localeCompare(b.username, "tr");
  }

  function recordMap(records) {
    return new Map((records || []).map((record) => [record.username, record]));
  }

  function enrichRecord(username, followerMap, followingMap, fallbackRecord, change) {
    const followerRecord = followerMap.get(username);
    const followingRecord = followingMap.get(username);

    return {
      username,
      profilePicUrl:
        normalizeProfilePicUrl(followerRecord && followerRecord.profilePicUrl) ||
        normalizeProfilePicUrl(followingRecord && followingRecord.profilePicUrl) ||
        normalizeProfilePicUrl(fallbackRecord && fallbackRecord.profilePicUrl),
      instagramUserId:
        normalizeInstagramUserId(followerRecord && followerRecord.instagramUserId) ||
        normalizeInstagramUserId(followingRecord && followingRecord.instagramUserId) ||
        normalizeInstagramUserId(fallbackRecord && fallbackRecord.instagramUserId),
      followerCount:
        normalizeAccountCount(followerRecord && followerRecord.followerCount) ??
        normalizeAccountCount(followingRecord && followingRecord.followerCount) ??
        normalizeAccountCount(fallbackRecord && fallbackRecord.followerCount),
      followingCount:
        normalizeAccountCount(followerRecord && followerRecord.followingCount) ??
        normalizeAccountCount(followingRecord && followingRecord.followingCount) ??
        normalizeAccountCount(fallbackRecord && fallbackRecord.followingCount),
      postCount:
        normalizeAccountCount(followerRecord && followerRecord.postCount) ??
        normalizeAccountCount(followingRecord && followingRecord.postCount) ??
        normalizeAccountCount(fallbackRecord && fallbackRecord.postCount),
      timestamp: Math.max(
        followerRecord ? followerRecord.timestamp : 0,
        followingRecord ? followingRecord.timestamp : 0,
        fallbackRecord ? fallbackRecord.timestamp : 0,
      ),
      isFollower: followerMap.has(username),
      isFollowing: followingMap.has(username),
      change: change || "",
    };
  }

  function analyzeDataset(current, previous) {
    const followers = (current && current.followers) || [];
    const following = (current && current.following) || [];
    const followerMap = recordMap(followers);
    const followingMap = recordMap(following);
    const previousFollowerMap = recordMap(previous && previous.followers);
    const previousFollowingMap = recordMap(previous && previous.following);
    const allNames = new Set([...followerMap.keys(), ...followingMap.keys()]);
    const hasPrevious = Boolean(previous);

    const all = Array.from(allNames, (username) =>
      enrichRecord(username, followerMap, followingMap),
    ).sort(sortRecent);

    const followerItems = followers.map((record) =>
      enrichRecord(record.username, followerMap, followingMap, record),
    );

    const followingItems = following.map((record) =>
      enrichRecord(record.username, followerMap, followingMap, record),
    );

    const mutual = followingItems.filter((record) => record.isFollower);
    const notFollowingBack = followingItems.filter((record) => !record.isFollower);
    const youDontFollowBack = followerItems.filter((record) => !record.isFollowing);

    const newFollowers = hasPrevious
      ? followerItems
          .filter((record) => !previousFollowerMap.has(record.username))
          .map((record) => ({
            ...record,
            change: "newFollower",
            detectedAfter: Number(previous.importedAt) || 0,
            detectedAt: Number(current.importedAt) || Date.now(),
          }))
      : [];

    const lostFollowers = hasPrevious
      ? Array.from(previousFollowerMap.values())
          .filter((record) => !followerMap.has(record.username))
          .map((record) =>
            enrichRecord(
              record.username,
              followerMap,
              followingMap,
              record,
              "lostFollower",
            ),
          )
          .map((record) => ({
            ...record,
            detectedAfter: Number(previous.importedAt) || 0,
            detectedAt: Number(current.importedAt) || Date.now(),
          }))
          .sort(sortRecent)
      : [];

    const newFollowing = hasPrevious
      ? followingItems.filter((record) => !previousFollowingMap.has(record.username))
      : [];

    const stoppedFollowing = hasPrevious
      ? Array.from(previousFollowingMap.values()).filter(
          (record) => !followingMap.has(record.username),
        )
      : [];

    return {
      all,
      followers: followerItems,
      following: followingItems,
      mutual,
      notFollowingBack,
      youDontFollowBack,
      newFollowers,
      lostFollowers,
      newFollowing,
      stoppedFollowing,
      hasPrevious,
      deltas: {
        followers: hasPrevious ? followers.length - previousFollowerMap.size : 0,
        following: hasPrevious ? following.length - previousFollowingMap.size : 0,
      },
    };
  }

  function hashString(input) {
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function datasetFingerprint(dataset) {
    const followers = (dataset.followers || []).map((record) => record.username).sort().join("|");
    const following = (dataset.following || []).map((record) => record.username).sort().join("|");
    return hashString(`f:${followers};g:${following}`);
  }

  function createSnapshot(username, dataset, importedAt) {
    const timestamp = Number(importedAt) || Date.now();
    const cleanDataset = {
      followers: dedupeRecords(dataset.followers || []),
      following: dedupeRecords(dataset.following || []),
      profilePicUrl: normalizeProfilePicUrl(dataset.profilePicUrl),
      sourceFiles: Array.from(new Set(dataset.sourceFiles || [])),
    };

    return {
      id: `${timestamp}-${Math.random().toString(36).slice(2, 9)}`,
      username: normalizeUsername(username),
      importedAt: timestamp,
      fingerprint: datasetFingerprint(cleanDataset),
      ...cleanDataset,
    };
  }

  function createDemoData(username) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const day = 86400;
    const followerNames = [
      "deniz.rotasi",
      "pixel.gezgini",
      "mavi.defter",
      "gece.vardiyasi",
      "kahveharitasi",
      "minimal.kare",
      "sokak.notlari",
      "bulut.atolyesi",
      "ritimkutusu",
      "analog.ruya",
      "yesil.pencere",
      "kuzey.isigi",
      "renkli.patika",
      "pazar.sessizligi",
      "sesli.cizgi",
      "limonlu.film",
      "doku.kolektifi",
      "yildiz.tozu",
      "kirmizi.rota",
      "dus.atlasi",
      "oda.dokuz",
      "baska.bir.gun",
      "acik.hava",
      "mor.merdiven",
      "ince.detay",
      "tempo.lab",
      "gunsonu.notu",
      "kum.saati",
    ];
    const followingNames = [
      "deniz.rotasi",
      "pixel.gezgini",
      "mavi.defter",
      "gece.vardiyasi",
      "kahveharitasi",
      "minimal.kare",
      "sokak.notlari",
      "bulut.atolyesi",
      "ritimkutusu",
      "analog.ruya",
      "yesil.pencere",
      "kuzey.isigi",
      "renkli.patika",
      "pazar.sessizligi",
      "sesli.cizgi",
      "limonlu.film",
      "doku.kolektifi",
      "yildiz.tozu",
      "kirmizi.rota",
      "dus.atlasi",
      "gezgin.kamera",
      "mikro.mekan",
      "cizgi.arasi",
      "sahil.studyo",
      "gece.postasi",
      "kare.avcisi",
      "sade.sesler",
      "uzak.yakin",
      "film.araligi",
      "kent.gunlugu",
    ];

    function makeRecords(names, offset) {
      return names.map((name, index) => ({
        username: name,
        timestamp: nowSeconds - (index + offset) * day * 3,
      }));
    }

    const currentDataset = {
      followers: makeRecords(followerNames, 1),
      following: makeRecords(followingNames, 2),
      sourceFiles: ["örnek takip verisi"],
    };

    const previousFollowerNames = followerNames
      .filter((name) => !["deniz.rotasi", "pixel.gezgini", "mavi.defter", "gece.vardiyasi"].includes(name))
      .concat(["eski.frekans", "soluk.kare"]);

    const previousDataset = {
      followers: makeRecords(previousFollowerNames, 5),
      following: makeRecords(followingNames.slice(0, -2), 6),
      sourceFiles: ["önceki örnek takip verisi"],
    };

    const safeUsername = normalizeUsername(username) || "atlas.gezgini";
    return {
      profile: { username: safeUsername, createdAt: Date.now(), isDemo: true },
      snapshots: [
        createSnapshot(safeUsername, currentDataset, Date.now()),
        createSnapshot(safeUsername, previousDataset, Date.now() - 3 * day * 1000),
      ],
    };
  }

  return {
    normalizeUsername,
    normalizeProfilePicUrl,
    normalizeInstagramUserId,
    normalizeAccountCount,
    analyzeDataset,
    datasetFingerprint,
    createSnapshot,
    createDemoData,
    dedupeRecords,
    sortRecent,
  };
});
