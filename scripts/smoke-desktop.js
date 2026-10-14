const assert = require("node:assert/strict");
const { chromium } = require("playwright-core");
const { zipSync, strToU8 } = require("fflate");
const server = require("./serve.js");

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
    await page.reload();
    assert.equal(await page.locator("#sidebarProfileName").innerText(), "@test.owner");
    assert.deepEqual(errors, []);
    console.log("PC ZIP içe aktarma, liste görünümü ve kalıcı kayıt başarılı.");

    const nativeContext = await browser.newContext();
    await nativeContext.addInitScript(() => {
      // Simulate only the native error contract. This is not a live Instagram test.
      localStorage.setItem("takip-atlasi-data-disclosure-v1", "1");
      const plugin = {
        addListener: async () => ({ remove: async () => {} }),
        getConnectionStatus: async () => ({ blockedUntil: Number(localStorage.getItem("mock-blocked-until")) || 0 }),
        collect: async (options) => {
          localStorage.setItem("mock-tempo", options.tempo);
          localStorage.setItem("mock-collect-count", String(Number(localStorage.getItem("mock-collect-count") || 0) + 1));
          localStorage.setItem("mock-blocked-until", String(Date.now() + 900000));
          const error = new Error("Instagram istekleri geçici olarak sınırladı (HTTP 429). Tarama durduruldu.");
          error.code = "RATE_LIMITED";
          error.data = { retryAfterMs: 900000 };
          throw error;
        },
        requestMetadata: async ({ records }) => {
          localStorage.setItem("mock-metadata-count", String(Number(localStorage.getItem("mock-metadata-count") || 0) + 1));
          return { records: records.map((record) => ({ ...record, followerCount: 2, followingCount: 3, postCount: 4 })) };
        },
        cancelEnrichment: async () => {},
        clearResult: async () => {},
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
    await nativePage.locator("#scanTempoSelect").selectOption("original");
    const nativeChooserPromise = nativePage.waitForEvent("filechooser");
    await nativePage.locator("#archiveButton").click();
    await (await nativeChooserPromise).setFiles({ name: "instagram.zip", mimeType: "application/zip", buffer: Buffer.from(zip) });
    await nativePage.locator("#dashboardView").waitFor({ state: "visible" });
    await nativePage.locator('[data-category="notFollowingBack"]').first().click();
    await nativePage.locator("#sortSelect").selectOption("followers-desc");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), null);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-collect-count")), null);
    await nativePage.locator("#loadAccountDetailsButton").click();
    await nativePage.waitForFunction(() => document.querySelector("#loadAccountDetailsButton").hidden);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "1");
    await nativePage.locator('[data-category="following"]').first().click();
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "1");
    await nativePage.locator("#dashboardScanTempoSelect").selectOption("steady");
    await nativePage.locator("#changeProfileButton").click();
    await nativePage.locator("#keepDataButton").click();
    assert.equal(await nativePage.locator("#scanTempoSelect").inputValue(), "steady");
    await nativePage.locator("#instagramConnectButton").click();
    await nativePage.locator("#setupError").waitFor({ state: "visible" });
    assert.match(await nativePage.locator("#setupError").innerText(), /HTTP 429/);
    assert.equal(await nativePage.locator("#collectorTitle").innerText(), "Instagram istek sınırı");
    assert.equal(await nativePage.locator("#instagramConnectButton").isDisabled(), true);
    assert.equal(await nativePage.locator("#archiveButton").isEnabled(), true);
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-tempo")), "steady");
    await nativePage.reload();
    await nativePage.waitForFunction(() => document.querySelector("#instagramConnectTitle").textContent.includes("429"));
    assert.equal(await nativePage.locator("#instagramConnectButton").isDisabled(), true);
    await nativePage.evaluate(() => document.querySelector("#setupForm").requestSubmit());
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-collect-count")), "1");
    assert.equal(await nativePage.evaluate(() => localStorage.getItem("mock-metadata-count")), "1");
    assert.deepEqual(errors, []);
    console.log("Simüle edilmiş Android köprüsü: manuel tarama/sayaçlar, tempo seçimi ve kalıcı 429 beklemesi başarılı.");
    await nativeContext.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
