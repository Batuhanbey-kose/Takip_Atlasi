(function attachDesktopCollector() {
  "use strict";
  if (window.Capacitor?.isNativePlatform?.() || location.protocol !== "http:" ||
    !["localhost", "127.0.0.1"].includes(location.hostname)) return;

  const listeners = new Set();
  async function request(path, body) {
    const response = await fetch(`/api/instagram/${path}`, body === undefined
      ? { cache: "no-store" }
      : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw Object.assign(new Error(result.message || "PC bağlantısı tamamlanamadı."), result);
    return result;
  }
  window.TakipDesktopCollector = {
    isAvailable: async () => (await request("health")).available,
    addListener: async (name, listener) => {
      listeners.add(listener);
      return { remove: async () => listeners.delete(listener) };
    },
    getConnectionStatus: () => request("status"),
    collect: async (options) => {
      await request("start", options);
      while (true) {
        const status = await request("status");
        listeners.forEach((listener) => listener(status));
        if (status.phase === "complete") return status.summary;
        if (status.phase === "error" || status.phase === "cancelled") {
          throw Object.assign(new Error(status.message), status.error);
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
      }
    },
    beginScan: () => request("scan", {}),
    readResult: ({ relationship, offset, limit }) => request(`result?relationship=${encodeURIComponent(relationship)}&offset=${offset || 0}&limit=${limit || 250}`),
    clearResult: () => request("clear-result", {}),
    cancel: () => request("cancel", {}),
    clearSession: () => request("clear-session", {}),
    requestMetadata: ({ records }) => request("metadata", { records }),
    requestProfilePhotos: ({ records }) => request("photos", { records }),
    cancelEnrichment: () => request("cancel-enrichment", {}),
  };
})();
