const assert = require("node:assert/strict");

module.exports = async function ({ browser, api, base }) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  async function morph(button, reduced = false) {
    const svg = button.locator("[data-morph-icon]");
    const before = await svg.boundingBox();
    await svg.evaluate((el) => {
      window.morphWrites = [];
      window.morphObserver?.disconnect();
      window.morphObserver = new MutationObserver((records) => {
        for (const r of records)
          if (r.attributeName === "d")
            window.morphWrites.push(r.target.getAttribute("d"));
      });
      window.morphObserver.observe(el, {
        subtree: true,
        attributes: true,
        attributeFilter: ["d"],
      });
    });
    await button.click();
    await page.waitForTimeout(850);
    const after = await svg.boundingBox();
    assert.equal(after.width, before.width);
    assert.equal(after.height, before.height);
    const writes = await page.evaluate(() => [...new Set(window.morphWrites)]);
    assert.ok(writes.length > 0, "icon did not change");
    assert.ok(
      writes.every((d) => d && !/NaN|Infinity/.test(d)),
      "invalid path during animation",
    );
    if (reduced) assert.ok(writes.length <= 2, "reduced-motion still animates");
    else assert.ok(writes.length > 2, "state swapped without morphing");
  }
  await page.goto(base);
  await page.locator(".password-visibility").first().waitFor();
  const password = page.locator('input[type="password"]').first();
  await password.fill("keep-this-input");
  await morph(page.locator(".password-visibility").first());
  assert.equal(
    await page.locator('input[type="text"]').last().inputValue(),
    "keep-this-input",
  );
  await morph(page.locator(".password-visibility").first());
  await morph(page.locator(".theme-toggle"));
  await page.emulateMedia({ reducedMotion: "reduce" });
  await morph(page.locator(".theme-toggle"), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.context().addCookies((await api.storageState()).cookies);
  await page.goto(base);
  await page.locator(".card-tile").first().waitFor();
  await morph(page.locator(".sidebar-edge-toggle"));
  await morph(page.locator(".sidebar-edge-toggle"));
  const minimap = page.locator(".canvas-tools button[aria-expanded]");
  await morph(minimap);
  await morph(minimap);
  const fullscreen = page.locator('[aria-keyshortcuts="F"]');
  await morph(fullscreen);
  await morph(fullscreen);
  await page.locator(".card-tile").first().click();
  await page.getByRole("dialog").waitFor();
  await morph(page.getByRole("dialog").locator(".select-trigger").first());
  await page.keyboard.press("Escape");
  await page.waitForTimeout(850);
  assert.equal(
    await page.locator('[data-morph-icon="chevronDown"]').count(),
    1,
  );
  // Repeated input should not create malformed paths or duplicate controls.
  const eye = page.locator("[data-morph-icon]");
  assert.ok((await eye.count()) > 0);
  await page.keyboard.press("Escape");
  const sidebar = page.locator(".sidebar-edge-toggle");
  for (let i = 0; i < 6; i++) await sidebar.click({ delay: 20 });
  await page.waitForTimeout(850);
  assert.ok((await sidebar.getAttribute("aria-expanded")) === "true");
  assert.deepEqual(errors, []);
  await page.evaluate(() => window.morphObserver?.disconnect());
  await page.close();
  console.log(
    "PASS morph icons: six state controls, real interpolation, stable dimensions, reduced motion, rapid toggles",
  );
};
