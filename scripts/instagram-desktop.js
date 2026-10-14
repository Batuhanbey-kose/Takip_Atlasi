const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright-core");
const logic = require("../www/logic.js");
const { DesktopEnrichment } = require("./desktop-enrichment.js");

const ORIGIN = "https://www.instagram.com";
const LOGIN_URL = `${ORIGIN}/accounts/login/`;
const collectorPath = () => {
  const shared = path.join(__dirname, "../shared/instagram-collector.js");
  return fs.existsSync(shared) ? shared : path.join(__dirname, "../android/app/src/main/assets/instagram-collector.js");
};

function browserPath() {
  return [process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome", "/usr/bin/chromium",
  ].find((candidate) => candidate && fs.existsSync(candidate));
}

function readyUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === ORIGIN && !url.username && !url.password &&
      !/^\/(?:accounts(?:\/|$)|challenge|checkpoint|consent)/i.test(url.pathname);
  } catch (error) {
    return false;
  }
}

function failure(code, message, data = {}) {
  return Object.assign(new Error(message), { code, data });
}

class DesktopCollector {
  constructor(options = {}) {
    this.stateFile = options.stateFile === null ? null : options.stateFile || path.join(__dirname, "../.local-state/instagram-cooldown.json");
    this.blockedUntil = 0;
    try {
      const saved = JSON.parse(fs.readFileSync(this.stateFile, "utf8"));
      this.blockedUntil = Number(saved.blockedUntil) || 0;
    } catch (error) {
      // Only a cooldown timestamp is persisted. Browser sessions stay in memory.
    }
    this.state = { phase: "idle", message: "PC bağlantısı hazır", progress: 0, followersCount: 0, followingCount: 0 };
    this.records = { followers: new Map(), following: new Map() };
    this.active = false;
    this.scanning = false;
    this.run = 0;
    this.page = null;
    this.context = null;
    this.browser = null;
    this.browserPromise = null;
    this.watchdog = null;
    this.requestedUsername = "";
  }

  get available() { return Boolean(browserPath()); }

  get enrichment() {
    if (!this._enrichment) this._enrichment = new DesktopEnrichment(this);
    return this._enrichment;
  }

  requestMetadata(records) { return this.enrichment.requestMetadata(records); }
  requestPhotos(records) { return this.enrichment.requestPhotos(records); }
  photo(key) { return this.enrichment.photo(key); }
  cancelEnrichment() { return this._enrichment ? this._enrichment.cancel() : Promise.resolve(); }

  async ensureBrowser() {
    if (this.browser && this.browser.isConnected()) return this.context;
    if (!this.browserPromise) {
      this.browserPromise = (async () => {
        const executablePath = browserPath();
        if (!executablePath) throw failure("BROWSER_UNAVAILABLE", "PC'de Edge veya Chrome bulunamadı.");
        this.browser = await chromium.launch({ executablePath, headless: false });
        this.context = await this.browser.newContext();
        this.browser.on("disconnected", () => {
          this.browserPromise = null;
          this.browser = null;
          this.context = null;
          if (this.active) this.fail("CANCELLED", "Instagram ekranı kapatıldı.");
        });
        return this.context;
      })().catch(() => {
        this.browserPromise = null;
        throw failure("BROWSER_UNAVAILABLE", "PC Instagram tarayıcısı açılamadı.");
      });
    }
    return this.browserPromise;
  }

  start(options = {}) {
    if (this.active) throw failure("BUSY", "Başka bir PC Instagram bağlantısı sürüyor.");
    if (Date.now() < this.blockedUntil) {
      throw failure("RATE_LIMITED", "Instagram bekleme süresi henüz dolmadı (HTTP 429).", { retryAfterMs: this.blockedUntil - Date.now() });
    }
    if (!this.available) throw failure("BROWSER_UNAVAILABLE", "Edge veya Chrome kurulu olmalı.");
    this.requestedUsername = logic.normalizeUsername(options.username || "");
    if (!this.requestedUsername || this.requestedUsername.length > 30) {
      throw failure("INVALID_USERNAME", "Instagram kullanıcı adı geçersiz.");
    }
    this.cancelEnrichment();
    this.tempo = ["slow", "original", "steady"].includes(options.tempo) ? options.tempo : "slow";
    this.records.followers.clear();
    this.records.following.clear();
    this.summary = null;
    this.active = true;
    this.scanning = false;
    this.loginDeadline = Date.now() + 20 * 60 * 1000;
    const run = ++this.run;
    this.state = { phase: "launching", message: "PC'de Instagram tarayıcısı açılıyor...", progress: 4, followersCount: 0, followingCount: 0 };
    this.prepareLogin(run).catch(() => {
      if (run === this.run && this.active) this.fail("BROWSER_ERROR", "Instagram giriş sayfası açılamadı.");
    });
    return { started: true };
  }

