"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const EXPECTED_SHARE = "\\\\192.0.2.10\\Example Share";
const EXPECTED_WORKING_DIRECTORY = "Y:\\WorkshopERP";
const normal = value => String(value || "").trim().replaceAll("/", "\\").replace(/\\+$/, "").toLowerCase();

function assertCanonicalMapping(mapping) {
  const registered = normal(mapping.registered);
  const actual = mapping.diskPresent ? normal(mapping.provider) : registered;
  if (actual !== normal(EXPECTED_SHARE) || (registered && registered !== normal(EXPECTED_SHARE))) {
    throw new Error(`ERP startup refused: Y: must map exactly to ${EXPECTED_SHARE}; actual=${actual || "missing"}, registered=${registered || "missing"}`);
  }
}

function assertCanonicalWorkingDirectory(value) {
  const candidate = path.win32.normalize(String(value || EXPECTED_WORKING_DIRECTORY));
  if (![EXPECTED_WORKING_DIRECTORY, EXPECTED_SHARE + "\\WorkshopERP"].some(p => normal(p) === normal(candidate))) {
    throw new Error("ERP storage must remain on the canonical shared WorkshopERP directory; no local/old-share fallback is allowed.");
  }
  return EXPECTED_WORKING_DIRECTORY;
}

function safetyError(code, message) {
  return Object.assign(new Error(message), {code, httpStatus:503});
}

// The owner row is outside the JSON collections. BEGIN IMMEDIATE serializes
// ownership checks and writes. A fingerprint also detects legacy/external
// writers that do not maintain our owner row; it survives connection reopen.
class SnapshotWriteGuard {
  constructor(collections, singletons) {
    this.collections = [...new Set([...collections, "projects"])];
    this.singletons = [...singletons].sort();
    for (const t of this.collections) if (!/^[A-Za-z][A-Za-z0-9]*$/.test(t)) throw Error("Unsafe collection name");
    this.owner = crypto.randomUUID();
    this.fingerprint = null;
  }
  contentFingerprint(handle) {
    const hash = crypto.createHash("sha256");
    for (const table of this.collections) {
      hash.update(table + "\0");
      for (const row of handle.prepare(`SELECT id, data FROM ${table} ORDER BY id`).all()) hash.update(JSON.stringify([row.id,row.data]));
    }
    const get = handle.prepare("SELECT value FROM singletons WHERE key=?");
    for (const key of this.singletons) hash.update(JSON.stringify([key,get.get(key)?.value ?? null]));
    return hash.digest("hex");
  }
  claimAndLoad(handle, load, identity, verifyClaim) {
    handle.exec("CREATE TABLE IF NOT EXISTS erpHostOwner (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT NOT NULL, identity TEXT NOT NULL)");
    handle.exec("BEGIN IMMEDIATE");
    try {
      verifyClaim();
      handle.prepare("INSERT INTO erpHostOwner(id,owner,identity) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,identity=excluded.identity")
        .run(this.owner,JSON.stringify(identity));
      const snapshot = load();
      const fingerprint = this.contentFingerprint(handle);
      handle.exec("COMMIT");
      this.fingerprint = fingerprint;
      return snapshot;
    } catch(error) {
      try { handle.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
  assertOwner(handle) {
    if (this.fingerprint === null) throw safetyError("ERP_STORAGE_NOT_CLAIMED", "Database write refused: this process has not claimed storage.");
    if (handle.prepare("SELECT owner FROM erpHostOwner WHERE id=1").get()?.owner !== this.owner) {
      throw safetyError("ERP_STORAGE_OWNER_LOST", "Database write refused: another host owns storage.");
    }
  }
  save(handle, write) {
    handle.exec("BEGIN IMMEDIATE");
    try {
      this.assertOwner(handle);
      if (this.contentFingerprint(handle) !== this.fingerprint) {
        throw safetyError("ERP_STORAGE_CHANGED", "Database write refused: data changed outside this host; stale memory must not replace it.");
      }
      write();
      const fingerprint = this.contentFingerprint(handle);
      handle.exec("COMMIT");
      this.fingerprint = fingerprint;
    } catch(error) {
      try { handle.exec("ROLLBACK"); } catch {}
      throw error;
    }
  }
}
module.exports = {SnapshotWriteGuard,assertCanonicalMapping,assertCanonicalWorkingDirectory,EXPECTED_SHARE,EXPECTED_WORKING_DIRECTORY};
