import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createOriginalFixture, ORIGINAL_COLLECTIONS, ORIGINAL_SINGLETONS } from "../scripts/create-original-fixture.mjs";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));

test("original-schema fixture is synthetic, complete, non-overwriting and has no usable default password", () => {
  const original = fs.readFileSync(path.join(root, "app", "server.js"), "utf8");
  for (const [constant, expected] of [["SQLITE_COLLECTIONS", ORIGINAL_COLLECTIONS], ["SQLITE_SINGLETONS", ORIGINAL_SINGLETONS]]) {
    const match = original.match(new RegExp(`const ${constant} = \\[([\\s\\S]*?)\\];`));
    assert.ok(match, `original schema ${constant} must remain discoverable`);
    const actual = [...match[1].matchAll(/"([A-Za-z][A-Za-z0-9]*)"/g)].map((item) => item[1]);
    assert.deepEqual(actual, expected, `${constant} drifted from the fixture schema`);
  }
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-original-fixture-"));
  const output = path.join(folder, "synthetic-original.db");
  const result = createOriginalFixture(output);
  assert.equal(result.users, 2);
  assert.equal(result.projects, 2);
  assert.equal(result.notifications, 2);
  const before = fs.readFileSync(output);
  assert.throws(() => createOriginalFixture(output), /overwrite/);
  assert.deepEqual(fs.readFileSync(output), before);
  const db = new DatabaseSync(output, { readOnly: true });
  try {
    assert.equal(Object.values(db.prepare("PRAGMA integrity_check").get())[0], "ok");
    const users = db.prepare("SELECT data FROM users").all().map((row) => JSON.parse(row.data));
    assert.equal(users.length, 2);
    assert.ok(users.every((user) => user.passwordHash?.length === 64 && user.passwordSalt?.length === 32));
    assert.notEqual(users[0].passwordHash, users[1].passwordHash);
    assert.equal(db.prepare("SELECT count(*) AS n FROM pushSubscriptions").get().n, 0);
    assert.equal(db.prepare("SELECT count(*) AS n FROM projectNotices").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM engineeringDesignItems").get().n, 1);
    assert.equal(db.prepare("SELECT count(*) AS n FROM projects").get().n, 2);
    const notifications = db.prepare("SELECT data FROM notifications").all().map((row) => JSON.parse(row.data));
    assert.equal(notifications.length, 2);
    assert.ok(notifications.every((row) => row.tag === "sample" && row.url === "/"));
    const security = JSON.parse(db.prepare("SELECT value FROM singletons WHERE key = 'notificationSecurity'").get().value);
    assert.equal(security.vapidPublicKey, "");
    assert.equal(security.vapidPrivateJwk, null);
  } finally {
    db.close();
  }
});