  async prepareLogin(run) {
    const context = await this.ensureBrowser();
    if (run !== this.run || !this.active) return;
    const previous = this.page;
    const page = await context.newPage();
    this.page = page;
    if (previous && !previous.isClosed()) await previous.close().catch(() => {});
    await page.exposeBinding("__takipAtlasiPostMessage", ({ frame, page: sourcePage }, raw) => {
      if (sourcePage !== page || frame !== page.mainFrame() || run !== this.run || !this.scanning) return;
      try {
        if (new URL(frame.url()).origin !== ORIGIN) return;
      } catch (error) { return; }
      this.handleMessage(raw);
    });
    page.on("close", () => {
      if (this.page === page && this.active) this.fail("CANCELLED", "Instagram ekranı kapatıldı.");
    });
    page.on("framenavigated", (frame) => {
      if (this.page === page && frame === page.mainFrame()) {
        this.pageFinishedAt = Date.now();
        if (this.scanning) this.fail("NAVIGATION_CHANGED", "Instagram sayfası tarama sırasında değişti.");
      }
    });
    await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    if (run !== this.run || !this.active) return;
    this.pageFinishedAt = Date.now();
    this.state = { ...this.state, phase: "waiting_login", message: "Açılan Instagram tarayıcısında giriş yap; sonra burada “Listeleri tara” düğmesine bas.", progress: 8 };
  }

  async status() {
    let ready = false;
    let authStep = "login";
    if (this.active && this.state.phase === "waiting_login" && this.page && !this.page.isClosed()) {
      if (Date.now() > this.loginDeadline) this.fail("LOGIN_TIMEOUT", "Instagram giriş bekleme süresi doldu.");
      try {
        const url = new URL(this.page.url());
        if (/challenge|checkpoint|two_factor/.test(url.pathname)) authStep = "verification";
        if (readyUrl(url.href) && Date.now() - this.pageFinishedAt >= 700) {
          const cookies = await this.context.cookies(ORIGIN);
          ready = cookies.some((cookie) => cookie.name === "sessionid" && cookie.value);
          if (ready) authStep = "ready";
        }
      } catch (error) { /* The page can close between polls. */ }
    }
    return { ...this.state, ready, authStep, summary: this.summary, blockedUntil: this.blockedUntil };
  }

  async beginScan() {
    const status = await this.status();
    if (!this.active || this.scanning || !status.ready) throw failure("LOGIN_NOT_READY", "Önce Instagram girişini tamamla.");
    const cookies = await this.context.cookies(ORIGIN);
    const userId = logic.normalizeInstagramUserId(cookies.find((cookie) => cookie.name === "ds_user_id")?.value);
    if (!this.requestedUsername) throw failure("USERNAME_REQUIRED", "PC taraması için Instagram kullanıcı adını yaz.");
    this.state = { ...this.state, phase: "profile", message: "Instagram'ın güncel web profil verisi hazırlanıyor...", progress: 15 };
    this.resetWatchdog();
    const run = this.run;
    let prepared;
    try {
      prepared = await this.prepareWebProfile(userId);
    } catch (error) {
      if (this.active && run === this.run) this.fail(error.code || "WEB_PROFILE_FAILED", error.code ? error.message : "Instagram web profil verisi hazırlanamadı.");
      return { started: false };
    }
    if (!this.active || run !== this.run) return { started: false };
    this.scanning = true;
    const bootstrap = `window.__TAKIP_ATLASI_REQUESTED_USERNAME__=${JSON.stringify(this.requestedUsername)};\n` +
      `window.__TAKIP_ATLASI_SESSION_USER_ID__=${JSON.stringify(userId)};\n` +
      `window.__TAKIP_ATLASI_SCAN_TEMPO__=${JSON.stringify(this.tempo)};\n` +
      `window.__TAKIP_ATLASI_VERIFIED_ACCOUNT__=${JSON.stringify(prepared.account)};\n` +
      `window.__TAKIP_ATLASI_WEBSITE_HEADERS__=${JSON.stringify(prepared.headers)};\n` +
      "window.__TAKIP_ATLASI_PAGE_SIZE__=12;\n" +
      "window.TakipAtlasiNative={postMessage:raw=>window.__takipAtlasiPostMessage(raw)};\n";
    this.page.evaluate(bootstrap + fs.readFileSync(collectorPath(), "utf8")).catch(() => {
      if (this.scanning) this.fail("COLLECTOR_START_FAILED", "PC takip toplayıcısı başlatılamadı.");
    });
    return { started: true };
  }

