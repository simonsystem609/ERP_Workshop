import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "demo-server.mjs");
test("generic config validates without starting a listener", () => {
  const run = spawnSync(process.execPath, [entry, "--check-config"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Config OK/);
});
test("unsafe host key is rejected before any listener", () => {
  const fixture = path.join(root, "tests", "fixtures", "unsafe-config.json");
  const run = spawnSync(process.execPath, [entry, "--check-config", "--config", fixture], { cwd: root, encoding: "utf8" });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /Unknown or unsafe config key: host/);
});
test("CAD sidecar format is configurable but must be a simple identifier", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-demo-cad-format-"));
  fs.mkdirSync(path.join(profile, "images"));
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  const original = JSON.parse(fs.readFileSync(path.join(root, "config.json"), "utf8"));
  const run = (name, format) => {
    const file = path.join(profile, name);
    fs.writeFileSync(file, JSON.stringify({ ...original, cadModelFormat: format }), { flag: "wx" });
    return spawnSync(process.execPath, [entry, "--check-config", "--config", file], { cwd: root, encoding: "utf8" });
  };
  const valid = run("valid.json", "my-cadmodel-v1");
  assert.equal(valid.status, 0, valid.stderr);
  const invalid = run("invalid.json", ["my-cadmodel-v1"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /cadModelFormat must be/);
});
test("future hosting config is documentation only and rejects activation or inline tokens", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-demo-future-hosting-"));
  fs.mkdirSync(path.join(profile, "images"));
  fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
  const sample = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
  const run = (name, mutate) => {
    const config = structuredClone(sample);
    mutate(config.futureHosting);
    const file = path.join(profile, name);
    fs.writeFileSync(file, JSON.stringify(config), { flag: "wx" });
    return spawnSync(process.execPath, [entry, "--check-config", "--config", file], { cwd: root, encoding: "utf8" });
  };
  const valid = run("valid.json", () => {});
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /no server started/);
  for (const [name, mutate, error] of [
    ["host-enabled.json", (plan) => { plan.status = "enabled"; }, /futureHosting.status.*reference-only/],
    ["tunnel-enabled.json", (plan) => { plan.cloudflare.enabled = true; }, /futureHosting.cloudflare.enabled.*false/],
    ["watchdog-enabled.json", (plan) => { plan.watchdog.enabled = true; }, /futureHosting.watchdog.enabled.*false/],
    ["raw-token.json", (plan) => { plan.cloudflare.token = "do-not-accept-inline-secrets"; }, /Unknown futureHosting.cloudflare key: token/],
    ["token-as-file.json", (plan) => { plan.cloudflare.tokenSourceFile = "not-a-file-path"; }, /tokenSourceFile must be a .txt file path/]
  ]) {
    const result = run(name, mutate);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, error);
  }
});
