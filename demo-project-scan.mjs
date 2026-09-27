// Opt-in local project-folder inventory and conservative continuity planning.
// No network drive access, no data writes, and no automatic archiving.
import fs from "node:fs";
import path from "node:path";

const normalizePath = (value) => path.normalize(String(value || "")).replace(/[\\/]+$/, "").normalize("NFC").toLocaleLowerCase("hu-HU");
const normalizeName = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function inside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}
function identity(name) {
  const text = normalizeName(name);
  const projectCode = text.match(/^(szt|sz) (\d{2}|\d{4}) (\d{1,4})(?: |$)/);
  const genericCode = !projectCode && text.match(/^([a-z]{2,8}) (\d{1,6})(?: |$)/);
  const prefix = projectCode || genericCode;
  const code = projectCode ? `${projectCode[1]}:${Number(projectCode[2]) % 100}:${Number(projectCode[3])}`
    : genericCode ? `${genericCode[1]}:${Number(genericCode[2])}` : "";
  return { code, text: (prefix ? text.slice(prefix[0].length) : text).replace(/ /g, ""),
    numbers: (text.match(/\d+/g) || []).map(Number).join(":") };
}
function similarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  let prior = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const next = [i];
    for (let j = 1; j <= right.length; j++) next[j] = Math.min(next[j - 1] + 1, prior[j] + 1, prior[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    prior = next;
  }
  return 1 - prior[right.length] / Math.max(left.length, right.length);
}
export function namesContinue(oldName, newName) {
  const old = identity(oldName), next = identity(newName);
  if (old.code !== next.code || (!old.code && old.numbers !== next.numbers)) return false;
  if (old.text === next.text) return Boolean(old.text || old.code);
  if (Math.min(old.text.length, next.text.length) < 8) return false;
  return similarity(old.text, next.text) >= (old.code ? 0.8 : 0.9);
}
export function validateScanRoots(roots) {
  if (roots === undefined) return [];
  if (!Array.isArray(roots) || roots.length > 4) throw new Error("scanRoots must be an array of at most four local folders");
  const seen = new Set();
  for (const root of roots) {
    if (typeof root !== "string" || !/^documents\/scanned-projects(?:\/[A-Za-z0-9_-]+)*$/.test(root) || seen.has(root.toLowerCase())) {
      throw new Error("scanRoots may contain only unique documents/scanned-projects[/name] paths");
    }
    seen.add(root.toLowerCase());
  }
  const paths = [...seen];
  if (paths.some((root, index) => paths.some((other, otherIndex) => index !== otherIndex && root.startsWith(`${other}/`)))) {
    throw new Error("scanRoots must not overlap or nest inside one another");
  }
  return roots;
}
export function inventoryLocalProjectFolders(profileDir, roots) {
  const folders = [], absoluteRoots = [];
  for (const relative of validateScanRoots(roots)) {
    const root = path.join(profileDir, ...relative.split("/"));
    if (!inside(profileDir, root)) throw new Error("Project scan root escapes its profile");
    let ancestor = root;
    while (ancestor !== profileDir) {
      const stat = fs.lstatSync(ancestor);
      if (!stat.isDirectory() || stat.isSymbolicLink() || normalizePath(fs.realpathSync(ancestor)) !== normalizePath(ancestor)) {
        throw new Error(`Project scan root redirects: ${relative}`);
      }
      ancestor = path.dirname(ancestor);
    }
    const entries = fs.readdirSync(root, { withFileTypes: true });
    if (entries.length > 1000) throw new Error(`Project scan root has over 1000 entries: ${relative}`);
    for (const entry of entries) {
      if (entry.isSymbolicLink()) throw new Error(`Redirected project child in ${relative}`);
      if (!entry.isDirectory()) continue;
      if (entry.name.length > 160 || /[\x00-\x1f]/.test(entry.name)) throw new Error(`Invalid project folder name in ${relative}`);
      const folderPath = path.join(root, entry.name);
      if (normalizePath(fs.realpathSync(folderPath)) !== normalizePath(folderPath)) throw new Error(`Redirected project child in ${relative}`);
      folders.push({ name: entry.name, folderPath });
    }
    absoluteRoots.push(root);
  }
  return { folders, roots: absoluteRoots };
}
export function planLocalProjectContinuity(projects, inventory) {
  const all = Object.values(projects || {});
  const managed = all.filter((project) => project.scanManaged && project.primaryFolder && inventory.roots.some((root) => inside(root, project.primaryFolder)));
  const presentPaths = new Set(inventory.folders.map((folder) => normalizePath(folder.folderPath)));
  const matches = [], potentialAttachments = [], attachments = [], unclaimed = [];
  for (const folder of inventory.folders) {
    const owners = managed.filter((project) => normalizePath(project.primaryFolder) === normalizePath(folder.folderPath));
    if (owners.length === 1) { matches.push({ project: owners[0], folder }); continue; }
    if (owners.length > 1) throw new Error(`Multiple ERP projects claim one local folder: ${folder.name}`);
    const manual = all.filter((project) => !project.primaryFolder && normalizeName(project.name) === normalizeName(folder.name));
    if (manual.length === 1) potentialAttachments.push({ project: manual[0], folder });
    else unclaimed.push(folder);
  }
  for (const item of potentialAttachments) {
    if (potentialAttachments.filter((other) => other.project.id === item.project.id).length === 1) attachments.push(item);
    else unclaimed.push(item.folder);
  }
  const missing = managed.filter((project) => !presentPaths.has(normalizePath(project.primaryFolder)));
  const missingIds = new Set(missing.map((project) => project.id));
  const candidates = unclaimed.map((folder) => ({ folder, projects: managed.filter((project) =>
    normalizePath(path.dirname(project.primaryFolder)) === normalizePath(path.dirname(folder.folderPath))
      && namesContinue(project.name, folder.name)) }));
  const renames = candidates.filter((candidate) => candidate.projects.length === 1 && missingIds.has(candidate.projects[0].id)
    && candidates.filter((other) => other.projects.some((project) => project.id === candidate.projects[0].id)).length === 1)
    .map((candidate) => ({ project: candidate.projects[0], folder: candidate.folder }));
  const renamedIds = new Set(renames.map((item) => item.project.id));
  const renamedPaths = new Set(renames.map((item) => normalizePath(item.folder.folderPath)));
  return { matches, attachments, renames, additions: unclaimed.filter((folder) => !renamedPaths.has(normalizePath(folder.folderPath))),
    missing: missing.filter((project) => !renamedIds.has(project.id)) };
}
