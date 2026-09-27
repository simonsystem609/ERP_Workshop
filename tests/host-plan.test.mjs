import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateHostPlan, validateObservedMapping } from "../hosting/host-plan.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sample = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
function filledPlan() {
  const plan = structuredClone(sample.futureHosting);
  const share = "\\\\host.example.invalid\\Example Share";
  const erp = "Z:\\WorkshopERP", data = erp + "\\data";
  Object.assign(plan.storage, {
    canonicalShare: share, mappedDrive: "Z:", erpRoot: erp,
    appDirectory: erp + "\\app", dataDirectory: data, databaseFile: data + "\\erp.db",
    projectRoots: ["Z:\\Projects"], worklogInbox: erp + "\\imports\\worklogs\\inbox",
    cadModelInbox: erp + "\\imports\\cadmodels", cadModelCache: erp + "\\app\\.local-data\\cadmodel-cache",
    logsDirectory: erp + "\\app\\logs", uploadsDirectory: erp + "\\uploads",
    trashDirectory: share + "\\trash"
  });
  Object.assign(plan.server, { host: "0.0.0.0" });
  Object.assign(plan.watchdog, {
    hostLockFile: data + "\\.host-lock.json", hostSwitchFile: data + "\\.host-switch.json",
    heartbeatDirectory: data + "\\.watchdogs"
  });
  Object.assign(plan.backups, { automaticRoot: "Z:\\ERPbackup\\auto", manualRoot: "Z:\\ERPbackup\\manual" });
  return plan;
}

test("complete generic plan passes string/path checks without touching a share", () => {
  const plan = filledPlan();
  assert.deepEqual(validateHostPlan(plan), []);
  assert.equal(validateObservedMapping(plan, { diskPresent: true, provider: plan.storage.canonicalShare, registered: plan.storage.canonicalShare }), true);
});

test("wrong drive, unsafe trash, inline token and old mapping fail closed", () => {
  const plan = filledPlan();
  plan.storage.trashDirectory = "Z:\\trash";
  plan.cloudflare.tokenValue = "synthetic-not-a-real-token";
  assert.match(validateHostPlan(plan).join("\n"), /canonical share's trash/);
  assert.match(validateHostPlan(plan).join("\n"), /inline credentials/);
  assert.throws(() => validateObservedMapping(plan, { diskPresent: true, provider: "\\\\other.example.invalid\\Share", registered: plan.storage.canonicalShare }), /refusing host action/);
});

test("generic control remains inert even with every path filled", () => {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-host-plan-"));
  const configFile = path.join(fixture, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ futureHosting: filledPlan() }), { flag: "wx" });
  const inspect = spawnSync(process.execPath, [path.join(root, "hosting", "host-control.mjs"), "inspect", "--config", configFile], { encoding: "utf8" });
  assert.equal(inspect.status, 0, inspect.stderr);
  const start = spawnSync(process.execPath, [path.join(root, "hosting", "host-control.mjs"), "start", "--config", configFile], { encoding: "utf8" });
  assert.notEqual(start.status, 0);
  assert.match(start.stderr, /not enabled/);
  assert.match(start.stderr, /No action was taken/);
});