  async prepareWebProfile(userId) {
    if (!userId) throw failure("SESSION_REQUIRED", "Instagram oturum kimliği okunamadı.");
    await this.page.goto(`${ORIGIN}/${encodeURIComponent(this.requestedUsername)}/`, { waitUntil: "domcontentloaded", timeout: 60000 });
    const deadline = Date.now() + 30000;
    while (this.active && Date.now() < deadline) {
      const requests = await this.page.requests();
      let account = null;
      const headers = {};
      for (const request of requests) {
        if (new URL(request.url()).origin !== ORIGIN) continue;
        const sent = await request.allHeaders();
        if (sent["x-asbd-id"]) {
          for (const name of ["X-IG-App-ID", "X-ASBD-ID", "X-IG-WWW-Claim", "X-Web-Session-ID", "X-CSRFToken"]) {
            if (sent[name.toLowerCase()]) headers[name] = sent[name.toLowerCase()];
          }
        }
        if (sent["x-fb-friendly-name"] !== "PolarisProfilePageContentQuery") continue;
        const response = await request.response();
        if (!response || response.status() !== 200) continue;
        const payload = await response.json().catch(() => null);
        const walk = (value, depth) => {
          if (!value || typeof value !== "object" || depth > 15) return;
          const id = logic.normalizeInstagramUserId(value.pk_id) || logic.normalizeInstagramUserId(value.id) || logic.normalizeInstagramUserId(value.pk);
          if (value.username === this.requestedUsername && id === userId &&
            logic.normalizeAccountCount(value.follower_count) !== null && logic.normalizeAccountCount(value.following_count) !== null) {
            account = { username: value.username, userId, followerCount: Number(value.follower_count), followingCount: Number(value.following_count),
              profilePicUrl: logic.normalizeProfilePicUrl(value.profile_pic_url) };
          }
          Object.values(value).forEach((child) => walk(child, depth + 1));
        };
        walk(payload, 0);
      }
      if (account && headers["X-ASBD-ID"]) return { account, headers };
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw failure("WEB_PROFILE_FAILED", "Instagram web profil toplamları oturum kimliğiyle doğrulanamadı.");
  }

  handleMessage(raw) {
    if (!this.scanning || typeof raw !== "string" || raw.length > 512 * 1024) return;
    let message;
    try { message = JSON.parse(raw); } catch (error) { this.fail("INVALID_RESPONSE", "Instagram yanıtı okunamadı."); return; }
    this.resetWatchdog();
    if (message.type === "progress") {
      this.state = { ...this.state, phase: message.phase, message: String(message.message || "").slice(0, 500),
        progress: Math.max(0, Math.min(100, Number(message.progress) || 0)),
        followersCount: this.records.followers.size, followingCount: this.records.following.size };
    } else if (message.type === "page") {
      if (!["followers", "following"].includes(message.relationship) || !Array.isArray(message.users) || message.users.length > 100) {
        this.fail("INVALID_RESPONSE", "Instagram geçersiz bir liste sayfası döndürdü."); return;
      }
      const target = this.records[message.relationship];
      for (const record of logic.dedupeRecords(message.users)) {
        target.set(record.username, record);
        if (target.size > 15000) { this.fail("LIST_TOO_LARGE", "Takip listesi sınırı aşıldı."); return; }
      }
    } else if (message.type === "complete") {
      const username = logic.normalizeUsername(message.username);
      if (!username || !logic.normalizeInstagramUserId(message.userId) ||
        (this.requestedUsername && username !== this.requestedUsername) ||
        message.followersCount !== this.records.followers.size || message.followingCount !== this.records.following.size) {
        this.fail("INCOMPLETE_RESULT", "PC takip listesi eksik veya hesap kimliği tutarsız; veri kaydedilmedi."); return;
      }
      this.summary = { username, profilePicUrl: logic.normalizeProfilePicUrl(message.profilePicUrl),
        followersCount: this.records.followers.size, followingCount: this.records.following.size };
      this.active = false;
      this.scanning = false;
      clearTimeout(this.watchdog);
      this.state = { ...this.state, phase: "complete", progress: 100, message: "PC takip listeleri hazır." };
    } else if (message.type === "error") {
      if (message.code === "RATE_LIMITED") {
        this.rateLimit(String(message.message || "Instagram istek sınırı (HTTP 429)."), Number(message.retryAfterMs));
        return;
      }
      this.fail(message.code || "COLLECTION_FAILED", String(message.message || "Instagram taraması tamamlanamadı.").slice(0, 500));
    }
  }

  rateLimit(message, requestedDelay) {
    const delay = Number.isFinite(requestedDelay) && requestedDelay > 0 ? requestedDelay : 900000;
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + Math.min(86400000, Math.max(1000, delay)));
    if (this.stateFile) {
      try {
        fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
        fs.writeFileSync(this.stateFile, JSON.stringify({ blockedUntil: this.blockedUntil }));
      } catch (error) { /* The in-memory cooldown still prevents new requests. */ }
    }
    this.fail("RATE_LIMITED", message.slice(0, 500), { retryAfterMs: this.blockedUntil - Date.now() });
  }

  resetWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => this.fail("TIMEOUT", "Instagram uzun süre yanıt vermedi."), 90000);
    this.watchdog.unref();
  }

  fail(code, message, data = {}) {
    this.active = false;
    this.scanning = false;
    clearTimeout(this.watchdog);
    this.state = { ...this.state, phase: code === "CANCELLED" ? "cancelled" : "error", message, error: { code, message, data } };
    this.records.followers.clear();
    this.records.following.clear();
    this.summary = null;
  }

  async cancel() {
    if (this.page && !this.page.isClosed()) {
      await this.page.evaluate(() => { window.__TAKIP_ATLASI_NATIVE_CANCELLED__ = true; }).catch(() => {});
    }
    this.fail("CANCELLED", "Tarama durduruldu.");
  }

  readResult(relationship, offset = 0, limit = 250) {
    if (this.state.phase !== "complete") throw failure("RESULT_NOT_READY", "PC listeleri henüz tamamlanmadı.");
    if (!["followers", "following"].includes(relationship)) throw failure("INVALID_RELATIONSHIP", "Geçersiz liste türü.");
    const records = Array.from(this.records[relationship].values());
    offset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
    limit = Number.isSafeInteger(limit) ? Math.max(1, Math.min(250, limit)) : 250;
    return { records: records.slice(offset, offset + limit), total: records.length, done: offset + limit >= records.length };
  }

  clearResult() {
    if (this.active) throw failure("BUSY", "Tarama sürerken sonuç temizlenemez.");
    this.records.followers.clear();
    this.records.following.clear();
    this.summary = null;
    if (this.state.phase === "complete") this.state = { ...this.state, phase: "idle", message: "Son analiz cihazına kaydedildi." };
  }

  async close() {
    if (this._enrichment) await this._enrichment.close();
    if (this.active) this.fail("CANCELLED", "Instagram ekranı kapatıldı.");
    this.active = false;
    this.scanning = false;
    clearTimeout(this.watchdog);
    if (this.browser) await this.browser.close();
    this.page = null;
    this.records.followers.clear();
    this.records.following.clear();
    this.summary = null;
  }
}

module.exports = new DesktopCollector();
module.exports.DesktopCollector = DesktopCollector;
module.exports.readyUrl = readyUrl;
