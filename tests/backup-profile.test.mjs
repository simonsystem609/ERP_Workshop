import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { backupProfile } from "../scripts/backup-profile.mjs";

async function unusedPort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
function hash(file) { return createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }

test("profile backup preserves config, files, and a verified SQLite snapshot without overwrite", async () => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), "erp-profile-backup-test-"));
  const profile = path.join(area, "profile");
  const backup = path.join(area, "snapshot");
  fs.mkdirSync(path.join(profile, "images"), { recursive: true });
  fs.mkdirSync(path.join(profile, "documents"));
  fs.mkdirSync(path.join(profile, "imports", "cadmodels"), { recursive: true });
  fs.mkdirSync(path.join(profile, ".demo-data"));
  fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify({ port: await unusedPort() }));
  fs.writeFileSync(path.join(profile, "images", "logo.svg"), "<svg></svg>");
  fs.writeFileSync(path.join(profile, "documents", "example.txt"), "demo document");
  fs.writeFileSync(path.join(profile, "imports", "cadmodels", "example.json"), "{}\n");
  const db = new DatabaseSync(path.join(profile, ".demo-data", "erp-demo.db"));
  db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO items(name) VALUES ('saved');");
  db.close();

  const manifest = await backupProfile({ configPath: path.join(profile, "config.json"), outDir: backup });
  assert.equal(manifest.format, "workshop-erp-profile-backup-v1");
  assert.ok(manifest.files.some((file) => file.path === ".demo-data/erp-demo.db"));
  assert.equal(hash(path.join(profile, "documents", "example.txt")), hash(path.join(backup, "documents", "example.txt")));
  const restored = new DatabaseSync(path.join(backup, ".demo-data", "erp-demo.db"), { readOnly: true });
  assert.equal(restored.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.equal(restored.prepare("SELECT name FROM items").get().name, "saved");
  restored.close();
  assert.ok(fs.existsSync(path.join(backup, "backup-manifest.json")));
  await assert.rejects(backupProfile({ configPath: path.join(profile, "config.json"), outDir: backup }), /already exists/);
  assert.equal(fs.readFileSync(path.join(profile, "documents", "example.txt"), "utf8"), "demo document");
});

test("profile backup refuses output inside source profile", async () => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), "erp-profile-backup-bounds-"));
  fs.mkdirSync(path.join(area, "images"));
  fs.writeFileSync(path.join(area, "config.json"), JSON.stringify({ port: await unusedPort() }));
  fs.writeFileSync(path.join(area, "images", "logo.svg"), "<svg></svg>");
  const target = path.join(area, "snapshot");
  await assert.rejects(backupProfile({ configPath: path.join(area, "config.json"), outDir: target }), /outside the profile tree/);
  assert.equal(fs.existsSync(target), false);
});
