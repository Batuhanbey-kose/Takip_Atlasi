(function attachTakipArchive(root, factory) {
  const api = factory(
    root && root.TakipLogic ? root.TakipLogic : require("./logic.js"),
    root && root.fflate ? root.fflate : require("fflate"),
  );
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.TakipArchive = api;
  }
})(typeof window !== "undefined" ? window : null, function createTakipArchive(logic, zip) {
  "use strict";

  const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
  const MAX_JSON_BYTES = 10 * 1024 * 1024;
  const MAX_RECORDS = 15000;
  const decoder = new TextDecoder("utf-8", { fatal: true });

  function kindOf(name) {
    const fileName = String(name || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
    if (/^followers(?:_\d+)?\.json$/.test(fileName)) {
      return "followers";
    }
    if (/^following(?:_\d+)?\.json$/.test(fileName)) {
      return "following";
    }
    return "";
  }

  function recordsFromJson(name, bytes, kind) {
    if (bytes.length > MAX_JSON_BYTES) {
      throw new Error("Takip listesi JSON dosyası çok büyük.");
    }
    let content;
    try {
      content = JSON.parse(decoder.decode(bytes));
    } catch (error) {
      throw new Error(`${name} geçerli bir Instagram JSON dosyası değil.`);
    }
    const key = kind === "followers" ? "relationships_followers" : "relationships_following";
    const entries = Array.isArray(content) ? content : content && content[key];
    if (!Array.isArray(entries)) {
      throw new Error(`${name} beklenen ${kind === "followers" ? "takipçi" : "takip edilen"} listesini içermiyor.`);
    }
    if (entries.length > MAX_RECORDS) {
      throw new Error("Takip listesi güvenlik sınırını aştı.");
    }
    return entries.map((entry) => {
      const item = entry && Array.isArray(entry.string_list_data) && entry.string_list_data[0];
      const username = logic.normalizeUsername(item && item.value || entry && entry.title);
      if (!username) {
        throw new Error(`${name} içinde geçersiz bir hesap bulundu; eksik liste kaydedilmedi.`);
      }
      return { username, timestamp: item && item.timestamp || 0 };
    });
  }

  async function importFiles(files) {
    if (!files || !files.length || files.length > 24) {
      throw new Error("Bir ZIP veya takipçi ve takip edilen JSON dosyalarını seç.");
    }
    const selected = Array.from(files);
    if (selected.some((file) => !file || file.size > MAX_ARCHIVE_BYTES)) {
      throw new Error("Arşiv çok büyük. Instagram'dan yalnızca takip bağlantılarını JSON olarak indir.");
    }
    if (selected.reduce((total, file) => total + (file.size || 0), 0) > MAX_ARCHIVE_BYTES) {
      throw new Error("Seçilen dosyalar 30 MB sınırını aşıyor.");
    }
    const zipFiles = selected.filter((file) => /\.zip$/i.test(file.name));
    if (zipFiles.length && (zipFiles.length !== 1 || selected.length !== 1)) {
      throw new Error("ZIP arşivini diğer dosyalardan ayrı seç.");
    }

    const entries = [];
    if (zipFiles.length) {
      const archive = new Uint8Array(await zipFiles[0].arrayBuffer());
      if (archive.length > MAX_ARCHIVE_BYTES) {
        throw new Error("ZIP arşivi 30 MB sınırını aşıyor.");
      }
      let scanned = 0;
      let extractedSize = 0;
      let extracted;
      try {
        extracted = zip.unzipSync(archive, { filter: (info) => {
          scanned += 1;
          if (scanned > 1000) {
            throw new Error("ZIP arşivinde çok fazla dosya var.");
          }
          const fileName = info.name.replace(/\\/g, "/");
          const relevant = kindOf(fileName) &&
            (!fileName.includes("/") || /(?:^|\/)followers_and_following\//i.test(fileName));
          if (!relevant) {
            return false;
          }
          if (info.originalSize > MAX_JSON_BYTES || extractedSize + info.originalSize > MAX_ARCHIVE_BYTES) {
            throw new Error("ZIP içindeki takip listesi çok büyük.");
          }
          extractedSize += info.originalSize;
          return true;
        } });
      } catch (error) {
        throw new Error(error.message && /çok/.test(error.message)
          ? error.message
          : "ZIP arşivi açılamadı. Instagram'dan JSON biçiminde yeniden indir.");
      }
      Object.entries(extracted).forEach(([name, bytes]) => entries.push({ name, bytes }));
    } else {
      for (const file of selected) {
        if (!kindOf(file.name)) {
          throw new Error("Yalnızca followers_1.json ve following.json dosyalarını seç.");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        entries.push({ name: file.name, bytes });
      }
    }

    const records = { followers: [], following: [] };
    const found = new Set();
    for (const { name, bytes } of entries) {
      const kind = kindOf(name);
      if (!kind) {
        continue;
      }
      found.add(kind);
      records[kind].push(...recordsFromJson(name.split(/[\\/]/).pop(), bytes, kind));
      if (records[kind].length > MAX_RECORDS) {
        throw new Error("Takip listesi güvenlik sınırını aştı.");
      }
    }
    if (!found.has("followers") || !found.has("following")) {
      throw new Error("Arşivde hem followers_1.json hem following.json bulunmalı; eksik liste kaydedilmedi.");
    }
    return {
      followers: logic.dedupeRecords(records.followers),
      following: logic.dedupeRecords(records.following),
      sourceFiles: [zipFiles.length ? "Instagram JSON ZIP arşivi" : "Instagram JSON dosyaları"],
    };
  }

  return { importFiles };
});
