// Isolated ERP demo. Never import the production host/watchdog module here.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { openDemoStore } from "./demo-store.mjs";
import { workbook } from "./xlsx-demo.mjs";
import { documentArea, documentMime, spreadsheetRows, bomItems } from "./demo-documents.mjs";
import { createImageArea } from "./demo-images.mjs";
import { createWorklogImporter } from "./demo-worklog-import.mjs";
import { createProjectBrowser } from "./demo-project-browser.mjs";
import { createModellingArea } from "./demo-modelling.mjs";
import { createDemoAuth } from "./demo-auth.mjs";
import { createSourceZip } from "./scripts/package-source.mjs";
import { validateScanRoots, inventoryLocalProjectFolders, planLocalProjectContinuity } from "./demo-project-scan.mjs";
import { validateOcrConfig, createDemoOcr } from "./demo-ocr.mjs";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "app", "public");
const args = process.argv.slice(2);
let configPath = path.join(root, "config.json");
const configIndex = args.indexOf("--config");
if (configIndex >= 0) {
  if (!args[configIndex + 1]) throw new Error("--config needs a local JSON file path");
  configPath = path.resolve(args[configIndex + 1]);
  args.splice(configIndex, 2);
}
const checkOnly = args.includes("--check-config");
if (args.some((arg) => arg !== "--check-config")) throw new Error("Unknown demo argument");
if (/^(?:\\\\|\/\/|y:)/i.test(configPath) || fs.lstatSync(configPath).isSymbolicLink()
    || /^(?:\\\\|\/\/|y:)/i.test(fs.realpathSync(configPath))) {
  throw new Error("Demo config must be a regular file on a local non-Y drive");
}

