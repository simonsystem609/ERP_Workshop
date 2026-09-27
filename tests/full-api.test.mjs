import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { workbook } from "../xlsx-demo.mjs";
import { projectFolderName } from "../demo-project-browser.mjs";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const generic = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
async function start(configPath, port) {
  const child = spawn(process.execPath, [path.join(root, "demo-server.mjs"), "--config", configPath], { cwd: root, windowsHide: true, stdio: "ignore" });
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/api/state`)).ok) return child; } catch {}
    if (child.exitCode !== null) throw new Error(`Demo server exited ${child.exitCode}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill(); throw new Error("Demo server did not start");
}
async function stop(child) {
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
}

test("all-menu local API persists in an isolated demo SQLite database", async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-public-api-test-"));
  fs.mkdirSync(path.join(profile, "images"));
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  fs.mkdirSync(path.join(profile, "documents"));
  fs.copyFileSync(path.join(root, "documents", "demo-bom.csv"), path.join(profile, "documents", "demo-bom.csv"));
  const projectFilesDir = path.join(profile, "documents", "projects", projectFolderName("demo-project-a"));
  const otherProjectDir = path.join(profile, "documents", "projects", projectFolderName("demo-project-b"));
  fs.mkdirSync(path.join(projectFilesDir, "drawings"), { recursive: true });
  fs.mkdirSync(otherProjectDir, { recursive: true });
  fs.writeFileSync(path.join(projectFilesDir, "drawings", "sample.slddrw"), "Synthetic drawing fixture", { flag: "wx" });
  fs.writeFileSync(path.join(projectFilesDir, "sample.pdf"), "%PDF-1.4\nSynthetic PDF fixture\n", { flag: "wx" });
  fs.writeFileSync(path.join(otherProjectDir, "private.pdf"), "%PDF-1.4\nOther demo project\n", { flag: "wx" });
  const sampleXlsx = path.join(profile, "documents", "sample.xlsx");
  fs.writeFileSync(sampleXlsx, workbook(["Megnevezés", "Mennyiség"], [["Árvíztűrő tükörfúrógép", 2]]), { flag: "wx" });
  const worklogInbox = path.join(profile, "imports", "worklogs", "inbox");
  fs.mkdirSync(worklogInbox, { recursive: true });
  const importFile = path.join(worklogInbox, "synthetic-batch.json");
  fs.writeFileSync(importFile, JSON.stringify({ source: "demo-tracker", defaults: { userName: "Demo User", workType: "Design" }, entries: [
    { projectName: "DEMO-001 Conveyor Prototype", minutes: 90, workDate: "2026-09-26", overtime: true, externalId: "demo-session-1" },
    { userName: "Demo Colleague", projectName: "Unknown sample project", minutes: 30, overtime: true, externalId: "demo-session-2" },
    { userName: "Nobody", minutes: 10, externalId: "demo-session-3" }
  ] }), { flag: "wx" });
  const oldTime = new Date(Date.now() - 2_000);
  fs.utimesSync(importFile, oldTime, oldTime);
  const port = await unusedPort();
  generic.port = port;
  const configPath = path.join(profile, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(generic));
  const base = `http://127.0.0.1:${port}`;
  const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xj8AAAAASUVORK5CYII=";
  async function call(route, method = "GET", body) {
    const response = await fetch(`${base}${route}`, { method, headers: { "Content-Type": "application/json", Origin: base }, body: body === undefined ? undefined : JSON.stringify(body) });
    const value = await response.json();
    assert.ok(response.ok, `${method} ${route}: ${response.status} ${value.error || ""}`);
    return value;
  }
  let child = await start(configPath, port);
  try {
    const initial = await call("/api/state");
    assert.equal(initial.data.cncTasks.length, 1);
    assert.equal(initial.data.cncMachines.length, 1);
    assert.equal((await call("/api/finance/state")).suppliers.length, 1);
    assert.equal(initial.data.materialLengths.includes("3000"), true);
    assert.equal(initial.data.workLogs.filter((row) => row.source === "demo-tracker").length, 2);
    assert.equal(initial.data.workLogs.find((row) => row.externalId === "demo-session-1").overtime, true);
    const colleagueImport = initial.data.workLogs.find((row) => row.externalId === "demo-session-2");
    assert.equal(colleagueImport.overtime, false);
    assert.equal(colleagueImport.projectId, "");
    assert.ok(colleagueImport.note.includes("Unknown sample project"));
    const importRoot = path.join(profile, "imports", "worklogs");
    assert.ok(fs.existsSync(path.join(importRoot, "worktypes.json")));
    assert.equal(fs.readdirSync(path.join(importRoot, "processed")).length, 1);
    const rejected = fs.readdirSync(path.join(importRoot, "failed")).find((name) => name.endsWith(".json"));
    assert.ok(rejected);
    assert.equal(JSON.parse(fs.readFileSync(path.join(importRoot, "failed", rejected), "utf8")).defaults.userName, "Demo User");
    const browser = await call("/api/files/browse?filter=office");
    assert.ok(browser.entries.some((entry) => entry.name === "sample.xlsx"));
    assert.ok(!browser.entries.some((entry) => entry.name === "demo-bom.csv"));
    const projectBrowser = await call("/api/projects/demo-project-a/browser");
    assert.equal(projectBrowser.files.length, 2);
    assert.deepEqual(new Set(projectBrowser.files.map((file) => file.kind)), new Set(["drawing", "pdf"]));
    assert.ok(projectBrowser.files.every((file) => file.path.startsWith("documents/projects/")));
    const pdfPath = projectBrowser.files.find((file) => file.kind === "pdf").path;
    const drawingPath = projectBrowser.files.find((file) => file.kind === "drawing").path;
    const projectPdf = await fetch(`${base}/api/projects/demo-project-a/browser/pdf?path=${encodeURIComponent(pdfPath)}`);
    assert.equal(projectPdf.status, 200);
    assert.equal(projectPdf.headers.get("content-type"), "application/pdf");
    assert.ok((await projectPdf.text()).startsWith("%PDF-1.4"));
    assert.equal((await fetch(`${base}/api/projects/demo-project-a/browser/file?path=${encodeURIComponent(drawingPath)}`)).status, 200);
    assert.equal((await fetch(`${base}/api/projects/demo-project-a/browser/pdf?path=${encodeURIComponent(drawingPath)}`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/demo-project-b/browser/file?path=${encodeURIComponent(pdfPath)}`)).status, 400);
    assert.equal((await fetch(`${base}/api/projects/missing-project/browser`)).status, 404);
    const redirectedTarget = path.join(profile, "redirect-target");
    fs.mkdirSync(redirectedTarget);
    fs.writeFileSync(path.join(redirectedTarget, "leak.pdf"), "%PDF-1.4\nNot a project file\n", { flag: "wx" });
    try {
      fs.symlinkSync(redirectedTarget, path.join(projectFilesDir, "redirected"), process.platform === "win32" ? "junction" : "dir");
      const redirectedPath = `documents/projects/${projectFolderName("demo-project-a")}/redirected/leak.pdf`;
      assert.equal((await fetch(`${base}/api/projects/demo-project-a/browser/file?path=${encodeURIComponent(redirectedPath)}`)).status, 400);
      assert.ok(!(await call("/api/projects/demo-project-a/browser")).files.some((file) => file.name === "leak.pdf"));
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    }
    const outsideBrowse = await fetch(`${base}/api/files/browse?path=${encodeURIComponent(path.dirname(profile))}&filter=office`);
    assert.equal(outsideBrowse.status, 400);
    const outsideAttachment = await fetch(`${base}/api/material-requests`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ projectId: "demo-project-a", userId: "demo-user", material: "Must not save", attachmentPath: path.join(profile, "images", "logo.svg") }) });
    assert.equal(outsideAttachment.status, 400);
    const bom = await call("/api/boms", "POST", { projectId: "demo-project-a", name: "Local BOM", filePath: "documents/demo-bom.csv" });
    assert.equal(bom.items.length, 2);
    assert.equal((await fetch(`${base}/api/boms/${bom.id}/file`)).status, 200);
    const uploaded = await fetch(`${base}/api/boms/upload?projectId=demo-project-a&name=Uploaded`, { method: "POST", headers: { Origin: base, "X-File-Name": encodeURIComponent("sample.xlsx") }, body: fs.readFileSync(sampleXlsx) });
    assert.equal(uploaded.status, 201);
    assert.equal((await uploaded.json()).items.length, 1);
    const malformedUpload = await fetch(`${base}/api/boms/upload?projectId=demo-project-a&name=Malformed`, { method: "POST", headers: { Origin: base, "X-File-Name": encodeURIComponent("malformed.xlsx") }, body: Buffer.from("not a workbook") });
    assert.equal(malformedUpload.status, 201);
    const malformedBom = await malformedUpload.json();
    assert.equal(malformedBom.importError, "Could not read this BOM file. Check the format and try again.");
    assert.deepEqual(malformedBom.items, []);
    const savedMalformedBom = (await call("/api/state")).data.boms.find((item) => item.id === malformedBom.id);
    assert.equal(savedMalformedBom.importError, malformedBom.importError);
    const linkedWorklog = await call("/api/worklogs", "POST", { projectId: "demo-project-a", userId: "demo-user", workType: "Design", hours: 1, filePath: "documents/sample.xlsx" });
    assert.equal(linkedWorklog.fileName, "sample.xlsx");
    const todo = await call("/api/dashboard/todos", "POST", { text: "Demo image todo", imageDataUrl: pixel });
    assert.ok(todo.image?.name.endsWith(".png"));
    assert.equal((await fetch(`${base}/api/dashboard/todos/${todo.id}/image`)).headers.get("content-type"), "image/png");
    const task = await call("/api/tasks", "POST", { projectId: "demo-project-a", userId: "demo-user", title: "Demo image task", imageDataUrls: [pixel] });
    assert.equal(task.images.length, 1);
    await call(`/api/tasks/${task.id}/images`, "POST", { imageDataUrl: pixel, imageName: "another.png" });
    assert.equal((await fetch(`${base}/api/tasks/${task.id}/images/1`)).status, 200);
    const prefab = await call("/api/material-requests", "POST", { projectId: "demo-project-a", userId: "demo-user", prefabTransport: true, imageDataUrls: [pixel] });
    assert.equal(prefab.images.length, 1);
    assert.equal((await fetch(`${base}/api/material-requests/${prefab.id}/images/0`)).status, 200);
    const unsafeImage = await fetch(`${base}/api/tasks`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ projectId: "demo-project-a", userId: "demo-user", title: "Invalid image", imageDataUrls: ["data:image/svg+xml;base64,PHN2Zz48L3N2Zz4="] }) });
    assert.equal(unsafeImage.status, 400);
    assert.deepEqual((await call("/api/modelling/folders")).folders, []);
    const modelling = await call("/api/modelling/photos", "POST", { folder: "Sample Project", imageDataUrl: pixel });
    assert.equal(modelling.folder, "Sample Project");
    assert.match(modelling.name, /^[0-9a-f-]+\.png$/);
    assert.ok(fs.existsSync(path.join(profile, modelling.relativePath)));
    assert.ok((await call("/api/modelling/folders")).folders.includes("Sample Project"));
    const escapedModelling = await fetch(`${base}/api/modelling/photos`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ folder: "..\\outside", imageDataUrl: pixel }) });
    assert.equal(escapedModelling.status, 400);
    const invalidModelling = await fetch(`${base}/api/modelling/photos`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ folder: "Sample Project", imageDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" }) });
    assert.equal(invalidModelling.status, 400);
    try {
      fs.symlinkSync(redirectedTarget, path.join(profile, ".demo-data", "modelling", "Redirected"), process.platform === "win32" ? "junction" : "dir");
      const redirectedModelling = await fetch(`${base}/api/modelling/photos`, { method: "POST", headers: { "Content-Type": "application/json", Origin: base }, body: JSON.stringify({ folder: "Redirected", imageDataUrl: pixel }) });
      assert.equal(redirectedModelling.status, 400);
      assert.ok(!(await call("/api/modelling/folders")).folders.includes("Redirected"));
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) throw error;
    }
    const finance = await call("/api/finance/suppliers", "POST", { name: "Synthetic New Supplier" });
    await call(`/api/finance/suppliers/${finance.id}`, "PATCH", { contact: "Demo Contact" });
    const project = await call("/api/projects/manual", "POST", { name: "DEMO-003 Sample Project" });
    const material = await call("/api/material-requests", "POST", { projectId: project.id, userId: "demo-user", material: "Sample steel", length: "2400", quantity: 1, attachmentPath: sampleXlsx });
    assert.equal(material.attachment.name, "sample.xlsx");
    const preview = await fetch(`${base}/api/material-requests/${material.id}/attachment/view`);
    assert.equal(preview.status, 200);
    assert.ok((await preview.text()).includes("Árvíztűrő tükörfúrógép"));
    await call("/api/catalog", "POST", { kind: "toolName", value: "Sample cutter" });
    await call(`/api/material-requests/${material.id}`, "DELETE");
    const archived = await call("/api/archive/state");
    const record = archived.archives.find((item) => item.type === "material-request" && item.data.id === material.id);
    assert.ok(record);
    await call(`/api/archive/${record.id}/restore`, "POST", { projectId: project.id });
    await stop(child);
    fs.copyFileSync(path.join(importRoot, "processed", fs.readdirSync(path.join(importRoot, "processed"))[0]), path.join(worklogInbox, "repeat.json"));
    fs.utimesSync(path.join(worklogInbox, "repeat.json"), oldTime, oldTime);
    child = await start(configPath, port);
    const after = await call("/api/state");
    assert.ok(after.data.materialRequests.some((item) => item.id === material.id));
    assert.ok(after.data.tasks.some((item) => item.id === task.id && item.images?.length === 2));
    assert.equal((await fetch(`${base}/api/tasks/${task.id}/images/0`)).status, 200);
    assert.ok(after.data.boms.some((item) => item.id === bom.id));
    assert.ok(after.data.toolNames.includes("Sample cutter"));
    assert.equal((await call("/api/finance/state")).suppliers.find((item) => item.id === finance.id).contact, "Demo Contact");
    assert.equal((await call("/api/archive/state")).archives.find((item) => item.id === record.id).restoredProjectId, project.id);
    assert.equal(after.data.workLogs.filter((row) => row.source === "demo-tracker").length, 2);
    assert.ok((await call("/api/modelling/folders")).folders.includes("Sample Project"));
    assert.ok(fs.existsSync(path.join(profile, modelling.relativePath)));
    assert.ok(fs.existsSync(path.join(profile, ".demo-data", "erp-demo.db")));
  } finally { if (child.exitCode === null) await stop(child); }
});
