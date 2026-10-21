const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { zipSync, strToU8 } = require("fflate");
const server = require("./serve.js");
const { DesktopCollector } = require("./instagram-desktop.js");

async function settleLayout(page) {
  await page.evaluate(() => Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getTiming().iterations !== Infinity)
    .map((animation) => animation.finished.catch(() => {}))));
}

async function verifyLayouts(page) {
  const layouts = ["atlas", "bento", "glass", "editorial", "compact", "gallery", "terminal", "dashboard", "ribbon", "focus"];
  const themes = ["atlas", "ocean", "forest", "sunset", "sakura", "lavender", "mono", "midnight", "aurora", "amoled"];
  const signatures = new Set();
  for (let index = 0; index < layouts.length; index += 1) {
    const layout = layouts[index];
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.locator("#appearanceButton").click();
    await page.locator(`[data-layout-option="${layout}"]`).click();
    await page.locator("#themeDialog").waitFor({ state: "hidden" });
    await page.locator("#appearanceButton").click();
    await page.locator(`[data-theme-option="${themes[index]}"]`).click();
    await page.locator("#themeDialog").waitFor({ state: "hidden" });
    await settleLayout(page);
    signatures.add(await page.evaluate(() => {
      const card = document.querySelector(".person-card");
      const grid = getComputedStyle(document.querySelector("#peopleGrid"));
      const css = getComputedStyle(card);
      const main = getComputedStyle(document.querySelector("#dashboardMain"));
      return JSON.stringify([grid.gridTemplateColumns, grid.gap, css.display, css.borderRadius, css.backdropFilter,
        css.fontFamily, main.display, main.maxWidth, card.getBoundingClientRect().width,
        getComputedStyle(document.querySelector(".category-ribbon")).display]);
    }));
    for (const width of [320, 390, 430]) {
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(() => document.querySelector("#sidebar").getBoundingClientRect().right <= 0);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${layout} overflows at ${width}px`);
      assert.equal(await page.locator("#appearanceButton").isVisible(), true);
      assert.ok(await page.locator("#peopleGrid .person-card").count() > 0);
      const target = await page.locator(".favorite-button").first().boundingBox();
      assert.ok(target.width >= 43.9 && target.height >= 43.9, `${layout} touch target: ${JSON.stringify(target)}`);
      if (width === 390 && process.env.ATLAS_LAYOUT_SCREENSHOT_DIR) {
        await settleLayout(page);
        await page.screenshot({ path: require("node:path").join(process.env.ATLAS_LAYOUT_SCREENSHOT_DIR, `atlas-design-${layout}.png`) });
      }
    }
  }
  assert.equal(signatures.size, 10, "Designs must have different rendered structures");
  await page.reload();
  await page.locator("#dashboardView").waitFor({ state: "visible" });
  assert.equal(await page.evaluate(() => document.documentElement.dataset.layout), "focus");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "amoled");
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.locator("#appearanceButton").click();
  await page.locator('[data-layout-option="atlas"]').click();
  await page.locator("#appearanceButton").click();
  await page.locator('[data-theme-option="atlas"]').click();
  await page.locator('[data-category="following"]').first().click();
  console.log("10 farklı render düzeni ve 10 tema; 320/390/430px, dokunma alanları ve tercihler doğrulandı.");
}

async function verifyDesktopScan(browser) {
  const collector = new DesktopCollector({ stateFile: null });
  const context = await browser.newContext();
  collector.browser = browser;
  collector.context = context;
  const requests = [];
  try {
    await context.addCookies(["sessionid", "ds_user_id", "csrftoken"].map((name) => ({ name, value: name === "ds_user_id" ? "999" : "fixture-value", domain: "www.instagram.com", path: "/", secure: true, sameSite: "Lax" })));
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== "https://www.instagram.com") return route.abort();
      let payload;
      if (url.pathname === "/api/graphql") {
        const variables = JSON.parse(new URLSearchParams(request.postData()).get("variables"));
        requests.push({ kind: "profile", id: variables.id, headers: await request.allHeaders() });
        payload = { data: { user: variables.id === "999"
          ? { id: "999", username: "test.owner", follower_count: 1, following_count: 2, media_count: 3 }
          : { id: "2", username: "beta", follower_count: 0 } } };
      } else if (/\/friendships\/999\/(followers|following)\//.test(url.pathname)) {
        requests.push({ kind: "list", count: url.searchParams.get("count") });
        payload = { users: url.pathname.includes("/followers/")
          ? [{ username: "alpha", pk: "1", follower_count: 9 }]
          : [{ username: "alpha", pk: "1" }, { username: "beta", pk: "2" }] };
      } else {
        return route.fulfill({ contentType: "text/html", body: `<html><body>Instagram test fixture<script>fetch('/api/graphql',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded','X-ASBD-ID':'129477','X-FB-Friendly-Name':'PolarisProfilePageContentQuery'},body:new URLSearchParams({doc_id:'fixture',variables:JSON.stringify({id:'999'})}).toString()});</script></body></html>` });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
    });
    const opened = context.waitForEvent("page");
    collector.start({ username: "test.owner", tempo: "slow" });
    const page = await opened;
    for (let attempt = 0; attempt < 100 && collector.state.phase !== "waiting_login"; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(collector.state.phase, "waiting_login");
    await page.goto("https://www.instagram.com/test.owner/");
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal((await collector.status()).ready, true);
    assert.equal((await collector.beginScan()).started, true);
    for (let attempt = 0; attempt < 200 && !["complete", "error"].includes(collector.state.phase); attempt += 1) await new Promise((resolve) => setTimeout(resolve, 50));
    assert.equal(collector.state.phase, "complete", JSON.stringify(collector.state.error));
    assert.equal(collector.readResult("following").records.find((record) => record.username === "alpha").followerCount, 9);
    assert.equal(collector.readResult("following").records.find((record) => record.username === "beta").followerCount, null);
    assert.equal(collector.summary.profilesReady, 1);
    assert.ok(requests.filter((request) => request.kind === "list").every((request) => request.count === "12"));
    assert.equal(requests.filter((request) => request.kind === "profile" && request.id !== "999").length, 0);
    const metadata = await collector.requestMetadata([{ username: "beta", instagramUserId: "2" }], true);
    assert.equal(metadata.records[0]?.username, "beta");
    assert.equal(metadata.records[0]?.followerCount, 0);
    assert.equal(requests.filter((request) => request.kind === "profile" && request.id === "2").length, 1);
    console.log("Gerçek tarayıcı + taklit Instagram: liste taraması kişisel profil sorguları beklemeden tamamlandı.");
  } finally {
    collector.browser = null;
    await collector.close();
    await context.close();
  }
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: process.env.CHROME_PATH || "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    assert.equal(await page.locator("#instagramConnectButton").isVisible(), true);
    await page.locator("#profileName").fill("test.owner");

    const zip = zipSync({
      "connections/followers_and_following/followers_1.json": strToU8(JSON.stringify([
        { string_list_data: [{ value: "alice", timestamp: 100 }] },
        { string_list_data: [{ value: "bob", timestamp: 200 }] },
      ])),
      "connections/followers_and_following/following.json": strToU8(JSON.stringify({
        relationships_following: [
          { string_list_data: [{ value: "bob", timestamp: 200 }] },
          { string_list_data: [{ value: "carol", timestamp: 300 }] },
        ],
      })),
    });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator(".archive-options > summary").click();
    await page.locator("#archiveButton").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await page.locator("#dashboardView").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator('[data-count="followers"]').first().innerText(), "2");
    assert.equal(await page.locator('[data-count="following"]').first().innerText(), "2");
    await page.locator('[data-category="notFollowingBack"]').first().click();
    assert.match(await page.locator("#peopleGrid").innerText(), /@carol/);
    assert.match(await page.locator("#peopleGrid").innerText(), /Seni takip etmiyor/);
    assert.doesNotMatch(await page.locator("#peopleGrid").innerText(), /gönderi|Tek yönlü|Tarih bilgisi yok/);
    assert.equal(await page.locator("#peopleGrid .person-card__meta").count(), 0);
    await page.reload();
    await page.locator("#dashboardView").waitFor({ state: "visible", timeout: 15000 });
    assert.equal(await page.locator("#sidebarProfileName").innerText(), "@test.owner");
    assert.deepEqual(errors, []);
    console.log("PC ZIP içe aktarma, liste görünümü ve kalıcı kayıt başarılı.");

    await page.locator('[data-category="notFollowingBack"]').first().click();
    await page.locator("[data-toggle-favorite='carol']").click();
    await page.locator('[data-category="favorites"]').first().click();
    assert.match(await page.locator("#peopleGrid").innerText(), /@carol/);
    await page.locator("#densityButton").click();
    await page.reload();
    await page.locator("#dashboardView").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.body.dataset.listDensity), "comfortable");
    await page.locator('[data-category="favorites"]').first().click();
    assert.equal(await page.locator("#peopleGrid .favorite-button[aria-pressed='true']").count(), 1);
    await page.locator("#densityButton").click();
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Pano engellendi"); } } }));
    const wideZip = zipSync({
      "followers_1.json": strToU8(JSON.stringify([{ string_list_data: [{ value: "alice" }] }])),
      "following.json": strToU8(JSON.stringify({ relationships_following: Array.from({ length: 60 }, (_, index) => ({ string_list_data: [{ value: `wide.${index}` }] })) })),
    });
    const wideChooser = page.waitForEvent("filechooser");
    await page.locator("#archiveRefreshButton").click();
    await (await wideChooser).setFiles({ name: "wide.zip", mimeType: "application/zip", buffer: Buffer.from(wideZip) });
    await page.waitForFunction(() => document.querySelector('[data-count="following"]').textContent === "60");
    await page.locator('[data-category="notFollowingBack"]').first().click();
    assert.equal(await page.locator("#peopleGrid .person-card").count(), 48);
    await page.locator("#copyListButton").click();
    await page.locator("#copyDialog").waitFor({ state: "visible" });
    assert.equal((await page.locator("#copyText").inputValue()).split("\n").length, 60);
    assert.match(await page.locator("#copyText").inputValue(), /@wide\.59/);
    await page.locator("#copyDialog [data-close-dialog]").click();
    await page.locator("#searchInput").fill("wide.59");
    await page.locator("#copyListButton").click();
    assert.equal(await page.locator("#copyText").inputValue(), "@wide.59");
    await page.locator("#copyDialog [data-close-dialog]").click();
    await page.locator("#clearSearchButton").click();
    const themeIds = ["atlas", "ocean", "forest", "sunset", "sakura", "lavender", "mono", "midnight", "aurora", "amoled"];
    for (const theme of themeIds) {
      await page.locator("#appearanceButton").click();
      assert.equal(await page.locator("[data-theme-option]").count(), 10);
      assert.equal(await page.locator("[data-layout-option]").count(), 10);
      await page.locator(`[data-theme-option="${theme}"]`).click();
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      await page.locator("#themeDialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMode), ["midnight", "aurora", "amoled"].includes(theme) ? "dark" : "light");
    }
    await page.reload();
    await page.locator("#dashboardView").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "amoled");
    await page.locator('[data-category="favorites"]').first().click();
    assert.match(await page.locator("#peopleGrid").innerText(), /@carol/);
    assert.match(await page.locator("#peopleGrid .status-badge").textContent(), /Bu kayıtta yok/);
    if (process.env.ATLAS_THEME_SCREENSHOT) { await settleLayout(page); await page.screenshot({ path: process.env.ATLAS_THEME_SCREENSHOT }); }
    console.log("Yıldızlılar, bütün filtrelenmiş listeyi kopyalama ve 10 renk teması doğrulandı.");

    const nativeContext = await browser.newContext();
    await nativeContext.addInitScript(() => {
      // Simulate native success/error contracts; this is not a live Instagram test.
      localStorage.setItem("takip-atlasi-data-disclosure-v1", "1");
      localStorage.setItem("takip-atlasi-scan-tempo", "slow");
      let listener = () => {};
      const plugin = {
        addListener: async (name, handler) => { listener = handler; return { remove: async () => {} }; },
        getConnectionStatus: async () => ({ blockedUntil: Number(localStorage.getItem("mock-blocked-until")) || 0 }),
        collect: async (options) => {
          localStorage.setItem("mock-tempo", options.tempo);
          localStorage.setItem("mock-collect-count", String(Number(localStorage.getItem("mock-collect-count") || 0) + 1));
          if (localStorage.getItem("mock-scan-success") === "1") {
            localStorage.removeItem("mock-scan-success");
            listener({ phase: "followers", message: "Listeler ve profil takipçi sayıları toplanıyor", progress: 40, followersCount: 2, followingCount: 0, profilesReady: 2, profilesTotal: 3, pageSize: 100 });
            await new Promise((resolve) => { window.__finishMockScan = resolve; });
            localStorage.setItem("mock-session-connected", "1");
            return { username: options.username, followersCount: 2, followingCount: 2, profilesReady: 0, profilesTotal: 3,
              collection: { followers: { expected: 2, complete: true }, following: { expected: 3, complete: false } } };
          }
          localStorage.setItem("mock-blocked-until", String(Date.now() + 900000));
          const error = new Error("Instagram istekleri geçici olarak sınırladı (HTTP 429). Tarama durduruldu.");
          error.code = "RATE_LIMITED";
          error.data = { retryAfterMs: 900000 };
          throw error;
        },
        requestMetadata: async ({ records, followerOnly }) => {
          localStorage.setItem("mock-metadata-count", String(Number(localStorage.getItem("mock-metadata-count") || 0) + 1));
          localStorage.setItem("mock-follower-only", String(followerOnly));
          if (records.length !== 1) throw new Error("Hesaplar birer birer istenmeli");
          if (localStorage.getItem("mock-session-connected") !== "1") return { records: [], sessionRequired: true };
          const result = { records: records.map((record) => ({ ...record,
            followerCount: ({ alice: 1200, bob: 0, carol: 2 })[record.username] ?? 7, updatedAt: Date.now() })) };
          if (localStorage.getItem("mock-auto-counters") === "1") return result;
          return new Promise((resolve) => {
            window.__cancelCounterBatch = () => resolve({ records: [] });
            window.__finishCounterBatch = () => { localStorage.setItem("mock-auto-counters", "1"); resolve(result); };
          });
        },
        readResult: async ({ relationship }) => ({ records: relationship === "followers"
          ? [{ username: "alice", instagramUserId: "1" }, { username: "bob", instagramUserId: "2" }]
          : [{ username: "bob", instagramUserId: "2" }, { username: "carol", instagramUserId: "3" }], total: 2, done: true }),
        cancelEnrichment: async () => { window.__cancelCounterBatch?.(); },
        clearResult: async () => {},
        clearSession: async () => {
          localStorage.setItem("mock-session-clear-count", String(Number(localStorage.getItem("mock-session-clear-count") || 0) + 1));
          if (localStorage.getItem("mock-logout-fail") === "1") {
            localStorage.removeItem("mock-logout-fail");
            throw new Error("Simulated logout failure");
          }
        },
      };
      window.Capacitor = {
        isNativePlatform: () => true,
        getPlatform: () => "android",
        isPluginAvailable: () => true,
        Plugins: { InstagramCollector: plugin },
      };
    });
    const nativePage = await nativeContext.newPage();
    nativePage.on("pageerror", (error) => errors.push(error.message));
    await nativePage.goto(`http://127.0.0.1:${server.address().port}`);
    await nativePage.locator("#profileName").fill("test.owner");
    assert.equal(await nativePage.locator("#scanTempoSelect").inputValue(), "slow");
    await nativePage.locator("#scanTempoPanel > summary").click();
    await nativePage.locator("#scanTempoSelect").selectOption("slower");
    const nativeChooserPromise = nativePage.waitForEvent("filechooser");
    await nativePage.locator(".archive-options > summary").click();
    await nativePage.locator("#archiveButton").click();
    await (await nativeChooserPromise).setFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await nativePage.locator("#dashboardView").waitFor({ state: "visible" });
    await nativePage.locator('[data-category="notFollowingBack"]').first().click();
    await nativePage.locator("#sortSelect").selectOption("followers-desc");
    await nativePage.waitForFunction(() => document.querySelector("#counterPanel").dataset.phase === "session");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "1");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-collect-count")), null);
    assert.equal(await nativePage.locator("#loadAccountDetailsButton").count(), 0);
    await nativePage.evaluate(() => localStorage.setItem("mock-scan-success", "1"));
    await nativePage.locator("#refreshButton").click();
    await nativePage.locator("#dashboardMain #collectorPanel").waitFor({ state: "visible" });
    assert.match(await nativePage.locator("#collectorDetails").innerText(), /Geçen süre/);
    assert.doesNotMatch(await nativePage.locator("#collectorDetails").innerText(), /profil takipçi/);
    assert.equal(await nativePage.locator("#archiveRefreshButton").isDisabled(), true);
    assert.equal(await nativePage.locator("#logoutButton").isDisabled(), true);
    await nativePage.evaluate(() => window.__finishMockScan());
    await nativePage.locator("#collectorPanel").waitFor({ state: "hidden" });
    assert.equal(await nativePage.locator("#scanNotice").isVisible(), true);
    assert.match(await nativePage.locator("#scanNotice").innerText(), /2\/3 takip edilen/);
    await nativePage.locator('[data-category="notFollowingBack"]').first().click();
    assert.match(await nativePage.locator("#peopleGrid").innerText(), /Takipçi sayısı yükleniyor/);
    assert.doesNotMatch(await nativePage.locator("#peopleGrid").innerText(), /gönderi|Tek yönlü/);
    await nativePage.locator("#openFilterButton").click();
    assert.equal(await nativePage.locator("#relationshipFilter").isVisible(), false);
    assert.equal(await nativePage.locator("#detailsFilter").isVisible(), false);
    assert.equal(await nativePage.locator("#photoFilter").isVisible(), false);
    await nativePage.locator("#minFollowersFilter").fill("0");
    await nativePage.locator("#maxFollowersFilter").fill("2");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 0);
    assert.equal(await nativePage.locator("#pendingCounters").isVisible(), true);
    assert.match(await nativePage.locator("#emptyTitle").innerText(), /henüz tamamlanmadı/);
    await nativePage.waitForFunction(() => typeof window.__finishCounterBatch === "function");
    await nativePage.evaluate(() => window.__finishCounterBatch());
    await nativePage.waitForFunction(() => document.querySelector("#peopleGrid").textContent.includes("2 takipçi"));
    assert.equal(await nativePage.locator("#pendingCounters").isVisible(), false);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-follower-only")), "true");
    await nativePage.waitForFunction(async () => {
      const data = await window.TakipStorage.load();
      return data.snapshots[0].following.find((record) => record.username === "carol")?.followerCount === 2;
    });
    await nativePage.locator("#openFilterButton").click();
    await nativePage.locator("#minFollowersFilter").fill("3");
    await nativePage.locator("#maxFollowersFilter").fill("");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 0);
    assert.equal(await nativePage.locator("#pendingCounters").isVisible(), false);
    await nativePage.locator("#clearSearchButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 1);
    await nativePage.locator("#openFilterButton").click();
    await nativePage.locator("#minFollowersFilter").fill("1.5");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#filterDialog").isVisible(), true);
    assert.equal(await nativePage.locator("#filterError").isVisible(), true);
    await nativePage.locator("#minFollowersFilter").fill("7");
    await nativePage.locator("#maxFollowersFilter").fill("1");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 1);
    await nativePage.locator("#openFilterButton").click();
    assert.equal(await nativePage.locator("#minFollowersFilter").inputValue(), "1");
    assert.equal(await nativePage.locator("#maxFollowersFilter").inputValue(), "7");
    await nativePage.locator("#resetFiltersButton").click();
    for (const width of [320, 390, 430]) {
      await nativePage.setViewportSize({ width, height: 844 });
      await nativePage.waitForFunction(() => document.querySelector("#sidebar").getBoundingClientRect().right <= 0);
      assert.ok(await nativePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Mobile overflow at ${width}px`);
      assert.ok((await nativePage.locator("#peopleGrid .person-card").first().boundingBox()).height < 130);
      const favorite = await nativePage.locator(".favorite-button").first().boundingBox();
      assert.ok(favorite.width >= 43.9 && favorite.height >= 43.9, JSON.stringify({ width, favorite }));
      assert.deepEqual(await nativePage.locator(".favorite-button").first().evaluate((button) => {
        const style = getComputedStyle(button);
        return [style.width, style.height];
      }), ["44px", "44px"]);
      const toasts = await nativePage.locator("#toastRegion").boundingBox();
      const navigation = await nativePage.locator(".mobile-bottom-nav").boundingBox();
      assert.ok(toasts.y + toasts.height <= navigation.y, "Toasts must not cover mobile navigation");
      assert.equal(await nativePage.locator("#logoutButton").isVisible(), true);
      assert.equal(await nativePage.locator("#dashboardScanTempoPanel").getAttribute("open"), null);
      if (width === 390 && process.env.ATLAS_SMOKE_SCREENSHOT) { await settleLayout(nativePage); await nativePage.screenshot({ path: process.env.ATLAS_SMOKE_SCREENSHOT }); }
    }
    await nativePage.setViewportSize({ width: 1280, height: 720 });
    await nativePage.locator('[data-category="following"]').first().click();
    await nativePage.locator("#openFilterButton").click();
    await nativePage.locator("#minFollowersFilter").fill("0");
    await nativePage.locator("#maxFollowersFilter").fill("0");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 1);
    assert.match(await nativePage.locator("#peopleGrid").innerText(), /@bob/);
    await nativePage.locator("#clearSearchButton").click();
    await verifyLayouts(nativePage);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "4");
    assert.match(await nativePage.locator("#peopleGrid").innerText(), /0 takipçi/);
    await nativePage.locator(".favorite-button").first().click();
    await nativePage.locator("#dashboardScanTempoPanel > summary").click();
    await nativePage.locator("#dashboardScanTempoSelect").selectOption("slow");
    await nativePage.locator("#changeProfileButton").click();
    await nativePage.locator("#keepDataButton").click();
    assert.equal(await nativePage.locator("#scanTempoSelect").inputValue(), "slow");
    await nativePage.locator("#instagramConnectButton").click();
    await nativePage.locator("#setupError").waitFor({ state: "visible" });
    assert.match(await nativePage.locator("#setupError").innerText(), /HTTP 429/);
    assert.equal(await nativePage.locator("#collectorTitle").innerText(), "Instagram istek sınırı");
    assert.equal(await nativePage.locator("#instagramConnectButton").isDisabled(), true);
    assert.equal(await nativePage.locator("#archiveButton").isEnabled(), true);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-tempo")), "slow");
    await nativePage.reload();
    await nativePage.waitForFunction(() => document.querySelector("#instagramConnectTitle").textContent.includes("429"));
    assert.equal(await nativePage.locator("#instagramConnectButton").isDisabled(), true);
    await nativePage.evaluate(() => { document.querySelector("#profileName").value = "test.owner"; document.querySelector("#setupForm").requestSubmit(); });
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-collect-count")), "2");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "4");
    const savedCount = await nativePage.evaluate(async () => (await window.TakipStorage.load()).snapshots.length);
    await nativePage.evaluate(() => localStorage.setItem("mock-logout-fail", "1"));
    await nativePage.locator("#logoutButton").click();
    await nativePage.waitForFunction(() => localStorage.getItem("mock-session-clear-count") === "1" && !document.querySelector("#logoutButton").disabled);
    assert.equal(await nativePage.locator("#dashboardView").isVisible(), true);
    assert.equal(await nativePage.evaluate(async () => (await window.TakipStorage.load()).profile.username), "test.owner");
    await nativePage.locator("#logoutButton").click();
    await nativePage.locator("#onboardingView").waitFor({ state: "visible" });
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-session-clear-count")), "2");
    assert.deepEqual(await nativePage.evaluate(async () => {
      const data = await window.TakipStorage.load();
      return { profile: data.profile, count: data.snapshots.length };
    }), { profile: null, count: savedCount });
    await nativePage.reload();
    await nativePage.locator("#onboardingView").waitFor({ state: "visible" });
    assert.equal(await nativePage.locator("#dashboardView").isVisible(), false);
    assert.equal(await nativePage.locator("#instagramConnectButton").isDisabled(), true);
    await nativePage.locator("#profileName").fill("test.owner");
    await nativePage.locator(".archive-options > summary").click();
    const restoredChooser = nativePage.waitForEvent("filechooser");
    await nativePage.locator("#archiveButton").click();
    await (await restoredChooser).setFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await nativePage.locator("#dashboardView").waitFor({ state: "visible" });
    await nativePage.locator("#changeProfileButton").click();
    await nativePage.locator("#deleteDataButton").click();
    await nativePage.locator("#onboardingView").waitFor({ state: "visible" });
    assert.equal(await nativePage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("takip-atlasi-favorites-v1:")).length), 0);
    assert.deepEqual(errors, []);
    console.log("Simüle edilmiş Android: sade 320/390/430px arayüz, gerçek çıkış çağrısı, kayıtları koruma, yeniden açılış ve kalıcı 429 beklemesi başarılı.");
    await nativeContext.close();
    await verifyDesktopScan(browser);
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
