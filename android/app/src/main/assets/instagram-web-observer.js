(function observeInstagramWebProfiles() {
  "use strict";
  if (window.__TAKIP_WEB_OBSERVER__) return;
  const originalFetch = window.fetch.bind(window);
  const profileCache = new Map();
  const api = { headers: {}, account: null, template: null, generation: 0, abort: null };
  window.__TAKIP_WEB_OBSERVER__ = api;
  const username = (value) => /^[a-z0-9._]{1,30}$/i.test(String(value || "")) ? String(value).toLowerCase() : "";
  const userId = (value) => typeof value === "number" && !Number.isSafeInteger(value) ? "" : /^\d{1,30}$/.test(String(value || "")) ? String(value) : "";
  const count = (value) => value !== null && value !== undefined && value !== "" && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
  const send = (type, payload) => window.TakipAtlasiNative?.postMessage(JSON.stringify({ type, ...payload }));

  function profile(payload, name, id, followerOnly = false) {
    let found = null;
    const walk = (value, depth) => {
      if (!value || typeof value !== "object" || depth > 16 || found) return;
      const candidateId = userId(value.pk_id) || userId(value.id) || userId(value.pk);
      const candidateName = username(value.username);
      const followers = count(value.follower_count ?? value.edge_followed_by?.count);
      const following = count(value.following_count ?? value.edge_follow?.count);
      if (candidateName && candidateId && (!name || candidateName === name) && (!id || candidateId === id) && followers !== null && (followerOnly || following !== null)) {
        found = { username: candidateName, userId: candidateId, instagramUserId: candidateId,
          followerCount: followers, followingCount: following,
          postCount: count(value.media_count ?? value.edge_owner_to_timeline_media?.count),
          profilePicUrl: String(value.profile_pic_url_hd || value.profile_pic_url || ""), updatedAt: Date.now() };
      }
      Object.values(value).forEach((child) => walk(child, depth + 1));
    };
    walk(payload, 0);
    return found;
  }

  function identityPaths(variables, account) {
    const paths = [];
    const walk = (value, path) => {
      if (!value || typeof value !== "object") return;
      Object.entries(value).forEach(([key, child]) => {
        const next = path.concat(key);
        if (/^(username|id|user_id)$/i.test(key) && child === account.username) paths.push({ path: next, kind: "username" });
        if (/^(id|user_id)$/i.test(key) && String(child) === account.userId) paths.push({ path: next, kind: "id" });
        if (child && typeof child === "object") walk(child, next);
      });
    };
    walk(variables, []);
    return paths;
  }

  function capture(url, headers, body, payload) {
    try {
      const destination = new URL(url, location.href);
      if (destination.origin !== "https://www.instagram.com") return;
      const sent = new Headers(headers || {});
      if (sent.get("x-asbd-id")) {
        ["X-IG-App-ID", "X-ASBD-ID", "X-IG-WWW-Claim", "X-Web-Session-ID", "X-CSRFToken"].forEach((name) => {
          const value = sent.get(name);
          if (value) api.headers[name] = value;
        });
      }
      if (payload && ["/api/graphql", "/graphql/query"].includes(destination.pathname) && sent.get("x-fb-friendly-name") === "PolarisProfilePageContentQuery") {
        const account = profile(payload);
        if (account) {
          const params = new URLSearchParams(body || "");
          const variables = JSON.parse(params.get("variables") || "{}");
          const identities = identityPaths(variables, account);
          if (identities.length) {
            const queryHeaders = { "Content-Type": "application/x-www-form-urlencoded" };
            ["x-asbd-id", "x-csrftoken", "x-fb-friendly-name", "x-fb-lsd", "x-ig-app-id"].forEach((name) => {
              const value = sent.get(name);
              if (value) queryHeaders[name] = value;
            });
            api.template = { endpoint: destination.pathname, body: params.toString(), variables, identities, headers: queryHeaders };
          }
          api.account = account;
        }
      }
      if (api.account && api.headers["X-ASBD-ID"] && api.template) {
        send("web-profile", { account: api.account, hasTemplate: true });
      }
    } catch (error) { /* Never expose raw responses or request headers in error messages. */ }
  }

  window.fetch = async function trackedFetch(input, options = {}) {
    const url = typeof input === "string" ? input : input.url;
    const headers = options.headers || input.headers;
    const body = options.body;
    const requestBody = body !== undefined ? Promise.resolve(String(body)) :
      input instanceof Request ? input.clone().text().catch(() => "") : Promise.resolve("");
    capture(url, headers, body, null);
    const response = await originalFetch(input, options);
    if (response.status === 200 && new Headers(headers || {}).get("x-fb-friendly-name") === "PolarisProfilePageContentQuery") {
      Promise.all([response.clone().json(), requestBody]).then(([payload, capturedBody]) => capture(url, headers, capturedBody, payload)).catch(() => {});
    }
    return response;
  };
  const open = XMLHttpRequest.prototype.open;
  const setHeader = XMLHttpRequest.prototype.setRequestHeader;
  const sendRequest = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (...args) {
    this.__takipUrl = args[1]; this.__takipHeaders = {};
    return open.apply(this, args);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this.__takipHeaders) this.__takipHeaders[name] = value;
    return setHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (body) {
    capture(this.__takipUrl, this.__takipHeaders, body, null);
    this.addEventListener("load", () => {
      try {
        if (this.status === 200 && new Headers(this.__takipHeaders || {}).get("x-fb-friendly-name") === "PolarisProfilePageContentQuery") {
          capture(this.__takipUrl, this.__takipHeaders, body, this.responseType === "json" ? this.response : JSON.parse(this.responseText));
        }
      } catch (error) { /* Other website responses do not belong to the profile collector. */ }
    });
    return sendRequest.call(this, body);
  };

  api.cancelMetadata = () => { api.generation += 1; api.abort?.abort(); };
  api.queryMetadata = async (requestId, records, blockedUntil, followerOnly = false) => {
    const result = { records: [] };
    const generation = api.generation;
    try {
      if (Date.now() < blockedUntil) result.retryAfterMs = blockedUntil - Date.now();
      else if (!api.template) result.sessionRequired = true;
      else for (const record of (Array.isArray(records) ? records : []).slice(0, 4)) {
        if (generation !== api.generation) break;
        const name = username(record.username);
        const id = userId(record.instagramUserId);
        if (!name) continue;
        const key = id || name;
        const cached = profileCache.get(key);
        if (cached && cached.username === name && Date.now() - cached.updatedAt < 86400000 &&
          (followerOnly || cached.followingCount !== null && cached.postCount !== null)) { result.records.push(cached); continue; }
        const deadline = Date.now() + 1500 + Math.floor(Math.random() * 700);
        while (generation === api.generation && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
        if (generation !== api.generation) break;
        const variables = JSON.parse(JSON.stringify(api.template.variables));
        for (const identity of api.template.identities) {
          let object = variables;
          for (const part of identity.path.slice(0, -1)) object = object[part];
          object[identity.path[identity.path.length - 1]] = identity.kind === "username" ? name : id;
        }
        const body = new URLSearchParams(api.template.body);
        body.set("variables", JSON.stringify(variables));
        api.abort = new AbortController();
        const timer = setTimeout(() => api.abort.abort(), 30000);
        let response;
        try { response = await originalFetch(api.template.endpoint, { method: "POST", credentials: "include", redirect: "manual", headers: api.template.headers, body: body.toString(), signal: api.abort.signal }); }
        finally { clearTimeout(timer); }
        if (response.status === 429) { const seconds = Number(response.headers.get("Retry-After")); result.retryAfterMs = seconds > 0 ? Math.min(86400000, seconds * 1000) : 900000; break; }
        if ([401, 403].includes(response.status) || response.type === "opaqueredirect") { result.sessionRequired = true; break; }
        if (response.status === 400) { result.requestRejected = true; break; }
        const payload = await response.json().catch(() => null);
        const details = profile(payload, name, id, followerOnly);
        if (details && (followerOnly || details.postCount !== null)) { profileCache.set(key, details); result.records.push(details); }
        else if (payload?.errors?.length) { result.profileError = true; break; }
      }
    } catch (error) { if (generation === api.generation) result.connectionFailed = true; }
    send("metadata-result", { requestId, ...result });
  };
})();
