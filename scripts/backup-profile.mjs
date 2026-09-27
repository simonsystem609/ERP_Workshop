// Non-overwriting, local-only snapshot of a demo profile. Never targets production.
import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const MAX_FILES = 20_000;
const MAX_BYTES = 30 * 1024 * 1024 * 1024;
const MAX_DEPTH = 20;
const DATA_ROOTS = ["documents", "imports", ".demo-data/images", ".demo-data/uploads", ".demo-data/modelling", ".demo-data/trash"];

function localPath(input, label) {
  if (!input || typeof input !== "string") throw new Error(`${label} needs an absolute local path`);
  const resolved = path.resolve(input);
  if (!path.isAbsolute(input) || /^(?:\\\\|\/\/|y:)/i.test(resolved)) throw new Error(`${label} must be on a local non-Y drive`);
  return resolved;
}

function samePath(a, b) { return a.toLowerCase() === b.toLowerCase(); }
function safeExisting(target, label, directory = false) {
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())
      || !samePath(fs.realpathSync(target), target)) throw new Error(`${label} redirects or is not a regular ${directory ? "directory" : "file"}`);
  return stat;
}
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
function sha256(file) {
  const hash = createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}
function inventory(profileDir) {
  const files = [];
  let bytes = 0;
  function add(relative, depth = 0) {
    if (depth > MAX_DEPTH) throw new Error("Profile tree is too deep for a safe backup");
    const source = path.join(profileDir, ...relative.split("/"));
    if (!fs.existsSync(source)) return;
    const stat = fs.lstatSync(source);
    if (stat.isSymbolicLink() || !samePath(fs.realpathSync(source), source)) throw new Error(`Redirected profile path: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(source).sort()) add(`${relative}/${name}`, depth + 1);
      return;
    }
    if (!stat.isFile()) throw new Error(`Unsupported profile entry: ${relative}`);
    files.push({ relative, source, size: stat.size });
    bytes += stat.size;
    if (files.length > MAX_FILES || bytes > MAX_BYTES) throw new Error("Profile exceeds backup safety limits");
  }
  add("config.json");
  add("images/logo.svg");
  for (const relative of DATA_ROOTS) add(relative);
  return files;
}
async function portListening(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid profile port");
  return await new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(1000);
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
    socket.once("timeout", () => { socket.destroy(); resolve(true); });
  });
}

export async function backupProfile({ configPath, outDir }) {
  const sourceConfig = localPath(configPath, "--config");
  safeExisting(sourceConfig, "Profile config");
  const profileDir = path.dirname(sourceConfig);
  safeExisting(profileDir, "Profile directory", true);
  if (path.basename(sourceConfig).toLowerCase() !== "config.json") throw new Error("Profile config must be named config.json");
  const destination = localPath(outDir, "--out");
  if (fs.existsSync(destination)) throw new Error("Backup destination already exists; nothing was overwritten");
  const parent = path.dirname(destination);
  safeExisting(parent, "Backup parent", true);
  if (isInside(profileDir, destination) || isInside(destination, profileDir)) throw new Error("Backup must be outside the profile tree");
  const config = JSON.parse(fs.readFileSync(sourceConfig, "utf8"));
  if (await portListening(config.port)) throw new Error(`Stop the local demo on port ${config.port} before backing up its files`);
  const files = inventory(profileDir);
  const dbPath = path.join(profileDir, ".demo-data", "erp-demo.db");
  const dbExists = fs.existsSync(dbPath);
  if (dbExists) safeExisting(dbPath, "Demo SQLite database");
  if (await portListening(config.port)) throw new Error("The local demo started during backup preflight; stop it first");

  // Create the destination only after preflight. A failed copy remains visibly
  // incomplete (no manifest) and is never removed or reused by this script.
  fs.mkdirSync(destination);
  const manifest = { format: "workshop-erp-profile-backup-v1", createdAt: new Date().toISOString(), files: [] };
  for (const file of files) {
    const target = path.join(destination, ...file.relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    safeExisting(file.source, `Profile file ${file.relative}`);
    fs.copyFileSync(file.source, target, fs.constants.COPYFILE_EXCL);
    const sourceHash = sha256(file.source);
    const copyHash = sha256(target);
    if (sourceHash !== copyHash) throw new Error(`File changed during backup: ${file.relative}; incomplete snapshot retained`);
    manifest.files.push({ path: file.relative, bytes: file.size, sha256: copyHash });
  }
  if (dbExists) {
    const target = path.join(destination, ".demo-data", "erp-demo.db");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (fs.existsSync(target)) throw new Error("Database backup target already exists");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      if (db.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Source database failed integrity_check");
      db.prepare("VACUUM INTO ?").run(target);
    } finally { db.close(); }
    const copy = new DatabaseSync(target, { readOnly: true });
    try {
      if (copy.prepare("PRAGMA integrity_check").get().integrity_check !== "ok") throw new Error("Backup database failed integrity_check");
    } finally { copy.close(); }
    manifest.files.push({ path: ".demo-data/erp-demo.db", bytes: fs.statSync(target).size, sha256: sha256(target) });
  }
  if (await portListening(config.port)) throw new Error("The local demo started during backup; incomplete snapshot retained");
  fs.writeFileSync(path.join(destination, "backup-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
  return manifest;
}

if (process.argv[1] && samePath(path.resolve(process.argv[1]), fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--config" || args[2] !== "--out") {
    console.error("Usage: node scripts/backup-profile.mjs --config <absolute local config.json> --out <new absolute local backup directory>");
    process.exitCode = 2;
  } else {
    backupProfile({ configPath: args[1], outDir: args[3] })
      .then((manifest) => console.log(`Verified profile backup: ${manifest.files.length} files; no source file removed.`))
      .catch((error) => { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; });
  }
}
