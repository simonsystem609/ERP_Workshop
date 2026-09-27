"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_GLB_BYTES = 256 * 1024 * 1024;
const CANONICAL_SHARE = "\\\\192.0.2.10\\Example Share";
const CAD_TRASH_ROOT = path.win32.join(CANONICAL_SHARE, "trash");
const CAD_MODEL_INBOX = path.win32.join(CANONICAL_SHARE, "WorkshopERP", "imports", "cadmodels");
const CAD_MODEL_CACHE_ROOT = path.win32.join(CANONICAL_SHARE, "WorkshopERP", "app", ".local-data", "cadmodel-cache");

function safeFileName(name, extension) {
  return typeof name === "string" && name.length > extension.length && name.length <= 240 &&
    !/[\\/:*?"<>|\x00-\x1f]/.test(name) && !name.startsWith(".") &&
    name.toLowerCase().endsWith(extension);
}

function modelIdForSidecar(sidecarFile) {
  return crypto.createHash("sha256").update(sidecarFile, "utf8").digest("hex").slice(0, 32);
}

function canonicalProjectPath(value) {
  let text = String(value || "").trim().replace(/\//g, "\\");
  if (text.toLowerCase() === CANONICAL_SHARE.toLowerCase()) text = "Y:\\";
  else if (text.toLowerCase().startsWith(CANONICAL_SHARE.toLowerCase() + "\\")) {
    text = "Y:\\" + text.slice(CANONICAL_SHARE.length + 1);
  }
  if (!/^Y:\\/i.test(text)) return "";
  return path.win32.normalize(text).replace(/\\+$/, "").toLocaleLowerCase("hu-HU");
}

function withinFolder(candidate, folder) {
  return Boolean(candidate && folder && (candidate === folder || candidate.startsWith(folder + "\\")));
}

function existingProjectForSource(sourceRoot, projects, scanRoots) {
  const source = canonicalProjectPath(sourceRoot);
  const roots = (scanRoots || []).map(canonicalProjectPath).filter(Boolean);
  if (!roots.some((root) => withinFolder(source, root))) return null;
  let best = null;
  let bestLength = 0;
  let ambiguous = false;
  for (const project of Object.values(projects || {})) {
    if (!project?.id) continue;
    const folders = [project.primaryFolder, ...(project.folderPaths || [])];
    for (const rawFolder of folders) {
      const folder = canonicalProjectPath(rawFolder);
      if (!roots.some((root) => withinFolder(folder, root)) || !withinFolder(source, folder)) continue;
      if (folder.length > bestLength) {
        best = project;
        bestLength = folder.length;
        ambiguous = false;
      } else if (folder.length === bestLength && best?.id !== project.id) {
        ambiguous = true;
      }
    }
  }
  return ambiguous ? null : best;
}

function readReadyPair(inbox, sidecarFile) {
  if (!safeFileName(sidecarFile, ".json")) throw new Error("Invalid sidecar filename.");
  const sidecarPath = path.join(inbox, sidecarFile);
  const sidecarStat = fs.lstatSync(sidecarPath);
  if (!sidecarStat.isFile() || sidecarStat.isSymbolicLink() || sidecarStat.size > 64 * 1024) {
    throw new Error("Invalid or oversized sidecar.");
  }
  const sidecar = JSON.parse(fs.readFileSync(sidecarPath, "utf8").replace(/^\uFEFF/, ""));
  if (sidecar?.format !== "examplecad-cadmodel" || sidecar.formatVersion !== 1) {
    throw new Error("Unsupported CAD model sidecar format.");
  }
  const glbFile = sidecar.glbFile;
  if (!safeFileName(glbFile, ".glb") || glbFile.slice(0, -4).toLowerCase() !== sidecarFile.slice(0, -5).toLowerCase()) {
    throw new Error("GLB filename must be the sidecar's safe sibling.");
  }
  if (!Number.isSafeInteger(sidecar.bytes) || sidecar.bytes < 20 || sidecar.bytes > MAX_GLB_BYTES) {
    throw new Error("Invalid GLB size in sidecar.");
  }
  if (!["assembly", "part"].includes(sidecar.source?.type) || !sidecar.source?.name || !sidecar.source?.root) {
    throw new Error("Missing CAD source information.");
  }
  if (!Number.isFinite(Date.parse(sidecar.exportedAt))) throw new Error("Invalid export date.");
  const glbPath = path.join(inbox, glbFile);
  const glbStat = fs.lstatSync(glbPath);
  if (!glbStat.isFile() || glbStat.isSymbolicLink() || glbStat.size !== sidecar.bytes) {
    throw new Error("GLB is missing or does not match the sidecar size.");
  }
  const fd = fs.openSync(glbPath, "r");
  let json;
  try {
    const header = Buffer.alloc(20);
    if (fs.readSync(fd, header, 0, 20, 0) !== 20 || header.toString("ascii", 0, 4) !== "glTF" ||
        header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== sidecar.bytes ||
        header.toString("ascii", 16, 20) !== "JSON") {
      throw new Error("Invalid glTF 2.0 binary header.");
    }
    const jsonBytes = header.readUInt32LE(12);
    if (jsonBytes < 2 || jsonBytes > 16 * 1024 * 1024 || 20 + jsonBytes > sidecar.bytes) {
      throw new Error("Invalid GLB JSON chunk length.");
    }
    const chunk = Buffer.alloc(jsonBytes);
    if (fs.readSync(fd, chunk, 0, jsonBytes, 20) !== jsonBytes) throw new Error("Incomplete GLB JSON chunk.");
    json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(chunk));
  } finally {
    fs.closeSync(fd);
  }
  if (json.asset?.version !== "2.0" || !Array.isArray(json.meshes) || !json.meshes.length) {
    throw new Error("GLB has no glTF 2.0 meshes.");
  }
  for (const item of [...(json.buffers || []), ...(json.images || [])]) {
    if (typeof item?.uri === "string" && !item.uri.startsWith("data:")) {
      throw new Error("GLB refers to an external resource.");
    }
  }
  const sourceRoot = String(sidecar.source.root).trim();
  const projectLabel = String(sidecar.projectName || path.win32.basename(sourceRoot) || "").trim();
  return {
    id: modelIdForSidecar(sidecarFile), sidecarFile, glbFile,
    sourceType: sidecar.source.type, sourceName: String(sidecar.source.name).trim(), sourceRoot,
    projectLabel, exportedAt: sidecar.exportedAt, bytes: sidecar.bytes,
    extensionsUsed: Array.isArray(json.extensionsUsed) ? json.extensionsUsed.map(String) : []
  };
}

function movePairToTrash(inbox, record, trashRoot = CAD_TRASH_ROOT, cacheRoot = "") {
  if (!/^[a-f0-9]{32}$/.test(record?.id || "") ||
      !safeFileName(record?.sidecarFile, ".json") || !safeFileName(record?.glbFile, ".glb") ||
      record.id !== modelIdForSidecar(record.sidecarFile) ||
      record.glbFile.slice(0, -4).toLowerCase() !== record.sidecarFile.slice(0, -5).toLowerCase()) {
    throw new Error("Invalid model filenames.");
  }
  const originals = [record.sidecarFile, record.glbFile];
  const missingFiles = [];
  const present = [];
  for (const name of originals) {
    const source = path.join(inbox, name);
    let stat;
    try { stat = fs.lstatSync(source); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      missingFiles.push(name);
      continue;
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Model artifact is not a regular file: " + name);
    present.push({ source, name, original: true });
  }
  if (cacheRoot) {
    let cacheStat;
    try { cacheStat = fs.lstatSync(cacheRoot); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    if (cacheStat) {
      if (!cacheStat.isDirectory() || cacheStat.isSymbolicLink()) throw new Error("Invalid CAD cache directory.");
      for (const name of fs.readdirSync(cacheRoot)) {
        if (!name.startsWith(record.id + "-") || !/\.glb\.gz(?:\.[a-f0-9]{8}\.partial)?$/i.test(name)) continue;
        const source = path.join(cacheRoot, name);
        let stat;
        try { stat = fs.lstatSync(source); }
        catch (error) { if (error.code === "ENOENT") continue; throw error; }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Invalid cached model artifact.");
        present.push({ source, name, original: false });
      }
    }
  }
  if (!present.length) return { trashFolder: "", movedFiles: [], missingFiles, cachedFiles: [] };
  const trashStat = fs.lstatSync(trashRoot);
  if (!trashStat.isDirectory() || trashStat.isSymbolicLink()) throw new Error("Canonical Y: trash is unavailable.");
  const folder = path.win32.join(trashRoot,
    "WorkshopERP-cadmodel-" + new Date().toISOString().replace(/[:.]/g, "-") + "-" +
    record.id + "-" + crypto.randomBytes(4).toString("hex"));
  fs.mkdirSync(folder);
  const moved = [];
  try {
    for (const item of present) {
      const destination = path.win32.join(folder, item.name);
      fs.renameSync(item.source, destination);
      moved.push({ ...item, destination });
    }
  } catch (error) {
    for (const item of moved.reverse()) {
      try { fs.renameSync(item.destination, item.source); }
      catch (rollbackError) { error.message += "; artifact rollback failed: " + rollbackError.message; }
    }
    throw error;
  }
  return {
    trashFolder: folder,
    movedFiles: moved.filter((item) => item.original).map((item) => item.name),
    missingFiles,
    cachedFiles: moved.filter((item) => !item.original).map((item) => item.name)
  };
}

module.exports = {
  MAX_GLB_BYTES, CAD_TRASH_ROOT, CAD_MODEL_INBOX, CAD_MODEL_CACHE_ROOT, safeFileName, modelIdForSidecar, canonicalProjectPath,
  existingProjectForSource, readReadyPair, movePairToTrash
};
