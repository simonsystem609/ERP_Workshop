// Local-only SQLite store for the public demo. Never points at the live ERP.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export function openDemoStore(configPath) {
  const profileDir = fs.realpathSync(path.dirname(configPath));
  if (/^(?:\\\\|\/\/|y:)/i.test(profileDir)) throw new Error("Demo storage must be on a local non-Y drive");
  const storeDir = path.join(profileDir, ".demo-data");
  fs.mkdirSync(storeDir, { recursive: true });
  if (fs.lstatSync(storeDir).isSymbolicLink() || fs.realpathSync(storeDir).toLowerCase() !== storeDir.toLowerCase()) {
    throw new Error("Demo data folder must not redirect outside its profile");
  }
  const dbPath = path.join(storeDir, "erp-demo.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000");
  db.exec("CREATE TABLE IF NOT EXISTS demoState (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL, savedAt TEXT NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS demoCredentials (userId TEXT PRIMARY KEY, salt TEXT NOT NULL, passwordHash TEXT NOT NULL, updatedAt TEXT NOT NULL)");
  const select = db.prepare("SELECT data FROM demoState WHERE id=1");
  const insert = db.prepare("INSERT INTO demoState(id,data,savedAt) VALUES (1,?,?)");
  const update = db.prepare("UPDATE demoState SET data=?, savedAt=? WHERE id=1");
  const credentialCount = db.prepare("SELECT COUNT(*) AS count FROM demoCredentials");
  const credentialByUser = db.prepare("SELECT userId,salt,passwordHash,updatedAt FROM demoCredentials WHERE userId=?");
  const insertCredential = db.prepare("INSERT INTO demoCredentials(userId,salt,passwordHash,updatedAt) VALUES (?,?,?,?)");
  const upsertCredential = db.prepare("INSERT INTO demoCredentials(userId,salt,passwordHash,updatedAt) VALUES (?,?,?,?) ON CONFLICT(userId) DO UPDATE SET salt=excluded.salt,passwordHash=excluded.passwordHash,updatedAt=excluded.updatedAt");
  return {
    dbPath,
    loadOrSeed(initialState) {
      const existing = select.get();
      if (existing) return JSON.parse(existing.data);
      insert.run(JSON.stringify(initialState), new Date().toISOString());
      return initialState;
    },
    save(state) {
      update.run(JSON.stringify(state), new Date().toISOString());
    },
    credentialCount() { return Number(credentialCount.get().count); },
    credentialFor(userId) { return credentialByUser.get(userId) || null; },
    createFirstCredential(userId, salt, passwordHash) {
      db.exec("BEGIN IMMEDIATE");
      try {
        if (Number(credentialCount.get().count) !== 0) { db.exec("ROLLBACK"); return false; }
        insertCredential.run(userId, salt, passwordHash, new Date().toISOString());
        db.exec("COMMIT");
        return true;
      } catch (error) {
        try { db.exec("ROLLBACK"); } catch {}
        throw error;
      }
    },
    setCredential(userId, salt, passwordHash) {
      upsertCredential.run(userId, salt, passwordHash, new Date().toISOString());
    },
    close() { db.close(); }
  };
}
