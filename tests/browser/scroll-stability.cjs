const assert = require("node:assert/strict");

// Exercise actual column CSS at overflow boundaries without changing saved data.
module.exports = async function scrollStability(page) {
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 1100, height: 620 });
  try {
    const result = await page.evaluate(async () => {
      const column = document.querySelector(".column-cards");
      const world = document.querySelector(".board-world");
      const card = column.querySelector(".card-tile");
      if (!card || !world) throw new Error("Missing board fixture");
      const sample = () =>
        new Promise((resolve) => requestAnimationFrame(resolve));
      const results = [];
      world.style.zoom = "1.05";
      // Stable gutter must preserve the available text width on both sides of
      // the overflow threshold, including fractional canvas zoom.
      const probe = card.cloneNode(true);
      probe.style.height = "1200px";
      const before = column.clientWidth;
      column.append(probe);
      await sample();
      const overflowing = column.clientWidth;
      probe.remove();
      await sample();
      results.push({ before, overflowing, after: column.clientWidth });
      for (let i = 0; i < 120; i++) column.append(card.cloneNode(true));
      for (const zoom of [1, 1.05, 1.1, 1.25]) {
        world.style.zoom = String(zoom);
        await sample();
        column.scrollTop = column.scrollHeight;
        const sizes = [];
        for (let i = 0; i < 35; i++) {
          await sample();
          sizes.push(
            [column.clientWidth, column.clientHeight, column.scrollHeight].join(
              ",",
            ),
          );
        }
        results.push({
          zoom,
          sizes: [...new Set(sizes.slice(5))],
          scrollTop: column.scrollTop,
        });
      }
      return results;
    });
    assert.equal(
      result[0].before,
      result[0].overflowing,
      "Scrollbar must not change wrapping width",
    );
    assert.equal(result[0].before, result[0].after);
    for (const sample of result.slice(1)) {
      assert.equal(
        sample.sizes.length,
        1,
        `Unstable list at ${sample.zoom * 100}%`,
      );
      assert.ok(sample.scrollTop > 0, "Long columns must remain scrollable");
    }
  } finally {
    await page.setViewportSize(originalViewport);
    await page.reload();
    await page.locator(".card-tile").first().waitFor();
  }
};
