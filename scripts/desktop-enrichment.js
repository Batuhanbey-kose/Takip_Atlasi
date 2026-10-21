const { createHash } = require("node:crypto");
const logic = require("../www/logic.js");

const ORIGIN = "https://www.instagram.com";
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_CACHE_BYTES = 40 * 1024 * 1024;

function allowedPhoto(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && (!url.port || url.port === "443") &&
      (host.endsWith(".cdninstagram.com") || host.endsWith(".fbcdn.net"));
  } catch (error) { return false; }
}

function findProfile(payload, username, userId, followerOnly = false) {
  let profile = null;
  const walk = (value, depth) => {
    if (!value || typeof value !== "object" || depth > 16 || profile) return;
    const name = logic.normalizeUsername(value.username);
    const id = logic.normalizeInstagramUserId(value.pk_id) || logic.normalizeInstagramUserId(value.id) || logic.normalizeInstagramUserId(value.pk);
    if (name === username && id && (!userId || id === userId)) {
      const followerCount = logic.normalizeAccountCount(value.follower_count ?? value.edge_followed_by?.count);
      const followingCount = logic.normalizeAccountCount(value.following_count ?? value.edge_follow?.count);
      const postCount = logic.normalizeAccountCount(value.media_count ?? value.edge_owner_to_timeline_media?.count);
      if (followerCount !== null && (followerOnly || followingCount !== null && postCount !== null)) {
        profile = { username: name, instagramUserId: id, followerCount, followingCount, postCount,
          profilePicUrl: logic.normalizeProfilePicUrl(value.profile_pic_url_hd || value.profile_pic_url), updatedAt: Date.now() };
      }
    }
    Object.values(value).forEach((child) => walk(child, depth + 1));
  };
  walk(payload, 0);
  return profile;
}

function replaceIdentity(variables, paths, person) {
  const result = structuredClone(variables);
  for (const item of paths) {
    const value = item.kind === "username" ? person.username : person.instagramUserId;
    if (!value) throw new Error("Profile identity missing");
    let target = result;
    for (const key of item.path.slice(0, -1)) target = target[key];
    target[item.path[item.path.length - 1]] = value;
  }
  return result;
}

class DesktopEnrichment {
  constructor(desktop, options = {}) {
    this.desktop = desktop;
    this.metadata = new Map();
    this.photos = new Map();
    this.photoBytes = 0;
    this.generation = 0;
    this.busy = false;
    this.fetchImage = options.fetchImage || fetch;
    this.page = null;
    this.template = null;
  }

  async backgroundPage(context) {
    const existing = context.pages().find((page) => !page.isClosed());
    if (!existing) return context.newPage();
    const pageSession = await context.newCDPSession(existing);
    const { targetInfo } = await pageSession.send("Target.getTargetInfo");
    const browserSession = await this.desktop.browser.newBrowserCDPSession();
    const pagePromise = context.waitForEvent("page");
    try {
      await browserSession.send("Target.createTarget", { url: "about:blank", browserContextId: targetInfo.browserContextId, background: true });
      return await pagePromise;
    } finally {
      await pageSession.detach();
      await browserSession.detach();
    }
  }

