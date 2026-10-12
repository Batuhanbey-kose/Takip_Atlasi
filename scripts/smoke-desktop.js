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
    assert.equal(await page.locator("#instagramConnectButton").isVisible(), false);
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
  } finally {
    if (browser) {
      await browser.close();
    }
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
