import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createSourceZip, SOURCE_FILES } from "../scripts/package-source.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

test("source bundle is explicit and excludes runtime configuration and data", () => {
  const result = createSourceZip(root);
  assert.equal(result.manifest.length, SOURCE_FILES.length);
  assert.ok(result.bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])));
  const names = new Set(result.manifest.map((item) => item.path));
  for (const required of ["LICENSE", "README.md", "ERP-HANDOFF.md", "PRIVACY-REVIEW.md", "demo-server.mjs", "app/public/app.js", "app/server.js", "app/helper/workshop-helper.ps1", "config.example.json", "install-startup.bat", "watchdog-launcher.cmd", "cloudflare-launcher.cmd", "hosting/host-plan.mjs", "hosting/host-control.mjs", "scripts/create-original-fixture.mjs", "scripts/package-source.mjs", "app/vendor/erp-glb-viewer-source/src/viewer.mjs", "docs/images/menus/01-dashboard.png", "docs/images/menus/25-archive.png", "docs/images/functions/model-viewer.png", "documents/projects/d1df4d9de458995a26a8f5f9cdc83da3242ca3f93d0b5c2aa5323591fd61be81/synthetic-line.dxf"]) assert.ok(names.has(required), required);
  for (const forbidden of ["config.json", ".demo-data/erp-demo.db", ".demo-data/original-erp-synthetic.db", "app/host-reference/install-startup.bat.txt", "app/cloudflared/tunnel-token.txt"]) assert.ok(!names.has(forbidden), forbidden);
  assert.match(fs.readFileSync(path.join(root, "app", "server.js"), "utf8").slice(0, 300), /throw new Error\("Local sanitized source draft: server startup intentionally disabled/);
  const example = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  assert.equal(example.mode, "localhost-demo");
  assert.equal(example.security, undefined);
  assert.equal(example.futureHosting.status, "reference-only");
  assert.equal(example.futureHosting.cloudflare.enabled, false);
  assert.equal(example.futureHosting.cloudflare.tokenSourceFile, "");
});

test("a Git checkout has no unreviewed source candidate outside the ZIP allowlist", () => {
  if (!fs.existsSync(path.join(root, ".git"))) return; // a downloaded source ZIP has no Git metadata
  const candidates = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);
  assert.deepEqual(candidates.sort(), [...SOURCE_FILES].sort());
});

test("public source contains no non-documentation IPv4 address literals", () => {
  const approved = /^(?:0\.0\.0\.0|127\.0\.0\.1|192\.0\.2\.\d{1,3}|198\.51\.100\.\d{1,3}|203\.0\.113\.\d{1,3})$/;
  const binary = /\.(?:png|glb|zip)$/i;
  for (const name of SOURCE_FILES) {
    if (binary.test(name)) continue;
    const body = fs.readFileSync(path.join(root, ...name.split("/")), "utf8");
    const addresses = body.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g) || [];
    for (const address of addresses) assert.match(address, approved, `${name}: ${address}`);
  }
});
