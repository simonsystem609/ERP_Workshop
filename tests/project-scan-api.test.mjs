import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

test("opt-in local folder scan preserves IDs, entries and notices across a unique rename", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-project-scan-api-"));
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  config.port = await unusedPort();
  config.scanRoots = ["documents/scanned-projects"];
  fs.mkdirSync(path.join(profile, "images"));
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  const scanRoot = path.join(profile, "documents", "scanned-projects");
  fs.mkdirSync(scanRoot, { recursive: true });
  const first = path.join(scanRoot, "DEMO-042 Conveyor Prototype");
  const renamed = path.join(scanRoot, "DEMO-042 Conveyor Prototyp");
  fs.mkdirSync(first);
  fs.writeFileSync(path.join(first, "drawing.pdf"), "%PDF-1.4\nSynthetic test fixture\n", { flag: "wx" });
  const configPath = path.join(profile, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
  const base = `http://127.0.0.1:${config.port}`;
  const child = spawn(process.execPath, [path.join(root, "demo-server.mjs"), "--config", configPath], { cwd: root, windowsHide: true, stdio: "ignore" });
  async function call(route, method = "GET", body) {
    const response = await fetch(`${base}${route}`, { method, headers: { Origin: base, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${value.error || ""}`);
    return value;
  }
  try {
    let ready = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
      if (child.exitCode !== null) throw new Error(`Local scan server exited ${child.exitCode}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Local scan server did not start");
    const before = await call("/api/state");
    const project = Object.values(before.data.projects).find((item) => item.name === path.basename(first));
    assert.ok(project?.id);
    assert.equal(project.active, true);
    const log = await call("/api/worklogs", "POST", { projectId: project.id, userId: "demo-user", hours: 1, workDate: "2026-09-27", workType: "Design" });
    const browser = await call(`/api/projects/${project.id}/browser`);
    assert.equal(browser.files.length, 1);
    assert.ok(browser.files[0].path.endsWith("drawing.pdf"));
    fs.renameSync(first, renamed);
    const scan = await call("/api/scan", "POST", {});
    assert.equal(scan.renamed, 1);
    const after = await call("/api/state");
    assert.equal(after.data.projects[project.id].name, path.basename(renamed));
    assert.equal(after.data.projects[project.id].active, true);
    assert.equal(after.data.workLogs.find((item) => item.id === log.id).projectName, path.basename(renamed));
    const notice = after.data.projectNotices.find((item) => item.kind === "folder-renamed" && item.projectId === project.id);
    assert.ok(notice && !notice.read);
    await call("/api/project-notices/read", "POST", { ids: [notice.id] });
    assert.equal((await call("/api/state")).data.projectNotices.find((item) => item.id === notice.id).read, true);
    assert.equal((await call(`/api/projects/${project.id}/browser`)).files.length, 1);
    fs.mkdirSync(path.join(scanRoot, "DEMO-043 Conveyor Prototyp"));
    assert.equal((await call("/api/scan", "POST", {})).added, 1);
    assert.notEqual(Object.values((await call("/api/state")).data.projects).find((item) => item.name === "DEMO-043 Conveyor Prototyp").id, project.id);
    fs.renameSync(renamed, path.join(profile, "retained-folder-outside-scan"));
    await call("/api/scan", "POST", {});
    await call("/api/scan", "POST", {});
    assert.equal((await call("/api/scan", "POST", {})).missing, 1);
    const missing = await call("/api/state");
    assert.equal(missing.data.projects[project.id].active, true);
    assert.equal(missing.data.projects[project.id].folderMissing, true);
    assert.ok(missing.data.workLogs.some((item) => item.id === log.id));
    assert.equal(missing.data.projectNotices.filter((item) => item.kind === "folder-missing" && item.projectId === project.id).length, 1);
  } finally {
    if (child.exitCode === null) { child.kill(); await new Promise((resolve) => child.once("exit", resolve)); }
  }
});