  async profileTemplate(person, followerOnly = false) {
    if (this.template && this.page && !this.page.isClosed()) return this.template;
    const context = this.desktop.context;
    if (!context || !(await context.cookies(ORIGIN)).some((cookie) => cookie.name === "sessionid" && cookie.value)) {
      throw Object.assign(new Error("Instagram oturumu gerekli."), { code: "SESSION_REQUIRED" });
    }
    if (this.desktop.page && !this.desktop.page.isClosed()) {
      const observed = await this.desktop.page.evaluate(() => window.__TAKIP_WEB_OBSERVER__?.template || null).catch(() => null);
      if (observed?.identities?.length) {
        this.page = this.desktop.page;
        this.template = observed;
        return observed;
      }
    }
    this.page = await this.backgroundPage(context);
    await this.page.goto(`${ORIGIN}/${encodeURIComponent(person.username)}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const requests = await this.page.requests();
      for (const request of requests.slice().reverse()) {
        const sent = await request.allHeaders();
        const destination = new URL(request.url());
        if (destination.origin !== ORIGIN || !["/api/graphql", "/graphql/query"].includes(destination.pathname) || sent["x-fb-friendly-name"] !== "PolarisProfilePageContentQuery") continue;
        const params = new URLSearchParams(request.postData() || "");
        const variables = JSON.parse(params.get("variables") || "{}");
        const identities = [];
        const walk = (value, path) => {
          if (!value || typeof value !== "object") return;
          Object.entries(value).forEach(([key, child]) => {
            const next = path.concat(key);
            if (/^(username|user_id|id)$/i.test(key) && child === person.username) identities.push({ path: next, kind: "username" });
            if (/^(user_id|id)$/i.test(key) && person.instagramUserId && String(child) === person.instagramUserId) identities.push({ path: next, kind: "id" });
            if (child && typeof child === "object") walk(child, next);
          });
        };
        walk(variables, []);
        if (!identities.length) continue;
        const response = await request.response();
        if (!response || response.status() !== 200) continue;
        const headers = { "Content-Type": "application/x-www-form-urlencoded" };
        for (const name of ["x-asbd-id", "x-csrftoken", "x-fb-friendly-name", "x-fb-lsd", "x-ig-app-id"]) {
          if (sent[name]) headers[name] = sent[name];
        }
        this.template = { endpoint: new URL(request.url()).pathname, body: params.toString(), variables, identities, headers };
        const profile = findProfile(await response.json().catch(() => null), person.username, person.instagramUserId, followerOnly);
        if (profile) this.metadata.set(person.instagramUserId || person.username, profile);
        return this.template;
      }
      if (/^\/accounts|^\/challenge|^\/checkpoint/.test(new URL(this.page.url()).pathname)) {
        throw Object.assign(new Error("Instagram oturumu yenilenmeli."), { code: "SESSION_REQUIRED" });
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    throw new Error("Instagram profil sorgusu hazırlanamadı.");
  }

  async requestMetadata(records, followerOnly = false) {
    if (this.busy) throw new Error("Profil bilgisi yüklemesi zaten sürüyor.");
    const results = [];
    const complete = (profile) => profile && Number.isFinite(profile.followerCount) &&
      (followerOnly || Number.isFinite(profile.followingCount) && Number.isFinite(profile.postCount));
    const generation = this.generation;
    const retryAfterMs = Math.max(0, this.desktop.blockedUntil - Date.now());
    if (retryAfterMs) return { records: results, retryAfterMs };
    if (this.desktop.active) return { records: results, connectionFailed: true };
    this.busy = true;
    try {
      for (const record of Array.isArray(records) ? records.slice(0, 1) : []) {
        if (generation !== this.generation) break;
        const person = { username: logic.normalizeUsername(record?.username), instagramUserId: logic.normalizeInstagramUserId(record?.instagramUserId) };
        if (!person.username) continue;
        const key = person.instagramUserId || person.username;
        let cached = this.metadata.get(key);
        if (complete(cached) && cached.username === person.username && Date.now() - cached.updatedAt < 86400000) { results.push(cached); continue; }
        const template = await this.profileTemplate(person, followerOnly);
        cached = this.metadata.get(key);
        if (complete(cached) && cached.username === person.username) { results.push(cached); continue; }
        const deadline = Date.now() + 1500 + Math.floor(Math.random() * 700);
        while (Date.now() < deadline && generation === this.generation) await new Promise((resolve) => setTimeout(resolve, 100));
        if (generation !== this.generation) break;
        const variables = replaceIdentity(template.variables, template.identities, person);
        const result = await this.page.evaluate(async ({ template, variables }) => {
          const body = new URLSearchParams(template.body);
          body.set("variables", JSON.stringify(variables));
          window.__TAKIP_METADATA_ABORT__ = new AbortController();
          const timer = setTimeout(() => window.__TAKIP_METADATA_ABORT__.abort(), 30000);
          try {
            const response = await fetch(template.endpoint, { method: "POST", credentials: "include", redirect: "manual",
              headers: template.headers, body: body.toString(), signal: window.__TAKIP_METADATA_ABORT__.signal });
            return { status: response.status, retryAfter: response.headers.get("Retry-After"), payload: await response.json().catch(() => null) };
          } finally { clearTimeout(timer); }
        }, { template, variables });
        if (generation !== this.generation) break;
        if (result.status === 429) {
          const seconds = Number(result.retryAfter);
          this.desktop.rateLimit("Instagram profil bilgisi isteklerini sınırladı (HTTP 429).", seconds > 0 ? seconds * 1000 : 900000);
          return { records: results, retryAfterMs: this.desktop.blockedUntil - Date.now() };
        }
        if ([401, 403].includes(result.status)) return { records: results, sessionRequired: true };
        if (result.status === 400) return { records: results, requestRejected: true };
        const profile = findProfile(result.payload, person.username, person.instagramUserId, followerOnly);
        if (profile) { this.metadata.set(key, profile); results.push(profile); }
        else if (Array.isArray(result.payload?.errors) && result.payload.errors.length) return { records: results, profileError: true };
      }
      return { records: results };
    } catch (error) {
      return { records: results, sessionRequired: error.code === "SESSION_REQUIRED", connectionFailed: error.code !== "SESSION_REQUIRED" && generation === this.generation };
    } finally { this.busy = false; }
  }

  async requestPhotos(records) {
    const candidates = Array.isArray(records) ? records.slice(0, 12) : [];
    const results = [];
    let index = 0;
    const worker = async () => {
      while (index < candidates.length) {
        const record = candidates[index++];
        const username = logic.normalizeUsername(record?.username);
        const source = logic.normalizeProfilePicUrl(record?.profilePicUrl);
        if (!username || !allowedPhoto(source)) continue;
        const key = createHash("sha256").update(source).digest("hex");
        if (!this.photos.has(key)) {
          let url = source;
          for (let redirect = 0; redirect < 3; redirect += 1) {
            if (!allowedPhoto(url)) break;
            try {
              const response = await this.fetchImage(url, { redirect: "manual", credentials: "omit", signal: AbortSignal.timeout(10000), headers: { Accept: "image/jpeg,image/png,image/webp,image/avif" } });
              if (response.status >= 300 && response.status < 400) {
                const location = response.headers.get("Location");
                if (!location) break;
                url = new URL(location, url).href;
                continue;
              }
              const type = (response.headers.get("Content-Type") || "").split(";")[0].trim().toLowerCase();
              if (response.status !== 200 || !["image/jpeg", "image/png", "image/webp", "image/avif"].includes(type) || Number(response.headers.get("Content-Length")) > MAX_IMAGE_BYTES) break;
              const chunks = [];
              let size = 0;
              for await (const chunk of response.body) {
                size += chunk.length;
                if (size > MAX_IMAGE_BYTES) throw new Error("Image too large");
                chunks.push(Buffer.from(chunk));
              }
              if (!size) break;
              if (this.photos.has(key)) this.photoBytes -= this.photos.get(key).bytes.length;
              this.photos.set(key, { bytes: Buffer.concat(chunks), contentType: type });
              this.photoBytes += size;
              while (this.photoBytes > MAX_CACHE_BYTES) {
                const first = this.photos.keys().next().value;
                this.photoBytes -= this.photos.get(first).bytes.length;
                this.photos.delete(first);
              }
            } catch (error) { /* Keep the initials fallback for an unavailable image. */ }
            break;
          }
        }
        if (this.photos.has(key)) results.push({ username, photoUrl: `/api/instagram/photo/${key}` });
      }
    };
    await Promise.all([worker(), worker()]);
    return { records: results };
  }

  photo(key) { return /^[a-f0-9]{64}$/.test(key) ? this.photos.get(key) : null; }

  async cancel() {
    this.generation += 1;
    if (this.page && !this.page.isClosed()) await this.page.evaluate(() => window.__TAKIP_METADATA_ABORT__?.abort()).catch(() => {});
  }

  async close() {
    await this.cancel();
    if (this.page && !this.page.isClosed()) await this.page.close().catch(() => {});
    this.metadata.clear();
    this.photos.clear();
    this.photoBytes = 0;
    this.template = null;
  }
}

module.exports = { DesktopEnrichment, allowedPhoto, findProfile, replaceIdentity };
