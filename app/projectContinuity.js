"use strict";

// Pure project reconciliation. No filesystem access, database writes or timers.
const path = require("node:path").win32;
const { randomUUID } = require("node:crypto");

const pathKey = (value) => path.normalize(String(value || "")).replace(/[\\/]+$/, "").normalize("NFC").toLocaleLowerCase("hu-HU");
const nameKey = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const projectPaths = (project) => [...new Set([project?.primaryFolder, ...(project?.folderPaths || [])].filter(Boolean))];
const within = (value, root) => pathKey(value) === pathKey(root) || pathKey(value).startsWith(`${pathKey(root)}\\`);

function nameIdentity(name) {
  const normalized = nameKey(name);
  const code = normalized.match(/^(szt|sz) (\d{2}|\d{4}) (\d{1,4})(?: |$)/);
  return {
    code: code ? `${code[1]}:${Number(code[2]) % 100}:${Number(code[3])}` : "",
    text: (code ? normalized.slice(code[0].length) : normalized).replace(/ /g, ""),
    numbers: (normalized.match(/\d+/g) || []).map(Number).join(":")
  };
}

function similarity(left, right) {
  if (left === right) return 1;
  if (!left || !right) return 0;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    const next = [i];
    for (let j = 1; j <= right.length; j += 1) {
      next[j] = Math.min(next[j - 1] + 1, previous[j] + 1, previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1));
    }
    previous = next;
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function namesContinue(oldName, newName) {
  const old = nameIdentity(oldName);
  const next = nameIdentity(newName);
  // A different project number is a hard boundary, never a fuzzy typo.
  if (old.code !== next.code) return false;
  if (!old.code && old.numbers !== next.numbers) return false;
  if (old.text === next.text) return Boolean(old.text || old.code);
  if (Math.min(old.text.length, next.text.length) < 8) return false;
  return similarity(old.text, next.text) >= (old.code ? 0.8 : 0.9);
}

function planFolderContinuations(projects, folders, successfulRoots) {
  const all = Object.values(projects || {});
  const safe = (folder) => successfulRoots.some((root) => within(folder, root));
  const inventory = folders.filter((folder) => safe(folder.folderPath));
  const presentPaths = new Set(inventory.map((folder) => pathKey(folder.folderPath)));
  const matches = [];
  const unclaimed = [];
  for (const folder of inventory) {
    let owners = all.filter((project) => projectPaths(project).some((known) => pathKey(known) === pathKey(folder.folderPath)));
    if (!owners.length) {
      // A folderless manual project can acquire its first exact-name folder.
      owners = all.filter((project) => !projectPaths(project).length && nameKey(project.name) === nameKey(folder.name));
    }
    if (owners.length === 1) matches.push({ projectId: owners[0].id, folder });
    else unclaimed.push(folder);
  }
  const matchedIds = new Set(matches.map((match) => match.projectId));
  const missing = all.filter((project) => {
    const known = projectPaths(project);
    return known.length && !matchedIds.has(project.id) && known.every(safe) && !known.some((folder) => presentPaths.has(pathKey(folder)));
  });
  const missingIds = new Set(missing.map((project) => project.id));
  const candidates = unclaimed.map((folder) => ({
    folder,
    // Include present projects as comdemousertors: copying a similar existing
    // folder must not accidentally claim a different missing project's data.
    projects: all.filter((project) => projectPaths(project).some((known) => pathKey(path.dirname(known)) === pathKey(path.dirname(folder.folderPath))) && namesContinue(project.name, folder.name))
  }));
  const renames = [];
  for (const candidate of candidates) {
    if (candidate.projects.length !== 1) continue;
    const project = candidate.projects[0];
    if (!missingIds.has(project.id)) continue;
    if (candidates.filter((item) => item.projects.some((other) => other.id === project.id)).length !== 1) continue;
    const oldFolder = projectPaths(project).find((known) => pathKey(path.dirname(known)) === pathKey(path.dirname(candidate.folder.folderPath)));
    renames.push({ projectId: project.id, oldFolder, folder: candidate.folder });
  }
  const renamedIds = new Set(renames.map((rename) => rename.projectId));
  const renamedPaths = new Set(renames.map((rename) => pathKey(rename.folder.folderPath)));
  return {
    matches,
    renames,
    additions: unclaimed.filter((folder) => !renamedPaths.has(pathKey(folder.folderPath))),
    missing: missing.filter((project) => !renamedIds.has(project.id)),
    candidates
  };
}

