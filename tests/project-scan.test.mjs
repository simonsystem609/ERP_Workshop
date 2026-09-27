import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { namesContinue, validateScanRoots, inventoryLocalProjectFolders, planLocalProjectContinuity } from "../demo-project-scan.mjs";

test("local scan identity keeps project numbers separate across slight renames", () => {
  assert.equal(namesContinue("DEMO-028_Conveyor_Prototype", "DEMO-028_Conveyor_Prototypes"), true);
  assert.equal(namesContinue("DEMO-028_Conveyor_Prototype", "DEMO-029_Conveyor_Prototype"), false);
  assert.equal(namesContinue("DEMO-001 Conveyor Prototype", "DEMO-002 Conveyor Prototype"), false);
  assert.throws(() => validateScanRoots(["Y:/private"]), /scanRoots/);
  assert.throws(() => validateScanRoots(["documents/../private"]), /scanRoots/);
  assert.throws(() => validateScanRoots(["documents/scanned-projects", "documents/scanned-projects/2026"]), /overlap|nest/);
});

test("complete local inventory plans a unique continuation without archiving or guessing competitors", () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-local-project-scan-"));
  const root = path.join(profile, "documents", "scanned-projects");
  fs.mkdirSync(root, { recursive: true });
  const oldPath = path.join(root, "DEMO-028_Conveyor_Prototype");
  const renamedPath = path.join(root, "DEMO-028_Conveyor_Prototypes");
  const separatePath = path.join(root, "DEMO-029_Conveyor_Prototype");
  fs.mkdirSync(renamedPath);
  fs.mkdirSync(separatePath);
  const projects = { old: { id: "old", name: path.basename(oldPath), primaryFolder: oldPath, scanManaged: true } };
  const inventory = inventoryLocalProjectFolders(profile, ["documents/scanned-projects"]);
  const plan = planLocalProjectContinuity(projects, inventory);
  assert.equal(plan.renames.length, 1);
  assert.equal(plan.renames[0].project.id, "old");
  assert.equal(plan.additions.length, 1);
  assert.equal(plan.additions[0].folderPath, separatePath);
  assert.equal(plan.missing.length, 0);
  fs.mkdirSync(oldPath);
  const both = planLocalProjectContinuity(projects, inventoryLocalProjectFolders(profile, ["documents/scanned-projects"]));
  assert.equal(both.renames.length, 0);
  assert.equal(both.matches.length, 1);
  assert.equal(both.additions.length, 2);
  assert.equal(projects.old.primaryFolder, oldPath); // planning is read-only
});

test("two same-name folders do not both attach to one manual project", () => {
  const projects = { manual: { id: "manual", name: "DEMO-042 Conveyor Prototype", primaryFolder: "" } };
  const inventory = { roots: ["C:\\demo\\documents\\scanned-projects\\2025", "C:\\demo\\documents\\scanned-projects\\2026"],
    folders: [
      { name: "DEMO-042 Conveyor Prototype", folderPath: "C:\\demo\\documents\\scanned-projects\\2025\\DEMO-042 Conveyor Prototype" },
      { name: "DEMO-042 Conveyor Prototype", folderPath: "C:\\demo\\documents\\scanned-projects\\2026\\DEMO-042 Conveyor Prototype" }
    ] };
  const plan = planLocalProjectContinuity(projects, inventory);
  assert.equal(plan.attachments.length, 0);
  assert.equal(plan.additions.length, 2);
});
