// Build a fresh SQLite fixture in the original ERP's collection format.
// This reads only the public synthetic config template; it never opens an
// existing ERP database or starts the retained original server.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pbkdf2Sync, randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const root = path.resolve(fileURLToPath(new URL("../", import.meta.url)));
const templatePath = path.join(root, "config.example.json");

export const ORIGINAL_COLLECTIONS = Object.freeze([
  "users", "dashboardTodos", "meetings", "dayOffs", "tasks", "cncTasks",
  "cncMachines", "boms", "cadModels", "toolRequests", "materialRequests",
  "fastenerRequests", "workLogs", "files", "pushSubscriptions", "notifications",
  "projectNotices", "financeSuppliers", "financePriceItems", "financeCostItems",
  "financeOutsourceItems", "financeProductionItems", "engineeringDesignItems",
  "financeQuotes", "engineeringNotes", "archives"
]);
export const ORIGINAL_SINGLETONS = Object.freeze([
  "version", "createdAt", "updatedAt", "security", "protectedSecurity",
  "materialNames", "materialTypes", "materialLengths", "externalCompanies",
  "prefabTaskTypes", "workTypes", "fastenerTypes", "fastenerGrades",
  "fastenerSizes", "toolNames", "projectFolderExclusions", "financeSettings",
  "blockedIps", "ipHistory", "notificationSecurity"
]);

const sampleToCollection = Object.freeze({
  financeDesignItems: "engineeringDesignItems",
  financeEngineeringNotes: "engineeringNotes"
});

function lockedPassword() {
  // Unknown high-entropy secret is deliberately discarded. The original
  // backend has no safe public first-run admin setup yet; this fixture must
  // not create a reusable or printed default password.
  const password = randomBytes(48);
  const salt = randomBytes(16).toString("hex");
  return {
    passwordHash: pbkdf2Sync(password, salt, 210000, 32, "sha256").toString("hex"),
    passwordSalt: salt,
    passwordIterations: 210000
  };
}

export function syntheticOriginalSnapshot(config, at = new Date().toISOString()) {
  if (config?.mode !== "localhost-demo" || !Array.isArray(config.users)
      || !Array.isArray(config.projects) || !config.users.length || !config.projects.length) {
    throw new Error("Only the public synthetic localhost template can seed the original-schema fixture");
  }
  const users = config.users.map((user) => ({
    id: user.id, name: user.name, clearanceLevel: user.clearanceLevel,
    hidden: false, createdAt: at, passwordUpdatedAt: at, ...lockedPassword()
  }));
  const usersById = new Map(users.map((user) => [user.id, user]));
  const projects = config.projects.map((project) => ({
    id: project.id, name: project.name, company: project.company || "",
    active: project.active !== false, priority: project.priority || 0,
    source: "manual", primaryFolder: "", folderPaths: [],
    responsibleUserIds: [], nameAliases: [], folderHistory: [], createdAt: at
  }));
  const projectsById = new Map(projects.map((project) => [project.id, project]));
  const collections = Object.fromEntries(ORIGINAL_COLLECTIONS.map((name) => [name, []]));
  collections.users = users;
  for (const [sampleName, rows] of Object.entries(config.sampleData || {})) {
    const name = sampleToCollection[sampleName] || sampleName;
    if (!ORIGINAL_COLLECTIONS.includes(name) || !Array.isArray(rows)) {
      throw new Error(`Unsupported synthetic sample collection: ${sampleName}`);
    }
    collections[name] = rows.map((row) => {
      if (!row?.id || (row.projectId && !projectsById.has(row.projectId))
          || (row.userId && !usersById.has(row.userId))) {
        throw new Error(`Invalid synthetic sample row: ${sampleName}`);
      }
      return {
        ...row,
        projectName: projectsById.get(row.projectId)?.name || "",
        userName: usersById.get(row.userId)?.name || "",
        createdByUserId: config.activeUserId,
        createdByName: usersById.get(config.activeUserId)?.name || "Demo User"
      };
    });
  }
  // In-app notice examples only. No push endpoints, VAPID keys or external
  // delivery are seeded.
  collections.notifications = users.map((user) => ({
    id: `demo-notification-${user.id}`, userId: user.id, type: "info",
    title: "Workshop ERP sample", body: "This is a synthetic notification.",
    url: "/", tag: "sample", createdAt: at
  }));
  collections.projectNotices = [{
    id: "demo-project-notice", kind: "project-activated",
    projectId: projects[0].id, projectName: projects[0].name,
    actorName: usersById.get(config.activeUserId)?.name || "Demo User",
    createdAt: at, readByUserIds: []
  }];
  const singletons = {
    version: 1, createdAt: at, updatedAt: at,
    security: { passwordHash: "", passwordSalt: "", passwordIterations: 210000, updatedAt: "", lockdownAllowlist: [] },
    protectedSecurity: { passwordHash: "", passwordSalt: "", passwordIterations: 210000, updatedAt: "" },
    projectFolderExclusions: [], blockedIps: [], ipHistory: [],
    notificationSecurity: { vapidPublicJwk: null, vapidPrivateJwk: null, vapidPublicKey: "", createdAt: "" },
    financeSettings: config.financeSettings || {}
  };
  for (const name of ORIGINAL_SINGLETONS) {
    if (Object.hasOwn(config.catalogs || {}, name)) singletons[name] = config.catalogs[name];
    else if (!Object.hasOwn(singletons, name)) singletons[name] = [];
  }
  return { collections, projects, singletons };
}

