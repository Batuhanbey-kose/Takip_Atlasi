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
    collector.start({ username: "test.owner", tempo: "fast" });
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
    assert.equal(collector.readResult("following").records.find((record) => record.username === "beta").followerCount, 0);
    assert.equal(collector.summary.profilesReady, 2);
    assert.ok(requests.filter((request) => request.kind === "list").every((request) => request.count === "100"));
    assert.equal(requests.filter((request) => request.kind === "profile" && request.id === "2").length, 1);
    assert.equal(requests.find((request) => request.id === "2").headers["x-asbd-id"], "129477");
    console.log("Gerçek tarayıcı + taklit Instagram yanıtları: PC giriş köprüsü, belge başlangıcı gözlemcisi, 100'lük tarama ve aynı akışta profil sayaçları başarılı.");
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
    await page.locator('[data-category="favorites"]').click();
    assert.match(await page.locator("#peopleGrid").innerText(), /@carol/);
    await page.locator("#densityButton").click();
    await page.reload();
    await page.locator("#dashboardView").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.body.dataset.listDensity), "comfortable");
    await page.locator('[data-category="favorites"]').click();
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
    for (const theme of ["aurora", "amoled", "coffee", "cyber"]) {
      await page.locator("#themeButton").click();
      await page.locator(`[data-theme-option="${theme}"]`).click();
      await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme);
      await page.locator("#themeDialog").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.documentElement.dataset.themeMode), theme === "coffee" ? "light" : "dark");
    }
    await page.reload();
    await page.locator("#dashboardView").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "cyber");
    await page.locator('[data-category="favorites"]').click();
    assert.match(await page.locator("#peopleGrid").innerText(), /@carol/);
    assert.match(await page.locator("#peopleGrid .status-badge").textContent(), /Bu kayıtta yok/);
    if (process.env.ATLAS_THEME_SCREENSHOT) { await settleLayout(page); await page.screenshot({ path: process.env.ATLAS_THEME_SCREENSHOT }); }
    console.log("Yıldızlılar, 60 hesabın tamamını/arama sonucunu kopyalama, görünüm ve dört yeni tema kalıcı olarak doğrulandı.");

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
            return { username: options.username, followersCount: 2, followingCount: 2, profilesReady: 3, profilesTotal: 3 };
          }
          localStorage.setItem("mock-blocked-until", String(Date.now() + 900000));
          const error = new Error("Instagram istekleri geçici olarak sınırladı (HTTP 429). Tarama durduruldu.");
          error.code = "RATE_LIMITED";
          error.data = { retryAfterMs: 900000 };
          throw error;
        },
        requestMetadata: async () => {
          localStorage.setItem("mock-metadata-count", String(Number(localStorage.getItem("mock-metadata-count") || 0) + 1));
          throw new Error("Sonuç ekranı bağımsız sayaç isteği göndermemeli");
        },
        readResult: async ({ relationship }) => ({ records: relationship === "followers"
          ? [{ username: "alice", instagramUserId: "1", followerCount: 10 }, { username: "bob", instagramUserId: "2", followerCount: 3 }]
          : [{ username: "bob", instagramUserId: "2", followerCount: 3 }, { username: "carol", instagramUserId: "3", followerCount: 2 }], total: 2, done: true }),
        cancelEnrichment: async () => {},
        clearResult: async () => {},
        clearSession: async () => {},
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
    assert.equal(await nativePage.locator("#scanTempoSelect").inputValue(), "steady");
    await nativePage.locator("#scanTempoSelect").selectOption("fast");
    const nativeChooserPromise = nativePage.waitForEvent("filechooser");
    await nativePage.locator("#archiveButton").click();
    await (await nativeChooserPromise).setFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await nativePage.locator("#dashboardView").waitFor({ state: "visible" });
    await nativePage.locator('[data-category="notFollowingBack"]').first().click();
    await nativePage.locator("#sortSelect").selectOption("followers-desc");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), null);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-collect-count")), null);
    assert.equal(await nativePage.locator("#loadAccountDetailsButton").count(), 0);
    await nativePage.evaluate(() => localStorage.setItem("mock-scan-success", "1"));
    await nativePage.locator("#refreshButton").click();
    await nativePage.locator("#dashboardMain #collectorPanel").waitFor({ state: "visible" });
    assert.match(await nativePage.locator("#collectorDetails").innerText(), /2 \/ 3 profil takipçi sayısı/);
    assert.equal(await nativePage.locator("#archiveRefreshButton").isDisabled(), true);
    await nativePage.evaluate(() => window.__finishMockScan());
    await nativePage.locator("#collectorPanel").waitFor({ state: "hidden" });
    await nativePage.locator('[data-category="notFollowingBack"]').first().click();
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), null);
    assert.match(await nativePage.locator("#peopleGrid").innerText(), /2 takipçi/);
    assert.doesNotMatch(await nativePage.locator("#peopleGrid").innerText(), /gönderi|Tek yönlü/);
    await nativePage.locator("#openFilterButton").click();
    assert.equal(await nativePage.locator("#relationshipFilter").isVisible(), false);
    assert.equal(await nativePage.locator("#detailsFilter").isVisible(), false);
    assert.equal(await nativePage.locator("#photoFilter").isVisible(), false);
    await nativePage.locator("#minFollowersFilter").fill("3");
    await nativePage.locator("#applyFiltersButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 0);
    await nativePage.locator("#clearSearchButton").click();
    assert.equal(await nativePage.locator("#peopleGrid .person-card").count(), 1);
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
      if (width === 390 && process.env.ATLAS_SMOKE_SCREENSHOT) { await settleLayout(nativePage); await nativePage.screenshot({ path: process.env.ATLAS_SMOKE_SCREENSHOT }); }
    }
    await nativePage.setViewportSize({ width: 1280, height: 720 });
    await nativePage.locator('[data-category="following"]').first().click();
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), null);
    await nativePage.locator(".favorite-button").first().click();
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
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), null);
    await nativePage.locator("#changeProfileButton").click();
    await nativePage.locator("#deleteDataButton").click();
    await nativePage.locator("#onboardingView").waitFor({ state: "visible" });
    assert.equal(await nativePage.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("takip-atlasi-favorites-v1:")).length), 0);
    assert.deepEqual(errors, []);
    console.log("Simüle edilmiş Android: tek taramada sayaçlar, görünür ilerleme, 320/390/430px mobil arayüz, veri silme ve kalıcı 429 beklemesi başarılı.");
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
