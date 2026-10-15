const assert = require("node:assert/strict");

exports.menu = async (menu) => {
  const values = await menu.getByRole("menuitem").evaluateAll((items) =>
    items.map((item) => ({
      font: getComputedStyle(item).fontSize,
      line: getComputedStyle(item).lineHeight,
      icons: Array.from(item.querySelectorAll("svg")).map(
        (svg) => getComputedStyle(svg).width,
      ),
      fits: item.scrollWidth <= item.clientWidth + 1,
    })),
  );
  assert.ok(values.length);
  for (const value of values) {
    assert.equal(value.font, "13px");
    assert.equal(value.line, "20px");
    assert.ok(value.icons.every((size) => size === "15px"));
    assert.ok(value.fits, "Menu labels must fit");
  }
};
exports.overview = async (page, shared) => {
  const inputs = page.locator(
    shared ? ".shared-toolbar input" : ".header-filter input",
  );
  const values = await inputs.evaluateAll((items) =>
    items.map((item) => ({
      size: parseFloat(getComputedStyle(item).fontSize),
      placeholder: getComputedStyle(item, "::placeholder").fontSize,
      font: getComputedStyle(item).fontSize,
    })),
  );
  assert.ok(values.length);
  for (const value of values) {
    assert.ok(value.size >= 12 && value.size <= 13);
    assert.equal(value.placeholder, value.font);
  }
  if (!shared) {
    const buttons = await page
      .locator(".board-toolbar-actions > button")
      .evaluateAll((items) =>
        items.map((item) => ({
          size: parseFloat(getComputedStyle(item).fontSize),
          height: item.offsetHeight,
          fits: item.scrollWidth <= item.clientWidth + 1,
        })),
      );
    assert.ok(buttons.length >= 3);
    for (const button of buttons) {
      assert.ok(button.size >= 12 && button.size <= 13);
      assert.equal(button.height, 32);
      assert.ok(button.fits);
    }
  }
};
exports.navigationMenus = async (page) => {
  for (const selector of [
    ".workspace-switcher",
    ".header-board-menu > button",
    '.column-heading button[aria-haspopup="menu"]',
  ]) {
    const trigger = page.locator(selector).first();
    await trigger.click();
    const menu = page.getByRole("menu");
    await menu.waitFor();
    await exports.menu(menu);
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () => document.querySelectorAll('[role="menu"]').length === 0,
    );
    await page.mouse.move(700, 750);
  }
};
exports.drawer = async (dialog) => {
  const sizes = await dialog
    .locator("button")
    .evaluateAll((items) =>
      items
        .filter((item) => item.classList.contains("text-[12px]"))
        .map((item) => getComputedStyle(item).fontSize),
    );
  for (const size of sizes)
    assert.equal(size, "12px", "Small drawer buttons must not inherit 16px");
};
