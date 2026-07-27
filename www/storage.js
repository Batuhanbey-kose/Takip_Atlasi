(function attachTakipStorage(root, factory) {
  const api = factory();
  if (root) {
    root.TakipStorage = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createTakipStorage() {
  "use strict";

  const DB_NAME = "takip-atlasi";
  const DB_VERSION = 1;
  const MAX_SNAPSHOTS = 8;
  const FALLBACK_KEY = "takip-atlasi-state-v1";
  let databasePromise;
  let useFallback = typeof indexedDB === "undefined";

  function openDatabase() {
    if (useFallback) {
      return Promise.reject(new Error("IndexedDB kullanılamıyor."));
    }

    if (databasePromise) {
      return databasePromise;
    }

    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("meta")) {
          database.createObjectStore("meta", { keyPath: "key" });
        }
        if (!database.objectStoreNames.contains("snapshots")) {
          const snapshots = database.createObjectStore("snapshots", { keyPath: "id" });
          snapshots.createIndex("importedAt", "importedAt");
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Yerel veritabanı açılamadı."));
      request.onblocked = () => reject(new Error("Yerel veritabanı başka bir sekmede kilitli."));
    }).catch((error) => {
      useFallback = true;
      databasePromise = null;
      throw error;
    });

    return databasePromise;
  }

  function requestResult(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Yerel işlem tamamlanamadı."));
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Yerel işlem tamamlanamadı."));
      transaction.onabort = () => reject(transaction.error || new Error("Yerel işlem iptal edildi."));
    });
  }

  function readFallback() {
    try {
      const value = localStorage.getItem(FALLBACK_KEY);
      return value ? JSON.parse(value) : { profile: null, snapshots: [] };
    } catch (error) {
      return { profile: null, snapshots: [] };
    }
  }

  function writeFallback(state) {
    try {
      localStorage.setItem(FALLBACK_KEY, JSON.stringify(state));
    } catch (error) {
      throw new Error("Yerel depolama alanı dolu veya kullanılamıyor.");
    }
  }

  function sortSnapshots(snapshots) {
    return snapshots.sort((a, b) => b.importedAt - a.importedAt);
  }

  async function load() {
    if (useFallback) {
      const state = readFallback();
      return { profile: state.profile || null, snapshots: sortSnapshots(state.snapshots || []) };
    }

    try {
      const database = await openDatabase();
      const transaction = database.transaction(["meta", "snapshots"], "readonly");
      const profileRequest = transaction.objectStore("meta").get("profile");
      const snapshotsRequest = transaction.objectStore("snapshots").getAll();
      const [profileEntry, snapshots] = await Promise.all([
        requestResult(profileRequest),
        requestResult(snapshotsRequest),
      ]);

      return {
        profile: profileEntry ? profileEntry.value : null,
        snapshots: sortSnapshots(snapshots || []),
      };
    } catch (error) {
      useFallback = true;
      return load();
    }
  }

  async function saveProfile(profile) {
    if (useFallback) {
      const state = readFallback();
      state.profile = profile;
      writeFallback(state);
      return;
    }

    try {
      const database = await openDatabase();
      const transaction = database.transaction("meta", "readwrite");
      transaction.objectStore("meta").put({ key: "profile", value: profile });
      await transactionDone(transaction);
    } catch (error) {
      useFallback = true;
      await saveProfile(profile);
    }
  }

  async function addSnapshot(snapshot) {
    if (useFallback) {
      const state = readFallback();
      state.snapshots = sortSnapshots([snapshot, ...(state.snapshots || [])])
        .filter((entry, index, all) => all.findIndex((item) => item.id === entry.id) === index)
        .slice(0, MAX_SNAPSHOTS);
      writeFallback(state);
      return state.snapshots;
    }

    try {
      const database = await openDatabase();
      let transaction = database.transaction("snapshots", "readwrite");
      transaction.objectStore("snapshots").put(snapshot);
      await transactionDone(transaction);

      const allSnapshots = sortSnapshots(
        await requestResult(
          database.transaction("snapshots", "readonly").objectStore("snapshots").getAll(),
        ),
      );

      if (allSnapshots.length > MAX_SNAPSHOTS) {
        transaction = database.transaction("snapshots", "readwrite");
        allSnapshots.slice(MAX_SNAPSHOTS).forEach((entry) => {
          transaction.objectStore("snapshots").delete(entry.id);
        });
        await transactionDone(transaction);
      }

      return allSnapshots.slice(0, MAX_SNAPSHOTS);
    } catch (error) {
      useFallback = true;
      return addSnapshot(snapshot);
    }
  }

  async function clear() {
    try {
      localStorage.removeItem(FALLBACK_KEY);
    } catch (error) {
      // IndexedDB can still be cleared when fallback storage is unavailable.
    }
    if (useFallback) {
      return;
    }

    try {
      const database = await openDatabase();
      const transaction = database.transaction(["meta", "snapshots"], "readwrite");
      transaction.objectStore("meta").clear();
      transaction.objectStore("snapshots").clear();
      await transactionDone(transaction);
    } catch (error) {
      useFallback = true;
      await clear();
    }
  }

  return { load, saveProfile, addSnapshot, clear };
});