function safeNewLocalOutput(filename) {
  if (!path.isAbsolute(filename) || /^(?:\\\\|\/\/|y:)/i.test(filename)) {
    throw new Error("Fixture output must be an absolute local non-Y path");
  }
  const resolved = path.resolve(filename);
  const parent = path.dirname(resolved);
  if (resolved === path.parse(resolved).root || !fs.statSync(parent).isDirectory()
      || fs.realpathSync(parent).toLowerCase() !== parent.toLowerCase()) {
    throw new Error("Fixture output parent must be an existing ordinary local directory");
  }
  if (fs.existsSync(resolved)) throw new Error("Refusing to overwrite an existing fixture or database");
  return resolved;
}

export function createOriginalFixture(filename, { config = JSON.parse(fs.readFileSync(templatePath, "utf8")), at } = {}) {
  const output = safeNewLocalOutput(filename);
  const snapshot = syntheticOriginalSnapshot(config, at);
  // Exclusive create protects an existing DB even if another process races us.
  const fd = fs.openSync(output, "wx");
  fs.closeSync(fd);
  const db = new DatabaseSync(output);
  try {
    db.exec("PRAGMA journal_mode = DELETE; PRAGMA synchronous = FULL; BEGIN IMMEDIATE");
    for (const name of ORIGINAL_COLLECTIONS) {
      db.exec(`CREATE TABLE ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
      const insert = db.prepare(`INSERT INTO ${name} (id, data) VALUES (?, ?)`);
      for (const row of snapshot.collections[name]) insert.run(row.id, JSON.stringify(row));
    }
    db.exec("CREATE TABLE projects (id TEXT PRIMARY KEY, data TEXT NOT NULL)");
    const insertProject = db.prepare("INSERT INTO projects (id, data) VALUES (?, ?)");
    for (const project of snapshot.projects) insertProject.run(project.id, JSON.stringify(project));
    db.exec("CREATE TABLE singletons (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const insertSingleton = db.prepare("INSERT INTO singletons (key, value) VALUES (?, ?)");
    for (const name of ORIGINAL_SINGLETONS) insertSingleton.run(name, JSON.stringify(snapshot.singletons[name]));
    db.exec("COMMIT");
    const result = db.prepare("PRAGMA integrity_check").get();
    if (Object.values(result)[0] !== "ok") throw new Error("Synthetic SQLite integrity check failed");
  } finally {
    db.close();
  }
  return { output, projects: snapshot.projects.length, users: snapshot.collections.users.length,
    notifications: snapshot.collections.notifications.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out") {
    throw new Error("Usage: node scripts/create-original-fixture.mjs --out <new local absolute .db path>");
  }
  console.log(JSON.stringify(createOriginalFixture(args[1])));
}
