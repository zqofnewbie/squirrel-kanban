// Optional browser regression: starts its own server and disposable data directory.
// Never accepts a production URL or touches development data.
const motion = require("./layer-motion.cjs");
const { chromium, request } = require("playwright");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { mkdtemp, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { randomBytes } = require("node:crypto");
const { setTimeout: sleep } = require("node:timers/promises");

async function main() {
  assert.ok(
    process.env.KANBAN_TEST_BINARY,
    "Build server first and set KANBAN_TEST_BINARY to its absolute path",
  );
  const data = await mkdtemp(path.join(tmpdir(), "squirrel-smoke-"));
  const socket = net.createServer();
  await new Promise((resolve) => socket.listen(0, "127.0.0.1", resolve));
  const port = socket.address().port;
  await new Promise((resolve) => socket.close(resolve));
  const base = `http://127.0.0.1:${port}`;
  const initial = randomBytes(18).toString("hex"),
    password = randomBytes(18).toString("hex");
  const server = spawn(
    path.resolve(process.env.KANBAN_TEST_BINARY),
    ["-addr", `127.0.0.1:${port}`, "-data", data],
    {
      env: {
        ...process.env,
        KANBAN_ADMIN_USER: "smoke_admin",
        KANBAN_ADMIN_PASS: initial,
        KANBAN_DEV: "false",
        KANBAN_COOKIE_SECURE: "false",
      },
      stdio: "ignore",
    },
  );
  let browser;
  const contexts = [];
  const context = async () => {
    const c = await request.newContext({ baseURL: base });
    contexts.push(c);
    return c;
  };
  const call = async (c, method, url, body, status = 200) => {
    const r = await c.fetch(url, {
      method,
      ...(body === undefined ? {} : { data: body }),
    });
    assert.equal(r.status(), status, `${method} ${url}: ${await r.text()}`);
    return r.json();
  };
  try {
    for (let i = 0; ; i++) {
      if (server.exitCode !== null)
        throw new Error("Test server exited before becoming ready");
      try {
        if ((await fetch(base + "/healthz")).ok) break;
      } catch {}
      if (i === 100) throw new Error("Test server startup timed out");
      await sleep(100);
    }
    const admin = await context();
    await call(admin, "POST", "/api/auth/login", {
      username: "smoke_admin",
      password: initial,
    });
    await call(admin, "GET", "/api/workspaces", undefined, 403);
    await call(admin, "PATCH", "/api/auth/password", {
      old_password: initial,
      new_password: password,
    });
    const subResult = await call(admin, "POST", "/api/users", {
      username: "smoke_sub",
      display_name: "Sub",
      role: "workspace_admin",
      password: initial,
      workspace_ids: [],
    });
    const sub = await context();
    await call(sub, "POST", "/api/auth/login", {
      username: "smoke_sub",
      password: initial,
    });
    await call(sub, "PATCH", "/api/auth/password", {
      old_password: initial,
      new_password: password,
    });
    const space = await call(sub, "POST", "/api/workspaces", {
      name: "Smoke space",
    });
    const board = await call(
      sub,
      "POST",
      "/api/boards",
      { name: "Smoke board", workspace_id: space.id },
      201,
    );
    await call(sub, "POST", "/api/users", {
      username: "smoke_member",
      display_name: "Member",
      role: "member",
      password: initial,
      workspace_ids: [space.id],
    });
    const member = await context();
    await call(member, "POST", "/api/auth/login", {
      username: "smoke_member",
      password: initial,
    });
    await call(member, "PATCH", "/api/auth/password", {
      old_password: initial,
      new_password: password,
    });
    await call(member, "POST", "/api/workspaces", { name: "Forbidden" }, 403);
    await call(member, "GET", "/api/users", undefined, 403);
    const detail = await call(member, "GET", `/api/boards/${board.id}`);
    for (const c of [sub, member])
      await call(c, "PUT", "/api/board-order", {
        workspace_id: space.id,
        ids: [board.id],
      });
    const card = await call(
      member,
      "POST",
      `/api/columns/${detail.columns[0].id}/cards`,
      { title: "中 English smoke task" },
      201,
    );
    const list = await call(
      member,
      "POST",
      `/api/cards/${card.id}/checklists`,
      { title: "Steps" },
      201,
    );
    const item = await call(
      member,
      "POST",
      `/api/checklists/${list.id}/items`,
      { text: "First" },
      201,
    );
    await call(member, "PATCH", `/api/items/${item.id}`, {
      text: "Edited",
      done: true,
    });
    const permissions = {
      pin: true,
      cover: true,
      download: true,
      comment: true,
      checklist: true,
      move: true,
      edit: true,
      create: true,
    };
    const shared = await call(
      member,
      "POST",
      "/api/shares",
      { board_id: board.id, name: "Editable", enabled: true, permissions },
      201,
    );
    const readonly = await call(
      member,
      "POST",
      "/api/shares",
      { board_id: board.id, name: "Readonly", enabled: true, permissions: {} },
      201,
    );
    browser = await chromium.launch({
      headless: true,
      ...(process.env.CHROME_PATH
        ? { executablePath: process.env.CHROME_PATH }
        : {}),
    });
    const errors = [];
    for (const [role, api, link] of [
      ["admin", admin],
      ["sub", sub],
      ["member", member],
      ["share", null, shared.short_key],
      ["readonly", null, readonly.short_key],
    ]) {
      for (const language of ["zh", "en"])
        for (const theme of ["light", "dark"]) {
          const page = await browser.newPage({
            viewport: { width: 1280, height: 800 },
            ...(api ? { storageState: await api.storageState() } : {}),
          });
          page.on("pageerror", (error) =>
            errors.push(`${role}: ${error.message}`),
          );
          await page.addInitScript(
            ({ language, theme, id }) => {
              localStorage.setItem("squirrel.language.v1", language);
              localStorage.setItem("squirrel.theme.preference.v1", theme);
              localStorage.setItem("kanban.board", String(id));
            },
            { language, theme, id: board.id },
          );
          await page.goto(base + (link ? "/s/" + link : "/"));
          await page.locator(".card-tile").first().waitFor();
          await page.locator(".card-more").first().hover();
          const menu = page.getByRole("menu");
          await menu.waitFor();
          const text = await menu.innerText();
          assert.equal(/删除卡片|Delete card/.test(text), !link);
          assert.equal(/编辑标题|Edit title/.test(text), role !== "readonly");
          const bounds = await menu.boundingBox();
          assert.ok(
            bounds.x >= 0 &&
              bounds.y >= 0 &&
              bounds.x + bounds.width <= 1280 &&
              bounds.y + bounds.height <= 800,
          );
          await menu.hover();
          await sleep(350);
          assert.ok(
            await menu.isVisible(),
            "menu closes while pointer enters it",
          );
          await motion.arm(menu);
          await page.keyboard.press("Escape");
          await motion.check(page);
          await menu.waitFor({ state: "hidden" });
          await page.locator('[aria-keyshortcuts="F"]').click();
          await page.waitForFunction(() => !!document.fullscreenElement);
          await page.locator(".card-tile").first().click();
          await page.getByRole("dialog").waitFor();
          await sleep(220);
          await motion.arm(page.getByRole("dialog"));
          await page.keyboard.press("Escape");
          await motion.check(page, true);
          await page.locator('[role="dialog"]').waitFor({ state: "detached" });
          await page.locator(".card-tile").first().click();
          await page.getByRole("dialog").waitFor();
          if (role === "share") {
            await page
              .getByRole("button", {
                name: language === "zh" ? "编辑内容" : "Edit content",
                exact: true,
              })
              .click();
            await page
              .getByRole("dialog")
              .locator("textarea")
              .first()
              .fill("Unsaved draft");
            await page.keyboard.press("Escape");
            await page
              .getByRole("dialog")
              .filter({
                hasText: language === "zh" ? "放弃未保存" : "Discard unsaved",
              })
              .waitFor();
            await page
              .getByRole("dialog")
              .last()
              .getByRole("button", {
                name: language === "zh" ? "取消" : "Cancel",
                exact: true,
              })
              .click();
            assert.equal(
              await page
                .getByRole("dialog")
                .locator("textarea")
                .first()
                .inputValue(),
              "Unsaved draft",
            );
            await page.keyboard.press("Escape");
            await page
              .getByRole("dialog")
              .last()
              .getByRole("button", {
                name: language === "zh" ? "放弃修改" : "Discard changes",
                exact: true,
              })
              .click();
          } else await page.keyboard.press("Escape");
          await page.getByRole("dialog").waitFor({ state: "hidden" });
          await page.locator('[aria-keyshortcuts="F"]').click();
          if (api) {
            await page.goto(base + "/administration");
            await page.locator(".administration").waitFor();
            assert.equal(
              await page
                .getByRole("tab", { name: /成员与权限|People & permissions/ })
                .count(),
              role === "member" ? 0 : 1,
            );
            assert.equal(
              await page
                .getByRole("button", { name: /^(新建工作空间|New workspace)$/ })
                .count(),
              role === "member" ? 0 : 1,
            );
            if (role !== "member") {
              await page
                .getByRole("tab", { name: /成员与权限|People & permissions/ })
                .click();
              await page
                .getByRole("button", { name: /^(添加成员|Add member)$/ })
                .click();
              const dialog = page.getByRole("dialog");
              await dialog.waitFor();
              await sleep(220);
              await motion.arm(dialog);
              await page.keyboard.press("Escape");
              await motion.check(page);
              assert.equal(
                await page.locator(".modal-footer").count(),
                1,
                "footer must survive exit",
              );
              await page
                .locator('[role="dialog"]')
                .waitFor({ state: "detached" });
            }
          }
          await page.close();
          console.log(
            `PASS ${role} ${language} ${theme}: menu, fullscreen, drawer, permissions`,
          );
        }
    }
    await require("./morph-icons.cjs")({ browser, api: admin, base });
    await require("./drag-boundaries.cjs")({ browser, api: admin, base });
    assert.deepEqual(errors, []);
    console.log("PASS isolated release smoke");
  } finally {
    await browser?.close();
    await Promise.all(contexts.map((c) => c.dispose()));
    server.kill("SIGTERM");
    await new Promise((resolve) => {
      if (server.exitCode !== null) resolve();
      else server.once("exit", resolve);
    });
    await rm(data, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
