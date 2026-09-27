// Profile-local, preservation-first version of the ERP JSON worklog drop.
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

const durationFields = { hours: 1, durationHours: 1, minutes: 1 / 60, durationMinutes: 1 / 60,
  seconds: 1 / 3600, durationSeconds: 1 / 3600, milliseconds: 1 / 3_600_000, durationMilliseconds: 1 / 3_600_000 };
const normalized = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLocaleLowerCase();
const first = (entry, names) => names.map((name) => entry[name]).find((value) => value !== undefined && value !== null && String(value).trim());

function directory(parent, name) {
  const target = path.join(parent, name);
  fs.mkdirSync(target, { recursive: true });
  if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target).toLowerCase() !== target.toLowerCase()) {
    throw new Error(`Demo import folder must not redirect: ${name}`);
  }
  return target;
}
function dateOrToday(value) {
  const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  if (!value) return localDay(new Date());
  const raw = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : localDay(new Date(raw));
  if (new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) throw new Error("Invalid work date");
  return date;
}
function importEntry(entry, defaults, source, index, fileHash, context) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new Error("Entry must be an object");
  const item = { ...defaults, ...entry };
  const id = first(item, ["userId", "erpUserId"]);
  const name = first(item, ["userName", "user"]);
  if (!id && !name) throw new Error("Explicit userId or userName required");
  const visible = context.users.filter((user) => !user.hidden && user.active !== false);
  const byId = id ? visible.find((user) => user.id === String(id)) : null;
  const byName = name ? visible.filter((user) => normalized(user.name) === normalized(name)) : [];
  if ((id && !byId) || (name && byName.length !== 1) || (id && name && byId?.id !== byName[0]?.id)) throw new Error("Unknown, ambiguous, hidden, or conflicting user");
  const user = byId || byName[0];
  const supplied = Object.entries(durationFields).filter(([key]) => item[key] !== undefined && item[key] !== null && item[key] !== "");
  if (supplied.length !== 1) throw new Error("Exactly one duration field is required");
  const hours = Math.round(Number(item[supplied[0][0]]) * supplied[0][1] * 100) / 100;
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error("Duration must be greater than 0 and at most 24 hours");
  const projectId = first(item, ["projectId", "erpProjectId"]);
  const projectName = first(item, ["projectName", "project", "projectFolder"]);
  let project = projectId ? context.projects[String(projectId)] : null;
  if (!project && projectName) {
    const matches = Object.values(context.projects).filter((candidate) => normalized(candidate.name) === normalized(projectName));
    if (matches.length === 1) project = matches[0];
  }
  const unknownProject = projectName && !project ? `Ismeretlen projekt az importból: ${projectName} - állítsd be a projektet kézzel.` : "";
  const started = first(item, ["startedAt", "start"]);
  const ended = first(item, ["endedAt", "end"]);
  const note = [unknownProject, String(first(item, ["note", "description"]) || "").trim(), started || ended ? `Időmérő: ${started || ""} - ${ended || ""}` : ""].filter(Boolean).join("\n");
  if (note.length > 2_000) throw new Error("Note exceeds 2,000 characters");
  const workDate = dateOrToday(first(item, ["workDate", "date"]) || started || ended);
  const externalId = String(first(item, ["externalId", "id"]) || "").slice(0, 160);
  return { id: randomUUID(), projectId: project?.id || "", projectName: project?.name || "", userId: user.id, userName: user.name,
    workType: String(first(item, ["workType", "activity"]) || context.workTypes[0] || "Work").slice(0, 160),
    hours, workDate, date: workDate, note, overtime: item.overtime === true && context.overtimeUserIds.includes(user.id),
    source, externalId, importKey: `${fileHash}:${index}`, createdAt: new Date().toISOString(), createdByUserId: user.id, createdByName: user.name };
}

