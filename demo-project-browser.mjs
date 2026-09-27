// Project-file browser for the localhost demo. It never scans production folders.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const types = new Map([
  [".slddrw", "drawing"], [".drw", "drawing"], [".dwg", "drawing"], [".dxf", "drawing"],
  [".sldasm", "assembly"], [".sldprt", "assembly"], [".step", "assembly"],
  [".stp", "assembly"], [".iges", "assembly"], [".igs", "assembly"],
  [".pdf", "pdf"]
]);
const maxFiles = 500;
const maxDirectories = 1000;
const maxDepth = 8;

function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function exactLocalDirectory(folder) {
  if (!fs.existsSync(folder)) return false;
  const stat = fs.lstatSync(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(folder).toLowerCase() !== folder.toLowerCase()) {
    throw new Error("Demo project folder must not redirect outside its local profile");
  }
  return true;
}

export function projectFolderName(projectId) {
  return createHash("sha256").update(String(projectId), "utf8").digest("hex");
}

export function createProjectBrowser(documents, scannedRootFor = () => "") {
  const base = path.join(documents.root, "projects");
  exactLocalDirectory(base);
  const rootFor = (id) => {
    const scanned = scannedRootFor(id);
    if (!scanned) return path.join(base, projectFolderName(id));
    const root = path.resolve(scanned);
    if (root === documents.root || !inside(documents.root, root)) throw new Error("Scanned project folder is outside local documents");
    return root;
  };
  const baseNeeded = (root) => inside(base, root);
  const toApiPath = (absolute) => `documents/${path.relative(documents.root, absolute).split(path.sep).join("/")}`;

  function list(projectId) {
    const root = rootFor(projectId);
    const rootLabel = toApiPath(root);
    const result = { files: [], roots: [rootLabel], missingRoots: [], truncated: false, scannedAt: new Date().toISOString() };
    if ((baseNeeded(root) && !exactLocalDirectory(base)) || !exactLocalDirectory(root)) {
      result.missingRoots.push(rootLabel);
      return result;
    }
    const pending = [{ folder: root, depth: 0 }];
    let visited = 0;
    while (pending.length) {
      if (++visited > maxDirectories) { result.truncated = true; break; }
      const { folder, depth } = pending.pop();
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const candidate = path.join(folder, entry.name);
        let stat;
        try {
          stat = fs.lstatSync(candidate);
          if (stat.isSymbolicLink() || fs.realpathSync(candidate).toLowerCase() !== candidate.toLowerCase()) continue;
        } catch { continue; }
        if (stat.isDirectory()) {
          if (depth < maxDepth) pending.push({ folder: candidate, depth: depth + 1 });
          else result.truncated = true;
          continue;
        }
        const kind = types.get(path.extname(entry.name).toLowerCase());
        if (!stat.isFile() || !kind) continue;
        result.files.push({ kind, name: entry.name, path: toApiPath(candidate),
          relativePath: path.relative(root, candidate).split(path.sep).join("/"),
          folder: toApiPath(folder), size: stat.size, modifiedAt: stat.mtime.toISOString() });
        if (result.files.length >= maxFiles) { result.truncated = true; break; }
      }
      if (result.truncated && result.files.length >= maxFiles) break;
    }
    result.files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return result;
  }

  function file(projectId, input, pdfOnly = false) {
    const root = rootFor(projectId);
    if ((baseNeeded(root) && !exactLocalDirectory(base)) || !exactLocalDirectory(root)) throw new Error("Demo project folder does not exist");
    const value = String(input || "");
    if (!value.startsWith("documents/") || value.includes("\\") || value.includes("\0")) throw new Error("Choose a listed local project file");
    const candidate = path.resolve(documents.root, value.slice("documents/".length));
    if (!inside(root, candidate) || candidate === root) throw new Error("File is outside this demo project folder");
    const resolved = documents.resolve(value, { file: true });
    if (!inside(root, resolved.path)) throw new Error("File is outside this demo project folder");
    let ancestor = candidate;
    while (ancestor !== root) {
      if (fs.lstatSync(ancestor).isSymbolicLink() || fs.realpathSync(ancestor).toLowerCase() !== ancestor.toLowerCase()) {
        throw new Error("Redirected demo project paths are not allowed");
      }
      ancestor = path.dirname(ancestor);
    }
    const kind = types.get(path.extname(resolved.path).toLowerCase());
    if (!kind || (pdfOnly && kind !== "pdf")) throw new Error("Unsupported demo project file");
    return { path: resolved.path, name: path.basename(resolved.path), kind };
  }

  return { list, file, rootFor };
}