const allowedConfigKeys = new Set(["mode", "port", "appName", "companyNames", "activeUserId", "overtimeUserIds", "overtimeViewerIds", "users", "projects", "sampleData", "catalogs", "financeSettings", "security", "cadModelFormat", "scanRoots", "ocr", "futureHosting"]);
// This is a documented migration contract, not an operational host setting.
// Keep it strictly inert until the guarded backend and launchers are adapted.
const futureHostingShape = {
  schemaVersion: 1,
  status: "reference-only",
  organization: { locale: "text", timeZone: "text", currency: "text" },
  storage: {
    canonicalShare: "text", mappedDrive: "text", erpRoot: "text", appDirectory: "text",
    dataDirectory: "text", databaseFile: "text", projectRoots: ["text"],
    excludedProjectPaths: ["text"], worklogInbox: "text", cadModelInbox: "text",
    cadModelCache: "text", modellingPhotos: "text", trashDirectory: "text",
    logsDirectory: "text", uploadsDirectory: "text"
  },
  server: {
    host: "text", port: "port", localAuthRequired: true,
    internetEnabled: false, internetHost: "text",
    internetPort: "port", httpsEnabled: false, httpsHost: "text", httpsPort: "port",
    publicHost: "text", publicHttpsPort: "port", scanIntervalSeconds: "interval",
    allowedIpPrefixes: ["text"]
  },
  cloudflare: {
    enabled: false, tunnelType: "remotely-managed", publicHostname: "text",
    originUrl: "text", binaryPath: "text", tokenSourceFile: "text",
    tokenLocalFile: "text"
  },
  watchdog: {
    enabled: false, singleActiveHost: true, hostLockFile: "text", hostSwitchFile: "text",
    heartbeatDirectory: "text", startupInstaller: "text", standbyLauncher: "text",
    hostNicknames: "nicknames"
  },
  helper: { enabled: false, url: "text", sourceScript: "text", localInstallRoot: "text" },
  backups: {
    enabled: false, automaticRoot: "text", manualRoot: "text",
    keepLatestAutomatic: "retention", keepLatestManual: "retention", trashOnly: true
  }
};
function validateFutureHostingNode(value, shape, label) {
  if (shape === "text") {
    if (typeof value !== "string" || value.length > 512 || /[<>\x00-\x1f]/.test(value)) {
      throw new Error(`${label} must be plain text of at most 512 characters`);
    }
    return;
  }
  if (shape === "port" || shape === "interval" || shape === "retention") {
    const [min, max] = shape === "port" ? [1, 65535] : shape === "interval" ? [5, 3600] : [1, 100];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} must be ${min}-${max}`);
    return;
  }
  if (shape === "nicknames") {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 30) {
      throw new Error(`${label} must be a small hostname-to-nickname object`);
    }
    for (const [hostname, nickname] of Object.entries(value)) {
      if (!/^[A-Za-z0-9][A-Za-z0-9.-]{0,79}$/.test(hostname)) throw new Error(`${label} has an invalid hostname`);
      validateFutureHostingNode(nickname, "text", `${label}.${hostname}`);
    }
    return;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length > 30) throw new Error(`${label} must be an array of at most 30 items`);
    value.forEach((item, index) => validateFutureHostingNode(item, shape[0], `${label}[${index}]`));
    return;
  }
  if (shape && typeof shape === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
    const expected = Object.keys(shape);
    for (const key of Object.keys(value)) if (!expected.includes(key)) throw new Error(`Unknown ${label} key: ${key}`);
    for (const key of expected) {
      if (!Object.hasOwn(value, key)) throw new Error(`Missing ${label} key: ${key}`);
      validateFutureHostingNode(value[key], shape[key], `${label}.${key}`);
    }
    return;
  }
  if (value !== shape) throw new Error(`${label} must remain ${JSON.stringify(shape)}; hosted startup is disabled`);
}
function validateFutureHosting(value) {
  if (value === undefined) return;
  validateFutureHostingNode(value, futureHostingShape, "futureHosting");
  for (const field of ["tokenSourceFile", "tokenLocalFile"]) {
    const file = value.cloudflare[field];
    if (file && (!/[\\/]/.test(file) || !/\.txt$/i.test(file))) {
      throw new Error(`futureHosting.cloudflare.${field} must be a .txt file path, never a token value`);
    }
  }
}
const catalogKeys = {
  material: "materialNames", type: "materialTypes", materialLength: "materialLengths",
  workType: "workTypes", fastenerType: "fastenerTypes", fastenerGrade: "fastenerGrades",
  fastenerSize: "fastenerSizes", toolName: "toolNames", externalCompany: "externalCompanies",
  prefabTaskType: "prefabTaskTypes"
};
const forbiddenText = /(?:\\\\|[A-Za-z]:[\\/]|https?:\/\/|cloudflare|password|token|secret)/i;
function textField(value, label, max = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[<>\x00-\x1f]/.test(value)) {
    throw new Error(`${label} must be a nonempty plain-text string (max ${max})`);
  }
  if (forbiddenText.test(value)) throw new Error(`${label} cannot contain paths, URLs, or credentials`);
  return value.trim();
}
function safeSeedValue(value, label, depth = 0) {
  if (depth > 3) throw new Error(`${label} is nested too deeply`);
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return;
  if (typeof value === "string") {
    if (value.length > 1000 || forbiddenText.test(value) || /[\x00-\x08\x0b\x0e-\x1f]/.test(value)) throw new Error(`Unsafe sample value in ${label}`);
    return;
  }
  if (Array.isArray(value) && value.length <= 100) return value.forEach((item, index) => safeSeedValue(item, `${label}[${index}]`, depth + 1));
  if (value && typeof value === "object" && Object.keys(value).length <= 50) {
    for (const [key, item] of Object.entries(value)) {
      if (!/^[a-zA-Z][a-zA-Z0-9]{0,60}$/.test(key) || /password|token|secret|credential|cookie|session|private/i.test(key)) throw new Error(`Unsafe sample field: ${label}.${key}`);
      safeSeedValue(item, `${label}.${key}`, depth + 1);
    }
    return;
  }
  throw new Error(`Invalid sample value in ${label}`);
}
function validateConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Config must be an object");
  for (const key of Object.keys(value)) if (!allowedConfigKeys.has(key)) throw new Error(`Unknown or unsafe config key: ${key}`);
  if (value.mode !== "localhost-demo") throw new Error('Config mode must be "localhost-demo"');
  if (!Number.isInteger(value.port) || value.port < 1024 || value.port > 65535 || [4780, 4781, 4782].includes(value.port)) {
    throw new Error("Demo port must be 1024-65535, excluding production ports 4780-4782");
  }
  textField(value.appName, "appName", 80);
  validateFutureHosting(value.futureHosting);
  validateScanRoots(value.scanRoots);
  validateOcrConfig(value.ocr);
  if (value.cadModelFormat !== undefined && (typeof value.cadModelFormat !== "string" || !/^[a-z][a-z0-9-]{2,63}$/.test(value.cadModelFormat))) {
    throw new Error("cadModelFormat must be a 3-64 character lowercase format identifier");
  }
  if (!Array.isArray(value.companyNames) || !value.companyNames.length || value.companyNames.length > 8) throw new Error("companyNames requires 1-8 names");
  value.companyNames.forEach((item, i) => textField(item, `companyNames[${i}]`));
  if (!Array.isArray(value.users) || !value.users.length || value.users.length > 30) throw new Error("users requires 1-30 display-only users");
  const userIds = new Set();
  for (const user of value.users) {
    if (Object.keys(user).some((key) => !["id", "name", "clearanceLevel"].includes(key))) throw new Error("Demo users may contain only id, name, clearanceLevel; never passwords");
    const id = textField(user.id, "user.id", 80);
    textField(user.name, "user.name", 80);
    if (![1, 2].includes(user.clearanceLevel) || userIds.has(id)) throw new Error("Invalid or duplicate demo user");
    userIds.add(id);
  }
  if (!userIds.has(value.activeUserId)) throw new Error("activeUserId must match a demo user");
  if (value.security !== undefined) {
    if (!value.security || typeof value.security !== "object" || Array.isArray(value.security)
        || Object.keys(value.security).some((key) => key !== "mode")
        || value.security.mode !== "local-password") throw new Error("security may only select local-password mode");
    if (value.users.find((user) => user.id === value.activeUserId)?.clearanceLevel !== 2) {
      throw new Error("The first secure-local administrator must have level-2 clearance");
    }
  }
  for (const field of ["overtimeUserIds", "overtimeViewerIds"]) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field]) || value[field].length > 30 || value[field].some((id) => !userIds.has(id))) throw new Error(`${field} must list known demo user IDs`);
  }
  if (!Array.isArray(value.projects) || value.projects.length > 100) throw new Error("projects must be an array of up to 100 display-only projects");
  const projectIds = new Set();
  for (const project of value.projects) {
    if (Object.keys(project).some((key) => !["id", "name", "company", "active", "priority"].includes(key))) throw new Error("Demo project has an unsafe or unknown key");
    const id = textField(project.id, "project.id", 80);
    textField(project.name, "project.name");
    if (project.company !== undefined) textField(project.company, "project.company");
    if (project.active !== undefined && typeof project.active !== "boolean") throw new Error("project.active must be boolean");
    if (project.priority !== undefined && (!Number.isInteger(project.priority) || project.priority < 0 || project.priority > 10)) throw new Error("project.priority must be 0-10");
    if (projectIds.has(id)) throw new Error("Duplicate project ID");
    projectIds.add(id);
  }
  if (value.sampleData !== undefined) {
    if (!value.sampleData || typeof value.sampleData !== "object" || Array.isArray(value.sampleData)) throw new Error("sampleData must be an object");
    const seedKeys = new Set(["dashboardTodos", "materialRequests", "toolRequests", "fastenerRequests", "workLogs", "tasks", "cncTasks", "boms", "cadModels", "meetings", "dayOffs", "cncMachines", "financeSuppliers", "financePriceItems", "financeCostItems", "financeOutsourceItems", "financeProductionItems", "financeDesignItems", "financeQuotes", "financeEngineeringNotes"]);
    for (const [key, rows] of Object.entries(value.sampleData)) {
      if (!seedKeys.has(key) || !Array.isArray(rows) || rows.length > 50) throw new Error(`Invalid sampleData collection: ${key}`);
      for (const row of rows) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("Sample row must be an object");
        safeSeedValue(row, `sampleData.${key}`);
        if (row.projectId && !projectIds.has(row.projectId)) throw new Error("Sample projectId does not exist");
        if (row.userId && !userIds.has(row.userId)) throw new Error("Sample userId does not exist");
      }
    }
  }
  if (value.catalogs !== undefined) {
    if (!value.catalogs || typeof value.catalogs !== "object" || Array.isArray(value.catalogs)) throw new Error("catalogs must be an object");
    for (const [key, rows] of Object.entries(value.catalogs)) {
      if (!Object.values(catalogKeys).includes(key) || !Array.isArray(rows) || rows.length > 100) throw new Error(`Invalid catalog: ${key}`);
      rows.forEach((row, i) => textField(row, `catalogs.${key}[${i}]`));
    }
  }
  if (value.financeSettings !== undefined) safeSeedValue(value.financeSettings, "financeSettings");
  return value;
}

const config = validateConfig(JSON.parse(fs.readFileSync(configPath, "utf8")));
const profileDir = fs.realpathSync(path.dirname(configPath));
const imageDir = path.join(profileDir, "images");
if (fs.lstatSync(imageDir).isSymbolicLink() || fs.realpathSync(imageDir).toLowerCase() !== imageDir.toLowerCase()) {
  throw new Error("Demo image asset folder must not redirect outside its profile");
}
const imagePath = path.join(imageDir, "logo.svg");
const cadInbox = path.join(profileDir, "imports", "cadmodels");
const viewerDir = path.join(publicDir, "erp-glb-viewer");
const viewerSourceZip = path.join(root, "app", "vendor", "erp-glb-viewer-source.zip");
if (!fs.existsSync(imagePath)) throw new Error(`Missing image: ${imagePath}`);
if (fs.lstatSync(imagePath).isSymbolicLink()) throw new Error("Demo logo must not be a symlink");
const logo = fs.readFileSync(imagePath);
const logoText = logo.toString("utf8");
if (logo.length > 512_000 || !/^\s*(?:<\?xml[^>]*>\s*)?<svg\b/i.test(logoText)
    || /<script\b|<foreignObject\b|<image\b|\bon\w+\s*=|(?:xlink:)?href\s*=|@import|url\s*\(/i.test(logoText)) {
  throw new Error("images/logo.svg must be a small self-contained SVG without active or external content");
}
if (checkOnly) {
  console.log(`Config OK: ${config.appName}; ${config.users.length} users; ${config.projects.length} projects; image OK; no server started.`);
  process.exit(0);
}
// Snapshot this exact source tree at process start. Runtime config, credentials,
// uploads, and the profile database are absent from the explicit allowlist.
const sourceBundle = createSourceZip(root);
const documents = documentArea(profileDir);
const projectBrowser = createProjectBrowser(documents, (id) => projects[id]?.scanManaged ? projects[id].primaryFolder : "");

const now = new Date().toISOString();
let users = config.users.map((user) => ({ ...user, active: true, hidden: false, createdAt: now }));
let activeUser = users.find((user) => user.id === config.activeUserId);
let projects = Object.fromEntries(config.projects.map((project) => [project.id, {
  ...project, active: project.active !== false, priority: project.priority ?? 0,
  source: "demo", primaryFolder: "", folders: [], createdAt: now, folderAddedAt: now,
  responsibleUserIds: [], nameAliases: [], folderHistory: []
}]));
const sampleArrays = ["dashboardTodos", "materialRequests", "toolRequests", "fastenerRequests", "workLogs", "tasks", "cncTasks", "boms", "cadModels", "meetings", "dayOffs", "cncMachines"];
let data = {
  users, projects,
  tasks: [], cncTasks: [], toolRequests: [], materialRequests: [], fastenerRequests: [],
  workLogs: [], boms: [], cadModels: [], meetings: [], dayOffs: [], dashboardTodos: [],
  cncMachines: [], files: [], notifications: [], projectNotices: [], projectFolderExclusions: [],
  materialNames: ["S235", "C45", "Aluminium"], materialTypes: ["bar", "sheet", "tube"],
  materialLengths: ["1000", "3000", "6000"], workTypes: ["Design", "Machining", "Assembly"],
  fastenerTypes: ["bolt", "nut", "washer"], fastenerGrades: ["8.8", "10.9"], fastenerSizes: ["M6", "M8"],
  toolNames: ["End mill", "Drill"], externalCompanies: [], prefabTaskTypes: []
};
for (const key of sampleArrays) {
  data[key] = (config.sampleData?.[key] || []).map((row) => ({
    ...row, id: row.id || randomUUID(), createdAt: row.createdAt || now,
    projectName: projects[row.projectId]?.name || "",
    userName: users.find((user) => user.id === row.userId)?.name || "",
    createdByUserId: activeUser.id, createdByName: activeUser.name
  }));
}
for (const [key, values] of Object.entries(config.catalogs || {})) data[key] = values.slice();

let finance = {
  suppliers: [], priceItems: [], costItems: [], outsourceItems: [],
  productionItems: [], designItems: [], quotes: [], engineeringNotes: [], settings: config.financeSettings || {}
};
for (const [sampleKey, financeKey] of Object.entries({ financeSuppliers: "suppliers", financePriceItems: "priceItems", financeCostItems: "costItems", financeOutsourceItems: "outsourceItems", financeProductionItems: "productionItems", financeDesignItems: "designItems", financeQuotes: "quotes", financeEngineeringNotes: "engineeringNotes" })) {
  finance[financeKey] = (config.sampleData?.[sampleKey] || []).map((row) => ({ ...row, id: row.id || randomUUID(), createdAt: row.createdAt || now }));
}
let archives = [];
const store = openDemoStore(configPath);
const uploadDir = path.join(path.dirname(store.dbPath), "uploads");
fs.mkdirSync(uploadDir, { recursive: true });
if (fs.lstatSync(uploadDir).isSymbolicLink() || fs.realpathSync(uploadDir).toLowerCase() !== uploadDir.toLowerCase()) {
  throw new Error("Demo upload folder must not redirect outside its profile");
}
const images = createImageArea(path.dirname(store.dbPath));
const ocr = createDemoOcr(config.ocr);
const modelling = createModellingArea(path.dirname(store.dbPath), images);
const persisted = store.loadOrSeed({ data, finance, archives });
if (persisted && persisted.data && typeof persisted.data === "object") {
  data = persisted.data;
  finance = persisted.finance || finance;
  archives = Array.isArray(persisted.archives) ? persisted.archives : archives;
  users = Array.isArray(data.users) ? data.users : users;
  projects = data.projects && typeof data.projects === "object" ? data.projects : projects;
  data.users = users;
  data.projects = projects;
  activeUser = users.find((user) => user.id === config.activeUserId) || users[0];
}
const secureLocal = config.security?.mode === "local-password";
if (!secureLocal && store.credentialCount() > 0) {
  throw new Error("This demo profile has local credentials; keep security.mode=local-password enabled");
}
const auth = secureLocal ? createDemoAuth({ store, users: () => users, adminUserId: config.activeUserId }) : null;

const collectionRoutes = new Map([
  ["/api/tasks", "tasks"], ["/api/cnc-tasks", "cncTasks"],
  ["/api/tool-requests", "toolRequests"], ["/api/material-requests", "materialRequests"],
  ["/api/fastener-requests", "fastenerRequests"], ["/api/worklogs", "workLogs"],
  ["/api/dashboard/todos", "dashboardTodos"], ["/api/meetings", "meetings"],
  ["/api/dayoffs", "dayOffs"], ["/api/cnc-machines", "cncMachines"]
]);
const financeRoutes = new Map([
  ["/api/finance/suppliers", "suppliers"],
  ["/api/finance/price-items", "priceItems"],
  ["/api/finance/cost-items", "costItems"],
  ["/api/finance/outsource-items", "outsourceItems"],
  ["/api/finance/production-items", "productionItems"],
  ["/api/finance/design-items", "designItems"],
  ["/api/finance/quotes", "quotes"],
  ["/api/finance/engineering-notes", "engineeringNotes"]
]);
const clients = new Set();
let lastProjectScanAt = now;
const cadMissingScans = new Map();
function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(body);
}
function changed() {
  try { store.save({ data, finance, archives }); }
  catch (error) {
    console.error("Demo SQLite save failed; stopping to prevent stale RAM writes:", error);
    process.exit(1);
  }
  for (const client of clients) client.write("event: state-changed\ndata: {}\n\n");
}
function state(actor = activeUser, csrf = "") {
  const { ocrCorrections, ...publicData } = data;
  return {
    auth: { passwordSet: true, user: actor, csrf },
    config: { port: config.port, host: "127.0.0.1", internetEnabled: false, localAuthRequired: secureLocal, helperUrl: "", workingDirectory: "", scanRoots: config.scanRoots || [], ocrEnabled: ocr.enabled, excludedPaths: [], scanIntervalSeconds: 60, hostNicknames: {} },
    server: { hostname: "LOCAL-DEMO", effectiveWorkingDirectory: path.dirname(configPath), usingFallbackDirectory: false, dataFile: store.dbPath, uploadsDirectory: "demo-only", lastScan: { at: lastProjectScanAt } },
    orderedProjects: Object.values(projects).sort((a, b) => (a.priority || 0) - (b.priority || 0)),
    data: { ...publicData, cadModels: data.cadModels.filter((item) => !item.hidden),
      projectNotices: (data.projectNotices || []).map(({ readByUserIds, ...notice }) => ({ ...notice, read: (readByUserIds || []).includes(actor.id) })) }
  };
}
function addProjectNotice(kind, project, details = {}, actorName = "") {
  data.projectNotices ||= [];
  data.projectNotices.unshift({ id: randomUUID(), kind, projectId: project.id, projectName: project.name,
    createdAt: new Date().toISOString(), actorName, readByUserIds: [], ...details });
}
function remapProjectPaths(value, oldFolder, newFolder) {
  if (Array.isArray(value)) return value.map((part) => remapProjectPaths(part, oldFolder, newFolder));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, part]) => [key, remapProjectPaths(part, oldFolder, newFolder)]));
  if (typeof value !== "string" || value.slice(0, oldFolder.length).toLocaleLowerCase("hu-HU") !== oldFolder.toLocaleLowerCase("hu-HU")) return value;
  const suffix = value.slice(oldFolder.length);
  return !suffix || /^[\\/]/.test(suffix) ? newFolder + suffix : value;
}
function scanLocalProjects() {
  if (!config.scanRoots?.length) return { disabled: true, added: 0, renamed: 0, missing: 0 };
  // Collect and validate the complete local inventory before changing any ERP data.
  const inventory = inventoryLocalProjectFolders(profileDir, config.scanRoots);
  const plan = planLocalProjectContinuity(projects, inventory);
  const at = new Date().toISOString();
  let dirty = false;
  for (const { project, folder } of [...plan.matches, ...plan.attachments]) {
    if (project.primaryFolder !== folder.folderPath || !project.scanManaged || project.folderMissing || project.missingScanCount) dirty = true;
    project.primaryFolder = folder.folderPath;
    project.folderPaths = [folder.folderPath];
    project.scanManaged = true;
    project.folderMissing = false;
    project.missingScanCount = 0;
    if (!project.folderAddedAt) project.folderAddedAt = at;
  }
  for (const { project, folder } of plan.renames) {
    const oldFolder = project.primaryFolder, oldName = project.name;
    project.name = folder.name;
    project.primaryFolder = folder.folderPath;
    project.folderPaths = [folder.folderPath];
    project.nameAliases = [...new Set([...(project.nameAliases || []), oldName])];
    project.folderHistory = [...new Set([...(project.folderHistory || []), oldFolder])];
    project.folderMissing = false;
    project.missingScanCount = 0;
    for (const [key, rows] of Object.entries(data)) if (key !== "projectNotices" && Array.isArray(rows)) for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.projectId !== project.id) continue;
      rows[i] = { ...remapProjectPaths(rows[i], oldFolder, folder.folderPath), projectName: project.name };
    }
    for (const rows of Object.values(finance)) if (Array.isArray(rows)) for (let i = 0; i < rows.length; i++) {
      if (rows[i]?.projectId !== project.id) continue;
      rows[i] = { ...remapProjectPaths(rows[i], oldFolder, folder.folderPath), projectName: project.name };
    }
    addProjectNotice("folder-renamed", project, { oldName, oldFolder, newFolder: folder.folderPath });
    dirty = true;
  }
  for (const folder of plan.additions) {
    const project = { id: randomUUID(), name: folder.name, company: config.companyNames[0], active: true,
      priority: 0, source: "local-folder", primaryFolder: folder.folderPath, folderPaths: [folder.folderPath],
      scanManaged: true, folderMissing: false, missingScanCount: 0, createdAt: at, folderAddedAt: at,
      responsibleUserIds: [], nameAliases: [], folderHistory: [] };
    projects[project.id] = project;
    dirty = true;
  }
  let newlyMissing = 0;
  for (const project of plan.missing) {
    project.missingScanCount = Math.min(3, Number(project.missingScanCount || 0) + 1);
    if (project.missingScanCount >= 3 && !project.folderMissing) {
      project.folderMissing = true;
      addProjectNotice("folder-missing", project, { oldFolder: project.primaryFolder });
      newlyMissing++;
    }
    dirty = true;
  }
  lastProjectScanAt = at;
  if (dirty) changed();
  return { ok: true, added: plan.additions.length, renamed: plan.renames.length, missing: newlyMissing,
    attached: plan.attachments.length, scanned: inventory.folders.length };
}
function scanCadInbox() {
  let names;
  try { names = fs.readdirSync(cadInbox).filter((name) => name.endsWith(".json")); }
  catch (error) { if (error.code !== "ENOENT") console.warn("CAD inbox unreadable:", error.message); return; }
  const seen = new Set();
  let dirty = false;
  for (const name of names) {
    if (!/^[a-zA-Z0-9._-]{1,180}\.json$/.test(name) || name.startsWith(".")) continue;
    try {
      const sidecar = JSON.parse(fs.readFileSync(path.join(cadInbox, name), "utf8"));
      const glbName = name.slice(0, -5) + ".glb";
      if (sidecar.format !== (config.cadModelFormat || "workshop-cadmodel") || sidecar.formatVersion !== 1 || sidecar.glbFile !== glbName) continue;
      const glbPath = path.join(cadInbox, glbName);
      const stat = fs.statSync(glbPath);
      if (!stat.isFile() || stat.size < 20 || stat.size > 1_000_000_000 || stat.size !== sidecar.bytes) continue;
      const fd = fs.openSync(glbPath, "r");
      let header;
      try { header = Buffer.alloc(20); fs.readSync(fd, header, 0, 20, 0); } finally { fs.closeSync(fd); }
      if (header.toString("ascii", 0, 4) !== "glTF" || header.readUInt32LE(4) !== 2 || header.readUInt32LE(8) !== stat.size || header.toString("ascii", 16, 20) !== "JSON") continue;
      seen.add(glbName);
      cadMissingScans.delete(glbName);
      const existing = data.cadModels.find((item) => item.glbFile === glbName);
      if (existing) {
        if (existing.hidden) { existing.hidden = false; dirty = true; }
      } else {
        data.cadModels.unshift({ id: randomUUID(), glbFile: glbName, sourceName: String(sidecar.source?.name || glbName).slice(0, 160),
          sourceType: sidecar.source?.type === "part" ? "part" : "assembly", projectLabel: String(sidecar.projectName || "").slice(0, 160),
          exportedAt: String(sidecar.exportedAt || new Date().toISOString()), bytes: stat.size, projectId: "", nickname: "", hidden: false });
        dirty = true;
      }
    } catch (error) { if (error.code !== "ENOENT") console.warn(`CAD pair ${name} ignored: ${error.message}`); }
  }
  for (const item of data.cadModels) {
    if (item.hidden || seen.has(item.glbFile)) continue;
    const count = (cadMissingScans.get(item.glbFile) || 0) + 1;
    cadMissingScans.set(item.glbFile, count);
    if (count >= 3) { item.hidden = true; dirty = true; }
  }
  if (dirty) changed();
}
function readBody(req, max = 1_000_000) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.on("data", (chunk) => {
      text += chunk;
      if (text.length > max) { reject(new Error("Demo request too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { const body = JSON.parse(text || "{}"); if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error(); resolve(body); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}
function readBytes(req, max = 20_000_000) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > max) { reject(new Error("Demo file is too large")); req.destroy(); return; }
      parts.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", reject);
  });
}
function storedFile(filePath) {
  const candidate = path.resolve(String(filePath || ""));
  const insideStorage = (target) => [documents.root, uploadDir].some((folder) => {
    const rel = path.relative(folder, target);
    return rel !== "" && rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
  });
  if (!insideStorage(candidate)) throw new Error("File is outside local demo storage");
  const target = fs.realpathSync(candidate);
  if (!insideStorage(target)) throw new Error("File is outside local demo storage");
  if (!fs.statSync(target).isFile()) throw new Error("Not a file");
  return target;
}
function sendDocument(res, filePath, name, inline = false) {
  const target = storedFile(filePath);
  const size = fs.statSync(target).size;
  const safeName = path.basename(name || target).replace(/[^a-zA-Z0-9._-]/g, "_");
  res.writeHead(200, { "Content-Type": documentMime(safeName), "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"`, "Content-Length": size, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(target).pipe(res);
}
function sendSpreadsheetPreview(res, filePath, name) {
  const target = storedFile(filePath);
  if (fs.statSync(target).size > 20_000_000) throw new Error("Spreadsheet preview is limited to 20 MB");
  const rows = spreadsheetRows(fs.readFileSync(target), name).slice(0, 500);
  const body = rows.map((row) => `<tr>${row.map((cell) => `<td>${htmlEscape(cell)}</td>`).join("")}</tr>`).join("");
  const html = `<!doctype html><meta charset="utf-8"><title>${htmlEscape(name)} — demo</title><style>body{font:14px system-ui;background:#f6f7f4;margin:18px}table{border-collapse:collapse}td{border:1px solid #ccd;padding:6px;white-space:pre-wrap}</style><h1>${htmlEscape(name)}</h1><table>${body}</table>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.end(html);
}
function sendImage(res, image) {
  const file = images.open(image);
  res.writeHead(200, { "Content-Type": file.mime, "Content-Length": file.size, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  fs.createReadStream(file.path).pipe(res);
}
function safeBody(body) {
  const copy = {};
  for (const [key, value] of Object.entries(body)) {
    if (["__proto__", "prototype", "constructor", "id", "createdAt", "createdByUserId", "createdByName", "projectName", "userName", "images", "imageDataUrls", "imageDataUrl", "imageName", "attachmentPath"].includes(key)) continue;
    if (typeof value === "string" && value.length > 10_000) continue;
    if (value === null || ["string", "number", "boolean"].includes(typeof value)) copy[key] = value;
    if (Array.isArray(value) && value.length <= 100 && value.every((part) => typeof part === "string" && part.length <= 160)) copy[key] = value;
  }
  return copy;
}
function normalizeItem(item, key, actor = activeUser) {
  if (key === "workLogs") {
    item.workDate = item.date || item.workDate || new Date().toISOString().slice(0, 10);
    item.hours = Number(item.hours || 0);
    item.overtime = Boolean(item.overtime) && actor.id === item.userId && (config.overtimeUserIds || []).includes(actor.id);
  }
  if (["materialRequests", "toolRequests", "fastenerRequests", "tasks"].includes(key)) item.quantity = Number(item.quantity || 0);
  if (key === "dashboardTodos") item.checkedAt = item.checked ? new Date().toISOString() : "";
  const catalogs = {
    materialRequests: [["material", "materialNames"], ["type", "materialTypes"], ["length", "materialLengths"]],
    toolRequests: [["toolName", "toolNames"]],
    fastenerRequests: [["type", "fastenerTypes"], ["grade", "fastenerGrades"], ["size", "fastenerSizes"]]
  };
  for (const [field, collection] of catalogs[key] || []) {
    const value = String(item[field] || "").trim();
    if (value && !data[collection].includes(value)) data[collection].push(value);
  }
  return item;
}
function htmlEscape(value) { return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]); }
function serveStatic(res, filename, contentType) {
  const bytes = fs.readFileSync(filename);
  res.writeHead(200, { "Content-Type": contentType, "Content-Length": bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(bytes);
}
function serveIndex(res) {
  const html = fs.readFileSync(path.join(publicDir, "index.html"), "utf8")
    .replaceAll("Workshop ERP", htmlEscape(config.appName));
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'", "X-Content-Type-Options": "nosniff" });
  res.end(html);
}
function sendWorkbook(res, filename, headers, rows) {
  const bytes = workbook(headers, rows);
  res.writeHead(200, { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${filename}"`, "Content-Length": bytes.length, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  res.end(bytes);
}
function demoError(res, message = "Not available in the local demo; no production files or services are connected") { sendJson(res, 501, { error: message }); }
function archiveRecord(type, item, actor = activeUser) {
  const record = {
    id: randomUUID(), type, data: structuredClone(item),
    projectName: projects[item.projectId]?.name || item.projectName || "",
    itemLabel: item.title || item.name || item.material || item.toolName || item.type || "Demo entry",
    archivedAt: new Date().toISOString(), archivedByName: actor.name, reason: "manual-delete"
  };
  archives.unshift(record);
  return record;
}
function freshItem(body, actor = activeUser) {
  return {
    ...safeBody(body), id: randomUUID(), createdAt: new Date().toISOString(),
    projectName: projects[body.projectId]?.name || "",
    userName: users.find((user) => user.id === body.userId)?.name || "",
    createdByUserId: actor.id, createdByName: actor.name
  };
}
function safeProjectId(body) {
  if (!body.projectId || !projects[body.projectId]) throw new Error("Choose an existing demo project");
}
function linkedAttachment(input) {
  if (!input) return null;
  const file = documents.resolve(input, { file: true, officeOnly: true });
  return { kind: "link", name: path.basename(file.path), path: file.path, size: file.stat.size,
    mime: documentMime(file.path), createdAt: new Date().toISOString() };
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host;
    const allowedHosts = new Set([`localhost:${config.port}`, `127.0.0.1:${config.port}`]);
    if (!allowedHosts.has(host) || !["127.0.0.1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress)) return sendJson(res, 403, { error: "Localhost only" });
    const origin = req.headers.origin;
    if ((origin && !allowedHosts.has(origin.replace(/^http:\/\//, ""))) || req.headers["sec-fetch-site"] === "cross-site") return sendJson(res, 403, { error: "Cross-site access blocked" });
    if (!req.url?.startsWith("/") || req.url.startsWith("//")) return sendJson(res, 400, { error: "Invalid path" });
    const pathname = new URL(req.url, `http://${host}`).pathname;
    const method = req.method || "GET";
    if (method === "GET" && pathname === "/SOURCE.zip") {
      res.writeHead(200, { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="workshop-erp-source.zip"',
        "Content-Length": sourceBundle.bytes.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(sourceBundle.bytes);
    }
    if (method === "GET" && pathname === "/LICENSE") return serveStatic(res, path.join(root, "LICENSE"), "text/plain; charset=utf-8");
    if (method === "GET" && pathname === "/") return serveIndex(res);
    if (method === "GET" && pathname === "/images/logo.svg") {
      res.writeHead(200, { "Content-Type": "image/svg+xml", "Content-Length": logo.length, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      return res.end(logo);
    }
    if (method === "GET" && pathname === "/demo-config.js") {
      const value = JSON.stringify({ companyNames: config.companyNames, overtimeUserIds: config.overtimeUserIds || [], overtimeViewerIds: config.overtimeViewerIds || [] }).replace(/</g, "\\u003c");
      res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(`globalThis.ERP_DEMO_CONFIG = ${value};`);
    }
    const staticFiles = {
      "/app.js": ["app.js", "text/javascript; charset=utf-8"],
      "/english-ui.js": ["english-ui.js", "text/javascript; charset=utf-8"],
      "/styles.css": ["styles.css", "text/css; charset=utf-8"],
      "/sw.js": ["sw.js", "text/javascript; charset=utf-8"],
      "/manifest.webmanifest": ["manifest.webmanifest", "application/manifest+json; charset=utf-8"]
    };
    if (method === "GET" && staticFiles[pathname]) return serveStatic(res, path.join(publicDir, staticFiles[pathname][0]), staticFiles[pathname][1]);
    if (method === "GET" && pathname.startsWith("/erp-glb-viewer/")) {
      const relative = pathname.slice("/erp-glb-viewer/".length);
      if (!relative || relative.split("/").some((segment) => !/^[A-Za-z0-9._-]+$/.test(segment) || segment === ".." || segment === ".")) return sendJson(res, 404, { error: "Not found" });
      const file = path.join(viewerDir, ...relative.split("/"));
      if (!file.startsWith(viewerDir + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: "Not found" });
      const ext = path.extname(file).toLowerCase();
      return serveStatic(res, file, ({ ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".txt": "text/plain; charset=utf-8" })[ext] || "application/octet-stream");
    }
    if (secureLocal && pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)
        && pathname !== "/api/client-error" && origin !== `http://${host}`) {
      return sendJson(res, 403, { error: "Same-origin request required" });
    }
    if (method === "GET" && pathname === "/api/auth") {
      if (!secureLocal) return sendJson(res, 200, { authenticated: true, passwordSet: true, user: activeUser, users });
      const found = auth.session(req);
      return sendJson(res, 200, { authenticated: Boolean(found), passwordSet: auth.passwordSet(),
        user: found?.user || null, users: auth.passwordSet() ? auth.publicUsers() : [activeUser], csrf: found?.csrf || "" });
    }
    if (method === "POST" && pathname === "/api/client-error") return sendJson(res, 200, { ok: true });
    if (secureLocal && method === "POST" && pathname === "/api/setup-admin") {
      const body = await readBody(req);
      const result = auth.setup(res, body.userId, body.password);
      changed();
      return sendJson(res, 201, { ok: true, user: result.user, csrf: result.csrf });
    }
    if (secureLocal && method === "POST" && pathname === "/api/login") {
      const body = await readBody(req);
      const result = auth.login(res, body.userId, body.password);
      return result ? sendJson(res, 200, { ok: true, user: result.user, csrf: result.csrf })
        : sendJson(res, 401, { error: "Hibás felhasználói jelszó." });
    }
    const found = secureLocal ? auth.session(req) : null;
    if (secureLocal && pathname.startsWith("/api/") && !found) {
      return sendJson(res, 401, { authRequired: true, passwordSet: auth.passwordSet(), users: auth.publicUsers() });
    }
    if (secureLocal && pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(method)
        && !auth.csrfAllowed(found, req.headers["x-csrf-token"])) {
      return sendJson(res, 403, { error: "Session confirmation missing" });
    }
    const actor = found?.user || activeUser;
    const level2Route = pathname.startsWith("/api/finance/") || pathname.startsWith("/api/security/")
      || pathname.startsWith("/api/users") || pathname.startsWith("/api/archive")
      || pathname === "/api/catalog" || pathname.startsWith("/api/export/finance/")
      || pathname.startsWith("/api/cnc-machines") || pathname === "/api/scan"
      || (method !== "GET" && (pathname === "/api/projects/manual" || /^\/api\/projects\/[^/]+$/.test(pathname)
        || (/^\/api\/cadmodels\/[^/]+$/.test(pathname))));
    if (secureLocal && level2Route && Number(actor.clearanceLevel) < 2) {
      return sendJson(res, 403, { clearanceRequired: true, error: "Level-2 permission required" });
    }
    if (secureLocal && method === "POST" && pathname === "/api/me/password") {
      const body = await readBody(req);
      auth.changePassword(found, body.currentPassword, body.newPassword);
      changed();
      return sendJson(res, 200, { ok: true });
    }
    if (method === "POST" && pathname === "/api/logout") {
      if (secureLocal) auth.logout(req, res);
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET" && pathname === "/api/state") return sendJson(res, 200, state(actor, found?.csrf || ""));
    const dashboardImageMatch = /^\/api\/dashboard\/todos\/([^/]+)\/image$/.exec(pathname);
    if (dashboardImageMatch && method === "GET") {
      const todo = data.dashboardTodos.find((item) => item.id === decodeURIComponent(dashboardImageMatch[1]));
      if (!todo?.image) return sendJson(res, 404, { error: "Demo image not found" });
      return sendImage(res, todo.image);
    }
    const entryImageMatch = /^\/api\/(tasks|cnc-tasks|material-requests)\/([^/]+)\/images(?:\/(\d+))?$/.exec(pathname);
    if (entryImageMatch) {
      const key = { tasks: "tasks", "cnc-tasks": "cncTasks", "material-requests": "materialRequests" }[entryImageMatch[1]];
      const item = data[key].find((row) => row.id === decodeURIComponent(entryImageMatch[2]));
      if (!item) return sendJson(res, 404, { error: "Demo entry not found" });
      if (method === "GET" && entryImageMatch[3] !== undefined) {
        const image = item.images?.[Number(entryImageMatch[3])];
        if (!image) return sendJson(res, 404, { error: "Demo image not found" });
        return sendImage(res, image);
      }
      if (method === "POST" && key === "tasks" && entryImageMatch[3] === undefined) {
        const body = await readBody(req, 30_000_000);
        const prepared = images.prepare([body.imageDataUrl]);
        if ((item.images?.length || 0) + prepared.length > 10) return sendJson(res, 400, { error: "At most 10 demo images are allowed" });
        item.images = [...(item.images || []), ...images.save(prepared)];
        changed(); return sendJson(res, 201, item);
      }
      return demoError(res);
    }
    if (method === "GET" && pathname === "/api/export/worklogs") {
      const query = new URL(req.url, `http://${host}`).searchParams;
      const rows = data.workLogs.filter((item) => (!query.get("projectId") || item.projectId === query.get("projectId")) && (!query.get("userId") || item.userId === query.get("userId")))
        .map((item) => [projects[item.projectId]?.name || item.projectName || "", users.find((user) => user.id === item.userId)?.name || item.userName || "", item.workDate || item.date || "", item.workType || "", Number(item.hours || 0), item.overtime ? "Yes" : "No", item.note || ""]);
      return sendWorkbook(res, "demo-worklogs.xlsx", ["Project", "User", "Date", "Work type", "Hours", "Overtime", "Note"], rows);
    }
    const projectExportMatch = /^\/api\/export\/(project|finance\/project)\/([^/]+)$/.exec(pathname);
    if (method === "GET" && projectExportMatch) {
      const projectId = decodeURIComponent(projectExportMatch[2]);
      if (!projects[projectId]) return sendJson(res, 404, { error: "Demo project not found" });
      if (projectExportMatch[1] === "project") {
        const rows = [];
        for (const key of ["tasks", "cncTasks", "toolRequests", "materialRequests", "fastenerRequests", "workLogs", "boms"]) for (const item of data[key].filter((row) => row.projectId === projectId)) rows.push([key, item.title || item.name || item.material || item.toolName || "", item.userName || "", item.createdAt || "", item.length || "", item.quantity || item.hours || ""]);
        return sendWorkbook(res, "demo-project.xlsx", ["Collection", "Entry", "User", "Created", "Length", "Quantity or hours"], rows);
      }
      const rows = [];
      for (const key of ["priceItems", "costItems", "outsourceItems", "productionItems", "designItems", "quotes", "engineeringNotes"]) for (const item of finance[key].filter((row) => row.projectId === projectId)) rows.push([key, item.name || item.part || item.title || "", item.status || "", Number(item.amount || item.actualAmount || item.unitPrice || 0), item.note || ""]);
      return sendWorkbook(res, "demo-finance.xlsx", ["Collection", "Entry", "Status", "Amount", "Note"], rows);
    }
    if (method === "GET" && pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive" });
      res.write("event: ready\ndata: {}\n\n");
      clients.add(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    if (method === "GET" && pathname === "/api/finance/state") return sendJson(res, 200, finance);
    if (method === "GET" && pathname === "/api/archive/state") return sendJson(res, 200, { archives });
    if (method === "GET" && pathname === "/api/security/state") return sendJson(res, 200, { sessions: [], blockedIps: [], loginHistory: [] });
    if (method === "GET" && pathname === "/api/host-status") return sendJson(res, 200, { currentHost: "LOCAL-DEMO", respondingHost: "LOCAL-DEMO", watchdogs: [] });
    if (method === "POST" && ["/api/ocr/drawing-number", "/api/ocr/project-path"].includes(pathname)) {
      if (!ocr.enabled) return demoError(res, "Local OCR is disabled. Install Tesseract and set ocr.executable in this profile's config.json.");
      const body = await readBody(req, 30_000_000);
      const prepared = images.prepare(body.imageDataUrls);
      if (!prepared.length || prepared.some((image) => image.mime !== "image/png")) return sendJson(res, 400, { error: "Use one or more PNG OCR crops" });
      const result = await ocr.recognize(prepared.map((image) => image.bytes), pathname.endsWith("drawing-number") ? "drawing-number" : "project-path");
      return sendJson(res, 200, result);
    }
    if (method === "POST" && ["/api/ocr/drawing-correction", "/api/ocr/project-correction"].includes(pathname)) {
      if (!ocr.enabled) return demoError(res, "Local OCR is disabled");
      const body = await readBody(req, 30_000_000);
      data.ocrCorrections ||= [];
      if (data.ocrCorrections.length >= 5000) return sendJson(res, 400, { error: "Local OCR correction log is full; back it up before adding more" });
      const record = { id: randomUUID(), kind: pathname.endsWith("drawing-correction") ? "drawing" : "project",
        userId: actor.id, createdAt: new Date().toISOString() };
      for (const key of ["worklogId", "projectId", "scannedText", "correctedText", "scannedProjectId", "correctedProjectId", "debugId"]) {
        if (typeof body[key] === "string") record[key] = body[key].slice(0, 500);
      }
      data.ocrCorrections.push(record);
      changed();
      return sendJson(res, 201, { ok: true, id: record.id });
    }
    if (method === "POST" && pathname === "/api/scan") return sendJson(res, 200, scanLocalProjects());
    if (method === "POST" && pathname === "/api/project-notices/read") {
      const body = await readBody(req);
      const ids = new Set(Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string").slice(0, 200) : []);
      let dirty = false;
      for (const notice of data.projectNotices || []) if (ids.has(notice.id) && !(notice.readByUserIds || []).includes(actor.id)) {
        notice.readByUserIds ||= [];
        notice.readByUserIds.push(actor.id);
        dirty = true;
      }
      if (dirty) changed();
      return sendJson(res, 200, { ok: true });
    }
    if (method === "GET" && pathname === "/api/modelling/folders") return sendJson(res, 200, { folders: modelling.folders() });
    if (method === "POST" && pathname === "/api/modelling/photos") {
      const body = await readBody(req, 12_000_000);
      return sendJson(res, 201, modelling.save(body.folder, body.imageDataUrl));
    }
    const projectBrowserMatch = /^\/api\/projects\/([^/]+)\/browser(?:\/(file|pdf))?$/.exec(pathname);
    if (method === "GET" && projectBrowserMatch) {
      const id = decodeURIComponent(projectBrowserMatch[1]);
      if (!Object.hasOwn(projects, id)) return sendJson(res, 404, { error: "Demo project not found" });
      if (!projectBrowserMatch[2]) return sendJson(res, 200, projectBrowser.list(id));
      const query = new URL(req.url, `http://${host}`).searchParams;
      const file = projectBrowser.file(id, query.get("path"), projectBrowserMatch[2] === "pdf");
      return sendDocument(res, file.path, file.name, projectBrowserMatch[2] === "pdf");
    }
    if (method === "GET" && pathname === "/api/cadmodels/viewer-source") {
      if (!fs.existsSync(viewerSourceZip)) return demoError(res, "Viewer source package is not built yet");
      return serveStatic(res, viewerSourceZip, "application/zip");
    }
    const cadGlbMatch = /^\/api\/cadmodels\/([^/]+)\/glb$/.exec(pathname);
    if (cadGlbMatch && method === "GET") {
      const item = data.cadModels.find((model) => model.id === decodeURIComponent(cadGlbMatch[1]) && !model.hidden);
      if (!item) return sendJson(res, 404, { error: "Model not found" });
      const file = path.join(cadInbox, item.glbFile);
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return sendJson(res, 404, { error: "Model file missing" });
      res.writeHead(200, { "Content-Type": "model/gltf-binary", "Content-Length": fs.statSync(file).size, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
      return fs.createReadStream(file).pipe(res);
    }
    const cadNicknameMatch = /^\/api\/cadmodels\/([^/]+)\/nickname$/.exec(pathname);
    if (cadNicknameMatch && method === "PATCH") {
      const item = data.cadModels.find((model) => model.id === decodeURIComponent(cadNicknameMatch[1]) && !model.hidden);
      if (!item) return sendJson(res, 404, { error: "Model not found" });
      const body = safeBody(await readBody(req));
      item.nickname = String(body.nickname || "").slice(0, 160); changed(); return sendJson(res, 200, item);
    }
    const cadMatch = /^\/api\/cadmodels\/([^/]+)$/.exec(pathname);
    if (cadMatch) {
      const item = data.cadModels.find((model) => model.id === decodeURIComponent(cadMatch[1]) && !model.hidden);
      if (!item) return sendJson(res, 404, { error: "Model not found" });
      if (method === "PATCH") {
        const body = await readBody(req);
        if (body.projectId && !projects[body.projectId]) return sendJson(res, 400, { error: "Choose an existing project" });
        item.projectId = body.projectId || ""; changed(); return sendJson(res, 200, item);
      }
      if (method === "DELETE") {
        const trashDir = path.join(profileDir, ".demo-data", "trash", `cadmodel-${Date.now()}-${randomUUID()}`);
        const moved = [], missing = [];
        for (const ext of [".glb", ".json"]) {
          const name = item.glbFile.slice(0, -4) + ext;
          const source = path.join(cadInbox, name);
          if (!fs.existsSync(source)) { missing.push(name); continue; }
          fs.mkdirSync(trashDir, { recursive: true });
          fs.renameSync(source, path.join(trashDir, name)); moved.push(name);
        }
        item.hidden = true; archiveRecord("cad-model", item, actor); changed();
        return sendJson(res, 200, { ok: true, moved, missing, trashPath: moved.length ? trashDir : "" });
      }
    }
    if (method === "POST" && pathname === "/api/pwa/session") return sendJson(res, 200, { ok: true });
    if (pathname === "/api/projects/manual" && method === "POST") {
      const body = safeBody(await readBody(req));
      const name = String(body.name || "").trim();
      if (!name || name.length > 160) return sendJson(res, 400, { error: "Project name is required" });
      if (Object.values(projects).some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return sendJson(res, 409, { error: "Project already exists" });
      const item = { id: randomUUID(), name, company: body.company || "", active: true, priority: 0,
        source: "demo", primaryFolder: "", folders: [], createdAt: new Date().toISOString(),
        folderAddedAt: new Date().toISOString(), responsibleUserIds: [], nameAliases: [], folderHistory: [] };
      projects[item.id] = item; changed(); return sendJson(res, 201, item);
    }
    if (pathname === "/api/catalog") {
      const url = new URL(req.url, `http://${host}`);
      const body = method === "DELETE" ? { kind: url.searchParams.get("kind"), value: url.searchParams.get("value") } : safeBody(await readBody(req));
      const key = catalogKeys[body.kind];
      if (!key) return sendJson(res, 400, { error: "Unknown catalog" });
      const values = data[key];
      const oldValue = String(body.oldValue || body.value || "").trim();
      const newValue = String(body.value || "").trim();
      if (method === "POST") {
        if (!newValue || newValue.length > 160) return sendJson(res, 400, { error: "Value required" });
        if (!values.includes(newValue)) values.push(newValue);
      } else if (method === "PATCH") {
        const index = values.indexOf(oldValue);
        if (index < 0 || !newValue) return sendJson(res, 404, { error: "Catalog value not found" });
        values[index] = newValue;
      } else if (method === "DELETE") {
        const index = values.indexOf(oldValue);
        if (index < 0) return sendJson(res, 404, { error: "Catalog value not found" });
        values.splice(index, 1);
        archiveRecord("catalog-value", { name: oldValue, catalog: body.kind }, actor);
      } else return demoError(res);
      changed(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/api/files/browse" && method === "GET") {
      const query = new URL(req.url, `http://${host}`).searchParams;
      return sendJson(res, 200, documents.browse(query.get("path") || "", query.get("filter") === "office"));
    }
    if (pathname === "/api/files/link" && method === "POST") {
      const body = await readBody(req); safeProjectId(body);
      const file = documents.resolve(body.path, { file: true });
      const task = body.taskId ? data.tasks.find((item) => item.id === body.taskId && item.projectId === body.projectId) : null;
      const cncTask = body.cncTaskId ? data.cncTasks.find((item) => item.id === body.cncTaskId && item.projectId === body.projectId) : null;
      if ((body.taskId && !task) || (body.cncTaskId && !cncTask)) return sendJson(res, 400, { error: "Task does not belong to this demo project" });
      const item = { id: randomUUID(), projectId: body.projectId, projectName: projects[body.projectId].name,
        taskId: task?.id || null, cncTaskId: cncTask?.id || null, taskTitle: task?.title || cncTask?.title || "",
        kind: "link", name: String(body.name || path.basename(file.path)).slice(0, 160), path: file.path,
        createdAt: new Date().toISOString(), createdByUserId: actor.id, createdByName: actor.name };
      data.files.unshift(item); changed(); return sendJson(res, 201, item);
    }
    const fileMatch = /^\/api\/files\/([^/]+)(?:\/(preview|download))?$/.exec(pathname);
    if (fileMatch) {
      const index = data.files.findIndex((item) => item.id === decodeURIComponent(fileMatch[1]));
      if (index < 0) return sendJson(res, 404, { error: "File link not found" });
      const item = data.files[index];
      if (method === "GET") return sendDocument(res, item.path, item.name, fileMatch[2] === "preview");
      if (method === "DELETE" && !fileMatch[2]) {
        archiveRecord("file-link", item, actor); data.files.splice(index, 1);
        changed(); return sendJson(res, 200, { ok: true });
      }
    }
    if (pathname === "/api/users" && method === "POST") {
      const body = safeBody(await readBody(req));
      const name = String(body.name || "").trim();
      if (!name || name.length > 80 || users.some((user) => user.name.toLocaleLowerCase() === name.toLocaleLowerCase())) return sendJson(res, 400, { error: "Unique user name required" });
      const item = { id: randomUUID(), name, clearanceLevel: body.clearanceLevel === 2 ? 2 : 1,
        active: true, hidden: false, createdAt: new Date().toISOString() };
      users.push(item); changed(); return sendJson(res, 201, item);
    }
    const userMatch = /^\/api\/users\/([^/]+)$/.exec(pathname);
    if (userMatch) {
      const user = users.find((item) => item.id === decodeURIComponent(userMatch[1]));
      if (!user) return sendJson(res, 404, { error: "Demo user not found" });
      if (method === "PATCH") {
        const body = safeBody(await readBody(req));
        if (secureLocal && user.id === actor.id && body.clearanceLevel === 1) {
          return sendJson(res, 400, { error: "An administrator cannot remove their own level-2 permission" });
        }
        if (body.name) user.name = String(body.name).slice(0, 80);
        if (body.clearanceLevel) user.clearanceLevel = body.clearanceLevel === 2 ? 2 : 1;
        if (secureLocal && Object.hasOwn(body, "password")) auth.setUserPassword(actor, user.id, body.password);
        changed(); return sendJson(res, 200, user);
      }
      if (method === "DELETE") {
        if (user.id === actor.id) return sendJson(res, 400, { error: "Current demo user cannot be removed" });
        user.hidden = true; archiveRecord("user", user, actor); changed(); return sendJson(res, 200, { ok: true });
      }
    }
    if (pathname === "/api/boms" && method === "POST") {
      const body = await readBody(req); safeProjectId(body);
      const file = documents.resolve(body.filePath, { file: true });
      if (![".xlsx", ".csv", ".txt"].includes(path.extname(file.path).toLowerCase())) return sendJson(res, 400, { error: "Choose a local XLSX, CSV, or TXT BOM" });
      if (file.stat.size > 20_000_000) return sendJson(res, 400, { error: "BOM import is limited to 20 MB" });
      const rows = spreadsheetRows(fs.readFileSync(file.path), file.path);
      const item = { ...freshItem(body, actor), kind: "link", fileName: path.basename(file.path), path: file.path,
        size: file.stat.size, items: bomItems(rows), importError: "" };
      data.boms.unshift(item); changed(); return sendJson(res, 201, item);
    }
    if (pathname === "/api/boms/upload" && method === "POST") {
      const query = new URL(req.url, `http://${host}`).searchParams;
      const projectId = query.get("projectId") || "";
      if (!projects[projectId]) return sendJson(res, 400, { error: "Choose a demo project" });
      let filename;
      try { filename = path.basename(decodeURIComponent(String(req.headers["x-file-name"] || ""))); } catch { return sendJson(res, 400, { error: "Invalid file name" }); }
      if (!/^[^\\/\x00-\x1f]{1,160}\.(xlsx|csv|txt)$/i.test(filename)) return sendJson(res, 400, { error: "Choose an XLSX, CSV, or TXT file" });
      const bytes = await readBytes(req);
      if (!bytes.length) return sendJson(res, 400, { error: "File is empty" });
      fs.mkdirSync(uploadDir, { recursive: true });
      const filePath = path.join(uploadDir, `${randomUUID()}-${filename}`);
      fs.writeFileSync(filePath, bytes, { flag: "wx" });
      let items = [], importError = "";
      try { items = bomItems(spreadsheetRows(bytes, filename)); } catch (error) { importError = String(error.message || error); }
      const item = { id: randomUUID(), projectId, projectName: projects[projectId].name,
        name: String(query.get("name") || path.parse(filename).name).slice(0, 160), revision: String(query.get("revision") || "").slice(0, 80),
        kind: "upload", fileName: filename, path: filePath, size: bytes.length, items, importError,
        createdAt: new Date().toISOString(), createdByUserId: actor.id, createdByName: actor.name };
      data.boms.unshift(item); changed(); return sendJson(res, 201, item);
    }
    const bomFileMatch = /^\/api\/boms\/([^/]+)\/file$/.exec(pathname);
    if (bomFileMatch && method === "GET") {
      const item = data.boms.find((bom) => bom.id === decodeURIComponent(bomFileMatch[1]));
      if (!item) return sendJson(res, 404, { error: "BOM not found" });
      return sendDocument(res, item.path, item.fileName || item.name);
    }
    const bomMatch = /^\/api\/boms\/([^/]+)$/.exec(pathname);
    if (bomMatch && method === "DELETE") {
      const index = data.boms.findIndex((item) => item.id === decodeURIComponent(bomMatch[1]));
      if (index < 0) return sendJson(res, 404, { error: "BOM not found" });
      archiveRecord("bom", data.boms[index], actor); data.boms.splice(index, 1);
      changed(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/api/finance/settings" && method === "POST") {
      const body = await readBody(req);
      if (Object.values(body).some((value) => !Array.isArray(value) || value.length > 100 || value.some((item) => typeof item !== "string" || item.length > 160))) return sendJson(res, 400, { error: "Invalid finance settings" });
      finance.settings = { ...finance.settings, ...body }; changed(); return sendJson(res, 200, finance.settings);
    }
    for (const [route, key] of financeRoutes) {
      if (pathname === route && method === "POST") {
        const item = freshItem(await readBody(req), actor);
        if (item.projectId && !projects[item.projectId]) return sendJson(res, 400, { error: "Choose a demo project" });
        finance[key].unshift(item); changed(); return sendJson(res, 201, item);
      }
      if (pathname.startsWith(`${route}/`) && !pathname.slice(route.length + 1).includes("/")) {
        const index = finance[key].findIndex((item) => item.id === decodeURIComponent(pathname.slice(route.length + 1)));
        if (index < 0) return sendJson(res, 404, { error: "Finance entry not found" });
        if (method === "PATCH") { Object.assign(finance[key][index], safeBody(await readBody(req))); changed(); return sendJson(res, 200, finance[key][index]); }
        if (method === "DELETE") { archiveRecord(`finance-${key}`, finance[key][index], actor); finance[key].splice(index, 1); changed(); return sendJson(res, 200, { ok: true }); }
      }
    }
    const projectMatch = /^\/api\/projects\/([^/]+)$/.exec(pathname);
    if (projectMatch && method === "PATCH") {
      const project = projects[decodeURIComponent(projectMatch[1])];
      if (!project) return sendJson(res, 404, { error: "Demo project not found" });
      const body = safeBody(await readBody(req));
      const activationChanged = Object.hasOwn(body, "active") && Boolean(body.active) !== Boolean(project.active);
      for (const key of ["name", "company", "active", "completed", "priority", "deadline", "description", "responsibleUserIds"]) if (key in body) project[key] = body[key];
      if (activationChanged) addProjectNotice(project.active ? "project-activated" : "project-deactivated", project, {}, actor.name);
      changed(); return sendJson(res, 200, project);
    }
    if (projectMatch && method === "DELETE") {
      const id = decodeURIComponent(projectMatch[1]);
      const project = projects[id];
      if (!project) return sendJson(res, 404, { error: "Demo project not found" });
      if (project.active) return sendJson(res, 400, { error: "Deactivate the project before archiving" });
      const attached = {};
      for (const key of ["tasks", "cncTasks", "toolRequests", "materialRequests", "fastenerRequests", "workLogs", "boms", "cadModels"]) {
        attached[key] = data[key].filter((item) => item.projectId === id);
        data[key] = data[key].filter((item) => item.projectId !== id);
      }
      archives.unshift({ id: randomUUID(), type: "project", project: structuredClone(project), projectName: project.name,
        data: attached, archivedAt: new Date().toISOString(), archivedByName: actor.name, reason: "manual-delete" });
      delete projects[id]; changed(); return sendJson(res, 200, { ok: true });
    }
    const restoreMatch = /^\/api\/archive\/([^/]+)\/restore$/.exec(pathname);
    if (restoreMatch && method === "POST") {
      const record = archives.find((item) => item.id === decodeURIComponent(restoreMatch[1]));
      if (!record || record.restoredAt) return sendJson(res, 404, { error: "Restorable archive not found" });
      const body = await readBody(req); safeProjectId(body);
      const original = record.type === "project" ? record.data : { [({ task: "tasks", "cnc-task": "cncTasks", "tool-request": "toolRequests", "material-request": "materialRequests", "fastener-request": "fastenerRequests", "work-log": "workLogs", bom: "boms" })[record.type]]: [record.data] };
      if (!original || Object.keys(original).some((key) => !Array.isArray(data[key]) || !Array.isArray(original[key]))) return sendJson(res, 400, { error: "This archive type cannot be restored" });
      for (const [key, rows] of Object.entries(original)) for (const item of rows) {
        if (!data[key].some((existing) => existing.id === item.id)) data[key].push({ ...item, projectId: body.projectId, projectName: projects[body.projectId].name });
      }
      record.restoredAt = new Date().toISOString(); record.restoredProjectId = body.projectId; record.restoredProjectName = projects[body.projectId].name;
      changed(); return sendJson(res, 200, { ok: true });
    }
    if (pathname === "/api/archive" && method === "DELETE") return demoError(res, "Permanent deletion is disabled; archived demo records are retained in the local database");
    if (/^\/api\/archive\/[^/]+$/.test(pathname) && method === "DELETE") return demoError(res, "Permanent deletion is disabled; archived demo records are retained");
    const attachmentMatch = /^\/api\/(tool|material|fastener)-requests\/([^/]+)\/attachment\/(view|download)$/.exec(pathname);
    if (attachmentMatch && method === "GET") {
      const key = { tool: "toolRequests", material: "materialRequests", fastener: "fastenerRequests" }[attachmentMatch[1]];
      const item = data[key].find((row) => row.id === decodeURIComponent(attachmentMatch[2]));
      if (!item?.attachment) return sendJson(res, 404, { error: "Attachment not found" });
      const file = item.attachment;
      if (attachmentMatch[3] === "view" && path.extname(file.name).toLowerCase() === ".xlsx") return sendSpreadsheetPreview(res, file.path, file.name);
      return sendDocument(res, file.path, file.name, attachmentMatch[3] === "view" && path.extname(file.name).toLowerCase() === ".pdf");
    }
    for (const [route, key] of collectionRoutes) {
      if (pathname === route && method === "POST") {
        const photoCollection = ["dashboardTodos", "tasks", "cncTasks", "materialRequests"].includes(key);
        const rawBody = await readBody(req, photoCollection ? 30_000_000 : 1_000_000);
        if (rawBody.filePath && key !== "workLogs") return demoError(res, "Non-document links are not yet supported in the local demo");
        const rawImages = key === "dashboardTodos" ? (rawBody.imageDataUrl ? [rawBody.imageDataUrl] : []) : (rawBody.imageDataUrls || []);
        if (!photoCollection && (rawBody.imageDataUrl || rawBody.imageDataUrls?.length)) return demoError(res, "This entry type does not accept demo images");
        if (key === "materialRequests" && !rawBody.prefabTransport && rawImages.length) return sendJson(res, 400, { error: "Only prefab transport requests accept images" });
        const body = safeBody(rawBody);
        if (body.projectId && !projects[body.projectId]) return sendJson(res, 400, { error: "Choose a demo project" });
        if (body.userId && !users.some((user) => user.id === body.userId)) return sendJson(res, 400, { error: "Choose a demo user" });
        const item = { ...body, id: randomUUID(), createdAt: new Date().toISOString(), projectName: projects[body.projectId]?.name || "", userName: users.find((user) => user.id === body.userId)?.name || "", createdByUserId: actor.id, createdByName: actor.name };
        if (rawBody.attachmentPath) {
          if (!["materialRequests", "toolRequests", "fastenerRequests"].includes(key)) return sendJson(res, 400, { error: "This entry type does not support an attachment" });
          item.attachment = linkedAttachment(rawBody.attachmentPath);
        }
        if (key === "workLogs" && rawBody.filePath) {
          const file = documents.resolve(rawBody.filePath, { file: true });
          item.filePath = file.path;
          item.fileName = path.basename(file.path);
        }
        if (photoCollection) {
          const prepared = images.prepare(rawImages);
          const saved = images.save(prepared);
          if (key === "dashboardTodos") item.image = saved[0] || null;
          else item.images = saved;
        }
        if (["materialRequests", "toolRequests", "fastenerRequests", "tasks", "cncTasks"].includes(key)) item.done = false;
        if (key === "dayOffs") item.userName = users.find((user) => user.id === body.userId)?.name || "";
        normalizeItem(item, key, actor);
        data[key].unshift(item); changed(); return sendJson(res, 201, item);
      }
      if (pathname.startsWith(`${route}/`) && !pathname.slice(route.length + 1).includes("/")) {
        const id = decodeURIComponent(pathname.slice(route.length + 1));
        const index = data[key].findIndex((item) => item.id === id);
        if (index < 0) return sendJson(res, 404, { error: "Demo entry not found" });
        if (method === "PATCH") {
          const rawBody = await readBody(req);
          if ((rawBody.filePath && key !== "workLogs") || rawBody.imageDataUrl || rawBody.imageDataUrls?.length) return demoError(res, "Images and non-document links are not yet supported in the local demo");
          const body = safeBody(rawBody);
          if (key === "workLogs" && rawBody.filePath) {
            const file = documents.resolve(rawBody.filePath, { file: true });
            body.filePath = file.path;
            body.fileName = path.basename(file.path);
          } else if (key === "workLogs" && Object.hasOwn(rawBody, "filePath")) body.fileName = "";
          Object.assign(data[key][index], body, { projectName: projects[body.projectId || data[key][index].projectId]?.name || "", userName: users.find((user) => user.id === (body.userId || data[key][index].userId))?.name || "" });
          if (Object.hasOwn(rawBody, "attachmentPath") && ["materialRequests", "toolRequests", "fastenerRequests"].includes(key)) data[key][index].attachment = linkedAttachment(rawBody.attachmentPath);
          normalizeItem(data[key][index], key, actor);
          changed(); return sendJson(res, 200, data[key][index]);
        }
        if (method === "DELETE") {
          const [removed] = data[key].splice(index, 1);
          const types = { tasks: "task", cncTasks: "cnc-task", toolRequests: "tool-request", materialRequests: "material-request", fastenerRequests: "fastener-request", workLogs: "work-log" };
          archiveRecord(types[key] || key, removed, actor);
          changed(); return sendJson(res, 200, { ok: true, removed });
        }
      }
    }
    if (pathname.startsWith("/api/")) return demoError(res);
    sendJson(res, 404, { error: "Not found" });
  } catch (error) {
    console.error("Demo request error:", error.message);
    if (!res.headersSent) sendJson(res, 400, { error: error.message });
    else res.end();
  }
});
const worklogImporter = createWorklogImporter({
  profileDir,
  context: () => ({ users, projects, workTypes: data.workTypes, workLogs: data.workLogs, overtimeUserIds: config.overtimeUserIds || [] }),
  commit: (rows) => { data.workLogs.unshift(...rows); changed(); }
});
if (fs.existsSync(cadInbox) && (fs.lstatSync(cadInbox).isSymbolicLink()
    || fs.realpathSync(cadInbox).toLowerCase() !== cadInbox.toLowerCase())) {
  throw new Error("Demo CAD inbox must not redirect outside its profile");
}
scanCadInbox();
const cadScanTimer = setInterval(scanCadInbox, 10_000);
cadScanTimer.unref();
function scanWorklogs() {
  try { worklogImporter.scan(); }
  catch (error) { console.warn("Demo worklog inbox unavailable; leaving source files in place:", error.message); }
}
scanWorklogs();
const worklogScanTimer = setInterval(scanWorklogs, 10_000);
worklogScanTimer.unref();
if (config.scanRoots?.length) {
  try { scanLocalProjects(); } catch (error) { console.warn("Local project scan unavailable; projects unchanged:", error.message); }
  const projectScanTimer = setInterval(() => {
    try { scanLocalProjects(); } catch (error) { console.warn("Local project scan unavailable; projects unchanged:", error.message); }
  }, 60_000);
  projectScanTimer.unref();
}
server.listen(config.port, "127.0.0.1", () => {
  console.log(`Workshop ERP persistent localhost demo: http://127.0.0.1:${config.port}/`);
  console.log(`Persistent local demo database: ${store.dbPath}`);
  console.log("No production backend, network shares, helper, or tunnel are connected.");
});
