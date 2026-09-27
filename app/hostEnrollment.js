"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

function hostKey(hostname) {
  const key = String(hostname || "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,62}$/.test(key)) throw new Error("Ervenytelen PC nev.");
  return key;
}

// Append-only coordination history, outside the business DB and watchdog
// heartbeat files. Install acknowledges the removal IDs it actually observed;
// a concurrent/newer removal cannot be undone by a stale installer snapshot.
// No timestamp ordering, overwrites, file deletion or cross-PC clock trust.
class HostEnrollment {
  constructor(root) { this.root = root; }
  state(hostname) {
    const key = hostKey(hostname), dir = path.join(this.root, key);
    let names;
    try { names = fs.readdirSync(dir); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      fs.accessSync(path.dirname(this.root)); // unavailable share is not an empty registry
      return { removed:false, removalIds:[], unclearedIds:[] };
    }
    const removed = new Set(), cleared = new Set();
    for (const name of names) {
      const match = /^(remove|install)-([a-f0-9-]{36})\.json$/.exec(name);
      if (!match) continue; // unpublished .tmp files are deliberately ignored
      const record = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      if (record.hostname !== key || record.action !== match[1] || record.id !== match[2]) throw new Error("Hibas PC regisztracios rekord.");
      if (record.action === "remove") removed.add(record.id);
      else {
        if (!Array.isArray(record.clearedRemovalIds) || record.clearedRemovalIds.some(id => typeof id !== "string")) throw new Error("Hibas telepitesi rekord.");
        for (const id of record.clearedRemovalIds) cleared.add(id);
      }
    }
    const removalIds = [...removed], unclearedIds = removalIds.filter(id => !cleared.has(id));
    return { removed:unclearedIds.length > 0, removalIds, unclearedIds };
  }
  append(hostname, action, actor, clearedRemovalIds = []) {
    const key = hostKey(hostname), dir = path.join(this.root, key), id = crypto.randomUUID();
    if (action !== "remove" && action !== "install") throw new Error("Hibas PC muvelet.");
    const record = {id,hostname:key,action,at:new Date().toISOString(),actor:String(actor || "").slice(0,160)};
    if (action === "install") record.clearedRemovalIds = [...clearedRemovalIds];
    fs.mkdirSync(dir, {recursive:true});
    const target = path.join(dir, `${action}-${id}.json`), temporary = target + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2), {encoding:"utf8",flag:"wx"});
    fs.renameSync(temporary, target);
    return record;
  }
  remove(hostname, actor) {
    if (this.state(hostname).removed) return null;
    return this.append(hostname, "remove", actor);
  }
  install(hostname, actor) {
    const observed = this.state(hostname);
    return this.append(hostname, "install", actor, observed.removalIds);
  }
}

module.exports = {HostEnrollment,hostKey};
