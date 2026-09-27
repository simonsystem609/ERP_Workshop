import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const generic = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function start(configPath, base) {
  const child = spawn(process.execPath, [path.join(root, "demo-server.mjs"), "--config", configPath], {
    cwd: root, windowsHide: true, stdio: "ignore"
  });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`${base}/api/auth`)).ok) return child; } catch {}
    if (child.exitCode !== null) throw new Error(`Secure demo exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill();
  throw new Error("Secure demo did not start");
}
async function stop(child) {
  if (child.exitCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

test("opt-in local passwords gate API, preserve attribution and survive restart", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-secure-local-test-"));
  fs.mkdirSync(path.join(profile, "images"));
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  const port = await unusedPort();
  const base = `http://127.0.0.1:${port}`;
  const configPath = path.join(profile, "config.json");
  generic.port = port;
  generic.security = { mode: "local-password" };
  fs.writeFileSync(configPath, JSON.stringify(generic), { flag: "wx" });
  const adminPassword = "A-unique-local-admin-password-2026";
  const colleaguePassword = "A-unique-demo-colleague-password-2026";
  async function call(route, { method = "GET", body, cookie = "", csrf = "", origin = base } = {}) {
    const headers = { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(csrf ? { "X-CSRF-Token": csrf } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) };
    const response = await fetch(`${base}${route}`, { method, headers,
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    return { response, value, cookie: response.headers.get("set-cookie")?.split(";")[0] || "" };
  }
  let child = await start(configPath, base);
  try {
    const before = await call("/api/auth");
    assert.equal(before.value.authenticated, false);
    assert.equal(before.value.passwordSet, false);
    assert.equal((await call("/api/state")).response.status, 401);
    assert.equal((await call("/api/setup-admin", { method: "POST", origin: "http://attacker.invalid", body: { userId: "demo-user", password: adminPassword } })).response.status, 403);
    assert.equal((await call("/api/setup-admin", { method: "POST", body: { userId: "demo-user", password: "short" } })).response.status, 400);
    const setup = await call("/api/setup-admin", { method: "POST", body: { userId: "demo-user", password: adminPassword } });
    assert.equal(setup.response.status, 201);
    assert.match(setup.response.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
    assert.match(setup.value.csrf, /^[0-9a-f]{64}$/);
    assert.equal((await call("/api/setup-admin", { method: "POST", body: { userId: "demo-user", password: adminPassword } })).response.status, 400);
    assert.equal((await call("/api/state", { cookie: setup.cookie })).value.auth.user.id, "demo-user");
    assert.equal((await call("/api/tasks", { method: "POST", cookie: setup.cookie, body: { title: "Blocked draft" } })).response.status, 403);
    const adminPost = await call("/api/tasks", { method: "POST", cookie: setup.cookie, csrf: setup.value.csrf,
      body: { title: "Admin task", projectId: "demo-project-a" } });
    assert.equal(adminPost.response.status, 201);
    assert.equal(adminPost.value.createdByUserId, "demo-user");
    assert.equal((await call("/api/users/demo-user", { method: "PATCH", cookie: setup.cookie, csrf: setup.value.csrf,
      body: { clearanceLevel: 1 } })).response.status, 400);
    const setColleague = await call("/api/users/demo-colleague", { method: "PATCH", cookie: setup.cookie, csrf: setup.value.csrf,
      body: { password: colleaguePassword } });
    assert.equal(setColleague.response.status, 200);
    assert.equal(JSON.stringify(setColleague.value).includes(colleaguePassword), false);
    assert.equal((await call("/api/login", { method: "POST", body: { userId: "demo-colleague", password: "wrong-password" } })).response.status, 401);
    const colleague = await call("/api/login", { method: "POST", body: { userId: "demo-colleague", password: colleaguePassword } });
    assert.equal(colleague.response.status, 200);
    assert.equal((await call("/api/finance/state", { cookie: colleague.cookie })).response.status, 403);
    assert.equal((await call("/api/users", { cookie: colleague.cookie })).response.status, 403);
    const colleaguePost = await call("/api/tasks", { method: "POST", cookie: colleague.cookie, csrf: colleague.value.csrf,
      body: { title: "Colleague task", projectId: "demo-project-a" } });
    assert.equal(colleaguePost.response.status, 201);
    assert.equal(colleaguePost.value.createdByUserId, "demo-colleague");
    const overtime = await call("/api/worklogs", { method: "POST", cookie: colleague.cookie, csrf: colleague.value.csrf,
      body: { userId: "demo-user", projectId: "demo-project-a", hours: 1, overtime: true } });
    assert.equal(overtime.response.status, 201);
    assert.equal(overtime.value.overtime, false);
    const logout = await call("/api/logout", { method: "POST", cookie: colleague.cookie, csrf: colleague.value.csrf });
    assert.equal(logout.response.status, 200);
    assert.equal((await call("/api/state", { cookie: colleague.cookie })).response.status, 401);
    await stop(child);
    const unsecuredConfig = { ...generic };
    delete unsecuredConfig.security;
    const unsecuredConfigPath = path.join(profile, "config-without-security.json");
    fs.writeFileSync(unsecuredConfigPath, JSON.stringify(unsecuredConfig), { flag: "wx" });
    const downgrade = spawn(process.execPath, [path.join(root, "demo-server.mjs"), "--config", unsecuredConfigPath], {
      cwd: root, windowsHide: true, stdio: ["ignore", "ignore", "pipe"]
    });
    const downgradeExit = new Promise((resolve) => downgrade.once("exit", resolve));
    let downgradeError = "";
    for await (const chunk of downgrade.stderr) downgradeError += chunk;
    const downgradeCode = await downgradeExit;
    assert.notEqual(downgradeCode, 0);
    assert.match(downgradeError, /has local credentials/);
    child = await start(configPath, base);
    assert.equal((await call("/api/auth")).value.passwordSet, true);
    assert.equal((await call("/api/state", { cookie: setup.cookie })).response.status, 401);
    const loginAgain = await call("/api/login", { method: "POST", body: { userId: "demo-user", password: adminPassword } });
    assert.equal(loginAgain.response.status, 200);
    assert.ok((await call("/api/state", { cookie: loginAgain.cookie })).value.data.tasks.some((item) => item.id === colleaguePost.value.id));
    assert.equal(fs.readFileSync(path.join(profile, ".demo-data", "erp-demo.db")).includes(Buffer.from(adminPassword)), false);
  } finally { await stop(child); }
});