export function createWorklogImporter({ profileDir, context, commit }) {
  const profile = fs.realpathSync(profileDir);
  if (/^(?:\\\\|\/\/|y:)/i.test(profile)) throw new Error("Demo imports must be on a local non-Y drive");
  const root = directory(directory(profile, "imports"), "worklogs");
  const inbox = directory(root, "inbox");
  const processed = directory(root, "processed");
  const failed = directory(root, "failed");
  const history = directory(root, "worktypes-history");
  const typesPath = path.join(root, "worktypes.json");
  let lastTypes = "";
  function writeWorkTypes() {
    const types = context().workTypes;
    const serialized = JSON.stringify({ updatedAt: new Date().toISOString(), defaultWorkType: types[0] || "Work", workTypes: types }, null, 2) + "\n";
    const signature = JSON.stringify(types);
    if (signature === lastTypes) return;
    if (fs.existsSync(typesPath)) {
      if (fs.lstatSync(typesPath).isSymbolicLink()) throw new Error("Demo worktypes file must not be a symlink");
      const existing = JSON.parse(fs.readFileSync(typesPath, "utf8"));
      if (JSON.stringify(existing.workTypes) === signature) { lastTypes = signature; return; }
      fs.copyFileSync(typesPath, path.join(history, `${Date.now()}-${randomUUID()}.json`), fs.constants.COPYFILE_EXCL);
    }
    const temp = `${typesPath}.${randomUUID()}.tmp`;
    fs.writeFileSync(temp, serialized, { flag: "wx" });
    fs.renameSync(temp, typesPath);
    lastTypes = signature;
  }
  function uniquePath(folder, name) {
    return path.join(folder, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}-${name}`);
  }
  function scan() {
    writeWorkTypes();
    for (const file of fs.readdirSync(inbox, { withFileTypes: true }).filter((entry) => entry.isFile() && /^[^\\/]+\.json$/i.test(entry.name)).slice(0, 25)) {
      const input = path.join(inbox, file.name);
      const stat = fs.statSync(input);
      if (Date.now() - stat.mtimeMs < 750) continue;
      let parsed, shape, bytes;
      try {
        if (stat.size > 2_000_000) throw new Error("Import JSON exceeds 2 MB");
        bytes = fs.readFileSync(input);
        parsed = JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, ""));
        shape = Array.isArray(parsed) ? { entries: parsed, defaults: {}, source: "external-time-tracker", format: "array" }
          : parsed && typeof parsed === "object" && Array.isArray(parsed.entries)
            ? { entries: parsed.entries, defaults: parsed.defaults || {}, source: parsed.source || "external-time-tracker", format: "envelope" }
            : parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { entries: [parsed], defaults: {}, source: parsed.source || "external-time-tracker", format: "single" } : null;
        if (!shape || !shape.defaults || typeof shape.defaults !== "object" || Array.isArray(shape.defaults) || !shape.entries.length || shape.entries.length > 500) throw new Error("Invalid import envelope");
      } catch (error) {
        fs.renameSync(input, uniquePath(failed, file.name));
        fs.writeFileSync(uniquePath(failed, `${file.name}.error.txt`), String(error.message || error), { flag: "wx" });
        continue;
      }
      const current = context();
      const fileHash = createHash("sha256").update(bytes).digest("hex");
      const source = String(shape.source || "external-time-tracker").slice(0, 80);
      const rows = [], failures = [];
      shape.entries.forEach((entry, index) => {
        try {
          const row = importEntry(entry, shape.defaults, source, index, fileHash, current);
          if ([...current.workLogs, ...rows].some((existing) => existing.importKey === row.importKey || (row.externalId && existing.source === row.source && existing.externalId === row.externalId))) return;
          rows.push(row);
        } catch (error) { failures.push({ entry, index, error: String(error.message || error) }); }
      });
      if (rows.length) commit(rows);
      if (failures.length) {
        const entries = failures.map((item) => item.entry);
        const rejected = shape.format === "envelope" ? { ...parsed, entries } : shape.format === "array" ? entries : entries[0];
        fs.writeFileSync(uniquePath(failed, file.name), JSON.stringify(rejected, null, 2) + "\n", { flag: "wx" });
        fs.writeFileSync(uniquePath(failed, `${file.name}.error.txt`), failures.map((item) => `Entry ${item.index + 1}: ${item.error}`).join("\n") + "\n", { flag: "wx" });
      }
      fs.renameSync(input, uniquePath(processed, file.name));
    }
  }
  return { scan, paths: { root, inbox, processed, failed, typesPath } };
}