function remapFolderReferences(value, oldFolder, newFolder) {
  if (Array.isArray(value)) return value.map((item) => remapFolderReferences(item, oldFolder, newFolder));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapFolderReferences(item, oldFolder, newFolder)]));
  }
  if (typeof value !== "string" || !/^(?:[a-z]:[\\/]|\\\\)/i.test(value)) return value;
  if (!within(value, oldFolder)) return value;
  const suffix = path.relative(oldFolder, value);
  return suffix ? path.join(newFolder, suffix) : newFolder;
}

function addProjectNotice(db, notice, at = new Date().toISOString()) {
  db.projectNotices = db.projectNotices || [];
  const item = { id: randomUUID(), createdAt: at, readByUserIds: [], ...notice };
  db.projectNotices.unshift(item);
  return item;
}

function continueProjectFolder(db, project, oldFolder, folder, collections, at = new Date().toISOString()) {
  const oldName = project.name;
  const aliases = [...new Set([...(project.nameAliases || []), oldName])].filter((name) => name !== folder.name);
  const previousHistory = project.folderHistory || [];
  const updated = oldFolder ? remapFolderReferences(project, oldFolder, folder.folderPath) : { ...project };
  Object.assign(project, updated, {
    name: folder.name,
    nameAliases: aliases,
    primaryFolder: updated.primaryFolder || folder.folderPath,
    folderPaths: [...new Map([...(updated.folderPaths || []), folder.folderPath].map((value) => [pathKey(value), value])).values()],
    folderMissing: false,
    missingScanCount: 0,
    folderMissingNotifiedAt: "",
    folderHistory: [...previousHistory, { oldName, newName: folder.name, oldFolder: oldFolder || "", newFolder: folder.folderPath, detectedAt: at }]
  });
  for (const collection of collections) {
    db[collection] = (db[collection] || []).map((item) => {
      if (item.projectId !== project.id) return item;
      const updatedItem = oldFolder ? remapFolderReferences(item, oldFolder, folder.folderPath) : { ...item };
      if ("projectName" in updatedItem) updatedItem.projectName = project.name;
      return updatedItem;
    });
  }
  addProjectNotice(db, { kind: "folder-renamed", projectId: project.id, projectName: project.name, oldName, oldFolder: oldFolder || "", newFolder: folder.folderPath }, at);
}

function restoreArchivedProjectInto(db, archive, project, collections, at = new Date().toISOString()) {
  if (archive.restoredAt) return {};
  if (archive.type !== "project" || archive.reason !== "folder-missing-auto") throw new Error("Only accidental folder-missing project archives may be recovered automatically.");
  const old = archive.project || {};
  // Validate every ID before changing anything. Never overwrite newer entries.
  for (const collection of collections) {
    for (const item of archive.data?.[collection] || []) {
      const existing = (db[collection] || []).find((entry) => entry.id === item.id);
      if (existing && existing.projectId !== project.id) throw new Error(`Recovery ID conflict: ${collection}/${item.id}`);
    }
  }
  const counts = {};
  for (const collection of collections) {
    db[collection] = db[collection] || [];
    const ids = new Set(db[collection].map((item) => item.id));
    let restored = 0;
    for (const item of archive.data?.[collection] || []) {
      if (!item?.id || ids.has(item.id)) continue;
      const copy = old.primaryFolder && project.primaryFolder
        ? remapFolderReferences(item, old.primaryFolder, project.primaryFolder)
        : JSON.parse(JSON.stringify(item));
      copy.projectId = project.id;
      if ("projectName" in copy) copy.projectName = project.name;
      db[collection].push(copy);
      ids.add(copy.id);
      restored += 1;
    }
    if (restored) counts[collection] = restored;
  }
  project.nameAliases = [...new Set([...(project.nameAliases || []), ...(old.nameAliases || []), old.name])].filter((name) => name && name !== project.name);
  project.previousProjectIds = [...new Set([...(project.previousProjectIds || []), old.id])].filter((value) => value && value !== project.id);
  project.responsibleUserIds = [...new Set([...(project.responsibleUserIds || []), ...(old.responsibleUserIds || [])])];
  project.active = project.active !== false && old.active !== false;
  project.priority = project.active ? (project.priority ?? old.priority ?? null) : null;
  project.completedAt = project.active ? null : (project.completedAt || old.completedAt || null);
  project.deadline = project.deadline || old.deadline || "";
  project.storageFolder = project.storageFolder || old.storageFolder || null;
  project.createdAt = old.createdAt || project.createdAt;
  project.folderMissing = false;
  project.missingScanCount = 0;
  // Keep the original archive and its data as recovery evidence. Purging a
  // recovered archive is blocked by the server because files may be live again.
  archive.restoredAt = at;
  archive.restoredProjectId = project.id;
  archive.restoredProjectName = project.name;
  archive.restoredCounts = counts;
  addProjectNotice(db, { kind: "project-restored", projectId: project.id, projectName: project.name, oldName: old.name || archive.projectName, oldFolder: old.primaryFolder || "", newFolder: project.primaryFolder || "", archivedAt: archive.archivedAt, restoredCounts: counts }, at);
  return counts;
}

