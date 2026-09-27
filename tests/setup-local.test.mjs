import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { initializeLocalConfig } from "../scripts/setup-local.mjs";

test("local setup copies a public template once and never overwrites later edits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "erp-setup-test-"));
  fs.writeFileSync(path.join(root, "config.example.json"), '{"mode":"localhost-demo"}\n');
  assert.equal(initializeLocalConfig(root).created, true);
  const target = path.join(root, "config.json");
  assert.equal(fs.readFileSync(target, "utf8"), '{"mode":"localhost-demo"}\n');
  fs.writeFileSync(target, '{"userEdit":true}\n');
  assert.equal(initializeLocalConfig(root).created, false);
  assert.equal(fs.readFileSync(target, "utf8"), '{"userEdit":true}\n');
});
