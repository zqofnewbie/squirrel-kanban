const assert = require("node:assert/strict");
module.exports = async function ({ browser, api, base }) {
  const b = browser;
  const admin = await b.newPage({ storageState: await api.storageState() });
  const req = async (path, data, method = "POST") => {
    const r = await admin.request.fetch(base + "/api/" + path, {
      method,
      data,
    });
    assert.ok(r.ok(), path + " " + (await r.text()));
    return r.status() === 204 ? null : r.json();
  };
  const me = await (await admin.request.get(base + "/api/auth/me")).json();
  const spaces = await (
    await admin.request.get(base + "/api/workspaces")
  ).json();
  const space = spaces[0].id;
  const board = await req("boards", {
    name: "边界回归测试",
    workspace_id: space,
  });
  let detail = await (
    await admin.request.get(base + "/api/boards/" + board.id)
  ).json();
  while (detail.columns.length < 3) {
    await req(`boards/${board.id}/columns`, {
      name: "测试列 " + detail.columns.length,
    });
    detail = await (
      await admin.request.get(base + "/api/boards/" + board.id)
    ).json();
  }
  for (const [title, pinned] of [
    ["PIN A", true],
    ["PIN B", true],
    ["普通 A", false],
    ["普通 B", false],
  ]) {
    const c = await req(`columns/${detail.columns[0].id}/cards`, { title });
    if (pinned) await req("cards/" + c.id, { pinned }, "PATCH");
  }
  const share = await req("shares", {
    board_id: board.id,
    name: "边界测试",
    enabled: true,
    expires_at: "",
    permissions: {
      pin: true,
      cover: true,
      download: true,
      comment: true,
      checklist: true,
      move: true,
      edit: true,
      create: true,
    },
  });
  const sid = share.short_key;
  assert.ok(sid);
  for (const mode of ["admin", "share"]) {
    const p = await b.newPage({
      viewport: { width: 1500, height: 900 },
      ...(mode === "admin" ? { storageState: await api.storageState() } : {}),
    });
    await p.goto(base);
    if (mode === "admin") {
      await p.evaluate(
        ({ id, space, user }) => {
          localStorage.setItem("kanban.board", String(id));
          localStorage.setItem("squirrel.workspace." + user, String(space));
        },
        { id: board.id, space, user: me.user.id },
      );
      await p.reload();
    } else await p.goto(base + "/s/" + sid);
    await p.locator(".card-tile").first().waitFor();
    const order = () =>
      p
        .locator(".kanban-column")
        .evaluateAll((es) =>
          es.map((e) =>
            [...e.querySelectorAll(".card-tile")].map((c) =>
              c.getAttribute("aria-label"),
            ),
          ),
        );
    const start = async (name, target) => {
      const source = p
        .locator(".kanban-column .card-tile")
        .filter({ hasText: name })
        .first();
      const a = await source.boundingBox();
      await p.mouse.move(a.x + a.width / 2, a.y + 20);
      await p.mouse.down();
      await p.mouse.move(a.x + a.width / 2 + 8, a.y + 28);
      await p.mouse.move(target.x, target.y, { steps: 14 });
      await p.waitForTimeout(150);
    };
    const initial = await order();
    const empty = await p.locator(".kanban-column").nth(1).boundingBox();
    let moves = 0;
    p.on("request", (r) => {
      if (r.url().endsWith("/move") && r.method() === "POST") moves++;
    });
    // Cancel after crossing into an empty column, with all board reads deliberately blocked.
    await start("普通 A", { x: empty.x + 100, y: empty.y + 50 });
    assert.ok((await order())[1].includes("普通 A"));
    await p.route("**/api/boards/*", (r) => r.abort());
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await p.waitForTimeout(80);
    assert.deepEqual(await order(), initial);
    assert.equal(moves, 0);
    await p.unroute("**/api/boards/*");
    console.log(
      mode,
      "empty-column Esc restores immediately without request PASS",
    );
    const last = await p
      .locator(".kanban-column .card-tile")
      .filter({ hasText: "普通 B" })
      .boundingBox();
    await start(initial[0][0], {
      x: last.x + 120,
      y: last.y + last.height - 8,
    });
    await p.mouse.up();
    await p.waitForTimeout(350);
    const pins = (await order())[0];
    assert.deepEqual(pins.slice(0, 2), initial[0].slice(0, 2).reverse());
    assert.deepEqual(pins.slice(2).sort(), ["普通 A", "普通 B"]);
    console.log(mode, "pinned boundary PASS");
    const pinBefore = await order();
    await start(pinBefore[0][0], { x: empty.x + 100, y: empty.y + 50 });
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await p.waitForTimeout(100);
    assert.deepEqual(await order(), pinBefore);
    console.log(mode, "pinned cross-column cancel PASS");
    const before = await order(),
      first = await p
        .locator(".kanban-column .card-tile")
        .first()
        .boundingBox();
    await start("普通 B", { x: first.x + 100, y: first.y + 5 });
    await p.keyboard.press("Escape");
    await p.mouse.up();
    await p.waitForTimeout(100);
    assert.deepEqual(await order(), before);
    console.log(mode, "same-column Esc PASS");
    await start("普通 A", { x: empty.x + 100, y: empty.y + 50 });
    await p.mouse.up();
    await p.waitForTimeout(400);
    assert.deepEqual((await order())[1], ["普通 A"]);
    await p.reload();
    await p.locator(".card-tile").first().waitFor();
    assert.deepEqual((await order())[1], ["普通 A"]);
    console.log(mode, "empty-column drop persists PASS");
    // Restore fixture for next role using the API.
    const current = await (
        await admin.request.get(base + "/api/boards/" + board.id)
      ).json(),
      card = current.columns[1].cards[0],
      beforeId = current.columns[0].cards.find((c) => !c.pinned)?.id || 0;
    await req(`cards/${card.id}/move`, {
      column_id: detail.columns[0].id,
      before_id: beforeId,
    });
    await p.close();
  }

  await admin.close();
};
