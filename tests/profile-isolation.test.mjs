import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

test("redirected profile import root fails before a localhost listener starts", (t) => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "erp-demo-profile-guard-"));
  const profile = path.join(fixture, "profile");
  const outside = path.join(fixture, "outside");
  fs.mkdirSync(path.join(profile, "images"), { recursive: true });
  fs.mkdirSync(outside);
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  const config = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  config.port = 4779;
  const configPath = path.join(profile, "config.json");
  fs.writeFileSync(configPath, JSON.stringify(config), { flag: "wx" });
  try { fs.symlinkSync(outside, path.join(profile, "imports"), process.platform === "win32" ? "junction" : "dir"); }
  catch (error) { if (["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) { t.skip("Host cannot create a test junction/symlink"); return; } throw error; }
  const result = spawnSync(process.execPath, [path.join(root, "demo-server.mjs"), "--config", configPath], { cwd: root, windowsHide: true, timeout: 5_000, encoding: "utf8" });
  assert.equal(result.status, 1, result.stderr || String(result.error));
  assert.match(result.stderr, /must not redirect/i);
  assert.deepEqual(fs.readdirSync(outside), []);
});
