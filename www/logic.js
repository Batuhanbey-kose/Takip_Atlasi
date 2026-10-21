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
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      return "";
    }
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
      const countsUpdatedAt = Number.isSafeInteger(Number(record.countsUpdatedAt)) ? Math.max(0, Number(record.countsUpdatedAt)) : 0;
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
          countsUpdatedAt,
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
          countsUpdatedAt: followerCount !== null ? countsUpdatedAt : existing.countsUpdatedAt,
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

  function enrichRecord(username, followerMap, followingMap, fallbackRecord, change, completeness = { followers: true, following: true }) {
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
      countsUpdatedAt: Math.max(Number(followerRecord?.countsUpdatedAt) || 0, Number(followingRecord?.countsUpdatedAt) || 0, Number(fallbackRecord?.countsUpdatedAt) || 0),
      timestamp: Math.max(
        followerRecord ? followerRecord.timestamp : 0,
        followingRecord ? followingRecord.timestamp : 0,
        fallbackRecord ? fallbackRecord.timestamp : 0,
      ),
      isFollower: followerMap.has(username) ? true : completeness.followers ? false : null,
      isFollowing: followingMap.has(username) ? true : completeness.following ? false : null,
      relationshipUnknown: !followerMap.has(username) && !completeness.followers || !followingMap.has(username) && !completeness.following,
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
    const completeness = {
      followers: current?.collection?.followers?.complete !== false && !(current?.collection?.complete === false && !current?.collection?.followers),
      following: current?.collection?.following?.complete !== false && !(current?.collection?.complete === false && !current?.collection?.following),
    };
    const canCompareFollowers = hasPrevious && completeness.followers && previous?.collection?.followers?.complete !== false &&
      !(previous?.collection?.complete === false && !previous?.collection?.followers);
    const canCompareFollowing = hasPrevious && completeness.following && previous?.collection?.following?.complete !== false &&
      !(previous?.collection?.complete === false && !previous?.collection?.following);

    const all = Array.from(allNames, (username) =>
      enrichRecord(username, followerMap, followingMap, undefined, undefined, completeness),
    ).sort(sortRecent);

    const followerItems = followers.map((record) =>
      enrichRecord(record.username, followerMap, followingMap, record, undefined, completeness),
    );

    const followingItems = following.map((record) =>
      enrichRecord(record.username, followerMap, followingMap, record, undefined, completeness),
    );

    const mutual = followingItems.filter((record) => record.isFollower === true);
    const notFollowingBack = followingItems.filter((record) => record.isFollower === false);
    const youDontFollowBack = followerItems.filter((record) => record.isFollowing === false);

    const newFollowers = canCompareFollowers
      ? followerItems
          .filter((record) => !previousFollowerMap.has(record.username))
          .map((record) => ({
            ...record,
            change: "newFollower",
            detectedAfter: Number(previous.importedAt) || 0,
            detectedAt: Number(current.importedAt) || Date.now(),
          }))
      : [];

    const lostFollowers = canCompareFollowers
      ? Array.from(previousFollowerMap.values())
          .filter((record) => !followerMap.has(record.username))
          .map((record) =>
            enrichRecord(
              record.username,
              followerMap,
              followingMap,
              record,
              "lostFollower",
              completeness,
            ),
          )
          .map((record) => ({
            ...record,
            detectedAfter: Number(previous.importedAt) || 0,
            detectedAt: Number(current.importedAt) || Date.now(),
          }))
          .sort(sortRecent)
      : [];

    const newFollowing = canCompareFollowing
      ? followingItems.filter((record) => !previousFollowingMap.has(record.username))
      : [];

    const stoppedFollowing = canCompareFollowing
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
      completeness,
      isLimited: !completeness.followers || !completeness.following,
      canCompareFollowers,
      canCompareFollowing,
      deltas: {
        followers: canCompareFollowers ? followers.length - previousFollowerMap.size : 0,
        following: canCompareFollowing ? following.length - previousFollowingMap.size : 0,
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

  function normalizeCollection(value, followersCount, followingCount) {
    const source = value && typeof value === "object" ? value : {};
    const result = {};
    for (const [name, observed] of [["followers", followersCount], ["following", followingCount]]) {
      const raw = source[name] && typeof source[name] === "object" ? source[name] : {};
      const expected = normalizeAccountCount(raw.expected) ?? observed;
      result[name] = { expected, observed, complete: raw.complete !== false && !(source.complete === false && !source[name]) &&
        observed >= expected && raw.restricted !== true, restricted: raw.restricted === true, rechecked: raw.rechecked === true };
    }
    result.complete = result.followers.complete && result.following.complete;
    return result;
  }

  function createSnapshot(username, dataset, importedAt) {
    const timestamp = Number(importedAt) || Date.now();
    const cleanDataset = {
      followers: dedupeRecords(dataset.followers || []),
      following: dedupeRecords(dataset.following || []),
      profilePicUrl: normalizeProfilePicUrl(dataset.profilePicUrl),
      sourceFiles: Array.from(new Set(dataset.sourceFiles || [])),
    };
    cleanDataset.collection = normalizeCollection(dataset.collection, cleanDataset.followers.length, cleanDataset.following.length);

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
        followerCount: [235, 1700, 12450, 0, 865, 48200, 320, 9920][index % 8],
        followingCount: 150 + index * 7,
        postCount: 12 + index * 3,
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
    normalizeCollection,
    analyzeDataset,
    datasetFingerprint,
    createSnapshot,
    createDemoData,
    dedupeRecords,
    sortRecent,
  };
});