const ARCHIVE_ENTRY_COLLECTION = {
  task: "tasks", "cnc-task": "cncTasks", "tool-request": "toolRequests",
  "material-request": "materialRequests", "fastener-request": "fastenerRequests", "work-log": "workLogs"
};

function archiveEntryGroups(archive, collections) {
  if (archive?.type === "project") return Object.fromEntries(collections.map((name) => [name, archive.data?.[name] || []]));
  const collection = ARCHIVE_ENTRY_COLLECTION[archive?.type];
  if (!collection || !archive.data?.id) throw new Error("Ez az archív típus nem állítható vissza.");
  return { [collection]: [archive.data] };
}

function restoreArchiveEntriesInto(db, archive, project, collections, actorName = "", at = new Date().toISOString()) {
  if (!archive || !project?.id || !db.projects?.[project.id]) throw new Error("Válassz létező célprojektet.");
  if (archive.restoredAt) {
    if (archive.restoredProjectId !== project.id) throw new Error("Ezt az archívumot már másik projektbe visszaállították.");
    return { counts: {}, skipped: 0, alreadyRestored: true };
  }
  const groups = archiveEntryGroups(archive, collections);
  if (!Object.values(groups).some((items) => items.length)) throw new Error("Az archív projektben nincs kapcsolt bejegyzés.");
  for (const [collection, items] of Object.entries(groups)) {
    for (const item of items) {
      if (!item?.id) throw new Error("Hiányzó archív bejegyzésazonosító.");
      const existing = (db[collection] || []).find((entry) => entry.id === item.id);
      if (existing && existing.projectId !== project.id) throw new Error("Egy bejegyzés már másik projektben létezik; nem írtunk felül semmit.");
    }
  }
  const counts = {};
  let skipped = 0;
  for (const [collection, items] of Object.entries(groups)) {
    db[collection] = db[collection] || [];
    const ids = new Set(db[collection].map((item) => item.id));
    for (const item of items) {
      if (ids.has(item.id)) { skipped += 1; continue; }
      const copy = JSON.parse(JSON.stringify(item));
      copy.projectId = project.id;
      if ("projectName" in copy) copy.projectName = project.name;
      copy.restoredFromArchiveId = archive.id;
      // Original dates/status/assignees/IDs and file paths are retained. A
      // manual cross-project restore changes association, not folder identity.
      db[collection].push(copy);
      ids.add(copy.id);
      counts[collection] = (counts[collection] || 0) + 1;
    }
  }
  archive.restoredAt = at;
  archive.restoredProjectId = project.id;
  archive.restoredProjectName = project.name;
  archive.restoredCounts = counts;
  archive.restoredByName = actorName;
  addProjectNotice(db, { kind: "archive-restored", projectId: project.id, projectName: project.name, oldName: archive.projectName || archive.project?.name || "Projekt nélkül", actorName, restoredCounts: counts }, at);
  return { counts, skipped, alreadyRestored: false };
}

module.exports = { pathKey, nameKey, projectPaths, namesContinue, planFolderContinuations, remapFolderReferences, addProjectNotice, continueProjectFolder, restoreArchivedProjectInto, archiveEntryGroups, restoreArchiveEntriesInto };
