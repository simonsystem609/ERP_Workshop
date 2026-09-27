"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const zlib = require("zlib");
const { pipeline } = require("stream/promises");
const { MAX_GLB_BYTES, modelIdForSidecar, safeFileName } = require("./cadModels");

const MAX_CACHE_BYTES = 2 * 1024 * 1024 * 1024;
const pending = new Map();
let warmTail = Promise.resolve();

function sourceIdentity(inbox, model) {
  if (!/^[a-f0-9]{32}$/.test(model?.id || "") ||
      !safeFileName(model?.sidecarFile, ".json") ||
      !safeFileName(model?.glbFile, ".glb") ||
      model.id !== modelIdForSidecar(model.sidecarFile) ||
      model.glbFile.slice(0, -4).toLowerCase() !== model.sidecarFile.slice(0, -5).toLowerCase()) {
    throw new Error("Invalid CAD model identity.");
  }
  const sourcePath = path.join(inbox, model.glbFile);
  const stat = fs.lstatSync(sourcePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size !== model.bytes ||
      stat.size < 20 || stat.size > MAX_GLB_BYTES) {
    throw new Error("CAD model file is missing or changed.");
  }
  const fingerprint = crypto.createHash("sha256")
    .update([model.id, model.glbFile, stat.size, stat.mtimeMs, stat.ctimeMs].join("|"))
    .digest("hex").slice(0, 24);
  return { sourcePath, stat, fingerprint };
}

function cacheFile(cacheRoot, model, fingerprint) {
  return path.join(cacheRoot, model.id + "-" + fingerprint + ".glb.gz");
}

function compressedModel(cacheRoot, model, identity) {
  const filePath = cacheFile(cacheRoot, model, identity.fingerprint);
  let stat;
  try { stat = fs.lstatSync(filePath); }
  catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 20 ||
      stat.size > model.bytes + 1024 * 1024) {
    throw new Error("Invalid CAD model cache file.");
  }
  return { filePath, stat };
}

function cacheUsage(cacheRoot) {
  let total = 0;
  for (const entry of fs.readdirSync(cacheRoot, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    total += fs.lstatSync(path.join(cacheRoot, entry.name)).size;
  }
  return total;
}

async function warmCompressedModel(inbox, model, cacheRoot, maxBytes = MAX_CACHE_BYTES) {
  const before = sourceIdentity(inbox, model);
  fs.mkdirSync(cacheRoot, { recursive: true });
  const rootStat = fs.lstatSync(cacheRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Invalid CAD cache directory.");
  const ready = compressedModel(cacheRoot, model, before);
  if (ready) return ready;
  if (cacheUsage(cacheRoot) + model.bytes > maxBytes) {
    throw new Error("CAD disk cache limit reached; source streaming remains available.");
  }
  const finalPath = cacheFile(cacheRoot, model, before.fingerprint);
  const tempPath = finalPath + "." + crypto.randomBytes(4).toString("hex") + ".partial";
  await pipeline(
    fs.createReadStream(before.sourcePath),
    zlib.createGzip({ level: 6 }),
    fs.createWriteStream(tempPath, { flags: "wx" })
  );
  const after = sourceIdentity(inbox, model);
  if (after.fingerprint !== before.fingerprint) {
    throw new Error("CAD model changed during cache warmup; partial copy retained.");
  }
  if (compressedModel(cacheRoot, model, before)) {
    throw new Error("CAD cache already appeared during warmup; duplicate partial copy retained.");
  }
  fs.renameSync(tempPath, finalPath);
  return compressedModel(cacheRoot, model, before);
}

function scheduleCompressedModel(inbox, model, cacheRoot) {
  const existing = pending.get(model.id);
  if (existing) return existing;
  const task = warmTail.then(() => warmCompressedModel(inbox, model, cacheRoot));
  warmTail = task.catch(() => {});
  pending.set(model.id, task);
  task.finally(() => {
    if (pending.get(model.id) === task) pending.delete(model.id);
  }).catch(() => {});
  return task;
}

async function waitForCompressedModel(modelId) {
  try { await pending.get(modelId); } catch {}
}

module.exports = {
  MAX_CACHE_BYTES, sourceIdentity, compressedModel, warmCompressedModel,
  scheduleCompressedModel, waitForCompressedModel
};
