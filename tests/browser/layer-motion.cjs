// Observe real closing frames, rather than accepting aria-hidden as a completed exit.
const assert = require("node:assert/strict");
exports.arm = async (locator) => {
  await locator.evaluate((panel) => {
    const layer = panel.closest(".motion-layer, .motion-panel");
    const height = panel.offsetHeight;
    window.__layerExit = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error("Layer did not close"));
      }, 3000);
      const observer = new MutationObserver(() => {
        if (layer.dataset.motion !== "exit") return;
        observer.disconnect();
        setTimeout(() => {
          const style = getComputedStyle(panel);
          const result = {
            connected: panel.isConnected,
            opacity: Number(style.opacity),
            stableHeight: Math.abs(panel.offsetHeight - height) < 1,
            transform: style.transform,
            animation: style.animationName,
            transition: style.transitionProperty,
          };
          clearTimeout(timeout);
          resolve(result);
        }, 65);
      });
      observer.observe(layer, {
        attributes: true,
        attributeFilter: ["data-motion"],
      });
    });
  });
};
exports.check = async (page, drawer = false) => {
  const result = await page.evaluate(() => window.__layerExit);
  assert.ok(result.connected, "layer must survive its closing animation");
  assert.ok(result.opacity > 0 && result.opacity < 1, JSON.stringify(result));
  assert.ok(
    result.stableHeight,
    "closing footer/content must not shrink the panel",
  );
  assert.equal(result.animation, "none");
  assert.ok(
    result.transition.includes("opacity") &&
      result.transition.includes("transform"),
  );
  if (drawer) {
    const matrix = result.transform
      .match(/matrix\(([^)]+)\)/)?.[1]
      .split(",")
      .map(Number);
    assert.ok(
      matrix && matrix[0] === 1 && matrix[4] > 0 && matrix[5] === 0,
      "drawer must slide right without scaling",
    );
  }
};
