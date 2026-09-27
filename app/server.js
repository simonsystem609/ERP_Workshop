"use strict";

throw new Error("Local sanitized source draft: server startup intentionally disabled pending generic configuration and security review.");

const http = require("http");
const https = require("https");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const zlib = require("zlib");
const { execFileSync, spawn, spawnSync } = require("child_process");
const { URL } = require("url");
const { pathKey, projectPaths, planFolderContinuations, addProjectNotice, continueProjectFolder, restoreArchivedProjectInto, restoreArchiveEntriesInto } = require("./projectContinuity");
const { SnapshotWriteGuard, assertCanonicalMapping, assertCanonicalWorkingDirectory } = require("./storageSafety");
const { HostEnrollment, hostKey } = require("./hostEnrollment");
const { MAX_GLB_BYTES, CAD_MODEL_INBOX, CAD_MODEL_CACHE_ROOT, CAD_TRASH_ROOT, modelIdForSidecar, existingProjectForSource, readReadyPair, movePairToTrash } = require("./cadModels");
const { sourceIdentity, compressedModel, scheduleCompressedModel, waitForCompressedModel } = require("./cadModelCache");
const hostEnrollment = new HostEnrollment("\\\\192.0.2.10\\Example Share\\WorkshopERP\\data\\.host-enrollment");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (error) {
  console.error("");
  console.error("HIBA: a 'node:sqlite' modul nem erheto el.");
  console.error("Ehhez Node.js 22.5 vagy ujabb verzio kell.");
  console.error("Aktualis Node verzio:", process.version);
  console.error("Frissits Node.js LTS-re: https://nodejs.org");
  console.error("");
  process.exit(1);
}

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, "public");
const CONFIG_PATH = path.join(APP_DIR, "config.json");
const LOCAL_FALLBACK_DIR = path.join(APP_DIR, ".local-data");
const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;
const DEFAULT_USER_PASSWORD = null; // No public default credential.
// Photos taken on the hidden /modelling page land here, one subfolder per
// project name typed by the user.
const MODELLING_PHOTO_BASE = "Y:\\WorkshopProjects\\EGYEB\\modelling";

// --- Crash safety net ------------------------------------------------------
// Without this, any unhandled async error or rejection silently kills node
// and start-server.bat's redirected err.log captures nothing. Write the
// stack to a permanent crash log so the next "random stop" is diagnosable.
const CRASH_LOG_DIR = path.join(APP_DIR, "logs");
function logCrash(kind, error) {
  try {
    fs.mkdirSync(CRASH_LOG_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const host = os.hostname();
    const file = path.join(CRASH_LOG_DIR, `crash-${host}-${stamp}.log`);
    const err = error instanceof Error ? error : new Error(String(error));
    const body = [
      `[crash] ${kind}`,
      `[when]  ${new Date().toISOString()}`,
      `[host]  ${host}`,
      `[pid]   ${process.pid}`,
      `[node]  ${process.version}`,
      `[argv]  ${process.argv.slice(1).join(" ")}`,
      `[error] ${err.message}`,
      "",
      err.stack || "(no stack)",
      ""
    ].join("\n");
    fs.writeFileSync(file, body, "utf8");
    try { console.error(`[crash] ${kind}: ${err.message} -> ${file}`); } catch {}
  } catch (logError) {
    try { console.error("[crash] logging failed:", logError.message); } catch {}
  }
}
process.on("uncaughtException", (error) => {
  logCrash("uncaughtException", error);
  setTimeout(() => process.exit(1), 200);
});
process.on("unhandledRejection", (reason) => {
  logCrash("unhandledRejection", reason);
});
// --- end crash safety net --------------------------------------------------

// --- Cloudflare manager supervision ----------------------------------------
// Option B: only the active ERP host PC may run cloudflared/manager. Standby
// PCs run only the watchdog. When a standby takes over and starts the host
// server, this host-side supervisor launches cloudflare-launcher.cmd.
const CLOUDFLARE_SUPERVISE_INTERVAL_MS = 60_000;
const CLOUDFLARE_HEARTBEAT_STALE_MS = 120_000;
const CLOUDFLARE_RELAUNCH_COOLDOWN_MS = 90_000;
let lastCloudflareRelaunchAt = 0;
function cloudflareLocalPaths() {
  if (process.platform !== "win32") return null;
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) return null;
  const cfDir = path.join(localAppData, "WorkshopERP", "cloudflared");
  return {
    exe: path.join(cfDir, "cloudflared.exe"),
    token: path.join(cfDir, "tunnel-token.txt"),
    heartbeat: path.join(cfDir, "cloudflared-manager-heartbeat.txt"),
    launcher: path.join(APP_DIR, "cloudflare-launcher.cmd")
  };
}
function stopLocalCloudflareProcesses(reason = "") {
  if (process.platform !== "win32") return;
  const cf = cloudflareLocalPaths();
  if (!cf) return;
  try {
    const ps = `
$ErrorActionPreference = 'SilentlyContinue'
$localRoot = Join-Path $env:LOCALAPPDATA 'WorkshopERP\\cloudflared'
$cfExe = Join-Path $localRoot 'cloudflared.exe'
Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne ${process.pid} -and (
    ($_.CommandLine -like '*cloudflare-manager.ps1*') -or
    ($_.CommandLine -like '*cloudflare-supervisor.ps1*') -or
    ($_.CommandLine -like '*cloudflare-launcher.cmd*') -or
    (($_.Name -like 'cloudflared*') -and (($_.ExecutablePath -eq $cfExe) -or ($_.CommandLine -like '*WorkshopERP*cloudflared*') -or ($_.CommandLine -like '*WorkshopERP*')))
  )
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item -LiteralPath (Join-Path $localRoot 'cloudflared.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $localRoot 'cloudflared-manager.pid') -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath (Join-Path $localRoot 'cloudflared-manager-heartbeat.txt') -Force -ErrorAction SilentlyContinue
exit 0
`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      stdio: "ignore",
      windowsHide: true,
      timeout: 8000
    });
    if (result.error) console.error("[cloudflared-supervisor] cleanup warning:", result.error.message);
    if (reason) console.log(`[cloudflared-supervisor] local connector stopped (${reason})`);
  } catch (error) {
    console.error("[cloudflared-supervisor] cleanup warning:", error.message);
  }
}
function tickCloudflareSupervision(options = {}) {
  const cf = cloudflareLocalPaths();
  if (!cf) return;
  // Pre-conditions: only supervise on PCs that are actually set up as
  // Cloudflare replicas (have local exe + token).
  try {
    if (!fs.existsSync(cf.exe) || !fs.existsSync(cf.token) || !fs.existsSync(cf.launcher)) return;
  } catch { return; }
  // Check heartbeat freshness. Missing file or old mtime = stale.
  let stale = Boolean(options.force);
  if (!stale) {
    try {
      const stat = fs.statSync(cf.heartbeat);
      if (Date.now() - stat.mtimeMs >= CLOUDFLARE_HEARTBEAT_STALE_MS) stale = true;
    } catch {
      stale = true;
    }
  }
  if (!stale) return;
  // Throttle relaunches.
  if (Date.now() - lastCloudflareRelaunchAt < CLOUDFLARE_RELAUNCH_COOLDOWN_MS) return;
  lastCloudflareRelaunchAt = Date.now();
  console.log(`[cloudflared-supervisor] heartbeat stale -> spawning ${cf.launcher}`);
  try {
    const { spawn } = require("child_process");
    const child = spawn("cmd.exe", ["/c", cf.launcher], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
    child.unref();
  } catch (error) {
    console.error("[cloudflared-supervisor] spawn failed:", error.message);
  }
}
// --- end cloudflare manager supervision ------------------------------------

const DEFAULT_CONFIG = {
  port: 4780,
  host: "0.0.0.0",
  internetPort: 4781,
  internetHost: "0.0.0.0",
  internetEnabled: false,
  localAuthRequired: true,
  internetHttpsEnabled: false,
  internetHttpsPort: 4782,
  internetPublicHost: "",
  internetPublicHttpsPort: 443,
  helperUrl: "http://127.0.0.1:4799",
  workingDirectory: "Y:\\WorkshopERP",
  scanIntervalSeconds: 10,
  scanRoots: ["Y:\\CompanyProjects", "Y:\\WorkshopProjects"],
  excludedPaths: [],
  hostNicknames: {},
  hostAllowedIpPrefixes: []
};

let config = loadJson(CONFIG_PATH, DEFAULT_CONFIG);
function getLocalIpv4Addresses() {
  const addresses = [];
  const nets = os.networkInterfaces();
  for (const entries of Object.values(nets)) {
    for (const entry of entries || []) {
      if (entry && entry.family === "IPv4" && !entry.internal && entry.address) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function getHostEligibility() {
  const prefixes = Array.isArray(config.hostAllowedIpPrefixes)
    ? config.hostAllowedIpPrefixes.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const addresses = getLocalIpv4Addresses();
  try {
    if (hostEnrollment.state(os.hostname()).removed) {
      return {ok:false,reason:"PC eltavolitva; ujraengedelyezeshez futtasd az aktualis install-startup.bat-ot.",addresses};
    }
  } catch (error) {
    return {ok:false,reason:"PC regisztracio nem ellenorizheto: " + error.message,addresses};
  }
  if (prefixes.length > 0 && !addresses.some((address) => prefixes.some((prefix) => address.startsWith(prefix)))) {
    return {
      ok: false,
      reason: `nincs engedelyezett ceges LAN IP (${prefixes.join(", ")}); helyi IP-k: ${addresses.join(", ") || "-"}`,
      addresses
    };
  }
  return {
    ok: true,
    reason: prefixes.length ? `ceges LAN IP ok (${addresses.join(", ") || "-"})` : "nincs LAN IP korlatozas",
    addresses
  };
}

let effectiveWorkingDirectory = null;
let usingFallbackDirectory = false;
let dataDirectory = null;
let dbPath = null;
let sqlitePath = null;
let sqlite = null;
let uploadsDirectory = null;
let db = null;
let lastScan = {
  at: null,
  found: 0,
  roots: [],
  errors: []
};
const sessions = new Map();
const failedLogins = new Map();
const recentLoginAttempts = [];
const RECENT_LOGIN_LIMIT = 100;
const SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
const PWA_SESSION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const SESSION_ACTIVE_WINDOW_MS = 2 * 60 * 1000;
const SESSION_COOKIE = "workshop_session";
const PASSWORD_REMINDER_PASSWORD_AGE_MS = 365 * 24 * 60 * 60 * 1000;
const PASSWORD_REMINDER_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const PASSWORD_REMINDER_CHECK_MS = 6 * 60 * 60 * 1000;
const NOTIFICATION_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const NOTIFICATION_MAX_STORED = 500;
const IP_HISTORY_CAP = 500;
const IP_HISTORY_FLUSH_MS = 60 * 1000;
let ipHistoryDirty = false;

const SQLITE_COLLECTIONS = [
  "users",
  "dashboardTodos",
  "meetings",
  "dayOffs",
  "tasks",
  "cncTasks",
  "cncMachines",
  "boms",
  "cadModels",
  "toolRequests",
  "materialRequests",
  "fastenerRequests",
  "workLogs",
  "files",
  "pushSubscriptions",
  "notifications",
  "projectNotices",
  "financeSuppliers",
  "financePriceItems",
  "financeCostItems",
  "financeOutsourceItems",
  "financeProductionItems",
  "engineeringDesignItems",
  "financeQuotes",
  "engineeringNotes",
  "archives"
];

const SQLITE_SINGLETONS = [
  "version",
  "createdAt",
  "updatedAt",
  "security",
  "protectedSecurity",
  "materialNames",
  "materialTypes",
  "materialLengths",
  "externalCompanies",
  "prefabTaskTypes",
  "workTypes",
  "fastenerTypes",
  "fastenerGrades",
  "fastenerSizes",
  "toolNames",
  "projectFolderExclusions",
  "financeSettings",
  "blockedIps",
  "ipHistory",
  "notificationSecurity"
];
const SQLITE_JOURNAL_MODE = "DELETE";
const SQLITE_BUSY_TIMEOUT_MS = 15000;
const SQLITE_SAVE_RETRY_DELAY_MS = 350;
const SQLITE_SAVE_MAX_ATTEMPTS = 2;
const storageGuard = new SnapshotWriteGuard(SQLITE_COLLECTIONS, SQLITE_SINGLETONS);

const sseClients = new Set();
let lastBroadcastFingerprint = "";
let sseBroadcastTimer = null;

// --- Host-lock takeover coordination ---------------------------------------
// All running ERP servers share a single lock file on the working drive
// (Y:\WorkshopERP\data\.host-lock.json). Each server start increments the
// generation number; running servers poll the file and gracefully shut down
// when they see a newer generation (someone else took over) or a stop flag.
const HOST_LOCK_FILENAME = ".host-lock.json";
const SERVER_STATE_FILENAME = "server-state.json";
const WATCHDOG_DIRNAME = ".watchdogs";
const HOST_SWITCH_FILENAME = ".host-switch.json";
const WATCHDOG_COMMAND_DIRNAME = ".watchdog-commands";
const HOST_LOCK_POLL_MS = 3000;
const WATCHDOG_READY_MS = 5 * 60 * 1000;
const LEGACY_WATCHDOG_LOG_READY_MS = 8 * 60 * 1000;
const HOST_SWITCH_MAX_AGE_MS = 2 * 60 * 1000;
const WATCHDOG_COMMAND_MAX_AGE_MS = 10 * 60 * 1000;
// Bumped 30s -> 60s on 2026-05-27 to survive brief Y: SMB blips without
// triggering takeover. Hosts that genuinely die are still detected within
// 60s + HOST_LOCK_STALE_LIMIT * poll interval.
const HOST_LOCK_STALE_MS = 60000;
const HOST_LOCK_MISSING_LIMIT = 4;
const HOST_LOCK_STALE_LIMIT = 3;
const LOG_MAINTENANCE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LOG_ROTATE_MAX_BYTES = 2 * 1024 * 1024;
const LOG_MAINTENANCE_MAX_BYTES = 512 * 1024;
const LOG_ARCHIVE_RETENTION_DAYS = 60;
const LOG_STRAY_FILE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SERVER_BACKUP_INTERVAL_MS = 10 * 60 * 1000;
const SERVER_BACKUP_RETENTION_DAYS = 3;
const MANUAL_BACKUP_KEEP = 3;
const SERVER_BACKUP_LOCK_MAX_AGE_MS = 4 * 60 * 60 * 1000;
const WORKLOG_IMPORT_INTERVAL_MS = 10 * 1000;
const WORKLOG_IMPORT_MAX_FILES_PER_TICK = 25;
let hostGeneration = 0;
let hostStartedAt = "";
let hostLockTimer = null;
let isShuttingDown = false;
let localHostRestartScheduled = false;
const httpServers = [];
const backgroundTimers = [];
let lastLogMaintenanceAt = 0;
let serverBackupRunning = false;
let worklogImportRunning = false;

function nowIso() {
  return new Date().toISOString();
}

function hostLockPath() {
  if (!dataDirectory) return null;
  return path.join(dataDirectory, HOST_LOCK_FILENAME);
}

function serverStatePath() {
  if (!effectiveWorkingDirectory) return null;
  return path.join(effectiveWorkingDirectory, SERVER_STATE_FILENAME);
}

function normalizeHostname(hostname) {
  return String(hostname || "").trim().toLocaleLowerCase("hu-HU");
}

function sameHostname(a, b) {
  return normalizeHostname(a) === normalizeHostname(b);
}

function normalizedHostNicknames() {
  const source = config.hostNicknames && typeof config.hostNicknames === "object" ? config.hostNicknames : {};
  const result = {};
  for (const [hostname, nickname] of Object.entries(source)) {
    const key = normalizeHostname(hostname);
    const value = String(nickname || "").trim();
    if (key && value) result[key] = value.slice(0, 80);
  }
  return result;
}

function hostNickname(hostname) {
  if (!hostname) return "";
  return normalizedHostNicknames()[normalizeHostname(hostname)] || "";
}

function safeHostnameSegment(hostname) {
  return String(hostname || "unknown").replace(/[^a-z0-9_.-]/gi, "_").slice(0, 80) || "unknown";
}

function localDateKey(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function safeReadJsonFile(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFileAtomic(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${safeHostnameSegment(os.hostname())}.${process.pid}.${Date.now()}.tmp`
  );
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2), "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.copyFileSync(tempPath, filePath);
      fs.unlinkSync(tempPath);
    } catch {
      try { fs.unlinkSync(tempPath); } catch {}
      throw error;
    }
  }
}

function appendMaintenanceLog(logDir, actions) {
  if (!actions.length) return;
  try {
    fs.mkdirSync(logDir, { recursive: true });
    const host = safeHostnameSegment(os.hostname());
    const logPath = path.join(logDir, `maintenance-${host}.log`);
    const lines = actions.map((action) => `[${new Date().toISOString()}] ${action}`).join("\n") + "\n";
    fs.appendFileSync(logPath, lines, "utf8");
  } catch {}
}

function archiveAndCleanLogFile(filePath, archiveDir, { removeOriginal = false } = {}) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archivePath = path.join(archiveDir, `${path.basename(filePath)}__${stamp}`);
  fs.copyFileSync(filePath, archivePath);
  if (removeOriginal) {
    fs.unlinkSync(filePath);
  } else {
    fs.truncateSync(filePath, 0);
  }
  return archivePath;
}

function pruneOldLogArchives(logDir, actions) {
  const archiveRoot = path.join(logDir, "archive");
  let entries = [];
  try {
    entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    return;
  }
  const cutoff = Date.now() - LOG_ARCHIVE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const folderPath = path.join(archiveRoot, entry.name);
    const parsed = Date.parse(`${entry.name}T00:00:00`);
    let shouldRemove = Number.isFinite(parsed) && parsed < cutoff;
    if (!shouldRemove) {
      try { shouldRemove = fs.statSync(folderPath).mtimeMs < cutoff; } catch {}
    }
    if (!shouldRemove) continue;
    if (safeRmrfSync(folderPath, { base: archiveRoot })) {
      actions.push(`Removed old log archive folder: ${folderPath}`);
    } else {
      actions.push(`Could not remove old log archive folder ${folderPath} (skipped or unsafe).`);
    }
  }
}

function runLogMaintenance(reason = "scheduled", { force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastLogMaintenanceAt < LOG_MAINTENANCE_INTERVAL_MS) return;
  lastLogMaintenanceAt = now;

  const logDir = path.join(APP_DIR, "logs");
  const today = localDateKey();
  const archiveDir = path.join(logDir, "archive", today);
  const statePath = path.join(logDir, ".maintenance-state.json");
  const actions = [`Log maintenance started (${reason}).`];
  let state = safeReadJsonFile(statePath, {});
  if (!state || typeof state !== "object") state = {};
  if (!state.files || typeof state.files !== "object") state.files = {};

  try {
    fs.mkdirSync(logDir, { recursive: true });
    fs.mkdirSync(archiveDir, { recursive: true });
    const entries = fs.readdirSync(logDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      if (name === ".maintenance-state.json") continue;
      const lower = name.toLowerCase();
      const filePath = path.join(logDir, name);
      let stat = null;
      try { stat = fs.statSync(filePath); } catch { continue; }
      if (stat && stat.size === 0 && /\.(?:err|out)\.log$/i.test(name)) {
        try {
          fs.unlinkSync(filePath);
          delete state.files[name];
          actions.push(`Removed empty stamp log ${filePath}`);
        } catch (error) {
          actions.push(`Could not remove empty ${filePath}: ${error.message}`);
        }
        continue;
      }
      if (!stat || stat.size <= 0) continue;

      const isLog = /\.log(?:\.old)?$/i.test(name);
      const isOldLog = /\.log\.old$/i.test(name);
      const isMaintenanceLog = /^maintenance-.+\.log$/i.test(name);
      const isCloudflaredRuntimeLog = /^cloudflared-(?!manager-).+\.log$/i.test(name);
      const isServerRuntimeLog = /^server(?:-.+)?\.(?:out|err)\.log$/i.test(name);
      const isStrayLogDirFile = /\.(png|jpe?g|gif|bmp|txt|tmp)$/i.test(name);
      const maxBytes = isMaintenanceLog ? LOG_MAINTENANCE_MAX_BYTES : LOG_ROTATE_MAX_BYTES;
      const dueDaily = isLog && !isMaintenanceLog && state.files[name] !== today;
      const tooBig = stat.size >= maxBytes;
      const staleStray = isStrayLogDirFile && (now - stat.mtimeMs >= LOG_STRAY_FILE_MAX_AGE_MS);

      // cloudflared keeps its log handle open; truncating it externally can
      // create null padding. Its own manager rotates that file after stopping
      // the connector, so shared maintenance deliberately skips it here.
      if (isCloudflaredRuntimeLog || isServerRuntimeLog) continue;
      if (!isLog && !staleStray) continue;
      if (isMaintenanceLog && !tooBig) continue;
      if (isLog && !dueDaily && !tooBig && !isOldLog) continue;

      try {
        const archived = archiveAndCleanLogFile(filePath, archiveDir, {
          removeOriginal: isOldLog || staleStray
        });
        state.files[name] = today;
        actions.push(`${isOldLog || staleStray ? "Archived and removed" : "Archived and cleared"} ${filePath} -> ${archived}`);
      } catch (error) {
        actions.push(`Could not clean ${filePath}: ${error.message}`);
      }
    }

    pruneOldLogArchives(logDir, actions);
    state.lastRunAt = new Date().toISOString();
    state.lastRunReason = reason;
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  } catch (error) {
    actions.push(`Log maintenance failed: ${error.message}`);
  } finally {
    appendMaintenanceLog(logDir, actions);
  }
}

function serverBackupRoot() {
  if (usingFallbackDirectory || !effectiveWorkingDirectory) return null;
  const parsed = path.parse(effectiveWorkingDirectory);
  const driveRoot = parsed.root || path.dirname(effectiveWorkingDirectory);
  return path.join(driveRoot, "ERPbackup", "auto");
}

function serverManualBackupRoot() {
  if (usingFallbackDirectory || !effectiveWorkingDirectory) return null;
  const parsed = path.parse(effectiveWorkingDirectory);
  const driveRoot = parsed.root || path.dirname(effectiveWorkingDirectory);
  return path.join(driveRoot, "ERPbackup", "manual");
}

function serverBackupLogPath(root, dateKey = localDateKey()) {
  return path.join(root, "logs", `auto-backup-${dateKey}.log`);
}

async function writeServerBackupLog(message) {
  const root = serverBackupRoot();
  if (!root) return;
  try {
    const logDir = path.join(root, "logs");
    await fsp.mkdir(logDir, { recursive: true });
    const line = `${new Date().toLocaleString("hu-HU", { hour12: false })} [${os.hostname()} server] ${message}\n`;
    await fsp.appendFile(serverBackupLogPath(root), line, "utf8");
  } catch {
    // Backup logging must not stop the ERP server.
  }
}

async function pathExists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function serverBackupTodayExists(root, dateKey = localDateKey()) {
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    if (entries.some((entry) => entry.isDirectory() && entry.name.startsWith(`WorkshopERP_${dateKey}_`))) {
      return true;
    }
  } catch {
    return false;
  }

  const stateDir = path.join(root, ".state");
  try {
    const entries = await fsp.readdir(stateDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.startsWith(`${dateKey}.`) || !entry.name.endsWith(".done")) continue;
      const marker = path.join(stateDir, entry.name);
      const target = String(await fsp.readFile(marker, "utf8")).trim();
      if (target && await pathExists(target)) return true;
    }
  } catch {}
  return false;
}

function backupPathDate(folderName, fallbackDate) {
  const match = /^WorkshopERP_(\d{4})-(\d{2})-(\d{2})_/.exec(folderName);
  if (match) {
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }
  return new Date(fallbackDate.getFullYear(), fallbackDate.getMonth(), fallbackDate.getDate());
}

async function cleanupServerBackups(root) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (SERVER_BACKUP_RETENTION_DAYS - 1));
  try {
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith("WorkshopERP_")) continue;
      const folderPath = path.join(root, entry.name);
      let stat;
      try { stat = await fsp.stat(folderPath); } catch { continue; }
      if (backupPathDate(entry.name, stat.mtime) >= cutoff) continue;
      if (await safeRmrf(folderPath, { base: root })) {
        await writeServerBackupLog(`Retention removed old backup: ${folderPath}`);
      } else {
        await writeServerBackupLog(`Retention skipped ${folderPath} (unsafe path or rm failed).`);
      }
    }

    const stateDir = path.join(root, ".state");
    const stateEntries = await fsp.readdir(stateDir, { withFileTypes: true }).catch(() => []);
    for (const entry of stateEntries) {
      if (!entry.isFile() || !entry.name.endsWith(".done")) continue;
      const marker = path.join(stateDir, entry.name);
      let stat;
      try { stat = await fsp.stat(marker); } catch { continue; }
      if (backupPathDate(entry.name.replace(/\.daily\.done$/, "_"), stat.mtime) < cutoff) {
        await fsp.rm(marker, { force: true }).catch(() => {});
      }
    }
  } catch (error) {
    await writeServerBackupLog(`Retention cleanup error: ${error.message}`);
  }
}

// Keep only the newest MANUAL_BACKUP_KEEP folders under Y:\ERPbackup\manual.
// Only DATE-STAMPED backup folders (name starts with a yyyymmdd / yymmdd stamp,
// matching how agents/manual snapshots are named) are ever considered, so a
// folder a human drops in there by hand is left alone and does not count toward
// the keep limit. Each delete still goes through safeRmrf with base = the
// manual root, so it can never escape that folder.
async function cleanupManualBackups() {
  const root = serverManualBackupRoot();
  if (!root) return;
  let entries;
  try {
    entries = await fsp.readdir(root, { withFileTypes: true });
  } catch {
    return; // no manual folder yet -> nothing to prune
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;
    if (!/^\d{6,8}[-_]/.test(entry.name)) continue; // backup folders are date-stamped
    const folderPath = path.join(root, entry.name);
    let mtimeMs = 0;
    try { mtimeMs = (await fsp.stat(folderPath)).mtimeMs; } catch { continue; }
    candidates.push({ folderPath, name: entry.name, mtimeMs });
  }
  if (candidates.length <= MANUAL_BACKUP_KEEP) return;
  // Newest first (by mtime, name as a stable tiebreak), then drop the overflow.
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  for (const old of candidates.slice(MANUAL_BACKUP_KEEP)) {
    const removed = await safeRmrf(old.folderPath, { base: root });
    await writeServerBackupLog(removed
      ? `Manual retention removed (keep ${MANUAL_BACKUP_KEEP}): ${old.folderPath}`
      : `Manual retention REFUSED unsafe/failed: ${old.folderPath}`);
  }
}

async function withServerBackupLock(root, body) {
  const stateDir = path.join(root, ".state");
  const lockPath = path.join(stateDir, "erp-auto-backup.lock");
  await fsp.mkdir(stateDir, { recursive: true });
  let handle = null;
  try {
    try {
      handle = await fsp.open(lockPath, "wx");
    } catch (error) {
      if (error.code === "EEXIST") {
        try {
          const stat = await fsp.stat(lockPath);
          if (Date.now() - stat.mtimeMs > SERVER_BACKUP_LOCK_MAX_AGE_MS) {
            await fsp.rm(lockPath, { force: true });
            handle = await fsp.open(lockPath, "wx");
          }
        } catch {}
      }
      if (!handle) {
        await writeServerBackupLog("Skipped: another host is holding the backup lock.");
        return false;
      }
    }
    await handle.writeFile(`${nowIso()} ${os.hostname()} pid=${process.pid}`, "utf8");
    await body();
    return true;
  } finally {
    if (handle) {
      await handle.close().catch(() => {});
      await fsp.rm(lockPath, { force: true }).catch(() => {});
    }
  }
}

function shouldSkipBackupEntry(sourceRoot, filePath, dirent, mode) {
  const rel = path.relative(sourceRoot, filePath);
  const parts = rel.split(/[\\/]+/).filter(Boolean).map((part) => part.toLowerCase());
  if (!parts.length) return false;
  if (mode === "app" && ["node", "node_modules", "logs", ".local-data"].includes(parts[0])) return true;
  if (mode === "data" && [".watchdogs", ".watchdog-commands"].includes(parts[0])) return true;
  if (dirent.isFile() && /\.(?:log|tmp)$/i.test(dirent.name)) return true;
  return false;
}

async function copyTreeForBackup(sourceRoot, destRoot, mode) {
  await fsp.mkdir(destRoot, { recursive: true });
  const entries = await fsp.readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name);
    if (shouldSkipBackupEntry(sourceRoot, sourcePath, entry, mode)) continue;
    const destPath = path.join(destRoot, entry.name);
    try {
      if (entry.isDirectory()) {
        await copyTreeForBackup(sourcePath, destPath, mode);
      } else if (entry.isFile()) {
        await fsp.mkdir(path.dirname(destPath), { recursive: true });
        if (mode === "data" && entry.name.toLowerCase() === "erp.db") {
          fs.copyFileSync(sourcePath, destPath);
        } else {
          await fsp.copyFile(sourcePath, destPath);
        }
      }
    } catch (error) {
      await writeServerBackupLog(`Copy skipped ${sourcePath}: ${error.message}`);
    }
  }
}

async function runServerAutoBackup(reason = "scheduled") {
  if (serverBackupRunning) return;
  const root = serverBackupRoot();
  if (!root) return;
  serverBackupRunning = true;
  try {
    await fsp.mkdir(root, { recursive: true });
    await cleanupServerBackups(root);
    await cleanupManualBackups();
    if (await serverBackupTodayExists(root)) {
      await writeServerBackupLog(`Skipped ${reason}: today's backup already exists.`);
      return;
    }

    await withServerBackupLock(root, async () => {
      if (await serverBackupTodayExists(root)) {
        await writeServerBackupLog(`Skipped ${reason} inside lock: today's backup already exists.`);
        return;
      }
      const dateKey = localDateKey();
      const timeKey = new Date().toTimeString().slice(0, 8).replace(/:/g, "-");
      const backupName = `WorkshopERP_${dateKey}_${timeKey}_server_${safeHostnameSegment(os.hostname())}`;
      const dest = path.join(root, backupName);
      await fsp.mkdir(dest, { recursive: true });
      await writeServerBackupLog(`Starting ${reason} backup to ${dest}`);

      saveDb();
      await copyTreeForBackup(APP_DIR, path.join(dest, "app"), "app");
      await copyTreeForBackup(dataDirectory, path.join(dest, "data"), "data");

      const manifest = [
        `created=${new Date().toISOString()}`,
        `computer=${os.hostname()}`,
        `pid=${process.pid}`,
        `reason=${reason}`,
        `source=${effectiveWorkingDirectory}`,
        `destination=${dest}`,
        "owner=server.js active host",
        "retentionDays=3",
        "excluded=app\\node, app\\node_modules, app\\logs, app\\.local-data, data\\.watchdogs, data\\.watchdog-commands, *.log, *.tmp",
        "note=Server-based backup; no per-PC startup worker is required."
      ].join("\n");
      await fsp.writeFile(path.join(dest, "backup-info.txt"), manifest, "utf8");
      await fsp.writeFile(path.join(root, ".state", `${dateKey}.daily.done`), dest, "utf8");
      await writeServerBackupLog(`Completed ${reason} backup to ${dest}`);
      await cleanupServerBackups(root);
    });
  } catch (error) {
    await writeServerBackupLog(`Fatal backup error (${reason}): ${error.message}`);
    console.error("[backup] server auto-backup error:", error.message);
  } finally {
    serverBackupRunning = false;
  }
}

function watchdogDirPath() {
  if (!dataDirectory) return null;
  return path.join(dataDirectory, WATCHDOG_DIRNAME);
}

function watchdogStatusPath(hostname = os.hostname()) {
  const dir = watchdogDirPath();
  if (!dir) return null;
  return path.join(dir, `${safeHostnameSegment(hostname)}.json`);
}

function writeWatchdogStatus(payload) {
  const filePath = watchdogStatusPath(payload?.hostname || os.hostname());
  if (!filePath) return;
  writeJsonFileAtomic(filePath, { ...payload, updatedAt: nowIso() });
}

function removeWatchdogStatus(hostname = os.hostname()) {
  const filePath = watchdogStatusPath(hostname);
  if (!filePath) return;
  try { fs.unlinkSync(filePath); } catch {}
}

function powershellSingleQuoted(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function readWatchdogStatusFilesViaPowershell(dir) {
  if (process.platform !== "win32") return null;
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$dir = ${powershellSingleQuoted(dir)}
if (!(Test-Path -LiteralPath $dir)) { '[]'; exit 0 }
$items = @()
Get-ChildItem -LiteralPath $dir -Filter '*.json' -File -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $raw = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop
    if ($raw) {
      $j = $raw | ConvertFrom-Json -ErrorAction Stop
      $j | Add-Member -NotePropertyName __mtime -NotePropertyValue $_.LastWriteTimeUtc.ToString('o') -Force
      $j | Add-Member -NotePropertyName __fileName -NotePropertyValue $_.Name -Force
      $items += $j
    }
  } catch {}
}
if ($items.Count -eq 0) { '[]' } else { $items | ConvertTo-Json -Compress -Depth 12 }
`;
  try {
    const output = execFileSync("powershell.exe", [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      script
    ], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3500,
      maxBuffer: 1024 * 1024
    }).trim();
    if (!output) return [];
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

function readWatchdogStatusFilesViaNode(dir) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLocaleLowerCase("hu-HU").endsWith(".json"))
    .map((entry) => {
      const filePath = path.join(dir, entry.name);
      try {
        const item = JSON.parse(fs.readFileSync(filePath, "utf8"));
        let fileMtime = "";
        try { fileMtime = fs.statSync(filePath).mtime.toISOString(); } catch {}
        return { ...item, __mtime: fileMtime, __fileName: entry.name };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function readWatchdogStatuses(maxAgeMs = WATCHDOG_READY_MS) {
  const dir = watchdogDirPath();
  if (!dir) return [];
  const now = Date.now();
  const files = readWatchdogStatusFilesViaPowershell(dir) || readWatchdogStatusFilesViaNode(dir);
  return files
    .map((item) => {
      try {
        const seenCandidates = [
          Date.parse(item.updatedAt || ""),
          Date.parse(item.lastSeen || ""),
          Date.parse(item.__mtime || "")
        ].filter(Number.isFinite);
        const seenAt = seenCandidates.length ? Math.max(...seenCandidates) : NaN;
        const ageMs = Number.isFinite(seenAt) ? now - seenAt : Infinity;
        return {
          ...item,
          ageSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
          ready: item.ready !== false && Number.isFinite(ageMs) && ageMs <= maxAgeMs,
          stale: !Number.isFinite(ageMs) || ageMs > maxAgeMs
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => String(a.hostname || "").localeCompare(String(b.hostname || ""), "hu"));
}

function hostSwitchPath() {
  if (!dataDirectory) return null;
  return path.join(dataDirectory, HOST_SWITCH_FILENAME);
}

function readHostSwitchRequest() {
  const filePath = hostSwitchPath();
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeHostSwitchRequest(payload) {
  const filePath = hostSwitchPath();
  if (!filePath) return;
  writeJsonFileAtomic(filePath, payload);
}

function clearHostSwitchRequest(nonce = "") {
  const filePath = hostSwitchPath();
  if (!filePath) return;
  try {
    const current = readHostSwitchRequest();
    if (!nonce || current?.nonce === nonce) fs.unlinkSync(filePath);
  } catch {}
}

function watchdogCommandDirPath() {
  if (!dataDirectory) return null;
  return path.join(dataDirectory, WATCHDOG_COMMAND_DIRNAME);
}

function watchdogCommandPath(hostname = os.hostname()) {
  const dir = watchdogCommandDirPath();
  if (!dir) return null;
  return path.join(dir, `${safeHostnameSegment(hostname)}.json`);
}

function readWatchdogCommand(hostname = os.hostname()) {
  const filePath = watchdogCommandPath(hostname);
  if (!filePath) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function writeWatchdogCommand(hostname, payload) {
  const targetHostname = String(hostname || "").trim();
  if (!targetHostname) return false;
  const filePath = watchdogCommandPath(targetHostname);
  if (!filePath) return false;
  writeJsonFileAtomic(filePath, { ...payload, targetHostname, updatedAt: nowIso() });
  return true;
}

function clearWatchdogCommand(hostname = os.hostname(), nonce = "") {
  const filePath = watchdogCommandPath(hostname);
  if (!filePath) return;
  try {
    const current = readWatchdogCommand(hostname);
    if (!nonce || current?.nonce === nonce) fs.unlinkSync(filePath);
  } catch {}
}

function commandAgeSeconds(requestedAt) {
  const at = Date.parse(requestedAt || "");
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.round((Date.now() - at) / 1000));
}

function freshWatchdogCommandFor(hostname) {
  const command = readWatchdogCommand(hostname);
  if (!command) return null;
  const ageSeconds = commandAgeSeconds(command.requestedAt || command.updatedAt);
  if (ageSeconds === null || ageSeconds * 1000 > WATCHDOG_COMMAND_MAX_AGE_MS) return null;
  return {
    type: command.type || "",
    targetHostname: command.targetHostname || hostname || "",
    requestedAt: command.requestedAt || command.updatedAt || "",
    requestedBy: command.requestedBy || "",
    nonce: command.nonce || "",
    ageSeconds
  };
}

function appScriptPath(filename) {
  const preferredRoot = config.workingDirectory || DEFAULT_CONFIG.workingDirectory || "";
  const preferred = preferredRoot ? path.join(preferredRoot, "app", filename) : "";
  try {
    if (preferred && fs.existsSync(preferred)) return preferred;
  } catch {}
  return path.join(APP_DIR, filename);
}

function spawnDelayedBatch(batchPath, delaySeconds = 3) {
  if (process.platform !== "win32") throw new Error("Ez a muvelet csak Windows hoston tamogatott.");
  const safeBatch = String(batchPath || "");
  if (!path.isAbsolute(safeBatch) || /[\r\n"]/.test(safeBatch)) throw new Error("Hibas BAT/CMD utvonal.");
  const launcher = path.join(APP_DIR, "delayed-launch.vbs");
  if (!fs.existsSync(launcher)) throw new Error(`Hianyzo kesleltetett indito: ${launcher}`);
  const localCwd = process.env.LOCALAPPDATA || os.tmpdir();
  const seconds = Math.min(60, Math.max(1, Math.round(Number(delaySeconds) || 1)));
  // WScript has no console and its Sleep works after the old Node exits.
  // CMD timeout cannot wait with detached/NUL stdin on these Windows hosts.
  const child = spawn("wscript.exe", ["//B", "//Nologo", launcher, safeBatch, String(seconds)], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    cwd: localCwd
  });
  child.on("error", error => console.error("[delayed-launch]", error.message));
  child.unref();
  return { pid: child.pid || 0, batchPath };
}

function scheduleLocalHostRestart(reason = "manual restart") {
  if (localHostRestartScheduled) return { scheduled: false, alreadyScheduled: true };
  const startBat = appScriptPath("start-server.bat");
  if (!fs.existsSync(startBat)) throw new Error(`Nem talalhato start-server.bat: ${startBat}`);
  const launch = spawnDelayedBatch(startBat, 4);
  localHostRestartScheduled = true;
  const timer = setTimeout(() => shutdownHost(reason), 800);
  if (timer.unref) timer.unref();
  return { scheduled: true, ...launch };
}

function readLegacyWatchdogLogStatuses(knownHostnames = new Set()) {
  const logDir = path.join(APP_DIR, "logs");
  let entries = [];
  try {
    entries = fs.readdirSync(logDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const now = Date.now();
  const byHost = new Map();
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!/^watchdog-.+(\.out)?\.log$/i.test(entry.name) || /\.err\.log$/i.test(entry.name)) continue;
    const match = entry.name.match(/^watchdog-(.+?)(?:\.out)?\.log$/i);
    const hostname = match?.[1] || "";
    const normalized = normalizeHostname(hostname);
    if (!hostname || knownHostnames.has(normalized)) continue;
    const filePath = path.join(logDir, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    const ageMs = now - stat.mtimeMs;
    if (ageMs > LEGACY_WATCHDOG_LOG_READY_MS) continue;
    let activeHost = "";
    let activeHostHttpOk = false;
    let relayTargetHost = "";
    try {
      const text = fs.readFileSync(filePath, "utf8");
      const matches = [...text.matchAll(/host:\s*([^\s(]+).*?http:\s*(ok|hiba).*?relay:\s*([^\)\r\n]+)/gi)];
      const last = matches[matches.length - 1];
      if (last) {
        activeHost = last[1] || "";
        activeHostHttpOk = normalizeSearchForServer(last[2]) === "ok";
        relayTargetHost = (last[3] || "").trim();
        if (relayTargetHost === "nincs") relayTargetHost = "";
      }
    } catch {}
    const item = {
      hostname,
      pid: 0,
      startedAt: "",
      updatedAt: stat.mtime.toISOString(),
      ageSeconds: Math.max(0, Math.round(ageMs / 1000)),
      ready: true,
      stale: false,
      switchable: false,
      role: "legacy",
      port: config.port || DEFAULT_CONFIG.port,
      workingDirectory: effectiveWorkingDirectory || "",
      activeHost,
      activeHostHttpOk,
      activeHostAgeSeconds: null,
      relayActive: Boolean(relayTargetHost),
      relayTargetHost,
      serverStateRun: true,
      healthFailCount: 0,
      source: "legacy-log"
    };
    const previous = byHost.get(normalized);
    if (!previous || String(item.updatedAt).localeCompare(previous.updatedAt || "") > 0) {
      byHost.set(normalized, item);
    }
  }
  return [...byHost.values()];
}

function normalizeSearchForServer(value) {
  return String(value || "").trim().toLocaleLowerCase("hu-HU");
}

function hostStatusSnapshot() {
  const lock = readHostLock();
  const state = readServerState();
  const now = Date.now();
  const lockSeenAt = Date.parse(lock?.lastSeen || "");
  const lockAgeMs = Number.isFinite(lockSeenAt) ? now - lockSeenAt : Infinity;
  const currentHost = lock ? {
    hostname: lock.hostname || "",
    nickname: hostNickname(lock.hostname || ""),
    pid: lock.pid || 0,
    generation: Number(lock.generation) || 0,
    startedAt: lock.startedAt || "",
    lastSeen: lock.lastSeen || "",
    stop: Boolean(lock.stop),
    ageSeconds: Number.isFinite(lockAgeMs) ? Math.max(0, Math.round(lockAgeMs / 1000)) : null,
    stale: !Number.isFinite(lockAgeMs) || lockAgeMs > WATCHDOG_READY_MS
  } : null;
  const currentHostName = currentHost?.hostname || "";
  const watchdogs = readWatchdogStatuses().map((item) => {
    const restartCommand = freshWatchdogCommandFor(item.hostname || "");
    return {
      hostname: item.hostname || "",
      nickname: hostNickname(item.hostname || ""),
      pid: item.pid || 0,
      startedAt: item.startedAt || "",
      updatedAt: item.updatedAt || item.lastSeen || "",
      ageSeconds: item.ageSeconds,
      ready: Boolean(item.ready),
      stale: Boolean(item.stale),
      switchable: item.switchable !== false,
      role: item.role || "",
      port: item.port || config.port || DEFAULT_CONFIG.port,
      workingDirectory: item.workingDirectory || "",
      activeHost: item.activeHost || "",
      activeHostNickname: hostNickname(item.activeHost || ""),
      activeHostHttpOk: Boolean(item.activeHostHttpOk),
      activeHostAgeSeconds: item.activeHostAgeSeconds ?? null,
      relayActive: Boolean(item.relayActive),
      relayTargetHost: item.relayTargetHost || "",
      relayTargetNickname: hostNickname(item.relayTargetHost || ""),
      serverStateRun: item.serverStateRun !== false,
      healthFailCount: Number(item.healthFailCount || 0),
      restartCommand,
      isCurrentHost: currentHostName ? sameHostname(item.hostname, currentHostName) : false,
      isThisServer: sameHostname(item.hostname, os.hostname())
    };
  });
  const known = new Set(watchdogs.map((item) => normalizeHostname(item.hostname)));
  for (const legacy of readLegacyWatchdogLogStatuses(known)) {
    watchdogs.push({
      ...legacy,
      nickname: hostNickname(legacy.hostname || ""),
      activeHostNickname: hostNickname(legacy.activeHost || ""),
      relayTargetNickname: hostNickname(legacy.relayTargetHost || ""),
      isCurrentHost: currentHostName ? sameHostname(legacy.hostname, currentHostName) : false,
      isThisServer: sameHostname(legacy.hostname, os.hostname())
    });
  }
  const switchRequest = readHostSwitchRequest();
  const switchAt = Date.parse(switchRequest?.requestedAt || "");
  const switchAgeMs = Number.isFinite(switchAt) ? now - switchAt : Infinity;
  return {
    serverHostname: os.hostname(),
    serverNickname: hostNickname(os.hostname()),
    currentHost,
    serverState: state,
    watchdogs: watchdogs.filter(item => !hostEnrollment.state(item.hostname).removed),
    switchRequest: switchRequest && switchAgeMs <= HOST_SWITCH_MAX_AGE_MS ? {
      targetHostname: switchRequest.targetHostname || "",
      targetNickname: hostNickname(switchRequest.targetHostname || ""),
      requestedAt: switchRequest.requestedAt || "",
      requestedBy: switchRequest.requestedBy || "",
      ageSeconds: Math.max(0, Math.round(switchAgeMs / 1000))
    } : null
  };
}

function readServerState() {
  const filePath = serverStatePath();
  if (!filePath) return { run: true };
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { run: parsed.run !== false, updatedAt: parsed.updatedAt || "", updatedBy: parsed.updatedBy || "" };
  } catch {
    // Missing/corrupt file → treat as "run on" so we don't accidentally disable hosting
    // because of a typo or partial write.
    return { run: true };
  }
}

function writeServerState(run, source = "server") {
  const filePath = serverStatePath();
  if (!filePath) return;
  writeJsonFileAtomic(filePath, {
    run: Boolean(run),
    updatedAt: nowIso(),
    updatedBy: source
  });
}

function readHostLockDetailed() {
  const filePath = hostLockPath();
  if (!filePath) return { lock: null, ok: false, reason: "no-data-directory", error: "" };
  try {
    const text = fs.readFileSync(filePath, "utf8");
    if (!String(text || "").trim()) {
      return { lock: null, ok: false, reason: "empty", error: "empty host-lock file" };
    }
    return { lock: JSON.parse(text), ok: true, reason: "ok", error: "" };
  } catch (error) {
    return {
      lock: null,
      ok: false,
      reason: error?.code || (error?.name === "SyntaxError" ? "parse" : "read-error"),
      error: error?.message || ""
    };
  }
}

function readHostLock() {
  return readHostLockDetailed().lock;
}

function writeHostLock(payload) {
  const filePath = hostLockPath();
  if (!filePath) return;
  writeJsonFileAtomic(filePath, payload);
}

function claimHostLock() {
  const read = readHostLockDetailed();
  if (!read.ok && read.reason !== "ENOENT") throw new Error(`Host claim refused: lock unreadable (${read.reason})`);
  const existing = read.lock;
  const previousGen = Number(existing?.generation) || 0;
  hostGeneration = previousGen + 1;
  hostStartedAt = nowIso();
  writeHostLock({
    hostname: os.hostname(),
    pid: process.pid,
    generation: hostGeneration,
    startedAt: hostStartedAt,
    lastSeen: nowIso(),
    stop: false
  });
  console.log(`[host-lock] átvettem a hostolást: generáció ${hostGeneration} (előző: ${previousGen}, host: ${existing?.hostname || "—"})`);
}

function tickHostLock() {
  if (isShuttingDown) return;
  // SQLite ownership fences stale processes even if the SMB JSON lock was
  // temporarily unreadable or two startup processes chose the same generation.
  try { storageGuard.assertOwner(sqlite); }
  catch (error) {
    if (String(error.code || "").startsWith("ERP_STORAGE_")) shutdownHost(error.message);
    return; // Unknown database state: never rewrite the shared file lock.
  }
  const eligibility = getHostEligibility();
  if (!eligibility.ok) {
    console.log(`[host-eligibility] ${eligibility.reason} - host leall.`);
    shutdownHost(`host not eligible: ${eligibility.reason}`);
    return;
  }
  // Global on/off switch wins over everything else.
  const state = readServerState();
  if (!state.run) {
    console.log(`[server-state] kikapcsolva (${state.updatedBy || "ismeretlen"}, ${state.updatedAt || "—"}) — leállítás.`);
    shutdownHost("server-state off");
    return;
  }
  const lock = readHostLock();
  if (!lock) {
    try {
      if (hostGeneration > 0) {
        const stamp = nowIso();
        writeHostLock({
          hostname: os.hostname(),
          pid: process.pid,
          generation: hostGeneration,
          startedAt: hostStartedAt || stamp,
          lastSeen: stamp,
          stop: false
        });
      } else {
        claimHostLock();
      }
    } catch (error) {
      console.error("[host-lock] újraírás hiba:", error.message);
    }
    return;
  }
  if (lock.stop) {
    console.log("[host-lock] STOP jel érkezett — leállítás.");
    shutdownHost("stop signal");
    return;
  }
  const lockGen = Number(lock.generation) || 0;
  const mine = lock.hostname === os.hostname() && lockGen === hostGeneration && Number(lock.pid) === process.pid;
  if (lockGen > hostGeneration || (lockGen === hostGeneration && !mine)) {
    console.log(`[host-lock] új host vette át (${lock.hostname}, gen ${lockGen}) — leállítás.`);
    shutdownHost("takeover by newer host");
    return;
  }
  if (mine) {
    try {
      hostStartedAt = hostStartedAt || lock.startedAt || nowIso();
      writeHostLock({ ...lock, hostname: os.hostname(), pid: process.pid, generation: hostGeneration, lastSeen: nowIso(), stop: false });
      writeWatchdogStatus({
        hostname: os.hostname(),
        pid: process.pid,
        startedAt: lock.startedAt || nowIso(),
        lastSeen: nowIso(),
        ready: true,
        serverStateRun: true,
        activeHost: os.hostname(),
        activeHostGeneration: hostGeneration,
        activeHostLastSeen: nowIso(),
        activeHostAgeSeconds: 0,
        activeHostHttpOk: true,
        healthFailCount: 0,
        relayActive: false,
        relayTargetHost: "",
        port: config.port || DEFAULT_CONFIG.port,
        role: "host",
        hostEligible: true,
        hostEligibilityReason: eligibility.reason,
        localIpAddresses: eligibility.addresses,
        workingDirectory: effectiveWorkingDirectory,
        source: "host-server"
      });
    } catch (error) {
      // Ignore transient write errors (network share blip).
    }
  }
}

function startHostLockWatcher() {
  if (hostLockTimer) clearInterval(hostLockTimer);
  hostLockTimer = setInterval(tickHostLock, HOST_LOCK_POLL_MS);
}

function shutdownHost(reason) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[shutdown] indok: ${reason}`);
  // Flush sessions so the PC taking over hosting picks up the latest state
  // and users stay logged in across the handover.
  try { if (sessionsLoaded) saveSessions(true); } catch {}
  if (hostLockTimer) clearInterval(hostLockTimer);
  for (const timer of backgroundTimers) {
    try { clearInterval(timer); } catch {}
  }
  for (const client of sseClients) {
    try { client.end(); } catch {}
  }
  sseClients.clear();
  for (const server of httpServers) {
    try { server.close(); } catch {}
  }
  stopLocalCloudflareProcesses(reason);
  setTimeout(() => process.exit(0), 600);
}

function listenWithRetry(server, port, host, label) {
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const MAX_ATTEMPTS = 20;
    const tryListen = () => {
      attempts += 1;
      const onError = (error) => {
        server.removeListener("listening", onListening);
        if (error && error.code === "EADDRINUSE" && attempts < MAX_ATTEMPTS) {
          console.log(`[listen] ${label} (port ${port}) foglalt — újrapróba 1s múlva (${attempts}/${MAX_ATTEMPTS})…`);
          setTimeout(tryListen, 1000);
        } else {
          reject(error);
        }
      };
      const onListening = () => {
        server.removeListener("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);
      try { server.listen(port, host); } catch (error) { onError(error); }
    };
    tryListen();
  });
}

function assertProductionMapping() {
  const command = "$ErrorActionPreference='Stop'; $disk=Get-CimInstance -Query 'SELECT ProviderName FROM Win32_LogicalDisk WHERE DeviceID = ''Y:'''; $registered=''; try{$registered=(Get-ItemProperty -LiteralPath 'HKCU:\\Network\\Y' -Name RemotePath -ErrorAction Stop).RemotePath}catch{}; @{diskPresent=($null -ne $disk);provider=[string]$disk.ProviderName;registered=$registered} | ConvertTo-Json -Compress";
  const raw = execFileSync("powershell.exe", ["-NoProfile", "-Command", command], { encoding:"utf8", windowsHide:true, timeout:15000 });
  assertCanonicalMapping(JSON.parse(raw));
}

function resolveWorkingDirForCli() {
  assertProductionMapping();
  const preferred = assertCanonicalWorkingDirectory(config.workingDirectory);
  fs.accessSync(path.join(preferred, "data"), fs.constants.R_OK | fs.constants.W_OK);
  return preferred;
}

// CLI: `node server.js --watch-loop`
// Idle "watchdog" loop. Polls shared state + host-lock, verifies the active
// host over HTTP, and launches start-server.bat locally when the active host is
// stale/unreachable. Standby PCs do not relay localhost traffic and do not run
// cloudflared; the connector starts only after a PC becomes the active host.
// Respects the global run=false off switch. Used by install-startup.bat to make
// every installed PC a self-healing host candidate.
if (process.argv.includes("--watch-loop")) {
  (async () => {
    try {
      effectiveWorkingDirectory = resolveWorkingDirForCli();
      dataDirectory = path.join(effectiveWorkingDirectory, "data");
    } catch (error) {
      console.error("[watchdog] init hiba:", error.message);
      process.exit(1);
    }
    // Explicit per-PC log file (synchronous appends — bypasses Node's stdout
    // buffering, which doesn't flush quickly when redirected to a network file).
    const myHost = os.hostname();
    const logDir = path.join(__dirname, "logs");
    try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
    const watchdogLogPath = path.join(logDir, `watchdog-${myHost}.log`);
    const WATCHDOG_LOG_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
    function rotateIfTooBig() {
      try {
        const stat = fs.statSync(watchdogLogPath);
        if (stat.size > WATCHDOG_LOG_MAX_BYTES) {
          const archived = watchdogLogPath + ".old";
          try { fs.unlinkSync(archived); } catch {}
          fs.renameSync(watchdogLogPath, archived);
        }
      } catch {}
    }
    rotateIfTooBig();
    function wlog(msg) {
      const line = `[${nowIso()}] ${msg}\n`;
      try {
        fs.appendFileSync(watchdogLogPath, line);
        // Cheap size check every ~50 writes (≈ every ~4 hours at heartbeat rate).
        wlog._writes = (wlog._writes || 0) + 1;
        if (wlog._writes % 50 === 0) rotateIfTooBig();
      } catch {}
      try { process.stdout.write(line); } catch {}
    }
    function werr(msg) {
      const line = `[${nowIso()}] ERROR: ${msg}\n`;
      try { fs.appendFileSync(watchdogLogPath, line); } catch {}
      try { process.stderr.write(line); } catch {}
    }
    const { spawn } = require("child_process");
    const STALE_MS = HOST_LOCK_STALE_MS;
    const POLL_MS = 10000;
    const HEALTH_FAIL_LIMIT = 3;
    const START_RETRY_MS = 45000;
    const PORT = Number(config.port) || DEFAULT_CONFIG.port || 4780;
    let healthFailCount = 0;
    let lastStartAttemptAt = 0;
    let relayServer = null;
    let relayTargetHost = "";
    let relayErrorKey = "";
    const watchdogStartedAt = nowIso();
    let lastHandledSwitchNonce = "";
    let lastHandledWatchdogCommandNonce = "";
    let watchdogRestarting = false;
    let missingLockCount = 0;
    let staleLockCount = 0;
    let lastGoodLock = null;
    let lastLockProblemKey = "";

    function acquireSingleWatchdog() {
      try {
        const localRoot = process.env.LOCALAPPDATA || os.tmpdir();
        const lockDir = path.join(localRoot, "WorkshopERP");
        fs.mkdirSync(lockDir, { recursive: true });
        const lockFile = path.join(lockDir, `watchdog-${myHost}.json`);
        let existing = null;
        try {
          existing = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        } catch {}
        const existingPid = Number(existing?.pid) || 0;
        if (existingPid && existingPid !== process.pid) {
          try {
            process.kill(existingPid, 0);
            wlog(`[watchdog] már fut ezen a gépen (pid: ${existingPid}), ez a példány kilép.`);
            return false;
          } catch {
            // stale pid, overwrite below
          }
        }
        fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, host: myHost, startedAt: nowIso() }, null, 2), "utf8");
        process.on("exit", () => {
          try {
            const current = JSON.parse(fs.readFileSync(lockFile, "utf8"));
            if (Number(current?.pid) === process.pid) fs.unlinkSync(lockFile);
          } catch {}
        });
      } catch (error) {
        werr(`lokális watchdog lock hiba: ${error.message}`);
      }
      return true;
    }

    function sameHost(hostname) {
      return sameHostname(hostname, myHost);
    }

    function healthHostFor(hostname) {
      return sameHost(hostname) ? "127.0.0.1" : String(hostname || "");
    }

    function checkHostHttp(hostname) {
      const targetHost = healthHostFor(hostname);
      if (!targetHost) return Promise.resolve(false);
      return new Promise((resolve) => {
        const req = http.request({
          hostname: targetHost,
          port: PORT,
          path: "/api/auth",
          method: "GET",
          timeout: 3500
        }, (response) => {
          response.resume();
          resolve(Number(response.statusCode) >= 200 && Number(response.statusCode) < 500);
        });
        req.on("timeout", () => req.destroy(new Error("timeout")));
        req.on("error", () => resolve(false));
        req.end();
      });
    }

    function freshWatchdogStatusFor(hostname, maxAgeMs = WATCHDOG_READY_MS) {
      if (!hostname) return null;
      try {
        return readWatchdogStatuses(maxAgeMs)
          .find((item) => sameHostname(item.hostname, hostname)) || null;
      } catch {
        return null;
      }
    }

    function remoteHostSelfHttpOk(hostname) {
      const status = freshWatchdogStatusFor(hostname, Math.max(WATCHDOG_READY_MS, STALE_MS + POLL_MS));
      if (!status || !sameHostname(status.activeHost, hostname)) return null;
      return status.activeHostHttpOk === true;
    }

    function stopRelay(reason = "") {
      if (!relayServer) return false;
      const oldTarget = relayTargetHost;
      try { relayServer.close(); } catch {}
      relayServer = null;
      relayTargetHost = "";
      relayErrorKey = "";
      if (reason) wlog(`[relay] leállítva (${reason}${oldTarget ? `, cél: ${oldTarget}` : ""})`);
      return true;
    }

    function ensureRelay(targetHost) {
      // Option B: standby PCs do not run a localhost relay. Cloudflare runs
      // only on the active host, so there is nothing to forward here.
      stopRelay("relay disabled: active host owns Cloudflare");
      return;
      if (!targetHost || sameHost(targetHost)) {
        stopRelay("helyi host aktív");
        return;
      }
      if (relayServer) {
        if (relayTargetHost !== targetHost) {
          wlog(`[relay] cél frissítve: ${relayTargetHost} → ${targetHost}`);
          relayTargetHost = targetHost;
        }
        return;
      }
      relayTargetHost = targetHost;
      const server = http.createServer((req, res) => {
        const currentTarget = relayTargetHost;
        if (!currentTarget) {
          res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          return res.end("Nincs aktív ERP host.");
        }
        const headers = {
          ...req.headers,
          host: `${currentTarget}:${PORT}`,
          "x-forwarded-host": req.headers.host || "",
          "x-forwarded-proto": "http"
        };
        const proxyReq = http.request({
          hostname: currentTarget,
          port: PORT,
          path: req.url,
          method: req.method,
          headers,
          timeout: 60000
        }, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
          proxyRes.pipe(res);
        });
        proxyReq.on("timeout", () => proxyReq.destroy(new Error("timeout")));
        proxyReq.on("error", () => {
          if (!res.headersSent) {
            res.writeHead(502, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
          }
          res.end(`Az aktív ERP host nem elérhető: ${currentTarget}:${PORT}`);
        });
        req.pipe(proxyReq);
      });
      server.on("error", (error) => {
        const key = `${error.code || "ERR"}:${targetHost}`;
        if (relayErrorKey !== key) {
          relayErrorKey = key;
          werr(`relay nem indítható a ${PORT} porton (${targetHost} felé): ${error.message}`);
        }
        relayServer = null;
        relayTargetHost = "";
      });
      server.listen(PORT, "0.0.0.0", () => {
        relayErrorKey = "";
        wlog(`[relay] helyi ${PORT} port továbbít ide: http://${targetHost}:${PORT}`);
      });
      relayServer = server;
    }

    function nodeExeForLocalHostStart() {
      const candidates = [
        process.env.NODE_EXE,
        process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "WorkshopERP", "node", "node.exe") : "",
        path.join(__dirname, "node", "node.exe"),
        process.execPath
      ].filter(Boolean);
      for (const candidate of candidates) {
        try {
          if (fs.existsSync(candidate)) return candidate;
        } catch {}
      }
      return "";
    }

    function directStartLocalHost(reason) {
      const nodeExe = nodeExeForLocalHostStart();
      if (!nodeExe) {
        werr(`közvetlen host indítás sikertelen: node.exe nem található (${reason})`);
        return;
      }
      const localRoot = process.env.LOCALAPPDATA
        ? path.join(process.env.LOCALAPPDATA, "WorkshopERP")
        : path.join(os.tmpdir(), "WorkshopERP");
      const logDir = path.join(localRoot, "logs");
      try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
      const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
      const outLog = path.join(logDir, `server-${myHost}-${stamp}-watchdog-fallback.out.log`);
      const errLog = path.join(logDir, `server-${myHost}-${stamp}-watchdog-fallback.err.log`);
      let outFd = null;
      let errFd = null;
      try {
        outFd = fs.openSync(outLog, "a");
        errFd = fs.openSync(errLog, "a");
        const child = spawn(nodeExe, ["--no-warnings=ExperimentalWarning", "server.js"], {
          detached: true,
          stdio: ["ignore", outFd, errFd],
          windowsHide: true,
          cwd: __dirname,
          env: {
            ...process.env,
            NODE_EXE: nodeExe,
            ERP_APP_DIR: __dirname.endsWith(path.sep) ? __dirname : `${__dirname}${path.sep}`
          }
        });
        child.on("error", (error) => werr(`közvetlen host indítás hiba: ${error.message}`));
        child.unref();
        wlog(`[watchdog] ${reason}. közvetlen node indítás pid=${child.pid || "?"}, log=${outLog}`);
      } catch (error) {
        werr(`közvetlen host indítás sikertelen: ${error.message}`);
      } finally {
        if (outFd !== null) { try { fs.closeSync(outFd); } catch {} }
        if (errFd !== null) { try { fs.closeSync(errFd); } catch {} }
      }
    }

    function scheduleStartFallback(reason) {
      const timer = setTimeout(() => {
        checkHostHttp(myHost)
          .then((ok) => {
            if (ok || localHostIsStarting()) return;
            werr(`start-server.bat után nincs helyi válasz a ${PORT} porton; közvetlen node indítás következik.`);
            directStartLocalHost(`${reason} (start-server.bat fallback)`);
          })
          .catch((error) => {
            werr(`start-server.bat utáni helyi ellenőrzés hiba: ${error.message}`);
            if (!localHostIsStarting()) directStartLocalHost(`${reason} (start-server.bat fallback)`);
          });
      }, 12000);
      if (timer.unref) timer.unref();
    }

    function localHostIsStarting() {
      const lock = readHostLock();
      const age = Date.now() - Date.parse(lock?.startedAt || "");
      if (!sameHost(lock?.hostname) || !Number.isFinite(age) || age < -5000 || age > 120000 || Number(lock.pid) <= 4 || Number(lock.pid) === process.pid) return false;
      try { process.kill(Number(lock.pid), 0); return true; } catch { return false; }
    }

    function startLocalHost(reason, force = false) {
      if (localHostIsStarting()) return;
      const eligibility = getHostEligibility();
      if (!eligibility.ok) {
        healthFailCount = 0;
        stopRelay("host inditas tiltva: nem ceges LAN");
        stopLocalCloudflareProcesses("watchdog host not eligible");
        wlog(`[watchdog] host inditas kihagyva (${reason}): ${eligibility.reason}`);
        return;
      }
      const now = Date.now();
      if (!force && now - lastStartAttemptAt < START_RETRY_MS) return;
      lastStartAttemptAt = now;
      const hadRelay = stopRelay("átvétel előtt");
      const launch = () => {
        wlog(`[watchdog] ${reason}. start-server.bat indítása helyben…`);
        try {
          const startBat = path.join(__dirname, "start-server.bat");
          const launch = spawnDelayedBatch(startBat, 1);
          wlog(`[watchdog] start-server.bat pid=${launch.pid || "?"}`);
          scheduleStartFallback(reason);
        } catch (error) {
          werr(`start-server.bat indítás sikertelen: ${error.message}`);
          directStartLocalHost(`${reason} (start-server.bat indítási hiba)`);
        }
      };
      if (hadRelay) {
        const timer = setTimeout(launch, 1200);
        if (timer.unref) timer.unref();
      } else {
        launch();
      }
    }

    wlog(`[watchdog] elindult ${myHost} gépen. Munkakönyvtár: ${effectiveWorkingDirectory}, pid: ${process.pid}`);
    function publishWatchdogStatus({ state = null, lock = null, httpOk = false, lastSeenAge = null } = {}) {
      try {
        const eligibility = getHostEligibility();
        const effectiveState = state || readServerState();
        const effectiveLock = lock || readHostLock();
        const role = sameHost(effectiveLock?.hostname)
          ? "host"
          : (relayServer ? "relay" : "standby");
        writeWatchdogStatus({
          hostname: myHost,
          pid: process.pid,
          startedAt: watchdogStartedAt,
          lastSeen: nowIso(),
          ready: effectiveState.run !== false && eligibility.ok,
          serverStateRun: effectiveState.run !== false,
          activeHost: effectiveLock?.hostname || "",
          activeHostGeneration: Number(effectiveLock?.generation) || 0,
          activeHostLastSeen: effectiveLock?.lastSeen || "",
          activeHostAgeSeconds: Number.isFinite(lastSeenAge) ? Math.max(0, Math.round(lastSeenAge / 1000)) : null,
          activeHostHttpOk: Boolean(httpOk),
          healthFailCount,
          relayActive: Boolean(relayServer),
          relayTargetHost,
          port: PORT,
          role,
          hostEligible: eligibility.ok,
          hostEligibilityReason: eligibility.reason,
          localIpAddresses: eligibility.addresses,
          workingDirectory: effectiveWorkingDirectory
        });
      } catch (error) {
        werr(`watchdog status kiírás hiba: ${error.message}`);
      }
    }

    function maybeHandleHostSwitch(state, lock) {
      const request = readHostSwitchRequest();
      if (!state?.run || !request?.targetHostname || !sameHost(request.targetHostname)) return;
      const requestedAt = Date.parse(request.requestedAt || "");
      if (!Number.isFinite(requestedAt) || Date.now() - requestedAt > HOST_SWITCH_MAX_AGE_MS) return;
      const nonce = request.nonce || request.requestedAt || request.targetHostname;
      if (sameHost(lock?.hostname)) {
        clearHostSwitchRequest(nonce);
        return;
      }
      if (nonce === lastHandledSwitchNonce) return;
      lastHandledSwitchNonce = nonce;
      startLocalHost(`kézi host váltás kérés (${request.requestedBy || "ERP"})`, true);
    }

    function restartWatchdogProcess(reason) {
      if (watchdogRestarting) return;
      watchdogRestarting = true;
      const launcher = appScriptPath("watchdog-launcher.cmd");
      if (!fs.existsSync(launcher)) {
        watchdogRestarting = false;
        werr(`watchdog ujrainditas sikertelen: nem talalhato ${launcher}`);
        return;
      }
      try {
        const launch = spawnDelayedBatch(launcher, 3);
        wlog(`[watchdog] ${reason}. uj watchdog indito utemezve pid=${launch.pid || "?"}`);
      } catch (error) {
        watchdogRestarting = false;
        werr(`watchdog ujrainditas inditasi hiba: ${error.message}`);
        return;
      }
      const timer = setTimeout(() => process.exit(0), 700);
      if (timer.unref) timer.unref();
    }

    function maybeHandleWatchdogCommand() {
      const raw = readWatchdogCommand(myHost);
      if (!raw) return;
      const ageSeconds = commandAgeSeconds(raw.requestedAt || raw.updatedAt);
      const nonce = raw.nonce || raw.requestedAt || raw.updatedAt || raw.targetHostname || "";
      if (ageSeconds === null || ageSeconds * 1000 > WATCHDOG_COMMAND_MAX_AGE_MS) {
        clearWatchdogCommand(myHost, nonce);
        return;
      }
      if (raw.type !== "restart-watchdog" || (raw.targetHostname && !sameHost(raw.targetHostname))) return;
      if (nonce && nonce === lastHandledWatchdogCommandNonce) return;
      lastHandledWatchdogCommandNonce = nonce;
      clearWatchdogCommand(myHost, nonce);
      restartWatchdogProcess(`tavoli watchdog ujrainditas keres (${raw.requestedBy || "ERP"})`);
    }

    if (!acquireSingleWatchdog()) process.exit(0);
    process.on("exit", () => removeWatchdogStatus(myHost));
    runLogMaintenance("watchdog-start", { force: true });
    const logMaintenanceTimer = setInterval(() => runLogMaintenance("watchdog-scheduled"), LOG_MAINTENANCE_INTERVAL_MS);
    if (logMaintenanceTimer.unref) logMaintenanceTimer.unref();
    // Standby watchdogs must not keep stale Cloudflare connectors alive.
    try {
      const startupState = readServerState();
      const startupLock = readHostLock();
      if (!startupState.run || !sameHost(startupLock?.hostname)) {
        stopLocalCloudflareProcesses("watchdog standby startup");
      }
    } catch {}
    while (true) {
      let loopState = null;
      let loopLock = null;
      let loopHttpOk = false;
      let loopLastSeenAge = null;
      try {
        const state = readServerState();
        loopState = state;
        maybeHandleWatchdogCommand();
        if (state.run) {
          const lockRead = readHostLockDetailed();
          const lock = lockRead.lock;
          const statusLock = lock || lastGoodLock;
          loopLock = statusLock;
          const lastSeenTime = statusLock?.lastSeen ? new Date(statusLock.lastSeen).getTime() : 0;
          const lastSeenAge = lastSeenTime ? (Date.now() - lastSeenTime) : Infinity;
          loopLastSeenAge = lastSeenAge;
          maybeHandleHostSwitch(state, lock);
          if (!lock) {
            missingLockCount += 1;
            staleLockCount = 0;
            const rememberedHost = lastGoodLock?.hostname || "";
            let rememberedHttpOk = false;
            if (rememberedHost) {
              const rememberedSelfOk = sameHost(rememberedHost) ? null : remoteHostSelfHttpOk(rememberedHost);
              rememberedHttpOk = rememberedSelfOk === true || await checkHostHttp(rememberedHost);
              loopHttpOk = rememberedHttpOk;
              if (rememberedHttpOk) {
                ensureRelay(rememberedHost);
              } else {
                stopRelay("host-lock nem olvashato es az utolso ismert host HTTP hibas");
              }
            } else {
              stopRelay("host-lock nem olvashato");
            }
            const problemKey = `${lockRead.reason}:${lockRead.error || ""}:${rememberedHost}:${rememberedHttpOk}`;
            if (problemKey !== lastLockProblemKey || missingLockCount === HOST_LOCK_MISSING_LIMIT) {
              lastLockProblemKey = problemKey;
              wlog(`[watchdog] host-lock nem olvashato (${lockRead.reason}${lockRead.error ? `: ${lockRead.error}` : ""}), sorozat: ${missingLockCount}/${HOST_LOCK_MISSING_LIMIT}, utolso ismert host: ${rememberedHost || "-"}, http: ${rememberedHttpOk ? "ok" : "hiba"}`);
            }
            if (!rememberedHttpOk && missingLockCount >= HOST_LOCK_MISSING_LIMIT) {
              healthFailCount = 0;
              startLocalHost(`host-lock ${missingLockCount} egymas utani alkalommal nem olvashato (${lockRead.reason}), utolso ismert host: ${rememberedHost || "-"}`);
              missingLockCount = 0;
            }
            await new Promise((r) => setTimeout(r, POLL_MS));
            continue;
          }
          missingLockCount = 0;
          lastLockProblemKey = "";
          lastGoodLock = lock;
          if (lastSeenAge > STALE_MS) {
            if (sameHost(lock.hostname)) stopRelay("helyi host ellenorzes elott");
            const staleHttpOk = await checkHostHttp(lock.hostname);
            loopHttpOk = staleHttpOk;
            if (staleHttpOk) {
              staleLockCount = 0;
              healthFailCount = 0;
              ensureRelay(lock.hostname);
              await new Promise((r) => setTimeout(r, POLL_MS));
              continue;
            }
            staleLockCount += 1;
            stopRelay("host-lock lejart es aktiv host HTTP hibas");
            if (staleLockCount < HOST_LOCK_STALE_LIMIT) {
              await new Promise((r) => setTimeout(r, POLL_MS));
              continue;
            }
          }
          if (!lock || lastSeenAge > STALE_MS) {
            healthFailCount = 0;
            startLocalHost(`nincs friss host (kor: ${Number.isFinite(lastSeenAge) ? Math.round(lastSeenAge/1000) + "s" : "nincs adat"}, utolsó: ${lock?.hostname || "—"})`);
          } else {
            const localActiveHost = sameHost(lock.hostname);
            let httpOk = false;
            let httpLabel = "nem ellenőrizve";
            if (localActiveHost) {
              stopRelay("helyi host ellenőrzés előtt");
              httpOk = await checkHostHttp(lock.hostname);
              httpLabel = httpOk ? "ok" : "hiba";
              loopHttpOk = httpOk;
              if (httpOk) {
                staleLockCount = 0;
                healthFailCount = 0;
                ensureRelay(lock.hostname);
              } else {
                staleLockCount = 0;
                healthFailCount += 1;
                stopRelay("aktív host helyi HTTP ellenőrzés hibás");
                if (healthFailCount >= HEALTH_FAIL_LIMIT) {
                  startLocalHost(`az aktív host helyben nem válaszol HTTP-n (${lock.hostname}:${PORT}, hibák: ${healthFailCount})`);
                  healthFailCount = 0;
                }
              }
            } else {
              // A fresh host-lock means the remote host process is alive. Do
              // not steal hosting only because this PC cannot resolve/reach
              // the other PC name over Windows networking; the active PC's
              // own watchdog is responsible for restarting its local server.
              const remoteSelfOk = remoteHostSelfHttpOk(lock.hostname);
              httpOk = remoteSelfOk === true;
              httpLabel = remoteSelfOk === null ? "nem ellenőrizve" : (remoteSelfOk ? "ok" : "host szerint hiba");
              loopHttpOk = httpOk;
              staleLockCount = 0;
              healthFailCount = 0;
              stopRelay("távoli host-lock friss; nincs standby átvétel");
            }
            // Heartbeat every ~5 minutes so the log shows the watchdog is alive.
            const minute = Math.floor(Date.now() / 60000);
            if (minute % 5 === 0 && (!wlog._lastHeartbeat || wlog._lastHeartbeat !== minute)) {
              wlog._lastHeartbeat = minute;
              wlog(`[watchdog] él, aktív host: ${lock.hostname} (kor: ${Math.round(lastSeenAge/1000)}s, http: ${httpLabel}, relay: ${relayServer ? relayTargetHost : "nincs"})`);
            }
          }
        } else {
          stopRelay("server-state off");
        }
      } catch (error) {
        werr(`ciklus hiba: ${error.message}`);
      } finally {
        publishWatchdogStatus({ state: loopState, lock: loopLock, httpOk: loopHttpOk, lastSeenAge: loopLastSeenAge });
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
  })();
}

// CLI helpers that any PC can run without being the active host:
//   node server.js --state-off    → writes "run: false" to Y:\WorkshopERP\server-state.json
//                                   so every running host on any PC steps down.
//   node server.js --state-on     → writes "run: true" so new hosts may start.
//   node server.js --stop         → alias for --state-off.
const STATE_OFF_FLAGS = ["--state-off", "--stop"];
const STATE_ON_FLAGS = ["--state-on"];
const cliWantsStateOff = STATE_OFF_FLAGS.some((flag) => process.argv.includes(flag));
const cliWantsStateOn = STATE_ON_FLAGS.some((flag) => process.argv.includes(flag));
if (process.argv.includes("--register-host")) {
  try {
    resolveWorkingDirForCli(); // exact canonical mapping, no fallback or business DB write
    hostEnrollment.install(os.hostname(), process.env.INSTALL_VERSION || "install-startup.bat");
    console.log("[host-enrollment] PC ujraengedelyezve: " + os.hostname());
    process.exit(0);
  } catch (error) {
    console.error("[host-enrollment] regisztracio sikertelen:", error.message);
    process.exit(1);
  }
}
if (cliWantsStateOff || cliWantsStateOn) {
  try {
    effectiveWorkingDirectory = resolveWorkingDirForCli();
    dataDirectory = path.join(effectiveWorkingDirectory, "data");
    const source = `${os.hostname()} (CLI)`;
    if (cliWantsStateOff) {
      writeServerState(false, source);
      // Also bump the host-lock generation so existing hosts see the change
      // immediately on their next poll (regardless of state-file caching).
      const existing = readHostLock();
      const gen = (Number(existing?.generation) || 0) + 1;
      writeHostLock({
        hostname: "STOP",
        pid: 0,
        generation: gen,
        startedAt: nowIso(),
        lastSeen: nowIso(),
        stop: true
      });
      console.log(`[server-state] run=false kiírva (${source}). Minden futó host leáll.`);
    } else {
      writeServerState(true, source);
      console.log(`[server-state] run=true kiírva (${source}). Új host indítható.`);
    }
    process.exit(0);
  } catch (error) {
    console.error("[server-state] CLI kiírás sikertelen:", error.message);
    process.exit(1);
  }
}

function id() {
  return crypto.randomUUID();
}

function loadJson(filePath, fallback) {
  try {
    return { ...fallback, ...JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    return { ...fallback };
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf8");
}

function sqlitePragmaValue(row, fallbackKey) {
  if (!row || typeof row !== "object") return "";
  if (row[fallbackKey] !== undefined) return String(row[fallbackKey]);
  const firstKey = Object.keys(row)[0];
  return firstKey ? String(row[firstKey]) : "";
}

function cleanupSqliteWalSidecars(targetPath) {
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${targetPath}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    try {
      fs.unlinkSync(sidecar);
      console.log(`[sqlite] stale sidecar torolve: ${sidecar}`);
    } catch (error) {
      console.error(`[sqlite] stale sidecar nem torolheto (${sidecar}):`, error.message);
    }
  }
}

function configureSqlitePragmas(handle, targetPath) {
  try {
    handle.exec(`PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS}`);
    handle.exec("PRAGMA foreign_keys = OFF");
    handle.exec("PRAGMA locking_mode = NORMAL");
    handle.exec("PRAGMA temp_store = MEMORY");
  } catch (error) {
    console.error("SQLite alap pragma hiba:", error.message);
  }

  let checkpointOk = true;
  try {
    const currentMode = sqlitePragmaValue(handle.prepare("PRAGMA journal_mode").get(), "journal_mode").toLowerCase();
    if (currentMode === "wal") {
      const checkpoint = handle.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
      checkpointOk = Number(checkpoint?.busy || 0) === 0;
      if (!checkpointOk) {
        console.error("[sqlite] WAL checkpoint busy, sidecar cleanup kihagyva.");
      }
    }
  } catch (error) {
    checkpointOk = false;
    console.error("SQLite WAL checkpoint hiba:", error.message);
  }

  try {
    const row = handle.prepare(`PRAGMA journal_mode = ${SQLITE_JOURNAL_MODE}`).get();
    const actualMode = sqlitePragmaValue(row, "journal_mode").toLowerCase();
    console.log(`[sqlite] journal_mode=${actualMode || "ismeretlen"}, busy_timeout=${SQLITE_BUSY_TIMEOUT_MS}ms`);
    handle.exec("PRAGMA synchronous = FULL");
    if (actualMode !== "wal" && checkpointOk) cleanupSqliteWalSidecars(targetPath);
  } catch (error) {
    console.error("SQLite journal pragma hiba:", error.message);
  }
}

function openSqliteAt(targetPath) {
  if (!fs.existsSync(targetPath)) throw new Error(`ERP database missing/unavailable; refusing to create a blank replacement: ${targetPath}`);
  const handle = new DatabaseSync(targetPath);
  configureSqlitePragmas(handle, targetPath);
  for (const name of SQLITE_COLLECTIONS) {
    handle.exec(`CREATE TABLE IF NOT EXISTS ${name} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  }
  handle.exec(`CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
  handle.exec(`CREATE TABLE IF NOT EXISTS singletons (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  return handle;
}

function runInTransaction(handle, fn) {
  handle.exec("BEGIN");
  try {
    fn();
    handle.exec("COMMIT");
  } catch (error) {
    try { handle.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function isSqliteEmpty(handle) {
  for (const name of [...SQLITE_COLLECTIONS, "projects", "singletons"]) {
    const row = handle.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get();
    if (row) return false;
  }
  return true;
}

function loadDbFromSqlite(handle) {
  const result = defaultDb();
  for (const name of SQLITE_COLLECTIONS) {
    const rows = handle.prepare(`SELECT data FROM ${name}`).all();
    result[name] = rows
      .map((row) => {
        try {
          return JSON.parse(row.data);
        } catch {
          return null;
        }
      })
      .filter((value) => value !== null);
  }
  result.projects = {};
  const projectRows = handle.prepare(`SELECT data FROM projects`).all();
  for (const row of projectRows) {
    try {
      const project = JSON.parse(row.data);
      if (project && project.id) result.projects[project.id] = project;
    } catch {
      // skip corrupt project row
    }
  }
  const singletonRows = handle.prepare(`SELECT key, value FROM singletons`).all();
  for (const row of singletonRows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      // keep default
    }
  }
  return result;
}

function writeDbToSqlite(handle, snapshot) {
  storageGuard.save(handle, () => {
    for (const name of SQLITE_COLLECTIONS) {
      handle.prepare(`DELETE FROM ${name}`).run();
      const items = Array.isArray(snapshot[name]) ? snapshot[name] : [];
      if (!items.length) continue;
      const insert = handle.prepare(`INSERT INTO ${name} (id, data) VALUES (?, ?)`);
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const rowId = String(item.id || crypto.randomUUID());
        insert.run(rowId, JSON.stringify(item));
      }
    }
    handle.prepare(`DELETE FROM projects`).run();
    const insertProject = handle.prepare(`INSERT INTO projects (id, data) VALUES (?, ?)`);
    for (const project of Object.values(snapshot.projects || {})) {
      if (!project || !project.id) continue;
      insertProject.run(String(project.id), JSON.stringify(project));
    }
    const upsert = handle.prepare(`INSERT INTO singletons (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
    for (const key of SQLITE_SINGLETONS) {
      if (snapshot[key] === undefined) continue;
      upsert.run(key, JSON.stringify(snapshot[key]));
    }
  });
}

function importLegacyJsonIfPresent(handle, dataDir) {
  const legacyPath = path.join(dataDir, "erp-data.json");
  if (!fs.existsSync(legacyPath)) return false;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(legacyPath, "utf8"));
  } catch (error) {
    console.error("Nem sikerult olvasni az erp-data.json fajlt importhoz:", error.message);
    return false;
  }
  const merged = { ...defaultDb(), ...raw };
  if (!merged.projects || typeof merged.projects !== "object") merged.projects = {};
  writeDbToSqlite(handle, merged);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 10);
  const archive = path.join(dataDir, `erp-data.json.imported-${stamp}`);
  try {
    if (fs.existsSync(archive)) {
      const altArchive = path.join(dataDir, `erp-data.json.imported-${stamp}-${Date.now()}`);
      fs.renameSync(legacyPath, altArchive);
      console.log(`Adatok importalva SQLite-ba. Eredeti: ${altArchive}`);
    } else {
      fs.renameSync(legacyPath, archive);
      console.log(`Adatok importalva SQLite-ba. Eredeti: ${archive}`);
    }
  } catch (error) {
    console.error("Nem sikerult atnevezni az erp-data.json fajlt:", error.message);
  }
  return true;
}

function computeFingerprint(snapshot) {
  const hash = crypto.createHash("md5");
  for (const name of SQLITE_COLLECTIONS) {
    hash.update(name);
    hash.update(JSON.stringify(snapshot[name] || []));
  }
  hash.update("projects");
  hash.update(JSON.stringify(snapshot.projects || {}));
  for (const key of SQLITE_SINGLETONS) {
    if (key === "ipHistory") continue; // bumps every request, do not trigger SSE pushes
    hash.update(key);
    hash.update(JSON.stringify(snapshot[key] ?? null));
  }
  return hash.digest("hex");
}

function broadcastChange() {
  if (sseBroadcastTimer) return;
  sseBroadcastTimer = setTimeout(() => {
    sseBroadcastTimer = null;
    if (!sseClients.size) return;
    const payload = `event: state-changed\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch {
        sseClients.delete(client);
      }
    }
  }, 120);
}

function handleSseConnect(req, res, context = {}) {
  const ctx = currentSession(req, context);
  if (!ctx) {
    return sendAuthRequired(res);
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("retry: 4000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ at: nowIso() })}\n\n`);
  res.__erpClientIp = clientIpFor(req, context);
  res.__erpSessionToken = ctx.token;
  sseClients.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
      const linked = sessions.get(res.__erpSessionToken);
      if (linked) linked.lastSeen = Date.now();
    } catch {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 25000);
  const cleanup = () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  };
  req.on("close", cleanup);
  req.on("error", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}

function defaultDb() {
  return {
    version: 1,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    security: {
      passwordHash: "",
      passwordSalt: "",
      passwordIterations: 210000,
      updatedAt: "",
      lockdownAllowlist: []
    },
    blockedIps: [],
    users: [],
    materialNames: ["S235", "42CrMo4+QT", "AlMgSi1", "C45", "Rozsdamentes acél"],
    materialTypes: ["hidegen húzott rúd", "lemez", "tömb", "cső", "laposacél"],
    materialLengths: [],
    externalCompanies: [],
    prefabTaskTypes: [],
    workTypes: [
      "Megmunkálás",
      "Polírozás",
      "Szerelés (mechanikus)",
      "Szerelés (elektromos)",
      "Kapcsolószekrény készítés",
      "Szállítás",
      "PLC programozás",
      "3D Tervezés"
    ],
    fastenerTypes: ["csavar", "anya", "alátét", "rugós alátét", "menetes szár", "süllyesztett csavar", "imbusz csavar", "szegecs"],
    fastenerGrades: ["4.6", "4.8", "5.6", "5.8", "6.8", "8.8", "10.9", "12.9", "A2-70", "A4-70", "A4-80"],
    fastenerSizes: [],
    toolNames: [],
    projects: {},
    dashboardTodos: [],
    meetings: [],
    dayOffs: [],
    tasks: [],
    cncTasks: [],
    cncMachines: [],
    boms: [],
    cadModels: [],
    toolRequests: [],
    materialRequests: [],
    fastenerRequests: [],
    workLogs: [],
    files: [],
    pushSubscriptions: [],
    notifications: [],
    projectNotices: [],
    projectFolderExclusions: [],
    protectedSecurity: {
      passwordHash: "",
      passwordSalt: "",
      passwordIterations: 210000,
      updatedAt: ""
    },
    notificationSecurity: {
      vapidPublicJwk: null,
      vapidPrivateJwk: null,
      vapidPublicKey: "",
      createdAt: ""
    },
    financeSuppliers: [],
    financePriceItems: [],
    financeCostItems: [],
    financeOutsourceItems: [],
    financeProductionItems: [],
    engineeringDesignItems: [],
    financeQuotes: [],
    engineeringNotes: [],
    archives: [],
    financeSettings: {
      categories: ["Anyag", "Szerszám", "CNC", "Alvállalkozó", "Szállítás", "Egyéb"],
      currencies: ["HUF", "EUR"],
      statuses: ["Tervezett", "Rendelve", "Beérkezett", "Számlázva"],
      quoteStatuses: ["Bekérve", "Beérkezett", "Elfogadva", "Elutasítva", "Lejárt"],
      noteTypes: ["Döntés", "Változás", "Kockázat", "Kérdés", "Ellenőrzés"],
      noteStatuses: ["Nyitott", "Folyamatban", "Lezárva"],
      outsourceOperations: ["Fűrészelés", "Huzalszikra", "Hőkezelés", "Felületkezelés", "Köszörülés", "Vízvágás"],
      outsourceStatuses: ["Új", "Kiadva", "Folyamatban", "Visszaérkezett", "Kész"],
      productionOperations: ["Fűrészelés", "CNC marás", "CNC eszterga", "Huzalszikra", "Szerelés", "Lakatos munka"],
      productionWorkplaces: ["CNC-01", "CNC-02", "Külső"],
      productionTypes: ["Belső", "Külső"],
      productionPriorities: ["Magas", "Normál", "Alacsony"],
      productionStatuses: ["Új", "Folyamatban", "Kiadva", "Kész"],
      costCategories: ["Anyag", "Bérmunka", "Szerszám", "CNC", "Mérnöki", "Szállítás", "Egyéb"],
      designAreas: ["Mechanika CAD", "CAD/CAM", "Villamos tervezés", "PLC", "Dokumentáció"],
      designStatuses: ["Új", "Jóváhagyásra vár", "NC kiadva", "EPLAN kész", "Kiadva", "Kész"]
    }
  };
}

function ensureDirWritable(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.accessSync(dir, fs.constants.W_OK);
}

function selectWorkingDirectory(preferred) {
  const target = assertCanonicalWorkingDirectory(preferred);
  fs.accessSync(path.join(target, "data"), fs.constants.R_OK | fs.constants.W_OK);
  fs.accessSync(path.join(target, "uploads"), fs.constants.R_OK | fs.constants.W_OK);
  usingFallbackDirectory = false;
  return target;
}

function configureStorage(preferredDirectory, keepExistingData = false) {
  // Settings updates must keep the original baseline/owner, not re-claim
  // storage and make a stale RAM snapshot appear current.
  if (keepExistingData && sqlite) {
    assertCanonicalWorkingDirectory(preferredDirectory);
    saveDb();
    return;
  }
  effectiveWorkingDirectory = selectWorkingDirectory(preferredDirectory);
  dataDirectory = path.join(effectiveWorkingDirectory, "data");
  uploadsDirectory = path.join(effectiveWorkingDirectory, "uploads");
  dbPath = path.join(dataDirectory, "erp-data.json");
  sqlitePath = path.join(dataDirectory, "erp.db");

  if (sqlite) {
    try {
      sqlite.close();
    } catch {
      // ignore
    }
    sqlite = null;
  }
  sqlite = openSqliteAt(sqlitePath);

  if (isSqliteEmpty(sqlite)) {
    throw new Error("ERP database is empty; refusing automatic replacement/import in production.");
  }
  db = storageGuard.claimAndLoad(sqlite, () => loadDbFromSqlite(sqlite), {
    hostname: os.hostname(), pid: process.pid, generation: hostGeneration, startedAt: hostStartedAt
  }, () => {
    const lock = readHostLock();
    if (!lock || lock.hostname !== os.hostname() || Number(lock.pid) !== process.pid || Number(lock.generation) !== hostGeneration) {
      throw new Error("Storage claim refused: this process does not own the host lock.");
    }
    if (!readServerState().run) throw new Error("Storage claim refused: ERP is stopped.");
  });
  db.projects = db.projects || {};
  db.users = db.users || [];
  db.materialNames = db.materialNames || [];
  db.materialTypes = db.materialTypes || [];
  db.materialLengths = Array.isArray(db.materialLengths) ? db.materialLengths : [];
  db.externalCompanies = Array.isArray(db.externalCompanies) ? db.externalCompanies : [];
  db.prefabTaskTypes = Array.isArray(db.prefabTaskTypes) ? db.prefabTaskTypes : [];
  const defaults = defaultDb();
  if (!Array.isArray(db.workTypes) || !db.workTypes.length) db.workTypes = defaults.workTypes;
  if (!Array.isArray(db.fastenerTypes) || !db.fastenerTypes.length) db.fastenerTypes = defaults.fastenerTypes;
  if (!Array.isArray(db.fastenerGrades) || !db.fastenerGrades.length) db.fastenerGrades = defaults.fastenerGrades;
  if (!Array.isArray(db.fastenerSizes)) db.fastenerSizes = [];
  if (!Array.isArray(db.toolNames)) db.toolNames = [];
  db.dashboardTodos = db.dashboardTodos || [];
  db.meetings = db.meetings || [];
  db.tasks = db.tasks || [];
  db.cncTasks = db.cncTasks || [];
  db.cncMachines = db.cncMachines || [];
  db.boms = db.boms || [];
  db.toolRequests = db.toolRequests || [];
  db.materialRequests = db.materialRequests || [];
  db.fastenerRequests = db.fastenerRequests || [];
  db.workLogs = db.workLogs || [];
  db.files = db.files || [];
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  db.projectNotices = Array.isArray(db.projectNotices) ? db.projectNotices : [];
  db.projectFolderExclusions = db.projectFolderExclusions || [];
  db.security = db.security || {
    passwordHash: "",
    passwordSalt: "",
    passwordIterations: 210000,
    updatedAt: ""
  };
  db.security.passwordIterations = Number(db.security.passwordIterations) || 210000;
  db.security.lockdownAllowlist = Array.isArray(db.security.lockdownAllowlist) ? db.security.lockdownAllowlist : [];
  delete db.security.lockdownMode;
  db.blockedIps = Array.isArray(db.blockedIps) ? db.blockedIps : [];
  db.ipHistory = Array.isArray(db.ipHistory) ? db.ipHistory : [];
  db.protectedSecurity = db.protectedSecurity || {
    passwordHash: "",
    passwordSalt: "",
    passwordIterations: 210000,
    updatedAt: ""
  };
  db.protectedSecurity.passwordIterations = Number(db.protectedSecurity.passwordIterations) || 210000;
  db.financeSuppliers = db.financeSuppliers || [];
  db.financePriceItems = db.financePriceItems || [];
  db.financeCostItems = db.financeCostItems || [];
  db.financeOutsourceItems = db.financeOutsourceItems || [];
  db.financeProductionItems = db.financeProductionItems || [];
  db.engineeringDesignItems = db.engineeringDesignItems || [];
  db.financeQuotes = db.financeQuotes || [];
  db.engineeringNotes = db.engineeringNotes || [];
  db.archives = db.archives || [];
  db.financeSettings = {
    categories: ["Anyag", "Szerszám", "CNC", "Alvállalkozó", "Szállítás", "Egyéb"],
    currencies: ["HUF", "EUR"],
    statuses: ["Tervezett", "Rendelve", "Beérkezett", "Számlázva"],
    quoteStatuses: ["Bekérve", "Beérkezett", "Elfogadva", "Elutasítva", "Lejárt"],
    noteTypes: ["Döntés", "Változás", "Kockázat", "Kérdés", "Ellenőrzés"],
    noteStatuses: ["Nyitott", "Folyamatban", "Lezárva"],
    outsourceOperations: ["Fűrészelés", "Huzalszikra", "Hőkezelés", "Felületkezelés", "Köszörülés", "Vízvágás"],
    outsourceStatuses: ["Új", "Kiadva", "Folyamatban", "Visszaérkezett", "Kész"],
    productionOperations: ["Fűrészelés", "CNC marás", "CNC eszterga", "Huzalszikra", "Szerelés", "Lakatos munka"],
    productionWorkplaces: ["CNC-01", "CNC-02", "Külső"],
    productionTypes: ["Belső", "Külső"],
    productionPriorities: ["Magas", "Normál", "Alacsony"],
    productionStatuses: ["Új", "Folyamatban", "Kiadva", "Kész"],
    costCategories: ["Anyag", "Bérmunka", "Szerszám", "CNC", "Mérnöki", "Szállítás", "Egyéb"],
    designAreas: ["Mechanika CAD", "CAD/CAM", "Villamos tervezés", "PLC", "Dokumentáció"],
    designStatuses: ["Új", "Jóváhagyásra vár", "NC kiadva", "EPLAN kész", "Kiadva", "Kész"],
    ...(db.financeSettings || {})
  };
  ensureNotificationData();
  ensureUserSecurity();
  ensurePasswordReminderLegacyBaseline();
  saveDb();
}

function isRecoverableSqliteError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  const code = String(error?.code || "").toUpperCase();
  return code.includes("SQLITE_IOERR") ||
    code.includes("SQLITE_BUSY") ||
    message.includes("disk i/o") ||
    message.includes("database is locked") ||
    message.includes("database is busy") ||
    message.includes("unable to open database file");
}

function closeSqliteHandle(reason = "") {
  if (!sqlite) return;
  try {
    sqlite.close();
    if (reason) console.error(`[sqlite] kapcsolat ujranyitashoz bezarva: ${reason}`);
  } catch (error) {
    console.error("[sqlite] kapcsolat bezarasi hiba:", error.message);
  } finally {
    sqlite = null;
  }
}

function blockingSleep(ms) {
  const buffer = new SharedArrayBuffer(4);
  const view = new Int32Array(buffer);
  Atomics.wait(view, 0, 0, ms);
}

function saveDb() {
  if (isShuttingDown) throw Object.assign(new Error("A szerver ujraindul. A mentes nem tortent meg; probald ujra ujratoltes utan."), {httpStatus:503});
  try {
    db.updatedAt = nowIso();
    if (!sqlite) {
      sqlite = openSqliteAt(sqlitePath || path.join(dataDirectory || ".", "erp.db"));
    }
    for (let attempt = 1; attempt <= SQLITE_SAVE_MAX_ATTEMPTS; attempt += 1) {
      try {
        writeDbToSqlite(sqlite, db);
        break;
      } catch (error) {
        console.error(`SQLite mentes hiba (${attempt}/${SQLITE_SAVE_MAX_ATTEMPTS}):`, error.message);
        if (attempt >= SQLITE_SAVE_MAX_ATTEMPTS || !isRecoverableSqliteError(error)) {
          throw error;
        }
        closeSqliteHandle(error.message);
        blockingSleep(SQLITE_SAVE_RETRY_DELAY_MS);
        sqlite = openSqliteAt(sqlitePath || path.join(dataDirectory || ".", "erp.db"));
      }
    }
    const fingerprint = computeFingerprint(db);
    if (fingerprint !== lastBroadcastFingerprint) {
      lastBroadcastFingerprint = fingerprint;
      broadcastChange();
    }
  } catch (error) {
    // Do not leave a failed request in RAM to be silently committed by a
    // later unrelated request. A fresh host must reload the durable database.
    console.error("[storage-safety] write stopped:", error.code || "", error.message);
    shutdownHost("database write safety: " + error.message);
    error.httpStatus = 503;
    throw error;
  }
}

function checkpointWal() {
  if (!sqlite) return;
  try {
    sqlite.exec("PRAGMA optimize");
  } catch (error) {
    console.error("SQLite karbantartasi hiba:", error.message);
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex"), iterations = 210000) {
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, 32, "sha256").toString("hex");
  return { salt, hash, iterations };
}

function passwordMatches(record, password) {
  if (!record?.passwordHash || !record?.passwordSalt) return false;
  const result = hashPassword(password, record.passwordSalt, Number(record.passwordIterations) || 210000);
  try {
    return crypto.timingSafeEqual(Buffer.from(result.hash, "hex"), Buffer.from(record.passwordHash, "hex"));
  } catch {
    return false;
  }
}

function normalizeClearanceLevel(value) {
  return Number(value) >= 2 ? 2 : 1;
}

function assignUserPassword(user, password) {
  const clean = String(password || "");
  if (clean.length < 4) throw new Error("A felhasználói jelszó legalább 4 karakter legyen.");
  const result = hashPassword(clean);
  user.passwordHash = result.hash;
  user.passwordSalt = result.salt;
  user.passwordIterations = result.iterations;
  user.passwordUpdatedAt = nowIso();
}

function setUserPassword(user, password) {
  assignUserPassword(user, password);
  saveDb();
}

function verifyUserPassword(user, password) {
  return passwordMatches(user, password);
}

function ensureNamedUser(name, clearanceLevel) {
  const existing = db.users.find((user) => normalizeKey(user.name) === normalizeKey(name));
  if (existing) {
    existing.clearanceLevel = Math.max(normalizeClearanceLevel(existing.clearanceLevel), normalizeClearanceLevel(clearanceLevel));
    return existing;
  }
  const user = { id: id(), name, createdAt: nowIso(), clearanceLevel: normalizeClearanceLevel(clearanceLevel) };
  assignUserPassword(user, DEFAULT_USER_PASSWORD);
  db.users.push(user);
  return user;
}

// Hidden service login for the modelling photo page. Not listed anywhere
// (publicUsers filters hidden users), so it can't be picked in the login
// dropdown — reachable only by opening /modelling and typing the Admin
// user's password.
const MODELLING_USER_ID = "modelling";

function ensureModellingUser() {
  let user = db.users.find((item) => item.id === MODELLING_USER_ID);
  if (!user) {
    user = { id: MODELLING_USER_ID, name: "modelling", createdAt: nowIso() };
    db.users.push(user);
  }
  user.name = "modelling";
  user.hidden = true;
  user.clearanceLevel = 1;
  return user;
}

function findAdminUser() {
  return db.users.find((item) => normalizeKey(item.name) === normalizeKey("Admin"))
    || db.users.find((item) => normalizeClearanceLevel(item.clearanceLevel) >= 2 && !item.hidden)
    || null;
}

const NOTIFICATION_DETAIL_LEVELS = new Set(["brief", "normal", "detailed"]);
const NOTIFICATION_MENU_KEYS = Object.freeze([
  "dashboard",
  "project-view",
  "cnc-summary",
  "todos",
  "cnc",
  "tools",
  "materials",
  "fasteners",
  "worklog",
  "bom",
  "finance"
]);
const NOTIFICATION_DEFAULT_MENU_SETTINGS = Object.freeze(Object.fromEntries(NOTIFICATION_MENU_KEYS.map((key) => [key, true])));
const NOTIFICATION_DEFAULT_SETTINGS = Object.freeze({
  enabled: false,
  detailLevel: "normal",
  menuNotifications: NOTIFICATION_DEFAULT_MENU_SETTINGS,
  passwordReminder: true
});

function normalizeNotificationMenuSettings(input = {}, legacy = {}) {
  const source = input && typeof input === "object" ? input : {};
  const out = {};
  for (const key of NOTIFICATION_MENU_KEYS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key] !== false;
    else if (key === "worklog" && Object.prototype.hasOwnProperty.call(legacy, "worklogCreated")) out[key] = legacy.worklogCreated !== false;
    else out[key] = true;
  }
  return out;
}

function notificationMenuEnabled(settings, key) {
  return settings?.menuNotifications?.[key] !== false;
}

function normalizeNotificationSettings(input = {}) {
  const source = input && typeof input === "object" ? input : {};
  const detailLevel = NOTIFICATION_DETAIL_LEVELS.has(source.detailLevel) ? source.detailLevel : NOTIFICATION_DEFAULT_SETTINGS.detailLevel;
  return {
    enabled: Boolean(source.enabled),
    detailLevel,
    menuNotifications: normalizeNotificationMenuSettings(source.menuNotifications, source),
    passwordReminder: true
  };
}

function notificationSettingsForUser(user) {
  if (!user) return normalizeNotificationSettings();
  user.notificationSettings = normalizeNotificationSettings(user.notificationSettings || {});
  return user.notificationSettings;
}

function base64UrlEncode(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64UrlDecode(value) {
  let text = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  return Buffer.from(text, "base64");
}

function jwkPublicKeyToRaw(jwk) {
  if (!jwk?.x || !jwk?.y) return Buffer.alloc(0);
  return Buffer.concat([Buffer.from([0x04]), base64UrlDecode(jwk.x), base64UrlDecode(jwk.y)]);
}

function ensureNotificationSecurity() {
  db.notificationSecurity = db.notificationSecurity && typeof db.notificationSecurity === "object" ? db.notificationSecurity : {};
  if (db.notificationSecurity.vapidPrivateJwk?.d && db.notificationSecurity.vapidPublicJwk?.x && db.notificationSecurity.vapidPublicKey) return;
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicJwk = publicKey.export({ format: "jwk" });
  const privateJwk = privateKey.export({ format: "jwk" });
  db.notificationSecurity = {
    vapidPublicJwk: publicJwk,
    vapidPrivateJwk: privateJwk,
    vapidPublicKey: base64UrlEncode(jwkPublicKeyToRaw(publicJwk)),
    createdAt: nowIso()
  };
}

function ensureNotificationData() {
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  ensureNotificationSecurity();
  pruneStoredNotifications();
}

function vapidPublicKey() {
  ensureNotificationSecurity();
  return db.notificationSecurity.vapidPublicKey || "";
}

function readDerLength(buffer, offset) {
  let length = buffer[offset];
  offset += 1;
  if ((length & 0x80) === 0) return { length, offset };
  const bytes = length & 0x7f;
  length = 0;
  for (let i = 0; i < bytes; i += 1) {
    length = (length << 8) | buffer[offset + i];
  }
  return { length, offset: offset + bytes };
}

function derIntegerToJose(bytes, size = 32) {
  let value = Buffer.from(bytes);
  while (value.length > 0 && value[0] === 0) value = value.slice(1);
  if (value.length > size) value = value.slice(value.length - size);
  if (value.length < size) value = Buffer.concat([Buffer.alloc(size - value.length), value]);
  return value;
}

function derEcdsaSignatureToJose(signature) {
  const buffer = Buffer.from(signature);
  let offset = 0;
  if (buffer[offset] !== 0x30) throw new Error("Invalid ECDSA signature.");
  offset += 1;
  const seq = readDerLength(buffer, offset);
  offset = seq.offset;
  if (buffer[offset] !== 0x02) throw new Error("Invalid ECDSA signature r.");
  offset += 1;
  const rLen = readDerLength(buffer, offset);
  offset = rLen.offset;
  const r = buffer.slice(offset, offset + rLen.length);
  offset += rLen.length;
  if (buffer[offset] !== 0x02) throw new Error("Invalid ECDSA signature s.");
  offset += 1;
  const sLen = readDerLength(buffer, offset);
  offset = sLen.offset;
  const s = buffer.slice(offset, offset + sLen.length);
  return Buffer.concat([derIntegerToJose(r), derIntegerToJose(s)]);
}

function vapidJwtForEndpoint(endpoint) {
  ensureNotificationSecurity();
  const aud = new URL(endpoint).origin;
  const header = base64UrlEncode(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const payload = base64UrlEncode(JSON.stringify({
    aud,
    exp: Math.floor(Date.now() / 1000) + 12 * 60 * 60,
    sub: "mailto:erp@example.invalid"
  }));
  const signingInput = `${header}.${payload}`;
  const key = crypto.createPrivateKey({ key: db.notificationSecurity.vapidPrivateJwk, format: "jwk" });
  const signature = crypto.createSign("SHA256").update(signingInput).end().sign(key);
  return `${signingInput}.${base64UrlEncode(derEcdsaSignatureToJose(signature))}`;
}

function pushSubscriptionId(endpoint) {
  return crypto.createHash("sha256").update(String(endpoint || "")).digest("hex").slice(0, 32);
}

function activePushSubscriptionsForUser(userId) {
  return (db.pushSubscriptions || []).filter((item) => item && !item.disabled && item.userId === userId && item.endpoint && item.keys?.p256dh && item.keys?.auth);
}

function upsertPushSubscription(user, subscription, req, context = {}) {
  if (!user) throw new Error("Nincs bejelentkezett felhasznalo.");
  const endpoint = String(subscription?.endpoint || "").trim();
  if (!endpoint || !endpoint.startsWith("https://")) throw new Error("Ervenytelen push subscription endpoint.");
  const keys = subscription?.keys || {};
  if (!keys.p256dh || !keys.auth) throw new Error("Hianyos push subscription kulcsok.");
  db.pushSubscriptions = Array.isArray(db.pushSubscriptions) ? db.pushSubscriptions : [];
  const subId = pushSubscriptionId(endpoint);
  const now = nowIso();
  let item = db.pushSubscriptions.find((entry) => entry.id === subId || entry.endpoint === endpoint);
  if (!item) {
    item = { id: subId, createdAt: now };
    db.pushSubscriptions.push(item);
  }
  item.userId = user.id;
  item.endpoint = endpoint;
  item.keys = { p256dh: String(keys.p256dh), auth: String(keys.auth) };
  item.expirationTime = subscription.expirationTime || null;
  item.userAgent = String(req.headers?.["user-agent"] || "").slice(0, 500);
  item.lastIp = clientIpFor(req, context);
  item.updatedAt = now;
  item.lastSeenAt = now;
  item.disabled = false;
  return item;
}

function disablePushSubscription(endpoint, userId = "") {
  const clean = String(endpoint || "").trim();
  if (!clean) return false;
  let changed = false;
  for (const item of db.pushSubscriptions || []) {
    if (item.endpoint === clean && (!userId || item.userId === userId)) {
      item.disabled = true;
      item.disabledAt = nowIso();
      changed = true;
    }
  }
  return changed;
}

function latestNotificationForUser(userId) {
  const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
  return (db.notifications || [])
    .filter((item) => item?.userId === userId && Date.parse(item.createdAt || "") >= cutoff)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))[0] || null;
}

function pruneStoredNotifications() {
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  const cutoff = Date.now() - NOTIFICATION_RETENTION_MS;
  db.notifications = db.notifications
    .filter((item) => item && Date.parse(item.createdAt || "") >= cutoff)
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")))
    .slice(0, NOTIFICATION_MAX_STORED);
}

function createUserNotification(user, payload) {
  if (!user?.id) return null;
  const item = {
    id: id(),
    userId: user.id,
    type: String(payload.type || "info"),
    title: String(payload.title || "Workshop ERP"),
    body: String(payload.body || ""),
    url: String(payload.url || "/"),
    tag: String(payload.tag || payload.type || "erp"),
    createdAt: nowIso()
  };
  db.notifications = Array.isArray(db.notifications) ? db.notifications : [];
  db.notifications.unshift(item);
  pruneStoredNotifications();
  return item;
}

function sendWebPushSignal(subscription) {
  return new Promise((resolve) => {
    let endpoint;
    try {
      endpoint = new URL(subscription.endpoint);
    } catch (error) {
      return resolve({ ok: false, expired: true, statusCode: 0, error });
    }
    let jwt;
    try {
      jwt = vapidJwtForEndpoint(subscription.endpoint);
    } catch (error) {
      return resolve({ ok: false, expired: false, statusCode: 0, error });
    }
    const req = https.request(endpoint, {
      method: "POST",
      timeout: 8000,
      headers: {
        TTL: "604800",
        "Content-Length": "0",
        Authorization: `vapid t=${jwt}, k=${vapidPublicKey()}`,
        "Crypto-Key": `p256ecdsa=${vapidPublicKey()}`
      }
    }, (response) => {
      response.resume();
      const statusCode = Number(response.statusCode) || 0;
      resolve({ ok: statusCode >= 200 && statusCode < 300, expired: statusCode === 404 || statusCode === 410, statusCode });
    });
    req.on("timeout", () => req.destroy(new Error("push timeout")));
    req.on("error", (error) => resolve({ ok: false, expired: false, statusCode: 0, error }));
    req.end();
  });
}

async function sendPushSignalsForUsers(userIds) {
  const wanted = new Set((userIds || []).filter(Boolean));
  if (!wanted.size) return;
  let changed = false;
  for (const sub of db.pushSubscriptions || []) {
    if (!sub || sub.disabled || !wanted.has(sub.userId)) continue;
    const result = await sendWebPushSignal(sub);
    sub.lastPushAttemptAt = nowIso();
    sub.lastPushStatus = result.statusCode || 0;
    if (result.ok) sub.lastPushOkAt = sub.lastPushAttemptAt;
    if (result.expired) {
      sub.disabled = true;
      sub.disabledAt = nowIso();
      changed = true;
    }
    if (result.error) console.error("[push] kuldes hiba:", result.error.message || result.error);
  }
  if (changed) saveDb();
}

function queuePushSignalsForUsers(userIds) {
  const unique = [...new Set((userIds || []).filter(Boolean))];
  if (!unique.length) return;
  const timer = setTimeout(() => {
    sendPushSignalsForUsers(unique).catch((error) => console.error("[push] kuldes hiba:", error.message));
  }, 0);
  if (timer.unref) timer.unref();
}

function worklogIsCnc(log) {
  return Boolean(log?.cncMachineId || String(log?.workType || "").toLocaleLowerCase("hu-HU").includes("cnc"));
}

function notificationHours(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toLocaleString("hu-HU", { maximumFractionDigits: 2 })} ora` : "";
}

function worklogNotificationPayloadForUser(log, creator, targetUser, recipient) {
  const settings = notificationSettingsForUser(recipient);
  const actor = targetUser?.name || userName(log.userId) || creator?.name || "Felhasznalo";
  const workType = log.cncMachineName || log.workType || (worklogIsCnc(log) ? "CNC munka" : "Munkaido");
  const hours = notificationHours(log.hours);
  const project = log.projectName || "Projekt";
  let body = "Megnyitas az ERP-ben.";
  if (settings.detailLevel === "normal") body = [actor, workType, hours].filter(Boolean).join(" - ");
  if (settings.detailLevel === "detailed") body = [project, actor, workType, hours].filter(Boolean).join(" - ");
  return {
    type: "worklog.created",
    title: "Uj munkaido naplozas",
    body,
    url: "/?view=worklog",
    tag: `worklog-${log.id || Date.now()}`
  };
}

function collectWorklogCreatedNotifications(log, creator) {
  const targetUser = db.users.find((user) => user.id === log.userId) || null;
  const recipients = [];
  for (const user of db.users || []) {
    if (!user || user.hidden) continue;
    const settings = notificationSettingsForUser(user);
    if (!settings.enabled || !notificationMenuEnabled(settings, "worklog")) continue;
    if (!activePushSubscriptionsForUser(user.id).length) continue;
    createUserNotification(user, worklogNotificationPayloadForUser(log, creator, targetUser, user));
    recipients.push(user.id);
  }
  return recipients;
}

function userPasswordAgeMs(user, now = Date.now()) {
  const updated = Date.parse(user?.passwordUpdatedAt || user?.createdAt || "");
  return Number.isFinite(updated) ? now - updated : Infinity;
}

function passwordReminderRecentlySent(user, now = Date.now()) {
  const lastSent = Date.parse(user?.passwordReminderLastSentAt || "");
  return Number.isFinite(lastSent) && now - lastSent < PASSWORD_REMINDER_REPEAT_MS;
}

function passwordReminderDueForUser(user, now = Date.now()) {
  return userPasswordAgeMs(user, now) >= PASSWORD_REMINDER_PASSWORD_AGE_MS && !passwordReminderRecentlySent(user, now);
}

function createPasswordReminderNotification(user) {
  if (!user?.id) return false;
  createUserNotification(user, {
    type: "security.passwordReminder",
    title: "Jelszo frissites ajanlott",
    body: "Kerlek frissitsd az ERP jelszavadat. Ez az eves emlekezteto.",
    url: "/?view=stats&panel=password",
    tag: "password-reminder"
  });
  user.passwordReminderLastSentAt = nowIso();
  return true;
}

function collectPasswordReminderNotifications(reason = "") {
  const now = Date.now();
  const recipients = [];
  for (const user of db.users || []) {
    if (!user || user.hidden) continue;
    const settings = notificationSettingsForUser(user);
    if (!settings.enabled) continue;
    if (!passwordReminderDueForUser(user, now)) continue;
    if (!activePushSubscriptionsForUser(user.id).length) continue;
    if (createPasswordReminderNotification(user)) recipients.push(user.id);
  }
  if (recipients.length) console.log(`[push] jelszo emlekezteto: ${recipients.length} felhasznalo (${reason || "scheduled"})`);
  return recipients;
}

function runPasswordReminderCheck(reason = "scheduled") {
  try {
    const recipients = collectPasswordReminderNotifications(reason);
    if (!recipients.length) return;
    saveDb();
    queuePushSignalsForUsers(recipients);
  } catch (error) {
    console.error("[push] jelszo emlekezteto hiba:", error.message);
  }
}
function ensurePasswordReminderLegacyBaseline() {
  ensureNotificationSecurity();
  if (db.notificationSecurity.passwordReminderLegacyBaselineAt) return;
  const oldStamp = new Date(Date.now() - PASSWORD_REMINDER_PASSWORD_AGE_MS - 24 * 60 * 60 * 1000).toISOString();
  let touched = 0;
  for (const user of db.users || []) {
    if (!user || user.hidden) continue;
    user.passwordUpdatedAt = oldStamp;
    user.passwordReminderLastSentAt = "";
    user.notificationSettings = normalizeNotificationSettings(user.notificationSettings || {});
    touched += 1;
  }
  db.notificationSecurity.passwordReminderLegacyBaselineAt = nowIso();
  db.notificationSecurity.passwordReminderLegacyBaselineValue = oldStamp;
  console.log(`[push] password reminder baseline set for ${touched} current users.`);
}
function ensureUserSecurity() {
  db.users = Array.isArray(db.users) ? db.users : [];
  for (const user of db.users) {
    user.id = user.id || id();
    user.name = String(user.name || "Felhasználó").trim() || "Felhasználó";
    user.createdAt = user.createdAt || nowIso();
    user.clearanceLevel = normalizeClearanceLevel(user.clearanceLevel);
    user.passwordIterations = Number(user.passwordIterations) || 210000;
    if (!user.passwordHash || !user.passwordSalt) assignUserPassword(user, DEFAULT_USER_PASSWORD);
    notificationSettingsForUser(user);
  }
  if (!db.users.filter((user) => !user.hidden).length) ensureNamedUser("Admin", 2);
  ensureModellingUser();
  db.users.sort((a, b) => a.name.localeCompare(b.name, "hu"));
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [part, ""];
      return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
    }));
}

function cookieHeader(name, value, maxAgeSeconds) {
  const pieces = [`${name}=${encodeURIComponent(value)}`, "HttpOnly", "SameSite=Lax", "Path=/"];
  if (Number.isFinite(maxAgeSeconds)) pieces.push(`Max-Age=${maxAgeSeconds}`);
  return pieces.join("; ");
}

function httpsCookieHeader(name, value, maxAgeSeconds, secure = false) {
  const header = cookieHeader(name, value, maxAgeSeconds);
  return secure ? `${header}; Secure` : header;
}

// Persistent (not session-only) cookie with a sliding Max-Age. Normal browser
// sessions keep the existing 12h window; installed PWA sessions are long-lived
// so users stay logged in until explicit logout.
function sessionMaxAgeMs(session = null) {
  return session && session.pwa ? PWA_SESSION_MAX_AGE_MS : SESSION_MAX_AGE_MS;
}

function sessionCookieMaxAgeSeconds(session = null) {
  return Math.floor(sessionMaxAgeMs(session) / 1000);
}

function setSessionCookie(res, token, context = {}, session = null) {
  res.setHeader("Set-Cookie", httpsCookieHeader(SESSION_COOKIE, token, sessionCookieMaxAgeSeconds(session), Boolean(context.https)));
}

// Re-issue the cookie on a request that already carries a valid session, so
// the browser's Max-Age window keeps sliding while the app is open (the
// client polls /api/state every 10-60s, so it never gets near expiry).
function renewSessionCookie(req, res, context = {}) {
  try {
    const token = parseCookies(req)[SESSION_COOKIE];
    const session = token ? sessions.get(token) : null;
    if (token && session) setSessionCookie(res, token, context, session);
  } catch { /* noop */ }
}

function publicUser(user, options = {}) {
  if (!user) return null;
  const result = {
    id: user.id,
    name: user.name,
    clearanceLevel: normalizeClearanceLevel(user.clearanceLevel),
    createdAt: user.createdAt || "",
    passwordUpdatedAt: user.passwordUpdatedAt || ""
  };
  if (options.private) {
    result.notificationSettings = notificationSettingsForUser(user);
    result.pushSubscriptionCount = activePushSubscriptionsForUser(user.id).length;
    result.passwordReminderDue = userPasswordAgeMs(user) >= PASSWORD_REMINDER_PASSWORD_AGE_MS;
  }
  return result;
}

function publicUsers() {
  return (db.users || []).filter((user) => !user.hidden).map(publicUser).filter(Boolean);
}

// --- Session persistence -------------------------------------------------
// Sessions live in RAM, but we mirror them to data/.sessions.json on the
// shared Y: drive. That file is loaded at host startup, so when the active
// host role moves between PCs (or the host process restarts), logged-in
// users keep their session instead of being kicked to the login screen.
// Only the active HTTP host (main()) ever loads/saves; the --watch-loop
// watchdog never touches sessions.
let sessionsDirty = false;
let sessionsLoaded = false;

function sessionsFilePath() {
  if (!dataDirectory) return null;
  return path.join(dataDirectory, ".sessions.json");
}

function markSessionsDirty() {
  sessionsDirty = true;
}

function loadSessions() {
  const filePath = sessionsFilePath();
  if (!filePath) return;
  sessionsLoaded = true;
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return; // no file yet — start empty
  }
  try {
    const parsed = JSON.parse(raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw);
    const stored = parsed && typeof parsed === "object" ? parsed.sessions : null;
    if (!stored || typeof stored !== "object") return;
    const now = Date.now();
    let loaded = 0;
    for (const [token, session] of Object.entries(stored)) {
      if (!token || !session || typeof session !== "object") continue;
      const lastSeen = Number(session.lastSeen) || 0;
      const loadedSession = {
        userId: String(session.userId || ""),
        createdAt: Number(session.createdAt) || lastSeen || now,
        lastSeen: lastSeen || now,
        ip: String(session.ip || ""),
        lastIp: String(session.lastIp || ""),
        userAgent: String(session.userAgent || ""),
        pwa: Boolean(session.pwa)
      };
      if (!loadedSession.userId || now - loadedSession.lastSeen > sessionMaxAgeMs(loadedSession)) continue;
      sessions.set(token, loadedSession);
      loaded += 1;
    }
    console.log(`[sessions] betöltve ${loaded} munkamenet a ${filePath} fájlból.`);
  } catch (error) {
    console.error("[sessions] betöltési hiba:", error.message);
  }
}

function saveSessions(force = false) {
  if (!force && !sessionsDirty) return;
  const filePath = sessionsFilePath();
  if (!filePath) return;
  try {
    const now = Date.now();
    const out = {};
    for (const [token, session] of sessions.entries()) {
      if (!session || now - (Number(session.lastSeen) || 0) > sessionMaxAgeMs(session)) continue;
      out[token] = session;
    }
    const payload = JSON.stringify({ updatedAt: nowIso(), sessions: out });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, filePath);
    sessionsDirty = false;
  } catch (error) {
    console.error("[sessions] mentési hiba:", error.message);
  }
}

function createSession(userId, meta = {}) {
  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, {
    userId,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    ip: meta.ip || "",
    lastIp: meta.ip || "",
    userAgent: meta.userAgent || "",
    pwa: Boolean(meta.pwa)
  });
  markSessionsDirty();
  return token;
}

function currentSession(req, context = {}) {
  const token = parseCookies(req)[SESSION_COOKIE];
  const session = token ? sessions.get(token) : null;
  if (!session) return null;
  if (Date.now() - session.lastSeen > sessionMaxAgeMs(session)) {
    sessions.delete(token);
    markSessionsDirty();
    return null;
  }
  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    sessions.delete(token);
    markSessionsDirty();
    return null;
  }
  session.lastSeen = Date.now();
  const ip = clientIpFor(req, context);
  if (ip) session.lastIp = ip;
  markSessionsDirty();
  return { token, session, user };
}

function isAuthenticated(req, context) {
  if (!authRequiredForContext(context)) return true;
  return Boolean(currentSession(req));
}

function authRequiredForContext(context = {}) {
  return true;
}

function currentUser(req) {
  return currentSession(req)?.user || null;
}

function userHasClearance(user, level) {
  return normalizeClearanceLevel(user?.clearanceLevel) >= level;
}

function canUseOvertimeFlag(user) {
  const id = normalizeKey(user?.id);
  const name = normalizeKey(user?.name);
  return id === "demouser" || id === "admin" || name === "demouser" || name === "admin";
}

function isNamedErpUser(user, expectedName) {
  const expected = normalizeKey(expectedName);
  return normalizeKey(user?.id) === expected || normalizeKey(user?.name) === expected;
}

function canViewOvertimeFlag(user, worklog) {
  if (canUseOvertimeFlag(user)) return true;
  if (!isNamedErpUser(user, "demo-supervisor") || !worklog) return false;
  const target = (db.users || []).find((entry) => String(entry.id) === String(worklog.userId || ""));
  return normalizeKey(worklog.userId) === "demouser"
    || isNamedErpUser(target, "demouser");
}

function sendAuthRequired(res) {
  sendJson(res, 401, { authRequired: true, passwordSet: true });
}

function sendClearanceRequired(res) {
  sendJson(res, 403, { clearanceRequired: true, error: "Nincs jogosultság ehhez a menühöz." });
}

function isDirectApiBrowserVisit(req, pathname) {
  if (req.method !== "GET") return false;
  if (!String(pathname || "").startsWith("/api/")) return false;
  const accept = String(req.headers?.accept || "").toLowerCase();
  if (!accept.includes("text/html")) return false;
  const mode = String(req.headers?.["sec-fetch-mode"] || "").toLowerCase();
  return !mode || mode === "navigate";
}

function isIntentionalBrowserApiPath(pathname) {
  return pathname.startsWith("/api/helper/") ||
    pathname.startsWith("/api/export/") ||
    pathname === "/api/cadmodels/viewer-source" ||
    /^\/api\/cadmodels\/[a-f0-9]{32}\/glb$/.test(pathname) ||
    /^\/api\/files\/[^/]+(\/preview|\/download)?$/.test(pathname) ||
    /^\/api\/boms\/[^/]+\/file$/.test(pathname) ||
    /^\/api\/projects\/[^/]+\/browser\/pdf$/.test(pathname) ||
    /^\/api\/dashboard\/todos\/[^/]+\/image$/.test(pathname) ||
    /^\/api\/tasks\/[^/]+\/images\/\d+$/.test(pathname) ||
    /^\/api\/cnc-tasks\/[^/]+\/images\/\d+$/.test(pathname) ||
    /^\/api\/material-requests\/[^/]+\/images\/\d+$/.test(pathname) ||
    /^\/api\/(tool-requests|material-requests|fastener-requests)\/[^/]+\/attachment\/(view|download)$/.test(pathname);
}

function sendApiBrowserPage(res) {
  const body = Buffer.from(`<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Workshop ERP API</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#f6f7f4;color:#071017;display:grid;place-items:center;min-height:100vh}
    main{max-width:520px;padding:28px;border:1px solid #d7ddd2;background:#f6f7f4}
    h1{margin:0 0 10px;font-size:28px}
    p{line-height:1.5;color:#46535c}
    a{display:inline-block;margin-top:14px;background:#ff6413;color:#fff;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:6px}
  </style>
</head>
<body>
  <main>
    <h1>ERP API</h1>
    <p>Ez egy belso adatutvonal. Nyisd meg a Workshop ERP fooldalat, ott tudsz bejelentkezni es dolgozni.</p>
    <a href="/">ERP megnyitasa</a>
  </main>
</body>
</html>`, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function clientIpFor(req, context = {}) {
  const headers = req.headers || {};
  const direct = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  // Cloudflare-fronted traffic (any port — users sometimes hit the public URL even from the LAN).
  // CF-Connecting-IP is Cloudflare's authoritative header for the original visitor IP.
  const cf = String(headers["cf-connecting-ip"] || "").trim().replace(/^::ffff:/, "");
  if (cf) return cf;
  // Honor X-Forwarded-For when the connection actually came through a trusted proxy
  // (the internet listener, or a localhost-bound tunnel like cloudflared).
  const trustForwarded = context.internet || direct === "127.0.0.1" || direct === "::1";
  if (trustForwarded) {
    const xff = String(headers["x-forwarded-for"] || "");
    if (xff) {
      const first = xff.split(",")[0].trim().replace(/^::ffff:/, "");
      if (first) return first;
    }
  }
  return direct || "unknown";
}

function isIpTrusted(ip) {
  if (!ip) return false;
  const list = Array.isArray(db?.security?.lockdownAllowlist) ? db.security.lockdownAllowlist : [];
  return list.includes(ip);
}

function recordLoginFailure(ip) {
  if (!ip || ip === "unknown") return false;
  if (isIpTrusted(ip)) return false;
  const current = failedLogins.get(ip) || { count: 0 };
  current.count += 1;
  failedLogins.set(ip, current);
  if (current.count >= 3) {
    db.blockedIps = Array.isArray(db.blockedIps) ? db.blockedIps : [];
    if (!db.blockedIps.some((entry) => entry && entry.ip === ip)) {
      db.blockedIps.push({
        ip,
        blockedAt: nowIso(),
        blockedBy: "auto",
        reason: "3 hibás jelszó"
      });
    }
    failedLogins.delete(ip);
    disconnectIp(ip);
    saveDb();
    return true;
  }
  return false;
}

function clearLoginFailure(ip) {
  if (!ip) return;
  failedLogins.delete(ip);
}

function recordLoginAttempt({ ip, kind, userId = "", userName = "", outcome }) {
  recentLoginAttempts.unshift({
    at: nowIso(),
    ip: ip || "unknown",
    kind,
    userId,
    userName,
    outcome
  });
  if (recentLoginAttempts.length > RECENT_LOGIN_LIMIT) {
    recentLoginAttempts.length = RECENT_LOGIN_LIMIT;
  }
}

function isIpBlocked(ip) {
  if (!ip) return false;
  if (isIpTrusted(ip)) return false;
  const list = Array.isArray(db?.blockedIps) ? db.blockedIps : [];
  return list.some((entry) => entry && entry.ip === ip);
}

function recordIpHit(ip, userAgent = "", userName = "") {
  if (!ip || ip === "unknown") return;
  if (!db) return;
  db.ipHistory = Array.isArray(db.ipHistory) ? db.ipHistory : [];
  const idx = db.ipHistory.findIndex((entry) => entry && entry.ip === ip);
  const now = nowIso();
  if (idx >= 0) {
    const entry = db.ipHistory[idx];
    entry.lastSeen = now;
    entry.hits = (Number(entry.hits) || 0) + 1;
    if (userAgent) entry.lastUserAgent = userAgent;
    if (userName) entry.lastUserName = userName;
  } else {
    db.ipHistory.push({
      ip,
      firstSeen: now,
      lastSeen: now,
      hits: 1,
      lastUserAgent: userAgent || "",
      lastUserName: userName || ""
    });
    if (db.ipHistory.length > IP_HISTORY_CAP) {
      db.ipHistory.sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
      db.ipHistory.length = IP_HISTORY_CAP;
    }
  }
  ipHistoryDirty = true;
}

function disconnectIp(ip) {
  let kicked = 0;
  for (const [token, session] of sessions.entries()) {
    if (session.ip === ip || session.lastIp === ip) {
      sessions.delete(token);
      kicked += 1;
    }
  }
  if (kicked) markSessionsDirty();
  for (const client of [...sseClients]) {
    if (client.__erpClientIp === ip) {
      try { client.end(); } catch { /* noop */ }
      sseClients.delete(client);
    }
  }
  return kicked;
}

function normalizeKey(value) {
  return String(value || "").trim().normalize("NFC").toLocaleLowerCase("hu-HU");
}

function booleanFlag(value) {
  return value === true || value === 1 || value === "1" || value === "true" || value === "on" || value === "yes";
}

function normalizeFsPath(value) {
  return path.resolve(String(value || "")).replace(/[\\/]+/g, "\\").toLocaleLowerCase("hu-HU");
}

function isExcluded(folderPath) {
  const normalized = normalizeFsPath(folderPath);
  const configured = (config.excludedPaths || []).some((excluded) => normalizeFsPath(excluded) === normalized);
  const erpDeleted = (db?.projectFolderExclusions || []).some((excluded) => normalizeFsPath(excluded) === normalized);
  return configured || erpDeleted;
}

function projectExportBaseName(project) {
  if (!project) return "projekt";
  const safeName = sanitizeFileName(project.name);
  if (project.company) {
    return `${sanitizeFileName(project.company)}_${safeName}`;
  }
  return safeName;
}

function sanitizeFileName(name) {
  const clean = String(name || "fajl")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "fajl";
}

function stampForPath(iso) {
  return String(iso || nowIso()).replace(/[:.]/g, "-");
}

function uniquePath(folder, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(folder, fileName);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folder, `${parsed.name}_${counter}${parsed.ext}`);
    counter += 1;
  }
  return candidate;
}

function findProjectByName(name) {
  const key = normalizeKey(name);
  const all = Object.values(db.projects);
  const exact = all.filter((project) => normalizeKey(project.name) === key);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const aliases = all.filter((project) => (project.nameAliases || []).some((alias) => normalizeKey(alias) === key));
  return aliases.length === 1 ? aliases[0] : null;
}

function makeProject(name, source, folderPath = null) {
  const createdAt = nowIso();
  const folderCompany = companyForFolderPath(folderPath);
  return {
    id: id(),
    name: String(name).trim(),
    source,
    manual: source === "manual",
    active: true,
    priority: null,
    completedAt: null,
    createdAt,
    discoveredAt: createdAt,
    folderAddedAt: createdAt,
    primaryFolder: folderPath,
    folderPaths: folderPath ? [folderPath] : [],
    folderMissing: false,
    storageFolder: null,
    responsibleUserIds: [],
    deadline: "",
    company: folderCompany,
    companyAuto: Boolean(folderCompany)
  };
}

const PROJECT_COMPANIES = ["Example Manufacturing Ltd", "Example Engineering Ltd"];

// Cég is decided by which scan root the project folder lives under.
// Prefix match runs on normalizeFsPath output (resolved, backslash-only,
// hu-HU lowercased), and the two roots are not prefixes of each other, so
// order here doesn't matter.
const PROJECT_COMPANY_FOLDER_MAP = [
  { prefix: "y:\\workshopprojects", company: "Example Manufacturing Ltd" },
  { prefix: "y:\\companyprojects", company: "Example Engineering Ltd" }
];

function companyForFolderPath(folderPath) {
  if (!folderPath) return "";
  const normalized = normalizeFsPath(folderPath);
  for (const entry of PROJECT_COMPANY_FOLDER_MAP) {
    if (normalized === entry.prefix || normalized.startsWith(`${entry.prefix}\\`)) {
      return entry.company;
    }
  }
  return "";
}

function deriveProjectCompany(project) {
  const candidates = [project?.primaryFolder, ...(project?.folderPaths || [])].filter(Boolean);
  for (const folderPath of candidates) {
    const company = companyForFolderPath(folderPath);
    if (company) return company;
  }
  return "";
}

function normalizeCompany(value) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  return PROJECT_COMPANIES.includes(clean) ? clean : "";
}

function ensureProjectFields(project) {
  if (!Array.isArray(project.responsibleUserIds)) project.responsibleUserIds = [];
  project.responsibleUserIds = project.responsibleUserIds.filter((userId, index, arr) =>
    isKnownUser(userId) && arr.indexOf(userId) === index
  );
  if (project.deadline === undefined || project.deadline === null) project.deadline = "";
  if (project.company === undefined || project.company === null) project.company = "";
  // Folder decides the company. A manually stored value only survives for
  // projects whose folder isn't under a mapped root (manual projects,
  // legacy paths). This also migrates every existing project the first
  // time the new code loads the db — no separate migration step needed.
  const derived = deriveProjectCompany(project);
  if (derived) {
    project.company = derived;
    project.companyAuto = true;
  } else {
    project.company = normalizeCompany(project.company);
    project.companyAuto = false;
  }
}

function ensureAllProjectFields() {
  for (const project of Object.values(db.projects || {})) {
    ensureProjectFields(project);
  }
}

function ensureManualProject(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const existing = findProjectByName(clean);
  if (existing) return existing;
  const project = makeProject(clean, "manual");
  db.projects[project.id] = project;
  return project;
}

function projectArchivePaths(archive) {
  const project = archive?.project || {};
  return [project.primaryFolder, ...(project.folderPaths || [])].filter(Boolean);
}

function archiveDataCount(archive) {
  return Object.values(archive?.counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
}

function mergeRestoredProject(current, archivedProject, fallbackName, folderPath, createdAt) {
  const archived = archivedProject || {};
  const project = current ? { ...current } : { ...archived };
  project.id = current?.id || archived.id || id();
  project.name = current?.name || archived.name || fallbackName;
  project.source = current?.source || archived.source || "folder";
  project.manual = Boolean(current?.manual ?? archived.manual ?? false);
  if (!String(project.source || "").includes("folder")) {
    project.source = `${project.source}+folder`;
  }
  project.active = archived.active === false || current?.active === false ? false : true;
  project.priority = project.active ? (current?.priority ?? archived.priority ?? null) : null;
  project.completedAt = project.active ? null : (current?.completedAt || archived.completedAt || null);
  project.createdAt = archived.createdAt || current?.createdAt || createdAt || nowIso();
  project.discoveredAt = archived.discoveredAt || current?.discoveredAt || project.createdAt;
  project.folderAddedAt = archived.folderAddedAt || current?.folderAddedAt || createdAt || project.createdAt;
  project.primaryFolder = current?.primaryFolder || archived.primaryFolder || folderPath || null;
  const paths = [current?.primaryFolder, archived.primaryFolder, folderPath, ...(current?.folderPaths || []), ...(archived.folderPaths || [])].filter(Boolean);
  project.folderPaths = Array.from(new Map(paths.map((item) => [normalizeFsPath(item), item])).values());
  project.folderMissing = false;
  project.missingScanCount = 0;
  project.storageFolder = current?.storageFolder || archived.storageFolder || null;
  project.responsibleUserIds = Array.from(new Set([...(current?.responsibleUserIds || []), ...(archived.responsibleUserIds || [])]));
  project.deadline = current?.deadline || archived.deadline || "";
  project.company = current?.company || archived.company || "";
  ensureProjectFields(project);
  return project;
}

function restoreAutoArchivedProject(name, folderPath, createdAt) {
  const normalizedPath = normalizeFsPath(folderPath);
  const matches = (db.archives || []).filter((archive) =>
    archive.type === "project" &&
    archive.reason === "folder-missing-auto" &&
    !archive.restoredAt &&
    projectArchivePaths(archive).some((item) => normalizeFsPath(item) === normalizedPath)
  );
  if (!matches.length) return null;

  matches.sort((a, b) => archiveDataCount(b) - archiveDataCount(a) || Date.parse(b.archivedAt || 0) - Date.parse(a.archivedAt || 0));
  const best = matches[0];
  const current = Object.values(db.projects).find((project) => projectPaths(project).some((item) => normalizeFsPath(item) === normalizedPath));
  const restoredProject = mergeRestoredProject(current, best.project, name, folderPath, createdAt);
  db.projects[restoredProject.id] = restoredProject;

  let restoredItems = 0;
  for (const archive of matches) {
    const counts = restoreArchivedProjectInto(db, archive, restoredProject, PROJECT_ARCHIVE_COLLECTIONS);
    restoredItems += Object.values(counts).reduce((sum, count) => sum + count, 0);
  }

  console.log(`[scan] visszaallitott auto-archivalt projekt: ${restoredProject.name} (${restoredItems} kapcsolt tetel)`);
  return restoredProject;
}

function addScannedProject(name, folderPath, createdAt = nowIso()) {
  if (!name || isExcluded(folderPath)) return;
  const existing = Object.values(db.projects).find((project) => projectPaths(project).some((item) => pathKey(item) === pathKey(folderPath)));
  const created = createdAt;

  if (existing) {
    existing.folderMissing = false;
    existing.missingScanCount = 0;
    existing.primaryFolder = existing.primaryFolder || folderPath;
    existing.folderAddedAt = existing.folderAddedAt || created;
    existing.folderPaths = existing.folderPaths || [];
    if (!existing.folderPaths.some((item) => normalizeFsPath(item) === normalizeFsPath(folderPath))) {
      existing.folderPaths.push(folderPath);
    }
    if (!String(existing.source).includes("folder")) {
      existing.source = `${existing.source}+folder`;
    }
    const restored = restoreAutoArchivedProject(name, folderPath, created);
    if (restored) return;
    return;
  }

  const restored = restoreAutoArchivedProject(name, folderPath, created);
  if (restored) return;

  const project = makeProject(name, "folder", folderPath);
  project.createdAt = created;
  project.folderAddedAt = created;
  db.projects[project.id] = project;
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`Idotullepes (${ms}ms): ${label}`)), ms))
  ]);
}

async function scanRoot(root) {
  const result = { root, ok: false, found: 0, error: null, folders: [] };
  let entries;
  try {
    entries = await withTimeout(fsp.readdir(root, { withFileTypes: true }), 15000, root);
  } catch (error) {
    result.error = error.message;
    return result;
  }

  result.ok = true;

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(root, entry.name);
    if (isExcluded(fullPath)) continue;

    if (/^\d{4}$/.test(entry.name)) {
      let yearEntries = [];
      try {
        yearEntries = await withTimeout(fsp.readdir(fullPath, { withFileTypes: true }), 15000, fullPath);
      } catch (error) {
        result.ok = false;
        result.error = result.error || `Almappa hiba: ${fullPath}: ${error.message}`;
        lastScan.errors.push({ root: fullPath, error: error.message });
        continue;
      }
      for (const child of yearEntries) {
        if (!child.isDirectory()) continue;
        const projectPath = path.join(fullPath, child.name);
        if (isExcluded(projectPath)) continue;
        result.folders.push({ name: child.name, folderPath: projectPath });
        result.found += 1;
      }
    } else {
      result.folders.push({ name: entry.name, folderPath: fullPath });
      result.found += 1;
    }
  }

  return result;
}

let projectScanPromise = null;
function scanProjects() {
  if (!projectScanPromise) projectScanPromise = scanProjectsOnce().finally(() => { projectScanPromise = null; });
  return projectScanPromise;
}

async function scanProjectsOnce() {
  lastScan = { at: nowIso(), found: 0, roots: [], errors: [] };
  const folders = [];
  for (const root of config.scanRoots || []) {
    const result = await scanRoot(root);
    if (result.ok) folders.push(...result.folders);
    const { folders: inventory, ...summary } = result;
    lastScan.roots.push(summary);
    lastScan.found += result.found;
    if (result.error) lastScan.errors.push({ root, error: result.error });
  }

  const successfulRoots = lastScan.roots.filter((result) => result.ok).map((result) => result.root);
  // Inventory first, then decide: filesystem enumeration order must never
  // decide identity. Failed/partial roots cannot create or remove projects.
  const plan = planFolderContinuations(db.projects, folders, successfulRoots);
  for (const folder of plan.additions) {
    try {
      const stat = await withTimeout(fsp.stat(folder.folderPath), 5000, folder.folderPath);
      folder.createdAt = stat.birthtime?.toISOString?.() || stat.ctime?.toISOString?.() || nowIso();
    } catch { folder.createdAt = nowIso(); }
  }
  // No awaits in the mutation phase. Other requests cannot see half a scan.
  for (const { projectId, folder } of plan.matches) {
    const project = db.projects[projectId];
    if (!project || isExcluded(folder.folderPath)) continue;
    if (project.name !== folder.name && plan.matches.filter((match) => match.projectId === projectId).length === 1) {
      continueProjectFolder(db, project, project.primaryFolder, folder, PROJECT_ARCHIVE_COLLECTIONS);
    }
    project.folderMissing = false;
    project.missingScanCount = 0;
    project.folderMissingNotifiedAt = "";
    project.primaryFolder = project.primaryFolder || folder.folderPath;
    project.folderPaths = [...new Set([...(project.folderPaths || []), folder.folderPath])];
    if (!String(project.source).includes("folder")) project.source = `${project.source}+folder`;
    restoreAutoArchivedProject(folder.name, folder.folderPath, project.createdAt);
  }
  for (const { projectId, oldFolder, folder } of plan.renames) {
    const project = db.projects[projectId];
    if (!project || isExcluded(folder.folderPath)) continue;
    continueProjectFolder(db, project, oldFolder, folder, PROJECT_ARCHIVE_COLLECTIONS);
    console.log(`[scan] projekt folytatasa atnevezes utan: ${oldFolder} -> ${folder.folderPath} (${projectId})`);
  }
  for (const folder of plan.additions) addScannedProject(folder.name, folder.folderPath, folder.createdAt);
  for (const missing of plan.missing) {
    const project = db.projects[missing.id];
    if (!project) continue;
    project.folderMissing = true;
    project.missingScanCount = Math.min(3, (Number(project.missingScanCount) || 0) + 1);
    if (project.missingScanCount >= 3 && !project.folderMissingNotifiedAt) {
      project.folderMissingNotifiedAt = nowIso();
      const candidates = plan.candidates.filter((item) => item.projects.some((candidate) => candidate.id === project.id)).map((item) => item.folder.folderPath);
      addProjectNotice(db, { kind: "folder-missing", projectId: project.id, projectName: project.name, oldFolder: project.primaryFolder || "", candidates });
    }
    // A missing directory is not proof of deletion. Keep the project, active
    // state and ALL related records until an explicit inactive-project archive.
  }
  ensureAllProjectFields();
  saveDb();
}

function cleanupExpired() {
  const now = Date.now();
  const beforeTodos = db.dashboardTodos.length;
  const beforeMeetings = db.meetings.length;
  const remainingTodos = [];
  for (const todo of db.dashboardTodos) {
    const expired = todo.checkedAt && Date.parse(todo.checkedAt) + TWELVE_HOURS_MS <= now;
    if (expired) {
      if (todo.image?.kind === "upload") safeRemoveErpFileOrFolder(todo.image.path);
    } else {
      remainingTodos.push(todo);
    }
  }
  db.dashboardTodos = remainingTodos;
  db.meetings = db.meetings.filter((meeting) => Date.parse(meeting.time) + TWELVE_HOURS_MS > now);
  // Szabadnap: drop entries whose end date is before today (auto-delete the
  // day after the holiday ends). endDate falls back to startDate.
  db.dayOffs = Array.isArray(db.dayOffs) ? db.dayOffs : [];
  const beforeDayOffs = db.dayOffs.length;
  const todayKey = todayLocalDate();
  db.dayOffs = db.dayOffs.filter((entry) => String(entry?.endDate || entry?.startDate || "") >= todayKey);
  if (beforeTodos !== db.dashboardTodos.length || beforeMeetings !== db.meetings.length || beforeDayOffs !== db.dayOffs.length) {
    saveDb();
  }
}

function orderedProjects(includeInactive = true) {
  ensureAllProjectFields();

  // Precompute the most recent open-task timestamp per project, across every
  // task-like collection. Used as a fallback sort key when neither project has a deadline.
  const latestOpenTaskAt = new Map();
  const taskCollections = [db.tasks, db.cncTasks, db.toolRequests, db.materialRequests, db.fastenerRequests];
  for (const collection of taskCollections) {
    if (!Array.isArray(collection)) continue;
    for (const item of collection) {
      if (!item || item.status === "done") continue;
      const at = String(item.createdAt || "");
      if (!at) continue;
      const projectId = item.projectId;
      if (!projectId) continue;
      const existing = latestOpenTaskAt.get(projectId) || "";
      if (at > existing) latestOpenTaskAt.set(projectId, at);
    }
  }

  return Object.values(db.projects)
    .filter((project) => includeInactive || project.active)
    .sort((a, b) => {
      const ap = projectPriorityRank(a);
      const bp = projectPriorityRank(b);
      if (ap !== bp) return ap - bp;
      const ad = Date.parse(a.deadline || "");
      const bd = Date.parse(b.deadline || "");
      const ah = Number.isFinite(ad);
      const bh = Number.isFinite(bd);
      if (ah || bh) {
        if (!ah) return 1;
        if (!bh) return -1;
        if (ad !== bd) return ad - bd;
      }
      // Neither has a deadline: prefer the project with the most recent open task.
      const aTask = latestOpenTaskAt.get(a.id) || "";
      const bTask = latestOpenTaskAt.get(b.id) || "";
      if (aTask || bTask) {
        if (!aTask) return 1;
        if (!bTask) return -1;
        if (aTask !== bTask) return bTask.localeCompare(aTask);
      }
      // Neither has open tasks either: fall back to date the folder was added / project created.
      return Date.parse(b.folderAddedAt || b.createdAt || 0) - Date.parse(a.folderAddedAt || a.createdAt || 0);
    });
}

function projectPriorityRank(project) {
  if (project?.priority === null || project?.priority === undefined || project?.priority === "") return 9999;
  const priority = Number(project.priority);
  return Number.isFinite(priority) && priority >= 1 && priority <= 10 ? priority : 9999;
}

function normalizePriorities() {
  const prioritized = orderedProjects(false)
    .filter((project) => projectPriorityRank(project) !== 9999)
    .sort((a, b) => projectPriorityRank(a) - projectPriorityRank(b));
  prioritized.forEach((project, index) => {
    project.priority = index + 1;
  });
}

function setProjectPriority(projectId, priority, reorderPriority = false) {
  const project = db.projects[projectId];
  if (!project || !project.active) return { ok: false, status: 400, error: "Csak aktív projekt kaphat prioritást." };

  if (priority === null || priority === "" || priority === undefined) {
    project.priority = null;
    return { ok: true };
  }

  const wanted = Math.max(1, Math.min(10, Number(priority)));
  if (!Number.isFinite(wanted)) return { ok: false, status: 400, error: "A prioritás 1 és 10 között lehet." };
  const active = Object.values(db.projects).filter((item) => item.active && item.id !== projectId);
  const conflict = active.find((item) => projectPriorityRank(item) === wanted);
  if (conflict && !reorderPriority) {
    return { ok: false, status: 409, error: `A(z) ${wanted}. prioritás már foglalt: ${conflict.name}` };
  }
  if (conflict && reorderPriority) {
    active
      .filter((item) => projectPriorityRank(item) !== 9999 && projectPriorityRank(item) >= wanted)
      .sort((a, b) => projectPriorityRank(b) - projectPriorityRank(a))
      .forEach((item) => {
        const next = Number(item.priority) + 1;
        item.priority = next <= 10 ? next : null;
      });
  }
  project.priority = wanted;
  return { ok: true };
}

const CAD_MODEL_SCAN_INTERVAL_MS = 10 * 1000;
const cadModelScanErrors = new Map();
const cadModelCacheErrors = new Map();
const cadModelMissingScans = new Map();

function prewarmCadModel(model) {
  scheduleCompressedModel(CAD_MODEL_INBOX, model, CAD_MODEL_CACHE_ROOT).then(() => {
    cadModelCacheErrors.delete(model.id);
  }).catch((error) => {
    if (cadModelCacheErrors.get(model.id) !== error.message) {
      cadModelCacheErrors.set(model.id, error.message);
      console.error("[cadmodels] compression cache skipped for " + model.glbFile + ": " + error.message);
    }
  });
}

function scanCadModels() {
  const entries = fs.readdirSync(CAD_MODEL_INBOX, { withFileTypes: true });
  const presentFiles = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name.toLowerCase()));
  const existingModels = new Map((db.cadModels || []).map((item) => [item.id, item]));
  let changed = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    const modelId = modelIdForSidecar(entry.name);
    const existing = existingModels.get(modelId);
    if (existing && !existing.trashedAt && !existing.missingAt) continue;
    try {
      const model = readReadyPair(CAD_MODEL_INBOX, entry.name);
      if (existing) {
        if (existing.trashedAt) {
          existing.trashHistory = [...(existing.trashHistory || []), {
            trashedAt: existing.trashedAt, trashFolder: existing.trashFolder,
            trashedByUserId: existing.trashedByUserId
          }];
        }
        Object.assign(existing, model, { trashedAt: "", missingAt: "", restoredAt: nowIso() });
        cadModelScanErrors.delete(entry.name);
        console.log("[cadmodels] restored " + model.glbFile + " from inbox");
        changed++;
        continue;
      }
      const project = existingProjectForSource(model.sourceRoot, db.projects, config.scanRoots);
      model.projectId = project?.id || "";
      model.importedAt = nowIso();
      db.cadModels.push(model);
      existingModels.set(model.id, model);
      cadModelScanErrors.delete(entry.name);
      changed++;
      console.log("[cadmodels] imported " + model.glbFile + (project ? " -> " + project.name : " (unassigned)"));
    } catch (error) {
      if (cadModelScanErrors.get(entry.name) !== error.message) {
        cadModelScanErrors.set(entry.name, error.message);
        console.error("[cadmodels] ignored " + entry.name + ": " + error.message);
      }
    }
  }
  for (const model of db.cadModels || []) {
    if (model.trashedAt) {
      cadModelMissingScans.delete(model.id);
      continue;
    }
    const jsonPresent = presentFiles.has(String(model.sidecarFile || "").toLowerCase());
    const glbPresent = presentFiles.has(String(model.glbFile || "").toLowerCase());
    if (!jsonPresent && !glbPresent) {
      const scans = (cadModelMissingScans.get(model.id) || 0) + 1;
      cadModelMissingScans.set(model.id, Math.min(scans, 3));
      if (scans >= 3 && !model.missingAt) {
        model.missingAt = nowIso();
        changed++;
        console.log("[cadmodels] hidden missing pair " + model.glbFile + " (metadata retained)");
      }
      continue;
    }
    cadModelMissingScans.delete(model.id);
    if (model.missingAt) {
      if (jsonPresent && glbPresent) continue;
      model.missingAt = "";
      model.returnedAt = nowIso();
      changed++;
    }
    if (jsonPresent && glbPresent) prewarmCadModel(model);
  }
  if (changed) saveDb();
  return changed;
}

function activeCadModel(modelId) {
  return (db.cadModels || []).find((item) => item.id === modelId && !item.trashedAt && !item.missingAt) || null;
}

function streamCadModel(req, res, model) {
  let identity;
  try {
    identity = sourceIdentity(CAD_MODEL_INBOX, model);
  } catch (error) {
    return sendError(res, error.code === "ENOENT" ? 404 : 409, "A modellfájl hiányzik vagy megváltozott.");
  }
  let gzip = null;
  const acceptsGzip = String(req.headers["accept-encoding"] || "").split(",").some((entry) => {
    const [name, ...parameters] = entry.split(";");
    if (name.trim().toLowerCase() !== "gzip") return false;
    const quality = parameters.find((parameter) => /^\s*q\s*=/i.test(parameter));
    if (!quality) return true;
    const value = Number(quality.split("=")[1]);
    return Number.isFinite(value) && value > 0 && value <= 1;
  });
  if (acceptsGzip) {
    try { gzip = compressedModel(CAD_MODEL_CACHE_ROOT, model, identity); }
    catch (error) { console.error("[cadmodels] compression cache unavailable:", error.message); }
  }
  const filePath = gzip?.filePath || identity.sourcePath;
  const stat = gzip?.stat || identity.stat;
  const etag = '"' + identity.fingerprint + (gzip ? "-gzip" : "-raw") + '"';
  const cacheHeaders = {
    "Cache-Control": "private, max-age=0, must-revalidate",
    "ETag": etag,
    "Vary": "Accept-Encoding",
    ...(gzip ? { "Content-Encoding": "gzip" } : {})
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, cacheHeaders);
    return res.end();
  }
  const stream = fs.createReadStream(filePath);
  stream.on("error", (error) => {
    console.error("[cadmodels] stream failed:", error.message);
    if (!res.headersSent) sendError(res, 500, "A modell olvasása sikertelen.");
    else res.destroy(error);
  });
  stream.on("open", () => {
    res.writeHead(200, {
      "Content-Type": "model/gltf-binary",
      "Content-Length": stat.size,
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      ...cacheHeaders
    });
    stream.pipe(res);
  });
}

function publicState(req = null) {
  cleanupExpired();
  ensureAllProjectFields();
  const publicData = JSON.parse(JSON.stringify(db));
  delete publicData.security;
  delete publicData.protectedSecurity;
  delete publicData.blockedIps;
  publicData.users = publicUsers();
  const overtimeViewer = currentUser(req);
  publicData.projectNotices = (publicData.projectNotices || []).map(({ readByUserIds, ...notice }) => ({
    ...notice, read: (readByUserIds || []).includes(overtimeViewer?.id)
  }));
  publicData.cadModels = (publicData.cadModels || []).filter((item) => !item.trashedAt && !item.missingAt);
  publicData.workLogs = (publicData.workLogs || []).map((log) => {
    if (!log?.overtime || canViewOvertimeFlag(overtimeViewer, log)) return log;
    const copy = { ...log };
    delete copy.overtime;
    return copy;
  });
  delete publicData.financeSuppliers;
  delete publicData.financePriceItems;
  delete publicData.financeCostItems;
  delete publicData.financeOutsourceItems;
  delete publicData.financeProductionItems;
  delete publicData.engineeringDesignItems;
  delete publicData.financeQuotes;
  delete publicData.engineeringNotes;
  delete publicData.financeSettings;
  delete publicData.archives;
  return {
    config: {
      port: config.port,
      host: config.host,
      internetPort: config.internetPort,
      internetHttpsEnabled: Boolean(config.internetHttpsEnabled),
      internetHttpsPort: config.internetHttpsPort,
      internetPublicHost: config.internetPublicHost || "",
      internetPublicHttpsPort: config.internetPublicHttpsPort || config.internetHttpsPort || 4782,
      internetEnabled: Boolean(config.internetEnabled),
      localAuthRequired: true,
      helperUrl: config.helperUrl || DEFAULT_CONFIG.helperUrl,
      workingDirectory: config.workingDirectory,
      scanRoots: config.scanRoots,
      excludedPaths: config.excludedPaths,
      scanIntervalSeconds: config.scanIntervalSeconds,
      hostNicknames: normalizedHostNicknames()
    },
    server: {
      hostname: os.hostname(),
      effectiveWorkingDirectory,
      usingFallbackDirectory,
      dataFile: dbPath,
      uploadsDirectory,
      lastScan
    },
    auth: {
      passwordSet: true,
      user: req ? publicUser(currentUser(req), { private: true }) : null
    },
    data: publicData,
    orderedProjects: orderedProjects(true)
  };
}

function sendJson(res, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": body.length,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

function compactLogText(value, maxLength = 1200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function recordClientError(req, context, body = {}) {
  try {
    fs.mkdirSync(path.join(APP_DIR, "logs"), { recursive: true });
    const stamp = new Date();
    const day = stamp.toISOString().slice(0, 10);
    const session = currentSession(req, context);
    const entry = {
      at: stamp.toISOString(),
      host: os.hostname(),
      ip: clientIpFor(req, context),
      userAgent: compactLogText(req.headers?.["user-agent"], 500),
      user: session?.user ? publicUser(session.user) : null,
      kind: compactLogText(body.kind || "client-error", 80),
      message: compactLogText(body.message, 1200),
      stack: compactLogText(body.stack, 3000),
      url: compactLogText(body.url, 1000),
      view: compactLogText(body.view, 120),
      source: compactLogText(body.source, 1000),
      line: Number.isFinite(Number(body.line)) ? Number(body.line) : null,
      column: Number.isFinite(Number(body.column)) ? Number(body.column) : null
    };
    fs.appendFileSync(path.join(APP_DIR, "logs", `client-errors-${day}.log`), `${JSON.stringify(entry)}\n`, "utf8");
  } catch (error) {
    try { console.error("[client-error] log failed:", error.message); } catch {}
  }
}

function readBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Túl nagy kérés."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  const raw = await readBody(req, maxBytes);
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function normalizeOcrText(value) {
  return String(value || "")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function parseImageDataUrl(dataUrl, maxBytes = 12 * 1024 * 1024) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Csak PNG/JPG kép küldhető OCR-hez.");
  const extension = match[1].toLowerCase() === "jpg" ? "jpg" : match[1].toLowerCase();
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length || buffer.length > maxBytes) throw new Error("Az OCR kép túl nagy vagy üres.");
  return { extension, buffer };
}

function imageDataUrlToTempFile(dataUrl) {
  const { extension, buffer } = parseImageDataUrl(dataUrl);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "workshop-ocr-"));
  const filePath = path.join(dir, `drawing-number.${extension}`);
  fs.writeFileSync(filePath, buffer);
  return { dir, filePath };
}

function recognizeWindowsDrawingNumberImage(dataUrl) {
  if (process.platform !== "win32") throw new Error("A szerver OCR csak Windows hoston érhető el.");
  const temp = imageDataUrlToTempFile(dataUrl);
  try {
    const ps = `
& {
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$ImagePath = $env:WORKSHOP_OCR_IMAGE
if ([string]::IsNullOrWhiteSpace($ImagePath)) { throw 'Hiányzik az OCR kép útvonala.' }
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() |
  Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } |
  Select-Object -First 1
function Await-WinRt($operation, [type]$resultType) {
  $task = $asTask.MakeGenericMethod($resultType).Invoke($null, @($operation))
  $task.Wait() | Out-Null
  return $task.Result
}
[Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime] | Out-Null
[Windows.Storage.Streams.IRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Graphics.Imaging.SoftwareBitmap, Windows.Graphics.Imaging, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
[Windows.Media.Ocr.OcrResult, Windows.Foundation, ContentType = WindowsRuntime] | Out-Null
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) { throw 'Nincs elérhető Windows OCR nyelv ezen a hoston.' }
$file = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = $null
try {
  $stream = Await-WinRt ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
  $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
  $bitmap = Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
  $result = Await-WinRt ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
  Write-Output $result.Text
} finally {
  if ($stream) { $stream.Dispose() }
}
}
`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps], {
      encoding: "utf8",
      env: { ...process.env, WORKSHOP_OCR_IMAGE: temp.filePath },
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const message = normalizeOcrText(result.stderr || result.stdout) || "Nem sikerült az OCR felismerés.";
      throw new Error(message);
    }
    return normalizeOcrText(result.stdout);
  } finally {
    try { safeRmrfSync(temp.dir, { base: os.tmpdir() }); } catch {}
  }
}

let cachedTesseractExePath;
function findTesseractExe() {
  if (cachedTesseractExePath !== undefined) return cachedTesseractExePath;
  const candidates = [
    process.env.TESSERACT_EXE,
    path.join(APP_DIR, "tesseract", "tesseract.exe"),
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "WorkshopERP", "tesseract", "tesseract.exe") : "",
    "C:\\Program Files\\Tesseract-OCR\\tesseract.exe",
    "C:\\Program Files (x86)\\Tesseract-OCR\\tesseract.exe"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) {
        cachedTesseractExePath = candidate;
        return cachedTesseractExePath;
      }
    } catch {}
  }
  try {
    const result = spawnSync("where.exe", ["tesseract"], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      maxBuffer: 64 * 1024
    });
    const found = String(result.stdout || "").split(/\r?\n/).map((line) => line.trim()).find(Boolean);
    cachedTesseractExePath = found || "";
  } catch {
    cachedTesseractExePath = "";
  }
  return cachedTesseractExePath;
}

function parseTesseractTsv(tsv) {
  const lines = String(tsv || "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return { text: "", confidence: 0 };
  const header = lines[0].split("\t");
  const textIndex = header.indexOf("text");
  const confIndex = header.indexOf("conf");
  if (textIndex < 0) return { text: normalizeOcrText(tsv), confidence: 0 };
  // Keep every token in the text, even low-confidence ones. On drawings,
  // the project/drawing code or suffix can be the lowest-confidence token
  // because it sits near a border line; deleting it silently truncates the
  // row. Low-confidence tokens still do not contribute to the average.
  const tokens = [];
  let confSum = 0;
  let weightSum = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split("\t");
    const token = String(cols[textIndex] || "").trim();
    if (!token) continue;
    const conf = Number(cols[confIndex]);
    tokens.push(token);
    if (Number.isFinite(conf) && conf >= 30) {
      const weight = Math.max(1, token.length);
      confSum += conf * weight;
      weightSum += weight;
    }
  }
  return {
    text: normalizeOcrText(tokens.join(" ")),
    confidence: weightSum ? confSum / weightSum : 0
  };
}

const OCR_TESSERACT_CONCURRENCY = Math.max(2, Math.min(4, Math.floor((os.cpus()?.length || 2) / 4) || 2));
let activeTesseractJobs = 0;
const pendingTesseractJobs = [];

function acquireTesseractSlot() {
  return new Promise((resolve) => {
    const grant = () => {
      activeTesseractJobs += 1;
      resolve(() => {
        activeTesseractJobs = Math.max(0, activeTesseractJobs - 1);
        const next = pendingTesseractJobs.shift();
        if (next) next();
      });
    };
    if (activeTesseractJobs < OCR_TESSERACT_CONCURRENCY) grant();
    else pendingTesseractJobs.push(grant);
  });
}

async function withTesseractSlot(fn) {
  const release = await acquireTesseractSlot();
  try {
    return await fn();
  } finally {
    release();
  }
}

function runHiddenProcessText(filePath, args, options = {}) {
  const timeoutMs = options.timeout || 12000;
  const maxBuffer = options.maxBuffer || 1024 * 1024;
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let done = false;
    let child;
    const finish = (result) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      try { child?.kill?.(); } catch {}
      finish({ error: new Error("OCR timeout"), stdout, stderr, status: null });
    }, timeoutMs);
    try {
      child = spawn(filePath, args, { windowsHide: true });
    } catch (error) {
      finish({ error, stdout: "", stderr: "", status: null });
      return;
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
      if (stdout.length > maxBuffer) {
        try { child.kill(); } catch {}
        finish({ error: new Error("OCR output too large"), stdout, stderr, status: null });
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > maxBuffer) stderr = stderr.slice(-maxBuffer);
    });
    child.on("error", (error) => finish({ error, stdout, stderr, status: null }));
    child.on("close", (code) => finish({ stdout, stderr, status: code }));
  });
}

const DRAWING_OCR_TESSERACT_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/. #";
const PROJECT_PATH_OCR_TESSERACT_WHITELIST = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_/.\\\\: #+()";

async function recognizeTesseractDrawingNumberImage(dataUrl, psm = 7, oem = 1, whitelist = DRAWING_OCR_TESSERACT_WHITELIST, outputMode = "tsv") {
  const exePath = findTesseractExe();
  if (!exePath) return null;
  const temp = imageDataUrlToTempFile(dataUrl);
  try {
    const args = [
        temp.filePath,
        "stdout",
        "-l", "eng",
        "--oem", String(oem),
        "--psm", String(psm),
        "-c", `tessedit_char_whitelist=${whitelist}`,
        // Disable Tesseract's internal dictionaries. Drawing numbers are
        // not English words and not pure numbers; the system/freq/number
        // dawgs were biasing readings toward "valid" English patterns,
        // which is precisely what causes T->1, O->0, S->5 misreads.
        "-c", "load_system_dawg=0",
        "-c", "load_freq_dawg=0",
        "-c", "load_punc_dawg=0",
        "-c", "load_number_dawg=0",
        "-c", "load_unambig_dawg=0",
        "-c", "load_bigram_dawg=0",
      ];
    if (outputMode === "tsv") args.push("tsv");
    const result = await withTesseractSlot(() => runHiddenProcessText(exePath, args, {
        timeout: 12000,
        maxBuffer: 1024 * 1024
      }));
    if (result.error || result.status !== 0) return null;
    if (outputMode === "text") {
      const text = normalizeOcrText(result.stdout);
      if (!text) return null;
      return { text, confidence: 45, engine: `tesseract-text-oem${oem}-psm${psm}` };
    }
    const parsed = parseTesseractTsv(result.stdout);
    return { ...parsed, engine: `tesseract-oem${oem}-psm${psm}` };
  } finally {
    try { safeRmrfSync(temp.dir, { base: os.tmpdir() }); } catch {}
  }
}

function normalizeDrawingNumberOcrText(value) {
  return normalizeOcrText(value)
    .toUpperCase()
    .replace(/^[|_[\]\s]+(?=S[Z2][-_ ]?T)/, "")
    .replace(/\bHR[EI]\b/g, "HRC")
    .replace(/\bHRC[IL1|]*V[AI1L|]{1,4}\b/g, "HRC V2")
    .replace(/\b([1-9])\s*D\s*B\b/g, "$1DB")
    .replace(/\b([1-9])[0O]B\b/g, "$1DB")
    .replace(/\b([1-9])D8\b/g, "$1DB")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function drawingNumberOcrScore(candidate) {
  const text = normalizeDrawingNumberOcrText(candidate?.text || "");
  if (!text) return -Infinity;
  let score = text.length * 2;
  // Quantity suffix: keep the strong bonus, this is a real signal.
  if (/\b\d+DB\b/.test(text)) score += 80;
  // Sheet drawing rows often start with SZ-T_018_101 and then continue with
  // the part/material description. That leading code is valuable even if
  // Tesseract gives it a low token confidence because it sits near a line.
  if (/\bS[Z2][-_ ]?T[-_ ]?\d{2,4}[-_ ]?\d{2,4}\b/.test(text)) score += 160;
  if (/\bVAGOLAP\b/.test(text)) score += 30;
  if (/\bHRC\b/.test(text)) score += 30;
  if (/\bV2\b/.test(text)) score += 20;
  if (/\b\d+\.\d+\b/.test(text)) score += 10;
  if (/\b\d{2}-\d{2}\b/.test(text)) score += 10;
  // Pattern bonuses kept but reduced. Previously +18 and +12 were strong
  // enough to override a clear confidence win — e.g. preferring "SZ-1_019"
  // over a correct "SZ-T_019" simply because "SZ-1" matches LETTERS-DIGIT.
  // User said "no reliable patterns", so we should mostly let confidence
  // and per-variant agreement decide.
  if (/[A-Z]{2,}[-_ ]?\d/.test(text)) score += 5;
  if (/\d[-_ ]?[A-Z]{1,4}[-_ ]?\d/.test(text)) score += 3;
  score += Math.max(0, Math.min(100, Number(candidate.confidence || 0))) / 2;
  score -= (text.match(/[^A-Z0-9\-_/ .#]/g) || []).length * 5;
  return score;
}

function bestDrawingNumberOcrCandidate(candidates) {
  // Group candidates by their normalized text and add a voting bonus per
  // agreement. Several variants reading the same string is much stronger
  // evidence than one outlier with a slightly higher single-candidate
  // score. Fixes cases like "T vs 1" where a binarized variant gives a
  // confident-but-wrong "1" but original/contrast/rotation variants
  // collectively agree on the correct "T".
  const groups = new Map();
  for (const candidate of candidates) {
    const text = normalizeDrawingNumberOcrText(candidate?.text || "");
    if (!text) continue;
    const score = drawingNumberOcrScore(candidate);
    const entry = groups.get(text);
    if (!entry) {
      groups.set(text, { text, bestSingleScore: score, voteCount: 1, sample: candidate });
    } else {
      entry.voteCount += 1;
      if (score > entry.bestSingleScore) {
        entry.bestSingleScore = score;
        entry.sample = candidate;
      }
    }
  }
  if (!groups.size) return { text: "", score: -Infinity };
  // +6 per extra vote — meaningful but not overwhelming. Two agreements
  // (+6) is worth roughly the old letter-digit pattern bonus.
  const VOTE_BONUS = 6;
  let best = null;
  for (const group of groups.values()) {
    const finalScore = group.bestSingleScore + (group.voteCount - 1) * VOTE_BONUS;
    if (!best || finalScore > best.finalScore) {
      best = {
        ...group.sample,
        text: group.text,
        score: group.bestSingleScore,
        finalScore,
        voteCount: group.voteCount
      };
    }
  }
  return best;
}

// Variant labels match the order produced by drawingOcrVariantDataUrls in
// public/app.js. Used only for debug-snapshot filenames so a human can
// quickly tell which variant a file corresponds to.
const OCR_VARIANT_LABELS = [
  "original-color",
  "contrast-19",
  "blur-otsu",
  "blur-otsu-inverted",
  "rotated-90",
  "rotated-180",
  "rotated-270"
];

const OCR_DEBUG_DIR = path.join(APP_DIR, "logs", "ocr-debug");
const OCR_DEBUG_KEEP = 20;

function saveOcrDebugSnapshot({ inputs, candidates, winner, kind = "drawing-number" }) {
  try {
    fs.mkdirSync(OCR_DEBUG_DIR, { recursive: true });
    // Prune: keep only the newest (KEEP-1) folders so this new run makes KEEP.
    try {
      const existing = fs.readdirSync(OCR_DEBUG_DIR, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
      for (const oldName of existing.slice(Math.max(0, OCR_DEBUG_KEEP - 1))) {
        try { safeRmrfSync(path.join(OCR_DEBUG_DIR, oldName), { base: OCR_DEBUG_DIR }); } catch {}
      }
    } catch {}

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeKind = sanitizeFileName(kind).slice(0, 40) || "ocr";
    const snapshotId = `${stamp}-${safeKind}`;
    const dir = path.join(OCR_DEBUG_DIR, snapshotId);
    fs.mkdirSync(dir, { recursive: true });

    // Save each input variant as a real PNG/JPG file. Filenames include
    // the index and the known variant label so they're scannable in
    // Explorer without opening candidates.json.
    inputs.forEach((dataUrl, idx) => {
      try {
        const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(dataUrl || ""));
        if (!match) return;
        const ext = match[1].toLowerCase() === "jpg" ? "jpg" : match[1].toLowerCase();
        const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
        const label = OCR_VARIANT_LABELS[idx] || `variant-${idx + 1}`;
        const fname = `${String(idx + 1).padStart(2, "0")}-${label}.${ext}`;
        fs.writeFileSync(path.join(dir, fname), buffer);
      } catch {}
    });

    // Save candidates + winner.
    const winnerText = winner?.text || "";
    fs.writeFileSync(path.join(dir, "candidates.json"), JSON.stringify({
      stamp,
      kind,
      inputCount: inputs.length,
      winner: {
        text: winnerText,
        confidence: winner?.confidence ?? null,
        engine: winner?.engine || null,
        voteCount: winner?.voteCount ?? null,
        score: winner?.score ?? null,
        finalScore: winner?.finalScore ?? null
      },
      candidates: candidates.map((c) => ({
        variantIndex: c.variantIndex ?? null,
        variantLabel: c.variantIndex != null ? OCR_VARIANT_LABELS[c.variantIndex] || null : null,
        psm: c.psm ?? null,
        oem: c.oem ?? null,
        mode: c.mode || null,
        engine: c.engine || null,
        text: c.text || "",
        confidence: Number.isFinite(c.confidence) ? Math.round(c.confidence * 10) / 10 : null,
        score: Math.round((kind === "project-path" ? plainTextOcrScore(c) : drawingNumberOcrScore(c)) * 10) / 10
      }))
    }, null, 2), "utf8");

    fs.writeFileSync(path.join(dir, "result.txt"), winnerText, "utf8");
    return snapshotId;
  } catch (error) {
    console.error("[ocr-debug] save failed:", error.message);
    return "";
  }
}

async function runTesseractDrawingNumberJobs(jobs) {
  const results = [];
  let nextIndex = 0;
  const workerCount = Math.min(OCR_TESSERACT_CONCURRENCY, jobs.length);
  async function worker() {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex++];
      try {
        const mode = job.mode || "tsv";
        const result = await recognizeTesseractDrawingNumberImage(job.dataUrl, job.psm, 1, DRAWING_OCR_TESSERACT_WHITELIST, mode);
        if (result?.text) {
          results.push({ ...result, variantIndex: job.index, psm: job.psm, oem: 1, mode });
        }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function recognizeDrawingNumberImagesDetailed(dataUrls) {
  // 12-variant cap covers: 4 preprocessed (original, contrast, Otsu thr,
  // inverted Otsu) + 3 rotations + headroom. Each variant => one or more
  // Tesseract invocations below.
  const inputs = (Array.isArray(dataUrls) ? dataUrls : [dataUrls]).filter(Boolean).slice(0, 12);
  if (!inputs.length) throw new Error("Nincs OCR kép.");
  const candidates = [];
  if (findTesseractExe()) {
    const jobs = [];
    for (const [index, dataUrl] of inputs.entries()) {
      // First two variants get full PSM treatment: 6 (uniform block),
      // 7 (single text line), 8 (single word). Other variants — including
      // rotations — get just PSM 7 to keep total runtime under ~2 s.
      const tsvPsms = index < 2 ? [6, 7, 8] : [7];
      const textPsms = [6, 7, 11];
      for (const psm of tsvPsms) jobs.push({ index, dataUrl, psm, mode: "tsv" });
      for (const psm of textPsms) jobs.push({ index, dataUrl, psm, mode: "text" });
      // (--oem 2 / LSTM+legacy was tried here previously, but the shipped
      // `eng.traineddata` at app/tesseract/tessdata/ is LSTM-only — no
      // legacy model — so --oem 2 always fails with exit 1. Drop the
      // wasted spawn. If the legacy model gets added later, re-enable.)
    }
    candidates.push(...await runTesseractDrawingNumberJobs(jobs));
  }
  if (!candidates.length) {
    // Fallback: Windows.Media.Ocr. Limit to first 4 variants since each
    // Windows OCR call is ~1 s and we only fall back when Tesseract is
    // entirely absent or returned nothing usable.
    for (const [idx, dataUrl] of inputs.slice(0, 4).entries()) {
      try {
        const text = recognizeWindowsDrawingNumberImage(dataUrl);
        if (text) candidates.push({ engine: "windows", text, confidence: 40, variantIndex: idx });
      } catch {}
    }
  }
  const winner = bestDrawingNumberOcrCandidate(candidates);
  // Save a debug snapshot regardless of outcome. Always-on rotation of
  // last OCR_DEBUG_KEEP runs lets us post-mortem any misread by looking
  // at exactly which variant Tesseract saw and how each candidate scored.
  const debugId = saveOcrDebugSnapshot({ inputs, candidates, winner, kind: "drawing-number" });
  return {
    text: winner.text || "",
    confidence: Number.isFinite(winner.confidence) ? winner.confidence : null,
    engine: winner.engine || "",
    voteCount: winner.voteCount || 0,
    score: Number.isFinite(winner.finalScore) ? winner.finalScore : winner.score,
    debugId
  };
}

async function recognizeDrawingNumberImages(dataUrls) {
  return (await recognizeDrawingNumberImagesDetailed(dataUrls)).text;
}

function plainTextOcrScore(candidate) {
  const text = normalizeOcrText(candidate?.text || "");
  if (!text) return -Infinity;
  const ascii = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const compact = ascii.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const tokens = ascii.split(/\s+/).filter(Boolean);
  let score = Math.max(0, Math.min(100, Number(candidate.confidence || 0)));
  score += Math.min(160, text.length) * 0.25;
  if (/workshop/i.test(text)) score += 15;
  if (/[a-z]:[\\/]/i.test(text) || /[\\/]/.test(text)) score += 12;
  if (/\bSZT?[-_\s]?\d{2}[-_\s]?\d+/i.test(text)) score += 16;
  if (/\b20\d{2}\b/.test(text)) score += 5;
  if (compact.includes("workshop")) score += 45;
  if (compact.includes("workshoptools") || compact.includes("toolsprojects") || compact.includes("oolsprojects") || compact.includes("oolsfrojects") || compact.includes("ookprojects")) score += 50;
  if (/[a-z]:[\\/]/i.test(text) || /[\\/]/.test(text)) score += 13;
  if (/\bS[Z2][T1]?[-_\s]?\d{2}[-_\s]?\d+/i.test(text) || /\bS2[1T][-_ ]?\d{2}[-_ ]?\d+/i.test(text)) score += 40;
  if (/\b20\d{2}\b/.test(text)) score += 13;
  if (/szentesi/i.test(ascii) || compact.includes("szentesi")) score += 30;
  if (/szersz/i.test(ascii) || compact.includes("szersz")) score += 24;
  if (/terit|lerit|ferit/i.test(ascii) || compact.includes("teritek") || compact.includes("leritek") || compact.includes("feritek")) score += 20;
  if (/kivag|kivosz|vucosz/i.test(ascii) || compact.includes("kivag") || compact.includes("vucosz")) score += 18;
  const oneCharRatio = tokens.length ? tokens.filter((token) => token.length === 1).length / tokens.length : 0;
  if (oneCharRatio > 0.4 && !/[\\/]/.test(text)) score -= 45;
  score -= (ascii.match(/[^A-Za-z0-9\-_/\\:. #+()]/g) || []).length * 3;
  return score;
}

function bestPlainTextOcrCandidate(candidates) {
  let best = null;
  for (const candidate of candidates) {
    const text = normalizeOcrText(candidate?.text || "");
    if (!text) continue;
    const score = plainTextOcrScore(candidate);
    if (!best || score > best.score) {
      best = { ...candidate, text, score };
    }
  }
  return best || { text: "", score: -Infinity };
}

async function runTesseractTextJobs(jobs, whitelist) {
  const results = [];
  let nextIndex = 0;
  const workerCount = Math.min(OCR_TESSERACT_CONCURRENCY, jobs.length);
  async function worker() {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex++];
      try {
        const mode = job.mode || "tsv";
        const result = await recognizeTesseractDrawingNumberImage(job.dataUrl, job.psm, 1, whitelist, mode);
        if (result?.text) {
          results.push({ ...result, variantIndex: job.index, psm: job.psm, oem: 1, mode });
        }
      } catch {}
    }
  }
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function recognizeProjectPathImagesDetailed(dataUrls) {
  const inputs = (Array.isArray(dataUrls) ? dataUrls : [dataUrls]).filter(Boolean).slice(0, 12);
  if (!inputs.length) throw new Error("Nincs OCR kép.");
  const candidates = [];
  if (findTesseractExe()) {
    const jobs = [];
    for (const [index, dataUrl] of inputs.entries()) {
      for (const psm of [6, 7]) jobs.push({ index, dataUrl, psm, mode: "tsv" });
      for (const psm of [6, 11]) jobs.push({ index, dataUrl, psm, mode: "text" });
    }
    candidates.push(...await runTesseractTextJobs(jobs, PROJECT_PATH_OCR_TESSERACT_WHITELIST));
  }
  if (!candidates.length) {
    for (const [idx, dataUrl] of inputs.slice(0, 4).entries()) {
      try {
        const text = recognizeWindowsDrawingNumberImage(dataUrl);
        if (text) candidates.push({ engine: "windows", text, confidence: 40, variantIndex: idx });
      } catch {}
    }
  }
  const winner = bestPlainTextOcrCandidate(candidates);
  const debugId = saveOcrDebugSnapshot({ inputs, candidates, winner, kind: "project-path" });
  return {
    text: winner.text || "",
    confidence: Number.isFinite(winner.confidence) ? winner.confidence : null,
    engine: winner.engine || "",
    score: Number.isFinite(winner.score) ? winner.score : null,
    debugId
  };
}

function ocrTrainingDirectory() {
  const root = dataDirectory || path.join(effectiveWorkingDirectory || config.workingDirectory || path.dirname(APP_DIR), "data");
  return path.join(root, "ocr-training");
}

function normalizedCorrectionText(value) {
  return normalizeOcrText(value).toLocaleUpperCase("hu-HU");
}

function saveOcrCorrectionSample(req, body) {
  const scannedText = String(body.scannedText || "").trim();
  const correctedText = String(body.correctedText || "").trim();
  if (!scannedText || !correctedText) return { saved: false, reason: "missing-text" };
  if (normalizedCorrectionText(scannedText) === normalizedCorrectionText(correctedText)) {
    return { saved: false, reason: "same-text" };
  }
  const user = currentUser(req);
  const project = body.projectId ? db.projects[body.projectId] : null;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sampleId = `${stamp}-${sanitizeFileName(user?.name || "user").slice(0, 24) || "user"}`;
  const dir = path.join(ocrTrainingDirectory(), sampleId);
  fs.mkdirSync(dir, { recursive: true });

  const rawImages = Array.isArray(body.imageDataUrls)
    ? body.imageDataUrls
    : (body.imageDataUrl ? [body.imageDataUrl] : []);
  const images = [];
  rawImages.slice(0, 8).forEach((dataUrl, index) => {
    try {
      const { extension, buffer } = parseImageDataUrl(dataUrl, 18 * 1024 * 1024);
      const name = `${String(index + 1).padStart(2, "0")}.${extension}`;
      fs.writeFileSync(path.join(dir, name), buffer);
      images.push({ name, bytes: buffer.length });
    } catch (error) {
      images.push({ error: error.message || "image-save-failed" });
    }
  });

  const meta = {
    id: sampleId,
    kind: "drawing-number-correction",
    createdAt: nowIso(),
    user: user ? { id: user.id, name: user.name } : null,
    project: project ? { id: project.id, name: project.name, primaryFolder: project.primaryFolder || "" } : null,
    worklogId: String(body.worklogId || ""),
    cncMachineId: String(body.cncMachineId || ""),
    scannedText,
    correctedText,
    confidence: body.confidence ?? null,
    engine: String(body.engine || ""),
    ocrDebugId: String(body.debugId || ""),
    noteBefore: String(body.noteBefore || ""),
    noteAfter: String(body.noteAfter || ""),
    images
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return { saved: true, id: sampleId };
}

function ocrProjectSnapshot(projectId, fallbackName = "", fallbackFolder = "") {
  const project = projectId ? db.projects[projectId] : null;
  if (project) {
    return {
      id: project.id,
      name: project.name || "",
      primaryFolder: project.primaryFolder || "",
      folderPaths: Array.isArray(project.folderPaths) ? project.folderPaths.slice(0, 8) : []
    };
  }
  if (!projectId && !fallbackName && !fallbackFolder) return null;
  return {
    id: String(projectId || ""),
    name: String(fallbackName || ""),
    primaryFolder: String(fallbackFolder || ""),
    folderPaths: []
  };
}

function saveOcrProjectCorrectionSample(req, body) {
  const scannedProjectId = String(body.scannedProjectId || "").trim();
  const correctedProjectId = String(body.correctedProjectId || body.projectId || "").trim();
  if (!scannedProjectId || !correctedProjectId) return { saved: false, reason: "missing-project" };
  if (scannedProjectId === correctedProjectId) return { saved: false, reason: "same-project" };

  const user = currentUser(req);
  const scannedProject = ocrProjectSnapshot(scannedProjectId, body.scannedProjectName, body.scannedProjectFolder);
  const correctedProject = ocrProjectSnapshot(correctedProjectId, body.correctedProjectName, body.correctedProjectFolder);
  if (!scannedProject || !correctedProject) return { saved: false, reason: "missing-project" };

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const sampleId = `${stamp}-project-${sanitizeFileName(user?.name || "user").slice(0, 24) || "user"}`;
  const dir = path.join(ocrTrainingDirectory(), sampleId);
  fs.mkdirSync(dir, { recursive: true });

  const rawImages = Array.isArray(body.imageDataUrls)
    ? body.imageDataUrls
    : (body.imageDataUrl ? [body.imageDataUrl] : []);
  const images = [];
  rawImages.slice(0, 8).forEach((dataUrl, index) => {
    try {
      const { extension, buffer } = parseImageDataUrl(dataUrl, 18 * 1024 * 1024);
      const name = `${String(index + 1).padStart(2, "0")}.${extension}`;
      fs.writeFileSync(path.join(dir, name), buffer);
      images.push({ name, bytes: buffer.length });
    } catch (error) {
      images.push({ error: error.message || "image-save-failed" });
    }
  });

  const meta = {
    id: sampleId,
    kind: "project-selection-correction",
    createdAt: nowIso(),
    user: user ? { id: user.id, name: user.name } : null,
    worklogId: String(body.worklogId || ""),
    cncMachineId: String(body.cncMachineId || ""),
    scannedText: String(body.scannedText || "").trim(),
    scannedProject,
    correctedProject,
    confidence: body.confidence ?? null,
    engine: String(body.engine || ""),
    ocrDebugId: String(body.debugId || ""),
    match: {
      score: body.matchScore ?? null,
      tokenRatio: body.tokenRatio ?? null,
      descriptorRatio: body.descriptorRatio ?? null,
      folderApproxScore: body.folderApproxScore ?? null,
      codeHit: Boolean(body.codeHit),
      rootHit: Boolean(body.rootHit),
      rootMismatch: Boolean(body.rootMismatch),
      scannedRoot: String(body.scannedRoot || ""),
      scannedCodes: Array.isArray(body.scannedCodes) ? body.scannedCodes.map(String).slice(0, 8) : []
    },
    images
  };
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  return { saved: true, id: sampleId };
}

function resolveProjectFromBody(body) {
  if (body.projectId && db.projects[body.projectId]) {
    const project = db.projects[body.projectId];
    return { projectId: project.id, projectName: project.name, sideProject: false };
  }
  return { projectId: null, projectName: "", sideProject: false };
}

function userName(userId) {
  return db.users.find((user) => user.id === userId)?.name || "";
}

function creatorFields(req) {
  const user = currentUser(req);
  return {
    createdByUserId: user?.id || "",
    createdByName: user?.name || ""
  };
}

function creatorFieldsForUser(user) {
  return {
    createdByUserId: user?.id || "",
    createdByName: user?.name || ""
  };
}

function worklogImportBaseDir() {
  return path.join(effectiveWorkingDirectory || DEFAULT_CONFIG.workingDirectory, "imports", "worklogs");
}

function worklogImportInboxDir() {
  return path.join(worklogImportBaseDir(), "inbox");
}

function worklogImportFailedDir() {
  return path.join(worklogImportBaseDir(), "failed");
}

function ensureWorklogImportDirs() {
  fs.mkdirSync(worklogImportInboxDir(), { recursive: true });
  fs.mkdirSync(worklogImportFailedDir(), { recursive: true });
}

function normalizeImportedUserName(value) {
  return normalizeKey(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function importedWorklogUser(entry) {
  const userId = normalizeImportText(entry.userId || entry.erpUserId || "", 120);
  const userName = normalizeImportText(entry.userName || entry.user || "", 200);
  if (!userId && !userName) {
    throw new Error("Missing user. Send userId, userName, or user for every entry.");
  }

  const visibleUsers = (db.users || []).filter((user) => user && !user.hidden);
  let byId = null;
  let byName = null;

  if (userId) {
    byId = visibleUsers.find((user) => normalizeKey(user.id) === normalizeKey(userId)) || null;
    if (!byId) throw new Error(`Unknown ERP userId: ${userId}`);
  }

  if (userName) {
    const normalizedName = normalizeImportedUserName(userName);
    const matches = visibleUsers.filter((user) => normalizeImportedUserName(user.name) === normalizedName);
    if (!matches.length) throw new Error(`Unknown ERP userName: ${userName}`);
    if (matches.length > 1) throw new Error(`Ambiguous ERP userName: ${userName}. Send userId instead.`);
    byName = matches[0];
  }

  if (byId && byName && String(byId.id) !== String(byName.id)) {
    throw new Error("userId and userName refer to different ERP users.");
  }
  return byId || byName;
}

function defaultImportedWorkType() {
  const types = Array.isArray(db.workTypes) ? db.workTypes : [];
  return types.find((type) => normalizeKey(type) === normalizeKey("3D Tervezés"))
    || types.find((type) => normalizeKey(type).includes(normalizeKey("Tervezés")))
    || types[0]
    || "Importált munka";
}

function normalizeImportText(value, maxLength = 500) {
  return String(value || "").trim().slice(0, maxLength);
}

function importProjectFromEntry(entry) {
  // Returns { project, attempted }. project is null when the name can't be
  // resolved — the caller imports such entries WITHOUT a project so the user
  // can assign it later in the ERP (no data is lost on a wrong project name).
  const projectId = normalizeImportText(entry.projectId || entry.erpProjectId || "", 120);
  if (projectId && db.projects[projectId]) {
    return { project: db.projects[projectId], attempted: db.projects[projectId].name };
  }
  if (projectId) {
    const previous = Object.values(db.projects).filter((project) => (project.previousProjectIds || []).includes(projectId));
    if (previous.length === 1) return { project: previous[0], attempted: previous[0].name };
  }
  const projectName = normalizeImportText(entry.projectName || entry.project || entry.projectFolder || "", 300);
  if (!projectName) return { project: null, attempted: "" };
  return { project: findProjectByName(projectName) || null, attempted: projectName };
}

function importWorkDate(entry) {
  const explicit = normalizeImportText(entry.workDate || entry.date || "", 40);
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;
  const fromStamp = dateOnly(entry.startedAt || entry.start || entry.endedAt || entry.end || "");
  return fromStamp || todayLocalDate();
}

function importHours(entry) {
  const candidates = [
    ["hours", 1],
    ["durationHours", 1],
    ["minutes", 1 / 60],
    ["durationMinutes", 1 / 60],
    ["seconds", 1 / 3600],
    ["durationSeconds", 1 / 3600],
    ["milliseconds", 1 / 3600000],
    ["durationMilliseconds", 1 / 3600000]
  ];
  for (const [key, multiplier] of candidates) {
    if (entry[key] === undefined || entry[key] === null || entry[key] === "") continue;
    const value = Number(entry[key]);
    if (!Number.isFinite(value)) throw new Error(`Invalid numeric duration field: ${key}`);
    const hours = Math.round(value * multiplier * 100) / 100;
    if (hours <= 0 || hours > 24) throw new Error("Imported hours must be > 0 and <= 24 per entry.");
    return hours;
  }
  throw new Error("Missing duration. Send hours, minutes, seconds, or milliseconds.");
}

function importedWorklogNote(entry, unknownProjectName = "") {
  const parts = [];
  if (unknownProjectName) parts.push(`Ismeretlen projekt az importból: ${unknownProjectName} - állítsd be a projektet kézzel.`);
  const note = normalizeImportText(entry.note || entry.description || "", 2000);
  if (note) parts.push(note);
  const startedAt = normalizeImportText(entry.startedAt || entry.start || "", 80);
  const endedAt = normalizeImportText(entry.endedAt || entry.end || "", 80);
  if (startedAt || endedAt) parts.push(`Időmérő: ${startedAt || "?"} - ${endedAt || "?"}`);
  return parts.join("\n");
}

function normalizeWorklogImportEntries(payload) {
  if (Array.isArray(payload)) return { source: "external-time-tracker", entries: payload, defaults: {} };
  if (!payload || typeof payload !== "object") throw new Error("Import JSON must be an object or an array.");
  if (Array.isArray(payload.entries)) {
    return {
      source: normalizeImportText(payload.source || "external-time-tracker", 120),
      entries: payload.entries,
      defaults: payload.defaults && typeof payload.defaults === "object" ? payload.defaults : {}
    };
  }
  return { source: normalizeImportText(payload.source || "external-time-tracker", 120), entries: [payload], defaults: {} };
}

function buildImportedWorklog(entry, context) {
  if (!entry || typeof entry !== "object") throw new Error("Each entry must be an object.");
  const merged = { ...(context.defaults || {}), ...entry };
  const importUser = importedWorklogUser(merged);
  const { project, attempted } = importProjectFromEntry(merged);
  const source = normalizeImportText(merged.source || context.source || "external-time-tracker", 120);
  const externalId = normalizeImportText(merged.externalId || merged.id || "", 200);
  if (externalId && (db.workLogs || []).some((log) => log.importSource === source && log.externalId === externalId)) {
    return null;
  }
  const workType = normalizeImportText(merged.workType || merged.activity || context.defaults?.workType || defaultImportedWorkType(), 200);
  return {
    id: id(),
    projectId: project ? project.id : "",
    projectName: project ? project.name : "",
    workType,
    hours: importHours(merged),
    cncMachineId: "",
    cncMachineName: "",
    workDate: importWorkDate(merged),
    overtime: booleanFlag(merged.overtime) && isNamedErpUser(importUser, "DemoUser"),
    note: importedWorklogNote(merged, project ? "" : attempted),
    filePath: "",
    fileName: "",
    userId: importUser.id,
    createdByUserId: importUser.id,
    createdByName: importUser.name,
    createdAt: nowIso(),
    importSource: source,
    externalId,
    importFile: context.fileName || "",
    importedAt: nowIso()
  };
}

function uniqueFailedImportPath(fileName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = path.basename(fileName || "import.json").replace(/[^\w .@()+,-]/g, "_");
  return path.join(worklogImportFailedDir(), `${stamp}_${safeName}`);
}

async function failWorklogImportFile(filePath, error) {
  try { ensureWorklogImportDirs(); } catch {}
  const failedPath = uniqueFailedImportPath(path.basename(filePath));
  try {
    await fsp.rename(filePath, failedPath);
  } catch {
    try {
      await fsp.copyFile(filePath, failedPath);
      await fsp.rm(filePath, { force: true });
    } catch (moveError) {
      console.error("[worklog-import] failed to quarantine file:", moveError.message);
      return;
    }
  }
  try {
    await fsp.writeFile(`${failedPath}.error.txt`, `${new Date().toISOString()}\n${error?.stack || error?.message || String(error)}\n`, "utf8");
  } catch {}
}

// Quarantine only the entries that failed within an otherwise-good batch.
// Writes a JSON containing just the failed entries (re-droppable after the
// source app fixes the reported errors) plus an .error.txt listing reasons.
// Preserve envelope defaults because they may contain the required user.
async function quarantineFailedEntries(fileName, failures, source, defaults = {}) {
  try { ensureWorklogImportDirs(); } catch {}
  const failedPath = uniqueFailedImportPath(fileName);
  const payload = {
    source: source || "external-time-tracker",
    defaults: defaults && typeof defaults === "object" ? defaults : {},
    note: "Ezek a tételek NEM importálódtak (a fájl többi tétele igen). Javítsd a jelzett hibákat, majd dobd vissza az inbox mappába.",
    entries: failures.map((f) => f.entry)
  };
  try {
    await fsp.writeFile(failedPath, JSON.stringify(payload, null, 2), "utf8");
    const lines = failures.map((f) => {
      const userLabel = f.entry?.userName || f.entry?.user || f.entry?.userId || f.entry?.erpUserId || "?";
      const projectLabel = f.entry?.projectName || f.entry?.project || "?";
      return `#${f.index} (felhasználó: ${userLabel}; projekt: ${projectLabel}): ${f.error}`;
    }).join("\n");
    await fsp.writeFile(`${failedPath}.error.txt`, `${new Date().toISOString()}\n${lines}\n`, "utf8");
  } catch (writeError) {
    console.error("[worklog-import] failed to quarantine entries:", writeError.message);
  }
}

async function importWorklogFile(filePath) {
  const fileName = path.basename(filePath);
  try {
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return { imported: 0, skipped: 0 };
    if (Date.now() - stat.mtimeMs < 750) return { imported: 0, skipped: 0, deferred: true };
    const raw = await fsp.readFile(filePath, "utf8");
    // Strip a UTF-8 BOM if present — PowerShell 5.1's Set-Content and many
    // other Windows tools prepend one, and JSON.parse rejects it.
    const text = raw.charCodeAt(0) === 0xFEFF ? raw.slice(1) : raw;
    const parsed = JSON.parse(text);
    const normalized = normalizeWorklogImportEntries(parsed);
    const context = {
      source: normalized.source,
      defaults: normalized.defaults,
      fileName
    };
    // Per-entry isolation: one bad entry (e.g. missing or unknown user) must NOT
    // sink the whole batch. Good entries import; failed entries are
    // quarantined to failed\ as their own JSON + .error.txt; duplicates
    // (already-imported externalId) are silently skipped.
    const built = [];
    const failures = [];
    let deduped = 0;
    normalized.entries.forEach((entry, index) => {
      try {
        const log = buildImportedWorklog(entry, context);
        if (log) built.push(log);
        else deduped += 1;
      } catch (error) {
        failures.push({ index, error: error.message, entry });
      }
    });
    if (built.length) {
      db.workLogs.unshift(...built.slice().reverse());
      saveDb();
    }
    if (failures.length) {
      await quarantineFailedEntries(fileName, failures, normalized.source, normalized.defaults);
    }
    await fsp.rm(filePath, { force: true });
    console.log(`[worklog-import] ${fileName}: imported ${built.length}, deduped ${deduped}, failed ${failures.length}.`);
    return { imported: built.length, skipped: deduped, failed: failures.length };
  } catch (error) {
    console.error(`[worklog-import] ${fileName}: ${error.message}`);
    await failWorklogImportFile(filePath, error);
    return { imported: 0, skipped: 0, failed: true };
  }
}

// Published list of valid work types for the external time-tracker app.
// Rewritten (atomically) whenever db.workTypes changes — checked on the
// same 10 s tick as the import scan, so catalog edits propagate within
// one tick. Also rewritten if someone deletes the file.
let lastPublishedWorkTypesJson = null;

function syncWorkTypesFile() {
  try {
    const workTypes = Array.isArray(db?.workTypes) ? db.workTypes : [];
    const listJson = JSON.stringify(workTypes);
    const filePath = path.join(worklogImportBaseDir(), "worktypes.json");
    if (listJson === lastPublishedWorkTypesJson && fs.existsSync(filePath)) return;
    const payload = JSON.stringify({
      updatedAt: nowIso(),
      defaultWorkType: defaultImportedWorkType(),
      workTypes
    }, null, 2);
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, payload, "utf8");
    fs.renameSync(tmpPath, filePath);
    lastPublishedWorkTypesJson = listJson;
    console.log(`[worklog-import] worktypes.json frissítve (${workTypes.length} típus).`);
  } catch (error) {
    console.error("[worklog-import] worktypes.json írás hiba:", error.message);
  }
}

async function importWorklogDropFolder() {
  if (worklogImportRunning || isShuttingDown) return;
  worklogImportRunning = true;
  try {
    ensureWorklogImportDirs();
    syncWorkTypesFile();
    const entries = await fsp.readdir(worklogImportInboxDir(), { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && /\.json$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort()
      .slice(0, WORKLOG_IMPORT_MAX_FILES_PER_TICK);
    for (const fileName of files) {
      await importWorklogFile(path.join(worklogImportInboxDir(), fileName));
    }
  } catch (error) {
    console.error("[worklog-import] scan failed:", error.message);
  } finally {
    worklogImportRunning = false;
  }
}

function itemCreatedByUser(item, user) {
  if (!item || !user) return false;
  if (item.createdByUserId) return item.createdByUserId === user.id;
  if (item.createdByName) return normalizeKey(item.createdByName) === normalizeKey(user.name);
  return false;
}

function canDeleteOwnedEntry(req, item) {
  const user = currentUser(req);
  return userHasClearance(user, 2) || itemCreatedByUser(item, user);
}

function requireDeleteOwnedEntry(req, res, item) {
  if (!currentUser(req)) {
    sendAuthRequired(res);
    return false;
  }
  if (canDeleteOwnedEntry(req, item)) return true;
  sendJson(res, 403, { clearanceRequired: true, error: "Csak saját létrehozású tételt törölhetsz." });
  return false;
}

function canDeleteFileEntry(req, record) {
  if (canDeleteOwnedEntry(req, record)) return true;
  if (record?.taskId) {
    const task = db.tasks.find((item) => item.id === record.taskId);
    if (canDeleteOwnedEntry(req, task)) return true;
  }
  if (record?.cncTaskId) {
    const task = db.cncTasks.find((item) => item.id === record.cncTaskId);
    if (canDeleteOwnedEntry(req, task)) return true;
  }
  return false;
}

function requireDeleteFileEntry(req, res, record) {
  if (!currentUser(req)) {
    sendAuthRequired(res);
    return false;
  }
  if (canDeleteFileEntry(req, record)) return true;
  sendJson(res, 403, { clearanceRequired: true, error: "Csak saját csatolmányt törölhetsz." });
  return false;
}

function isKnownUser(userId) {
  return Boolean(userId && db.users.some((user) => user.id === userId));
}

function machineName(machineId) {
  return db.cncMachines.find((machine) => machine.id === machineId)?.name || "";
}

function isKnownMachine(machineId) {
  return Boolean(machineId && db.cncMachines.some((machine) => machine.id === machineId));
}

const CATALOG_KEYS = {
  material: "materialNames",
  type: "materialTypes",
  materialLength: "materialLengths",
  externalCompany: "externalCompanies",
  prefabTaskType: "prefabTaskTypes",
  workType: "workTypes",
  fastenerType: "fastenerTypes",
  fastenerGrade: "fastenerGrades",
  fastenerSize: "fastenerSizes",
  toolName: "toolNames"
};

function catalogKey(kind) {
  return CATALOG_KEYS[kind] || null;
}

function addCatalogValue(kind, value) {
  const key = catalogKey(kind);
  if (!key) return;
  const clean = String(value || "").trim();
  if (!clean) return;
  db[key] = db[key] || [];
  if (!db[key].some((item) => normalizeKey(item) === normalizeKey(clean))) {
    db[key].push(clean);
    db[key].sort((a, b) => a.localeCompare(b, "hu"));
  }
}

function normalizeTaskPriority(value) {
  const priority = Number(value);
  return Number.isInteger(priority) && priority >= 1 && priority <= 10 ? priority : "";
}

function projectStorageFolder(project) {
  if (!project.storageFolder) {
    const folderName = `${sanitizeFileName(project.name)}_${stampForPath(project.createdAt)}`;
    project.storageFolder = path.join(uploadsDirectory, folderName);
  }
  fs.mkdirSync(project.storageFolder, { recursive: true });
  return project.storageFolder;
}

function isPathInside(parentPath, childPath) {
  if (!parentPath || !childPath) return false;
  const parent = path.resolve(parentPath);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

// --- Hard safety rail for recursive directory deletes ----------------------
// A bug that leaves a base path empty or wrong must NEVER let an automated
// cleanup (logs, OCR debug, backups, manual-backup retention) recurse into a
// drive root or network-share root. Every recursive delete in this server goes
// through safeRmrf / safeRmrfSync, which first resolve + validate the target:
//   * non-empty string
//   * not a filesystem/drive/UNC-share root (e.g. "C:\\", "Y:\\", "\\\\srv\\share\\", "/")
//   * at least `minDepth` path segments below the root (no shallow paths)
//   * when `base` is given, strictly INSIDE that base (never equal to / outside it)
// On any doubt they refuse and log, returning false instead of deleting.
function safeResolveForDelete(targetPath, { base = "", minDepth = 2 } = {}) {
  try {
    if (!targetPath || typeof targetPath !== "string") return null;
    const resolved = path.resolve(targetPath);
    const root = path.parse(resolved).root;
    if (!resolved || !root) return null;
    if (resolved.replace(/[\\/]+$/, "") === root.replace(/[\\/]+$/, "")) return null; // drive / share / fs root
    const segments = resolved.slice(root.length).split(/[\\/]+/).filter(Boolean);
    if (segments.length < minDepth) return null; // too shallow (e.g. "C:\\foo", "\\\\srv\\share")
    if (base) {
      const baseResolved = path.resolve(base);
      const baseRoot = path.parse(baseResolved).root;
      if (!baseResolved || baseResolved.replace(/[\\/]+$/, "") === baseRoot.replace(/[\\/]+$/, "")) return null;
      const rel = path.relative(baseResolved, resolved);
      if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null; // outside base, or equal to base
    }
    return resolved;
  } catch {
    return null;
  }
}

function safeRmrfSync(targetPath, options = {}) {
  const resolved = safeResolveForDelete(targetPath, options);
  if (!resolved) {
    try { console.error(`[safe-delete] refused unsafe recursive delete: ${String(targetPath)}`); } catch {}
    return false;
  }
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
    return true;
  } catch (error) {
    try { console.error(`[safe-delete] failed for ${resolved}: ${error.message}`); } catch {}
    return false;
  }
}

async function safeRmrf(targetPath, options = {}) {
  const resolved = safeResolveForDelete(targetPath, options);
  if (!resolved) {
    try { console.error(`[safe-delete] refused unsafe recursive delete: ${String(targetPath)}`); } catch {}
    return false;
  }
  try {
    await fsp.rm(resolved, { recursive: true, force: true });
    return true;
  } catch (error) {
    try { console.error(`[safe-delete] failed for ${resolved}: ${error.message}`); } catch {}
    return false;
  }
}

function safeRemoveErpFileOrFolder(targetPath) {
  if (!targetPath) return;
  const resolved = path.resolve(targetPath);
  const uploadsRoot = path.resolve(uploadsDirectory || "");
  if (!isPathInside(uploadsRoot, resolved)) return;
  safeRmrfSync(resolved, { base: uploadsRoot });
}

function dashboardTodoImageFolder() {
  const folder = path.join(uploadsDirectory, "_dashboard_todos");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function cncTaskImageFolder() {
  const folder = path.join(uploadsDirectory, "_cnc_tasks");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function taskImageFolder() {
  const folder = path.join(uploadsDirectory, "_tasks");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function materialRequestImageFolder() {
  const folder = path.join(uploadsDirectory, "_material_requests");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function storeCncTaskImage(dataUrl, preferredName = "") {
  const value = String(dataUrl || "");
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Csak beillesztett képfájl menthető.");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("A beillesztett kép üres.");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("A kép túl nagy. Maximum 10 MB lehet.");
  const extension = extByMime[mime] || ".png";
  const baseName = sanitizeFileName(preferredName || `cnc-kep-${stampForPath(nowIso())}${extension}`);
  const fileName = path.extname(baseName) ? baseName : `${baseName}${extension}`;
  const targetPath = uniquePath(cncTaskImageFolder(), fileName);
  fs.writeFileSync(targetPath, buffer);
  return {
    kind: "upload",
    name: path.basename(targetPath),
    path: targetPath,
    mime,
    size: buffer.length,
    createdAt: nowIso()
  };
}

function storeTaskImage(dataUrl, preferredName = "") {
  const value = String(dataUrl || "");
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Csak beillesztett képfájl menthető.");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("A beillesztett kép üres.");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("A kép túl nagy. Maximum 10 MB lehet.");
  const extension = extByMime[mime] || ".png";
  const baseName = sanitizeFileName(preferredName || `feladat-kep-${stampForPath(nowIso())}${extension}`);
  const fileName = path.extname(baseName) ? baseName : `${baseName}${extension}`;
  const targetPath = uniquePath(taskImageFolder(), fileName);
  fs.writeFileSync(targetPath, buffer);
  return {
    kind: "upload",
    name: path.basename(targetPath),
    path: targetPath,
    mime,
    size: buffer.length,
    createdAt: nowIso()
  };
}

function storeMaterialRequestImage(dataUrl, preferredName = "") {
  const value = String(dataUrl || "");
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Csak beillesztett képfájl menthető.");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("A beillesztett kép üres.");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("A kép túl nagy. Maximum 10 MB lehet.");
  const extension = extByMime[mime] || ".png";
  const baseName = sanitizeFileName(preferredName || `anyagigeny-kep-${stampForPath(nowIso())}${extension}`);
  const fileName = path.extname(baseName) ? baseName : `${baseName}${extension}`;
  const targetPath = uniquePath(materialRequestImageFolder(), fileName);
  fs.writeFileSync(targetPath, buffer);
  return {
    kind: "upload",
    name: path.basename(targetPath),
    path: targetPath,
    mime,
    size: buffer.length,
    createdAt: nowIso()
  };
}

function dropTaskImages(item) {
  for (const image of item?.images || []) {
    if (image?.kind === "upload") safeRemoveErpFileOrFolder(image.path);
  }
  item.images = [];
}

function dropCncTaskImages(item) {
  for (const image of item?.images || []) {
    if (image?.kind === "upload") safeRemoveErpFileOrFolder(image.path);
  }
  item.images = [];
}

function dropMaterialRequestImages(item) {
  for (const image of item?.images || []) {
    if (image?.kind === "upload") safeRemoveErpFileOrFolder(image.path);
  }
  item.images = [];
}

function storeDashboardTodoImage(dataUrl, preferredName = "") {
  const value = String(dataUrl || "");
  if (!value) return null;
  const match = value.match(/^data:(image\/(?:png|jpeg|jpg|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw new Error("Csak beillesztett képfájl menthető.");
  const mime = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/gif": ".gif",
    "image/webp": ".webp"
  };
  const buffer = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!buffer.length) throw new Error("A beillesztett kép üres.");
  if (buffer.length > 10 * 1024 * 1024) throw new Error("A kép túl nagy. Maximum 10 MB lehet.");
  const extension = extByMime[mime] || ".png";
  const baseName = sanitizeFileName(preferredName || `dashboard-kep-${stampForPath(nowIso())}${extension}`);
  const fileName = path.extname(baseName) ? baseName : `${baseName}${extension}`;
  const targetPath = uniquePath(dashboardTodoImageFolder(), fileName);
  fs.writeFileSync(targetPath, buffer);
  return {
    kind: "upload",
    name: path.basename(targetPath),
    path: targetPath,
    mime,
    size: buffer.length,
    createdAt: nowIso()
  };
}

const PROJECT_ARCHIVE_COLLECTIONS = [
  "tasks",
  "cncTasks",
  "boms",
  "toolRequests",
  "materialRequests",
  "fastenerRequests",
  "workLogs",
  "files",
  "pushSubscriptions",
  "notifications",
  "financePriceItems",
  "financeCostItems",
  "financeOutsourceItems",
  "financeProductionItems",
  "engineeringDesignItems",
  "financeQuotes",
  "engineeringNotes"
];

function clonePlain(value) {
  return JSON.parse(JSON.stringify(value));
}

function addProjectFolderExclusions(project) {
  const paths = [project.primaryFolder, ...(project.folderPaths || [])].filter(Boolean);
  db.projectFolderExclusions = db.projectFolderExclusions || [];
  for (const folderPath of paths) {
    if (!db.projectFolderExclusions.some((item) => normalizeFsPath(item) === normalizeFsPath(folderPath))) {
      db.projectFolderExclusions.push(folderPath);
    }
  }
}

function archiveProjectFromErp(projectId, options = {}) {
  const {
    excludeFromRescan = true,
    reason = "manual",
    archivedByUser = null
  } = options;
  const project = db.projects[projectId];
  if (!project) return null;

  if (excludeFromRescan) addProjectFolderExclusions(project);

  const data = {};
  for (const collection of PROJECT_ARCHIVE_COLLECTIONS) {
    data[collection] = (db[collection] || []).filter((item) => item.projectId === projectId);
  }

  const archive = {
    id: id(),
    type: "project",
    projectId,
    projectName: project.name,
    archivedAt: nowIso(),
    archivedByUserId: archivedByUser?.id || "",
    archivedByName: archivedByUser?.name || "",
    reason,
    project: clonePlain(project),
    data: clonePlain(data),
    counts: Object.fromEntries(PROJECT_ARCHIVE_COLLECTIONS.map((collection) => [collection, data[collection].length]))
  };

  db.archives = db.archives || [];
  db.archives.unshift(archive);

  for (const collection of PROJECT_ARCHIVE_COLLECTIONS) {
    db[collection] = (db[collection] || []).filter((item) => item.projectId !== projectId);
  }
  delete db.projects[projectId];
  normalizePriorities();
  return archive;
}

const TASK_ARCHIVE_TYPES = ["task", "cnc-task", "tool-request", "material-request", "fastener-request", "work-log"];

function normalizePrefabDirection(value) {
  return value === "elvinni" ? "elvinni" : "elhozni";
}

function materialRequestLabel(item) {
  if (item?.prefabTransport) {
    return ["Előgyártmány szállítás", normalizePrefabDirection(item.prefabDirection), item.externalCompany, item.prefabTaskType].filter(Boolean).join(" · ") || "Előgyártmány szállítás";
  }
  return [item?.material, item?.size, formatMaterialLength(item?.length)].filter(Boolean).join(" · ") || "anyag";
}

function formatMaterialLength(value) {
  const text = String(value ?? "").trim();
  return /^[+]?\d+(?:[.,]\d+)?$/.test(text) ? `${text} mm` : text;
}

function workLogTotalHours(item) {
  return Number(item?.hours || 0) || 0;
}

function taskArchiveLabel(type, item) {
  if (!item) return "tétel";
  switch (type) {
    case "task": return item.title || "feladat";
    case "cnc-task": return item.machineName || machineName(item.machineId) || "CNC";
    case "tool-request": return item.toolName || "szerszám";
    case "material-request": return materialRequestLabel(item);
    case "fastener-request": return [item.grade, item.size].filter(Boolean).join(" · ") || "kötőelem";
    case "work-log": return `${item.cncMachineName ? `CNC: ${item.cncMachineName}` : (item.workType || "munka")} · ${workLogTotalHours(item)} óra`;
    default: return "tétel";
  }
}

function archiveDeletedTask(type, item, user) {
  if (!item) return null;
  // Strip pasted images — they're already (or about to be) removed from disk.
  const data = clonePlain({ ...item, images: undefined });
  delete data.images;
  const project = item.projectId ? db.projects[item.projectId] : null;
  const archive = {
    id: id(),
    type,
    projectId: item.projectId || "",
    projectName: project?.name || item.projectName || "",
    itemLabel: taskArchiveLabel(type, item),
    archivedAt: nowIso(),
    archivedByUserId: user?.id || "",
    archivedByName: user?.name || "",
    reason: "manual-delete",
    data
  };
  db.archives = db.archives || [];
  db.archives.unshift(archive);
  return archive;
}

function purgeArchivedRecord(archiveId) {
  if ((db.archives || []).some((archive) => archive.id === archiveId && archive.restoredAt)) return null;
  const archive = removeFromCollection(db.archives || [], archiveId);
  if (!archive) return null;

  if (archive.type === "project") {
    const project = archive.project || {};
    for (const file of archive.data?.files || []) {
      if (file.kind === "upload") safeRemoveErpFileOrFolder(file.path);
    }
    for (const bom of archive.data?.boms || []) {
      if (bom.kind === "upload") safeRemoveErpFileOrFolder(bom.path);
    }
    safeRemoveErpFileOrFolder(project.storageFolder);
  }
  if (archive.data?.attachment?.kind === "upload") {
    safeRemoveErpFileOrFolder(archive.data.attachment.path);
  }

  return archive;
}

function archiveState() {
  return {
    archives: db.archives || []
  };
}

function validateNetworkLink(filePath) {
  const value = String(filePath || "").trim();
  if (!value) throw new Error("Hiányzik az útvonal.");
  if (/^c:\\/i.test(value)) throw new Error("Helyi C: meghajtós fájl nem linkelhető. Tedd Y:-ra vagy más hálózati meghajtóra.");
  if (!/^[a-z]:\\/i.test(value) && !/^\\\\/.test(value)) {
    throw new Error("Adj meg teljes hálózati vagy meghajtós útvonalat.");
  }
  return value;
}

function optionalNetworkPath(filePath) {
  const value = String(filePath || "").trim();
  return value ? validateNetworkLink(value) : "";
}

function validateYDrivePath(filePath) {
  const value = String(filePath || "").trim();
  if (!value) throw new Error("Hiányzik az útvonal.");
  if (!/^y:\\/i.test(value)) {
    throw new Error("Csak Y: meghajtós útvonal engedélyezett.");
  }
  return value;
}

function optionalYDrivePath(filePath) {
  const value = String(filePath || "").trim();
  return value ? validateYDrivePath(value) : "";
}

function cleanDesignPaths(body, patch = false) {
  const keys = ["drawingPath", "stepPath", "camPath", "ncPath", "eplanPath", "plcPath", "instructionPath"];
  const result = {};
  for (const key of keys) {
    if (!patch || key in body) result[key] = optionalNetworkPath(body[key]);
  }
  return result;
}

function configuredBrowseRoots() {
  const candidates = [
    ...(config.scanRoots || []),
    config.workingDirectory,
    effectiveWorkingDirectory
  ].filter(Boolean);
  const roots = [];
  for (const candidate of candidates) {
    const root = path.parse(candidate).root || candidate;
    if (!root || /^c:\\?$/i.test(root)) continue;
    if (!roots.some((item) => normalizeFsPath(item) === normalizeFsPath(root))) {
      roots.push(root);
    }
  }
  return roots;
}

function assertBrowsablePath(targetPath) {
  const clean = validateNetworkLink(targetPath);
  if (/^c:\\?$/i.test(path.parse(clean).root)) {
    throw new Error("C: meghajtót nem lehet linkként tallózni.");
  }
  return clean;
}

const REQUEST_ATTACHMENT_MIME_TYPES = new Map([
  [".pdf", "application/pdf"],
  [".doc", "application/msword"],
  [".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  [".docm", "application/vnd.ms-word.document.macroEnabled.12"],
  [".dot", "application/msword"],
  [".dotx", "application/vnd.openxmlformats-officedocument.wordprocessingml.template"],
  [".dotm", "application/vnd.ms-word.template.macroEnabled.12"],
  [".rtf", "application/rtf"],
  [".xls", "application/vnd.ms-excel"],
  [".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  [".xlsm", "application/vnd.ms-excel.sheet.macroEnabled.12"],
  [".xlsb", "application/vnd.ms-excel.sheet.binary.macroEnabled.12"],
  [".xlt", "application/vnd.ms-excel"],
  [".xltx", "application/vnd.openxmlformats-officedocument.spreadsheetml.template"],
  [".xltm", "application/vnd.ms-excel.template.macroEnabled.12"],
  [".csv", "text/csv; charset=utf-8"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  [".pptm", "application/vnd.ms-powerpoint.presentation.macroEnabled.12"],
  [".pps", "application/vnd.ms-powerpoint"],
  [".ppsx", "application/vnd.openxmlformats-officedocument.presentationml.slideshow"],
  [".ppsm", "application/vnd.ms-powerpoint.slideshow.macroEnabled.12"],
  [".pot", "application/vnd.ms-powerpoint"],
  [".potx", "application/vnd.openxmlformats-officedocument.presentationml.template"],
  [".potm", "application/vnd.ms-powerpoint.template.macroEnabled.12"],
  [".vsd", "application/vnd.visio"],
  [".vsdx", "application/vnd.visio"],
  [".vsdm", "application/vnd.visio"],
  [".vss", "application/vnd.visio"],
  [".vssx", "application/vnd.visio"],
  [".vssm", "application/vnd.visio"],
  [".vst", "application/vnd.visio"],
  [".vstx", "application/vnd.visio"],
  [".vstm", "application/vnd.visio"],
  [".mdb", "application/x-msaccess"],
  [".accdb", "application/x-msaccess"],
  [".pub", "application/x-mspublisher"],
  [".one", "application/onenote"],
  [".onepkg", "application/onenote"],
  [".odt", "application/vnd.oasis.opendocument.text"],
  [".ods", "application/vnd.oasis.opendocument.spreadsheet"],
  [".odp", "application/vnd.oasis.opendocument.presentation"],
  [".odg", "application/vnd.oasis.opendocument.graphics"]
]);

function requestAttachmentMimeType(fileName) {
  return REQUEST_ATTACHMENT_MIME_TYPES.get(path.extname(String(fileName || "")).toLowerCase()) || "";
}

function isRequestAttachmentFileName(fileName) {
  return Boolean(requestAttachmentMimeType(fileName));
}

async function browseFiles(folderPath, options = {}) {
  const officeOnly = Boolean(options.officeOnly);
  if (!folderPath) {
    return {
      current: null,
      parent: null,
      entries: configuredBrowseRoots().map((root) => ({
        name: root,
        path: root,
        kind: "folder",
        modifiedAt: "",
        size: null
      }))
    };
  }

  const clean = assertBrowsablePath(folderPath);
  const stat = await fsp.stat(clean);
  if (!stat.isDirectory()) throw new Error("Csak mappát lehet tallózni.");

  const entries = await fsp.readdir(clean, { withFileTypes: true });
  const rows = [];
  for (const entry of entries) {
    const fullPath = path.join(clean, entry.name);
    if (/^c:\\/i.test(fullPath)) continue;
    if (officeOnly && entry.isFile() && !isRequestAttachmentFileName(entry.name)) continue;
    try {
      const itemStat = await fsp.stat(fullPath);
      if (officeOnly && !itemStat.isDirectory() && !isRequestAttachmentFileName(entry.name)) continue;
      rows.push({
        name: entry.name,
        path: fullPath,
        kind: itemStat.isDirectory() ? "folder" : "file",
        modifiedAt: itemStat.mtime.toISOString(),
        size: itemStat.isDirectory() ? null : itemStat.size
      });
    } catch {
      if (officeOnly && !entry.isDirectory() && !isRequestAttachmentFileName(entry.name)) continue;
      rows.push({
        name: entry.name,
        path: fullPath,
        kind: entry.isDirectory() ? "folder" : "file",
        modifiedAt: "",
        size: null
      });
    }
  }

  rows.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
    return a.name.localeCompare(b.name, "hu");
  });

  const parsed = path.parse(clean);
  const parent = normalizeFsPath(clean) === normalizeFsPath(parsed.root) ? null : path.dirname(clean);
  return { current: clean, parent, entries: rows };
}

const PROJECT_BROWSER_EXTENSIONS = new Map([
  [".slddrw", "drawing"],
  [".drw", "drawing"],
  [".dwg", "drawing"],
  [".dxf", "drawing"],
  [".sldasm", "assembly"],
  [".asm", "assembly"],
  [".pdf", "pdf"]
]);

function projectBrowserRoots(project) {
  const values = [
    project?.primaryFolder,
    ...(Array.isArray(project?.folderPaths) ? project.folderPaths : [])
  ].filter(Boolean);
  const roots = [];
  for (const value of values) {
    try {
      const clean = validateNetworkLink(value);
      if (!roots.some((item) => normalizeFsPath(item) === normalizeFsPath(clean))) roots.push(clean);
    } catch {}
  }
  return roots;
}

async function crawlProjectBrowserRoot(rootPath, options = {}) {
  const maxFiles = Number(options.maxFiles || 3000);
  const maxDirs = Number(options.maxDirs || 2500);
  const rows = [];
  let dirsSeen = 0;
  let truncated = false;
  const queue = [rootPath];
  while (queue.length && !truncated) {
    const folder = queue.shift();
    dirsSeen += 1;
    if (dirsSeen > maxDirs) {
      truncated = true;
      break;
    }
    let entries = [];
    try {
      entries = await fsp.readdir(folder, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(folder, entry.name);
      if (/^c:\\/i.test(fullPath)) continue;
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      const kind = PROJECT_BROWSER_EXTENSIONS.get(ext);
      if (!kind) continue;
      try {
        const stat = await fsp.stat(fullPath);
        if (!stat.isFile()) continue;
        rows.push({
          name: entry.name,
          path: fullPath,
          folder: path.dirname(fullPath),
          relativePath: path.relative(rootPath, fullPath),
          kind,
          ext,
          size: stat.size,
          modifiedAt: stat.mtime.toISOString()
        });
      } catch {
        rows.push({
          name: entry.name,
          path: fullPath,
          folder: path.dirname(fullPath),
          relativePath: path.relative(rootPath, fullPath),
          kind,
          ext,
          size: null,
          modifiedAt: ""
        });
      }
      if (rows.length >= maxFiles) {
        truncated = true;
        break;
      }
    }
  }
  return { files: rows, truncated };
}

async function projectBrowserState(project) {
  const roots = projectBrowserRoots(project);
  const files = [];
  const missingRoots = [];
  let truncated = false;
  for (const rootPath of roots) {
    try {
      const stat = await fsp.stat(rootPath);
      if (!stat.isDirectory()) {
        missingRoots.push(rootPath);
        continue;
      }
      const result = await crawlProjectBrowserRoot(rootPath);
      truncated = truncated || result.truncated;
      files.push(...result.files.map((file) => ({ ...file, root: rootPath })));
    } catch {
      missingRoots.push(rootPath);
    }
  }
  const order = { drawing: 0, assembly: 1, pdf: 2 };
  files.sort((a, b) => {
    const typeDiff = (order[a.kind] ?? 9) - (order[b.kind] ?? 9);
    if (typeDiff) return typeDiff;
    return String(a.relativePath || a.name).localeCompare(String(b.relativePath || b.name), "hu");
  });
  return {
    project: {
      id: project.id,
      name: project.name,
      primaryFolder: project.primaryFolder || ""
    },
    roots,
    missingRoots,
    files,
    truncated,
    scannedAt: nowIso()
  };
}

function isPathInsideFolder(filePath, folderPath) {
  const normalizedFile = normalizeFsPath(filePath);
  const normalizedFolder = normalizeFsPath(folderPath);
  return normalizedFile === normalizedFolder || normalizedFile.startsWith(`${normalizedFolder}\\`);
}

function projectBrowserPdfRecord(project, filePath) {
  const clean = validateNetworkLink(filePath);
  if (path.extname(clean).toLowerCase() !== ".pdf") {
    throw new Error("Csak PDF fájl nyitható meg böngészőben.");
  }
  const roots = projectBrowserRoots(project);
  if (!roots.some((rootPath) => isPathInsideFolder(clean, rootPath))) {
    throw new Error("A PDF nem a kiválasztott projekt mappájában van.");
  }
  return { path: clean, name: path.basename(clean) };
}

function markDone(collection, itemId, doneAt = nowIso()) {
  const item = collection.find((entry) => entry.id === itemId);
  if (!item) return null;
  item.status = "done";
  item.doneAt = doneAt || nowIso();
  return item;
}

function validateTimeWindow(start, end) {
  const startText = String(start || "").trim();
  const endText = String(end || "").trim();
  const startTime = Date.parse(startText);
  const endTime = Date.parse(endText);
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
    throw new Error("Adj meg érvényes kezdő és befejező időpontot.");
  }
  if (endTime <= startTime) {
    throw new Error("A befejezés későbbi legyen, mint a kezdés.");
  }
  return {
    plannedStart: new Date(startTime).toISOString(),
    plannedEnd: new Date(endTime).toISOString()
  };
}

function removeFromCollection(collection, itemId) {
  const index = collection.findIndex((entry) => entry.id === itemId);
  if (index < 0) return null;
  const [removed] = collection.splice(index, 1);
  return removed;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function columnName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows) {
  const rowXml = rows.map((row, rowIndex) => {
    const cells = row.map((cell, cellIndex) => {
      const ref = `${columnName(cellIndex + 1)}${rowIndex + 1}`;
      if (typeof cell === "number" && Number.isFinite(cell)) {
        return `<c r="${ref}"><v>${cell}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr"><is><t>${xmlEscape(cell)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xFFFFFFFF;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date = new Date()) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function zipStore(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;
  const stamp = dosDateTime();

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, "utf8");
    const dataBuffer = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, "utf8");
    const crc = crc32(dataBuffer);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuffer.length, 18);
    local.writeUInt32LE(dataBuffer.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    fileParts.push(local, nameBuffer, dataBuffer);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuffer.length, 20);
    central.writeUInt32LE(dataBuffer.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);

    offset += local.length + nameBuffer.length + dataBuffer.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, centralDirectory, end]);
}

function xmlDecode(value) {
  const decoded = String(value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
  const codePoint = (match, raw, radix) => {
    const value = Number.parseInt(raw, radix);
    if (!Number.isInteger(value) || value < 0 || value > 0x10FFFF || (value >= 0xD800 && value <= 0xDFFF)) return match;
    return String.fromCodePoint(value);
  };
  return decoded
    .replace(/&#x([0-9a-f]+);/gi, (match, raw) => codePoint(match, raw, 16))
    .replace(/&#([0-9]+);/g, (match, raw) => codePoint(match, raw, 10));
}

function unzipEntries(buffer) {
  const entries = {};
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Nem olvasható XLSX fájl.");
  const total = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) entries[name] = compressed;
    if (method === 8) entries[name] = zlib.inflateRawSync(compressed);
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function columnIndex(ref) {
  const letters = String(ref || "").replace(/[^A-Z]/g, "");
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

function parseSharedStrings(xml) {
  const strings = [];
  for (const match of String(xml || "").matchAll(/<si[\s\S]*?<\/si>/g)) {
    const texts = [];
    for (const textMatch of match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)) {
      texts.push(xmlDecode(textMatch[1]));
    }
    strings.push(texts.join(""));
  }
  return strings;
}

function parseXlsxRows(buffer) {
  const entries = unzipEntries(buffer);
  const shared = parseSharedStrings(entries["xl/sharedStrings.xml"]?.toString("utf8") || "");
  const sheetName = Object.keys(entries).find((name) => /^xl\/worksheets\/sheet1\.xml$/i.test(name))
    || Object.keys(entries).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error("Nem található munkalap az XLSX fájlban.");
  const xml = entries[sheetName].toString("utf8");
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1] || "";
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] || "";
      const col = columnIndex(ref);
      let value = "";
      if (type === "inlineStr") {
        value = Array.from(body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((item) => xmlDecode(item[1])).join("");
      } else {
        const raw = xmlDecode(body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "");
        value = type === "s" ? (shared[Number(raw)] || "") : raw;
      }
      row[col] = value;
    }
    if (row.some((cell) => String(cell || "").trim())) rows.push(row.map((cell) => String(cell || "").trim()));
  }
  return rows;
}

function parseCsvLine(line, separator) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === "\"" && line[i + 1] === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === separator && !quoted) {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsvRows(buffer) {
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const sample = lines.slice(0, 5).join("\n");
  const separator = (sample.match(/;/g) || []).length >= (sample.match(/,/g) || []).length ? ";" : ",";
  return lines.map((line) => parseCsvLine(line, separator));
}

function normalizedHeader(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("hu-HU")
    .replace(/[^a-z0-9]+/g, "");
}

function headerIndex(headers, names, fallback) {
  const wanted = names.map(normalizedHeader);
  const index = headers.findIndex((header) => wanted.includes(normalizedHeader(header)));
  return index >= 0 ? index : fallback;
}

function rowsToBomItems(rows) {
  if (!rows.length) return [];
  const headers = rows[0];
  const itemIndex = headerIndex(headers, ["tétel", "tetel", "pozíció", "pozicio", "item"], 0);
  const partIndex = headerIndex(headers, ["cikkszám", "cikkszam", "rajzszám", "rajzszam", "part number", "pn"], 1);
  const nameIndex = headerIndex(headers, ["név", "nev", "megnevezés", "megnevezes", "name", "description"], 2);
  const materialIndex = headerIndex(headers, ["anyag", "material"], 3);
  const qtyIndex = headerIndex(headers, ["mennyiség", "mennyiseg", "db", "qty", "quantity"], 4);
  const unitIndex = headerIndex(headers, ["egység", "egyseg", "unit"], 5);
  const noteIndex = headerIndex(headers, ["megjegyzés", "megjegyzes", "note"], 6);
  return rows.slice(1)
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => ({
      item: row[itemIndex] || "",
      partNumber: row[partIndex] || "",
      name: row[nameIndex] || "",
      material: row[materialIndex] || "",
      quantity: row[qtyIndex] || "",
      unit: row[unitIndex] || "",
      note: row[noteIndex] || "",
      raw: row
    }));
}

function parseBomBuffer(buffer, fileName) {
  const ext = path.extname(fileName || "").toLowerCase();
  const rows = ext === ".xlsx" ? parseXlsxRows(buffer) : parseCsvRows(buffer);
  return { rows, items: rowsToBomItems(rows) };
}

async function importBomFile(filePath, fileName = "") {
  const buffer = await fsp.readFile(filePath);
  return parseBomBuffer(buffer, fileName || path.basename(filePath));
}

function bomStorageFolder(project) {
  const folder = path.join(projectStorageFolder(project), "BOM");
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function financeSettings() {
  db.financeSettings = db.financeSettings || {};
  return {
    categories: db.financeSettings.categories?.length ? db.financeSettings.categories : ["Anyag", "Szerszám", "CNC", "Alvállalkozó", "Szállítás", "Egyéb"],
    currencies: db.financeSettings.currencies?.length ? db.financeSettings.currencies : ["HUF", "EUR"],
    statuses: db.financeSettings.statuses?.length ? db.financeSettings.statuses : ["Tervezett", "Rendelve", "Beérkezett", "Számlázva"],
    quoteStatuses: db.financeSettings.quoteStatuses?.length ? db.financeSettings.quoteStatuses : ["Bekérve", "Beérkezett", "Elfogadva", "Elutasítva", "Lejárt"],
    noteTypes: db.financeSettings.noteTypes?.length ? db.financeSettings.noteTypes : ["Döntés", "Változás", "Kockázat", "Kérdés", "Ellenőrzés"],
    noteStatuses: db.financeSettings.noteStatuses?.length ? db.financeSettings.noteStatuses : ["Nyitott", "Folyamatban", "Lezárva"],
    outsourceOperations: db.financeSettings.outsourceOperations?.length ? db.financeSettings.outsourceOperations : ["Fűrészelés", "Huzalszikra", "Hőkezelés", "Felületkezelés", "Köszörülés", "Vízvágás"],
    outsourceStatuses: db.financeSettings.outsourceStatuses?.length ? db.financeSettings.outsourceStatuses : ["Új", "Kiadva", "Folyamatban", "Visszaérkezett", "Kész"],
    productionOperations: db.financeSettings.productionOperations?.length ? db.financeSettings.productionOperations : ["Fűrészelés", "CNC marás", "CNC eszterga", "Huzalszikra", "Szerelés", "Lakatos munka"],
    productionWorkplaces: db.financeSettings.productionWorkplaces?.length ? db.financeSettings.productionWorkplaces : ["CNC-01", "CNC-02", "Külső"],
    productionTypes: db.financeSettings.productionTypes?.length ? db.financeSettings.productionTypes : ["Belső", "Külső"],
    productionPriorities: db.financeSettings.productionPriorities?.length ? db.financeSettings.productionPriorities : ["Magas", "Normál", "Alacsony"],
    productionStatuses: db.financeSettings.productionStatuses?.length ? db.financeSettings.productionStatuses : ["Új", "Folyamatban", "Kiadva", "Kész"],
    costCategories: db.financeSettings.costCategories?.length ? db.financeSettings.costCategories : ["Anyag", "Bérmunka", "Szerszám", "CNC", "Mérnöki", "Szállítás", "Egyéb"],
    designAreas: db.financeSettings.designAreas?.length ? db.financeSettings.designAreas : ["Mechanika CAD", "CAD/CAM", "Villamos tervezés", "PLC", "Dokumentáció"],
    designStatuses: db.financeSettings.designStatuses?.length ? db.financeSettings.designStatuses : ["Új", "Jóváhagyásra vár", "NC kiadva", "EPLAN kész", "Kiadva", "Kész"]
  };
}

function supplierName(supplierId) {
  return (db.financeSuppliers || []).find((supplier) => supplier.id === supplierId)?.name || "";
}

function financeTotal(item) {
  return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

function quarterOf(dateValue) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return "";
  return `Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function financeState() {
  return {
    suppliers: db.financeSuppliers || [],
    priceItems: db.financePriceItems || [],
    costItems: db.financeCostItems || [],
    outsourceItems: db.financeOutsourceItems || [],
    productionItems: db.financeProductionItems || [],
    designItems: db.engineeringDesignItems || [],
    quotes: db.financeQuotes || [],
    engineeringNotes: db.engineeringNotes || [],
    settings: financeSettings()
  };
}

function financeRowsForProject(projectId) {
  const project = db.projects[projectId];
  if (!project) throw new Error("Nincs ilyen projekt.");
  const items = (db.financePriceItems || []).filter((item) => item.projectId === projectId);
  const costItems = (db.financeCostItems || []).filter((item) => item.projectId === projectId);
  const outsourceItems = (db.financeOutsourceItems || []).filter((item) => item.projectId === projectId);
  const productionItems = (db.financeProductionItems || []).filter((item) => item.projectId === projectId);
  const designItems = (db.engineeringDesignItems || []).filter((item) => item.projectId === projectId);
  const quotes = (db.financeQuotes || []).filter((item) => item.projectId === projectId);
  const notes = (db.engineeringNotes || []).filter((item) => item.projectId === projectId);
  const total = items.reduce((sum, item) => sum + financeTotal(item), 0);
  const costPlan = costItems.reduce((sum, item) => sum + Number(item.plannedAmount || 0), 0);
  const costActual = costItems.reduce((sum, item) => sum + Number(item.actualAmount || 0), 0);
  const byCategory = {};
  const byQuarter = {};
  for (const item of items) {
    byCategory[item.category || "Egyéb"] = (byCategory[item.category || "Egyéb"] || 0) + financeTotal(item);
    const year = new Date(item.date || item.createdAt).getFullYear();
    const quarter = quarterOf(item.date || item.createdAt);
    const key = `${year} ${quarter}`;
    byQuarter[key] = (byQuarter[key] || 0) + financeTotal(item);
  }
  return {
    summary: [
      ["Projekt", project.name],
      ["Pénzügyi tételek", items.length],
      ["Költségterv tételek", costItems.length],
      ["Költségterv összesen", costPlan],
      ["Költség tény összesen", costActual],
      ["Bérmunka / külső művelet", outsourceItems.length],
      ["Gyártási feladat", productionItems.length],
      ["Mérnöki / tervezési tétel", designItems.length],
      ["Ajánlatok", quotes.length],
      ["Mérnöki bejegyzések", notes.length],
      ["Összes nettó", total],
      ["Pénznem megjegyzés", "Az összegzés az eredeti pénznemeket nem váltja át."]
    ],
    prices: [["Beszállító", "Kategória", "Megnevezés", "Mennyiség", "Egység", "Egységár", "Pénznem", "Összesen", "Státusz", "Dátum", "Megjegyzés"],
      ...items.map((item) => [item.supplierName || supplierName(item.supplierId), item.category, item.name, Number(item.quantity || 0), item.unit, Number(item.unitPrice || 0), item.currency, financeTotal(item), item.status, item.date, item.note])],
    costItems: [["Kategória", "Tétel", "Terv Ft", "Tény Ft", "Eltérés Ft", "Státusz", "Dátum", "Megjegyzés"],
      ...costItems.map((item) => [item.category, item.name, Number(item.plannedAmount || 0), Number(item.actualAmount || 0), Number(item.actualAmount || 0) - Number(item.plannedAmount || 0), item.status, item.date, item.note])],
    outsource: [["Alkatrész", "Művelet", "Beszállító", "Kiadva", "Vissza várható", "Terv Ft", "Tény Ft", "Státusz", "Következő lépés"],
      ...outsourceItems.map((item) => [item.part, item.operation, item.supplierName || supplierName(item.supplierId), item.issuedAt, item.expectedBackAt, Number(item.plannedAmount || 0), Number(item.actualAmount || 0), item.status, item.nextStep])],
    production: [["Alkatrész", "Művelet", "Gép/Munkahely", "Terv óra", "Tény óra", "Típus", "Beszállító", "Határidő", "Prioritás", "Státusz", "Megjegyzés"],
      ...productionItems.map((item) => [item.part, item.operation, item.workplace, Number(item.plannedHours || 0), Number(item.actualHours || 0), item.type, item.supplierName || supplierName(item.supplierId), item.deadline, item.priority, item.status, item.note])],
    design: [["Terület", "Tétel", "Felelős", "Rev", "Státusz", "%", "Rajz", "STEP", "CAM", "NC", "EPLAN", "PLC", "Utasítás", "Megjegyzés"],
      ...designItems.map((item) => [item.area, item.title, userName(item.userId), item.revision, item.status, Number(item.percent || 0), item.drawingPath, item.stepPath, item.camPath, item.ncPath, item.eplanPath, item.plcPath, item.instructionPath, item.note])],
    quotes: [["Beszállító", "Tárgy", "Összeg", "Pénznem", "Státusz", "Érvényes eddig", "Megjegyzés", "Létrehozva"],
      ...quotes.map((item) => [item.supplierName || supplierName(item.supplierId), item.title, Number(item.amount || 0), item.currency, item.status, item.validUntil, item.note, item.createdAt])],
    engineering: [["Típus", "Tárgy", "Felelős", "Határidő", "Státusz", "Leírás", "Létrehozva", "Lezárva"],
      ...notes.map((item) => [item.type, item.title, userName(item.userId), item.dueDate, item.status, item.note, item.createdAt, item.closedAt || ""])],
    categories: [["Kategória", "Összesen"], ...Object.entries(byCategory)],
    quarters: [["Negyedév", "Összesen"], ...Object.entries(byQuarter).sort((a, b) => a[0].localeCompare(b[0], "hu"))],
    suppliers: [["Név", "Kapcsolat", "Email", "Telefon", "Megjegyzés"], ...(db.financeSuppliers || []).map((item) => [item.name, item.contact, item.email, item.phone, item.note])]
  };
}

function buildFinanceXlsx(projectId) {
  const rows = financeRowsForProject(projectId);
  const settings = financeSettings();
  const sheets = [
    { name: "Osszegzes", rows: rows.summary },
    { name: "Arak", rows: rows.prices },
    { name: "Koltsegterv", rows: rows.costItems },
    { name: "Bermunka", rows: rows.outsource },
    { name: "Gyartasi_feladatok", rows: rows.production },
    { name: "Mernoki_tervezes", rows: rows.design },
    { name: "Ajanlatok", rows: rows.quotes },
    { name: "Mernoki_naplo", rows: rows.engineering },
    { name: "Kategoriak", rows: rows.categories },
    { name: "Negyedevek", rows: rows.quarters },
    { name: "Beszallitok", rows: rows.suppliers },
    { name: "Parameterek", rows: [["Kategoria"], ...settings.categories.map((item) => [item]), [], ["Penznem"], ...settings.currencies.map((item) => [item]), [], ["Statusz"], ...settings.statuses.map((item) => [item]), [], ["Ajanlat statusz"], ...settings.quoteStatuses.map((item) => [item]), [], ["Mernoki tipus"], ...settings.noteTypes.map((item) => [item]), [], ["Mernoki statusz"], ...settings.noteStatuses.map((item) => [item]), [], ["Bermunka muvelet"], ...settings.outsourceOperations.map((item) => [item]), [], ["Bermunka statusz"], ...settings.outsourceStatuses.map((item) => [item]), [], ["Gyartasi muvelet"], ...settings.productionOperations.map((item) => [item]), [], ["Gep munkahely"], ...settings.productionWorkplaces.map((item) => [item]), [], ["Gyartasi tipus"], ...settings.productionTypes.map((item) => [item]), [], ["Gyartasi prioritas"], ...settings.productionPriorities.map((item) => [item]), [], ["Gyartasi statusz"], ...settings.productionStatuses.map((item) => [item]), [], ["Koltseg kategoria"], ...settings.costCategories.map((item) => [item]), [], ["Tervezesi terulet"], ...settings.designAreas.map((item) => [item]), [], ["Tervezesi statusz"], ...settings.designStatuses.map((item) => [item])] }
  ];
  const sheetEntries = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: sheetXml(sheet.rows)
  }));
  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");
  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>` },
    ...sheetEntries
  ]);
}

function rowsForProject(projectId) {
  const project = db.projects[projectId];
  if (!project) throw new Error("Nincs ilyen projekt.");
  const workLogs = db.workLogs.filter((item) => item.projectId === projectId);
  const cncLogs = workLogs.filter((item) => item.cncMachineId);
  const totalHours = workLogs.reduce((sum, item) => sum + workLogTotalHours(item), 0);
  const cncHours = cncLogs.reduce((sum, item) => sum + workLogTotalHours(item), 0);
  const cncHoursByMachine = new Map();
  for (const item of cncLogs) {
    const name = item.cncMachineName || machineName(item.cncMachineId) || "(ismeretlen gép)";
    cncHoursByMachine.set(name, (cncHoursByMachine.get(name) || 0) + workLogTotalHours(item));
  }
  const openTasks = db.tasks.filter((item) => item.projectId === projectId && item.status !== "done").length;
  const openCnc = db.cncTasks.filter((item) => item.projectId === projectId && item.status !== "done").length;
  const openTools = db.toolRequests.filter((item) => item.projectId === projectId && item.status !== "done").length;
  const openMaterials = db.materialRequests.filter((item) => item.projectId === projectId && item.status !== "done").length;
  const openFasteners = db.fastenerRequests.filter((item) => item.projectId === projectId && item.status !== "done").length;
  const projectBoms = db.boms.filter((item) => item.projectId === projectId);

  return {
    summary: [
      ["Projekt", project.name],
      ["Cég", project.company || ""],
      ["Állapot", project.active ? "Aktív" : "Inaktív / kész"],
      ["Prioritás", project.priority || ""],
      ["Felelősök", project.responsibleUserIds.map(userName).filter(Boolean).join(", ")],
      ["Határidő", project.deadline || ""],
      ["Létrehozva / mappa dátum", project.folderAddedAt || project.createdAt],
      ["Befejezve", project.completedAt || ""],
      ["Munkaóra összesen", totalHours],
      ["Ebből CNC munkaóra", cncHours],
      ["Ebből egyéb munkaóra", totalHours - cncHours],
      ...[...cncHoursByMachine.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([name, hours]) => [`CNC munkaóra — ${name}`, hours]),
      ["Nyitott feladat", openTasks],
      ["Nyitott CNC", openCnc],
      ["Nyitott szerszámigény", openTools],
      ["Nyitott anyagigény", openMaterials],
      ["Nyitott csavarigény", openFasteners],
      ["BOM darab", projectBoms.length],
      ["Elsődleges mappa", project.primaryFolder || ""]
    ],
    tasks: [["Név", "Leírás", "Felelős", "Állapot", "Létrehozva", "Kész dátum"], ...db.tasks.filter((item) => item.projectId === projectId).map((item) => [item.title, item.description, userName(item.userId), item.status, item.createdAt, item.doneAt || ""])],
    cnc: [["Projekt", "CNC gép", "Felelős", "Tervezett kezdés", "Tervezett befejezés", "Valós kezdés", "Valós befejezés", "Megjegyzés", "Lejelentés megjegyzés", "Állapot", "Létrehozva"], ...db.cncTasks.filter((item) => item.projectId === projectId).map((item) => [item.projectName, machineName(item.machineId) || item.machineName || "", userName(item.userId), item.plannedStart, item.plannedEnd, item.actualStart || "", item.actualEnd || item.doneAt || "", item.note, item.reportNote || "", item.status, item.createdAt])],
    boms: [["BOM", "Revizió", "Fájl", "Típus", "Sorok", "Import hiba", "Létrehozva"], ...projectBoms.map((item) => [item.name, item.revision, item.fileName, item.kind, item.items?.length || 0, item.importError || "", item.createdAt])],
    bomItems: [["BOM", "Tétel", "Cikkszám", "Név", "Anyag", "Mennyiség", "Egység", "Megjegyzés"], ...projectBoms.flatMap((bom) => (bom.items || []).map((item) => [bom.name, item.item, item.partNumber, item.name, item.material, item.quantity, item.unit, item.note]))],
    tools: [["Szerszám", "Leírás", "Felelős", "Állapot", "Létrehozva", "Kész dátum", "Melléklet"], ...db.toolRequests.filter((item) => item.projectId === projectId).map((item) => [item.toolName, item.description, userName(item.userId), item.status, item.createdAt, item.doneAt || "", item.attachment?.path || ""])],
    materials: [["Igény típusa", "Irány", "Feladat típus", "Anyag", "Méret", "Hossz", "Típus", "Külsős cég", "Leírás", "Felelős", "Állapot", "Létrehozva", "Kész dátum", "Melléklet"], ...db.materialRequests.filter((item) => item.projectId === projectId).map((item) => [
      item.prefabTransport ? "Előgyártmány szállítás" : "Anyagigény",
      item.prefabTransport ? normalizePrefabDirection(item.prefabDirection) : "",
      item.prefabTransport ? item.prefabTaskType || "" : "",
      item.prefabTransport ? "" : item.material,
      item.prefabTransport ? "" : item.size,
      item.prefabTransport ? "" : formatMaterialLength(item.length),
      item.prefabTransport ? "" : item.type,
      item.prefabTransport ? item.externalCompany || "" : "",
      item.description,
      userName(item.userId),
      item.status,
      item.createdAt,
      item.doneAt || "",
      item.attachment?.path || ""
    ])],
    fasteners: [["Típus", "Méret", "Darab", "Szilárdság / anyag", "Leírás", "Felelős", "Állapot", "Létrehozva", "Kész dátum", "Melléklet"], ...db.fastenerRequests.filter((item) => item.projectId === projectId).map((item) => [item.type, item.size, Number(item.quantity || 0), item.grade, item.description, userName(item.userId), item.status, item.createdAt, item.doneAt || "", item.attachment?.path || ""])],
    logs: [["Munka típusa", "CNC gép", "Óra", "Túlóra", "Megjegyzés", "Fájl", "Felelős", "Dátum", "Naplózva"], ...workLogs.map((item) => [item.workType, item.cncMachineName || (item.cncMachineId ? machineName(item.cncMachineId) || "" : ""), Number(item.hours || 0), item.overtime ? "igen" : "", item.note || "", item.filePath ? `${item.fileName || ""}${item.fileName ? " — " : ""}${item.filePath}` : "", userName(item.userId), item.workDate || dateOnly(item.createdAt), item.createdAt])],
    files: [["Név", "Típus", "Munkafolyamat", "Útvonal", "Létrehozva"], ...db.files.filter((item) => item.projectId === projectId).map((item) => [item.name, item.kind, item.taskTitle || "", item.path, item.createdAt])]
  };
}

function buildWorklogXlsx(projectId) {
  const project = db.projects[projectId];
  if (!project) throw new Error("Nincs ilyen projekt.");
  const logs = (db.workLogs || []).filter((item) => item.projectId === projectId);

  // Group by user → workType → hours
  const grouped = new Map();
  const userTotals = new Map();
  const userOvertimeTotals = new Map();
  for (const item of logs) {
    const name = userName(item.userId) || "(ismeretlen)";
    const type = item.cncMachineId
      ? `CNC: ${item.cncMachineName || machineName(item.cncMachineId) || "?"}`
      : String(item.workType || "(nincs típus)");
    const hours = Number(item.hours || 0);
    if (!grouped.has(name)) grouped.set(name, new Map());
    const inner = grouped.get(name);
    inner.set(type, (inner.get(type) || 0) + hours);
    userTotals.set(name, (userTotals.get(name) || 0) + hours);
    if (item.overtime) userOvertimeTotals.set(name, (userOvertimeTotals.get(name) || 0) + hours);
  }

  const userOrder = [...grouped.keys()].sort((a, b) => a.localeCompare(b, "hu"));
  const grandTotal = [...userTotals.values()].reduce((s, h) => s + h, 0);
  const grandOvertime = [...userOvertimeTotals.values()].reduce((s, h) => s + h, 0);

  // Each row is an array of cells. Cell shape: { t: "Some text" } or { n: 12 } with optional bold:true.
  const rows = [];
  const blank = () => rows.push([]);

  rows.push([{ t: `Munkaidő — ${project.name}`, bold: true }]);
  if (project.company) rows.push([{ t: `Cég: ${project.company}` }]);
  rows.push([{ t: `Generálva: ${nowIso()}` }]);
  rows.push([{ t: "Naplózott óra összesen:" }, { t: "" }, { n: grandTotal, bold: true }]);
  rows.push([{ t: "Ebből túlóra:" }, { t: "" }, { n: grandOvertime, bold: true }]);
  blank();

  if (!userOrder.length) {
    rows.push([{ t: "Nincs naplózott munkaidő ehhez a projekthez." }]);
  } else {
    for (const name of userOrder) {
      const types = grouped.get(name);
      const total = userTotals.get(name);
      rows.push([
        { t: name, bold: true },
        { t: "óra összesen:", bold: true },
        { n: total, bold: true }
      ]);
      const overtimeTotal = userOvertimeTotals.get(name) || 0;
      if (overtimeTotal) rows.push([{ t: "" }, { t: "túlóra:" }, { n: overtimeTotal }]);
      const typeOrder = [...types.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "hu"));
      for (const [type, hours] of typeOrder) {
        rows.push([{ t: "" }, { t: type }, { n: hours }]);
      }
      blank();
    }
  }

  // Build sheet XML with bold style support (s="1" = bold).
  const rowXml = rows.map((row, rowIndex) => {
    if (!row || !row.length) return "";
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      const styleAttr = cell && cell.bold ? ` s="1"` : "";
      if (cell && typeof cell.n === "number" && Number.isFinite(cell.n)) {
        return `<c r="${ref}"${styleAttr}><v>${cell.n}</v></c>`;
      }
      const text = cell ? String(cell.t ?? "") : "";
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).filter(Boolean).join("");

  const sheetXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="22" customWidth="1"/><col min="2" max="2" width="28" customWidth="1"/><col min="3" max="3" width="14" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

  const sheetName = `Munkaido`.slice(0, 31);

  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXmlBody },
    { name: "xl/styles.xml", data: stylesXml }
  ]);
}

function todayLocalDate() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateOnly(value) {
  const str = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return null;
  const parsed = new Date(`${str}T00:00:00`);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function dateOnly(value) {
  const str = String(value || "");
  const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
}

function buildCncWorklogXlsx({ from, to }) {
  const fromDate = parseDateOnly(from);
  const toDate = parseDateOnly(to);
  if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
    throw new Error("A kezdő dátum nem lehet későbbi mint a vég dátum.");
  }
  const fromKey = fromDate ? dateOnly(from) : "";
  const toKey = toDate ? dateOnly(to) : "";

  const logDay = (log) => log.workDate || dateOnly(log.createdAt);

  const logs = (db.workLogs || []).filter((item) => {
    if (!item.cncMachineId) return false;
    const day = logDay(item);
    if (!day) return false;
    if (fromKey && day < fromKey) return false;
    if (toKey && day > toKey) return false;
    return true;
  });

  // group by day (descending — newest first)
  const byDay = new Map();
  for (const log of logs) {
    const day = logDay(log);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(log);
  }
  const dayKeys = [...byDay.keys()].sort((a, b) => b.localeCompare(a));

  const rows = [];
  const blank = () => rows.push([]);

  const rangeLabel = (fromKey || toKey)
    ? `${fromKey || "kezdettől"} → ${toKey || "máig"}`
    : "Teljes időszak";
  rows.push([{ t: `CNC munkaidő export`, bold: true }]);
  rows.push([{ t: `Időszak: ${rangeLabel}` }]);
  rows.push([{ t: `Generálva: ${nowIso()}` }]);
  const grandTotal = logs.reduce((sum, item) => sum + Number(item.hours || 0), 0);
  rows.push([{ t: "CNC óra összesen:" }, { t: "" }, { n: grandTotal, bold: true }]);
  blank();

  if (!dayKeys.length) {
    rows.push([{ t: "Nincs CNC naplózás a megadott időszakban." }]);
  } else {
    for (const day of dayKeys) {
      const entries = byDay.get(day);
      const dayTotal = entries.reduce((sum, item) => sum + Number(item.hours || 0), 0);
      rows.push([{ t: day, bold: true }, { t: "összesen:", bold: true }, { n: dayTotal, bold: true }]);
      rows.push([
        { t: "CNC gép", bold: true },
        { t: "Projekt", bold: true },
        { t: "Cég", bold: true },
        { t: "Felelős", bold: true },
        { t: "Óra", bold: true },
        { t: "Túlóra", bold: true },
        { t: "Megjegyzés", bold: true },
        { t: "Fájl", bold: true },
        { t: "Naplózó", bold: true },
        { t: "Időpont", bold: true }
      ]);
      const sorted = [...entries].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      for (const log of sorted) {
        const project = db.projects[log.projectId];
        rows.push([
          { t: log.cncMachineName || machineName(log.cncMachineId) || "" },
          { t: log.projectName || project?.name || "" },
          { t: project?.company || "" },
          { t: userName(log.userId) || "" },
          { n: Number(log.hours || 0) },
          { t: log.overtime ? "igen" : "" },
          { t: log.note || "" },
          { t: log.filePath ? `${log.fileName || ""}${log.fileName ? " — " : ""}${log.filePath}` : "" },
          { t: log.createdByName || userName(log.createdByUserId) || "" },
          { t: log.createdAt || "" }
        ]);
      }
      blank();
    }
  }

  const rowXml = rows.map((row, rowIndex) => {
    if (!row || !row.length) return "";
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      const styleAttr = cell && cell.bold ? ` s="1"` : "";
      if (cell && typeof cell.n === "number" && Number.isFinite(cell.n)) {
        return `<c r="${ref}"${styleAttr}><v>${cell.n}</v></c>`;
      }
      const text = cell ? String(cell.t ?? "") : "";
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t>${xmlEscape(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).filter(Boolean).join("");

  const sheetXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols><col min="1" max="1" width="18" customWidth="1"/><col min="2" max="2" width="32" customWidth="1"/><col min="3" max="3" width="22" customWidth="1"/><col min="4" max="4" width="20" customWidth="1"/><col min="5" max="5" width="8" customWidth="1"/><col min="6" max="6" width="28" customWidth="1"/><col min="7" max="7" width="10" customWidth="1"/><col min="8" max="8" width="40" customWidth="1"/><col min="9" max="9" width="40" customWidth="1"/><col min="10" max="10" width="20" customWidth="1"/><col min="11" max="11" width="22" customWidth="1"/></cols><sheetData>${rowXml}</sheetData></worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`;

  const sheetName = `CNC munkaido`.slice(0, 31);

  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXmlBody },
    { name: "xl/styles.xml", data: stylesXml }
  ]);
}

// Generalized worklog export: EVERY worklog (manual + CNC) by default, with
// optional projectId and/or userId (felelős) filters. When both are given they
// combine (AND). Output is grouped by Felelős (each person's work together,
// with a per-person subtotal), styled (header band, borders), auto-fit columns,
// and human-readable local dates.
function buildWorklogExportXlsx({ projectId = "", userId = "" } = {}) {
  const project = projectId ? db.projects[projectId] : null;
  const userLabel = userId ? (userName(userId) || "") : "";

  const logs = (db.workLogs || []).filter((item) => {
    if (projectId && item.projectId !== projectId) return false;
    if (userId && String(item.userId || "") !== userId) return false;
    return true;
  });

  // Local, human-readable date helpers (the host runs in the shop's timezone).
  const fmtDay = (value) => {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}.${m[2]}.${m[3]}` : String(value || "");
  };
  const fmtStamp = (value) => {
    const d = new Date(value);
    if (!Number.isFinite(d.getTime())) return String(value || "");
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  };
  const sortKey = (log) => `${log.workDate || dateOnly(log.createdAt) || ""}T${log.createdAt || ""}`;

  // Group by Felelős so every person's work is listed together.
  const byUser = new Map();
  for (const log of logs) {
    const name = userName(log.userId) || "(ismeretlen)";
    if (!byUser.has(name)) byUser.set(name, []);
    byUser.get(name).push(log);
  }
  const userOrder = [...byUser.keys()].sort((a, b) => a.localeCompare(b, "hu"));

  // Style indices, see stylesXml: 0 normal, 1 bold, 2 title, 3 header band,
  // 4 data cell (bordered), 5 subtotal.
  const S = { normal: 0, bold: 1, title: 2, header: 3, data: 4, subtotal: 5 };
  const HEADERS = ["Felelős", "Dátum", "Projekt", "Cég", "Típus / CNC gép", "Óra", "Túlóra", "Megjegyzés", "Fájl", "Naplózó", "Rögzítve"];

  const rows = [];
  const blank = () => rows.push([]);

  const projLabel = project ? `${project.name}${project.company ? ` (${project.company})` : ""}` : "minden projekt";
  const respLabel = userLabel || "minden felelős";
  const grandTotal = logs.reduce((sum, item) => sum + Number(item.hours || 0), 0);

  rows.push([{ t: "Munkaidő export", s: S.title }]);
  blank();
  // Project filter on its own two rows (the value can be very long).
  rows.push([{ t: "Szűrő — Projekt:", s: S.bold }]);
  rows.push([{ t: projLabel }]);
  rows.push([{ t: "Szűrő — Felelős:", s: S.bold }, { t: respLabel }]);
  rows.push([{ t: "Generálva:", s: S.bold }, { t: fmtStamp(nowIso()) }]);
  rows.push([{ t: "Óra összesen:", s: S.bold }, { n: grandTotal, s: S.bold }]);
  rows.push([{ t: "Bejegyzések száma:", s: S.bold }, { n: logs.length, s: S.bold }]);
  blank();

  // Auto-fit: track the widest content per column (header + data + subtotal).
  const colWidths = HEADERS.map((h) => h.length);
  const measure = (cells) => {
    cells.forEach((cell, i) => {
      const len = cell == null ? 0 : (typeof cell.n === "number" ? String(cell.n).length : String(cell.t ?? "").length);
      if (len > (colWidths[i] || 0)) colWidths[i] = len;
    });
  };

  if (!logs.length) {
    rows.push([{ t: "Nincs naplózott munkaidő a megadott szűrőre." }]);
  } else {
    rows.push(HEADERS.map((h) => ({ t: h, s: S.header })));
    for (const name of userOrder) {
      const entries = byUser.get(name).slice().sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
      for (const log of entries) {
        const proj = db.projects[log.projectId];
        const type = log.cncMachineId
          ? `CNC: ${log.cncMachineName || machineName(log.cncMachineId) || "?"}`
          : String(log.workType || "");
        const cells = [
          { t: name, s: S.data },
          { t: fmtDay(log.workDate || dateOnly(log.createdAt)), s: S.data },
          { t: log.projectName || proj?.name || "", s: S.data },
          { t: proj?.company || log.company || "", s: S.data },
          { t: type, s: S.data },
          { n: Number(log.hours || 0), s: S.data },
          { t: log.overtime ? "igen" : "", s: S.data },
          { t: log.note || "", s: S.data },
          { t: log.filePath ? `${log.fileName || ""}${log.fileName ? " — " : ""}${log.filePath}` : "", s: S.data },
          { t: log.createdByName || userName(log.createdByUserId) || "", s: S.data },
          { t: fmtStamp(log.createdAt), s: S.data }
        ];
        measure(cells);
        rows.push(cells);
      }
      // Blank separator between people (no per-person subtotal — by request).
      blank();
    }
  }

  const colsXml = colWidths.map((len, i) => {
    const width = Math.min(60, Math.max(8, Math.round(len * 1.15) + 2));
    return `<col min="${i + 1}" max="${i + 1}" width="${width}" customWidth="1"/>`;
  }).join("");

  const rowXml = rows.map((row, rowIndex) => {
    if (!row || !row.length) return "";
    const cells = row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      const s = cell && Number.isInteger(cell.s) ? cell.s : 0;
      const styleAttr = s ? ` s="${s}"` : "";
      if (cell && typeof cell.n === "number" && Number.isFinite(cell.n)) {
        return `<c r="${ref}"${styleAttr}><v>${cell.n}</v></c>`;
      }
      const text = cell ? String(cell.t ?? "") : "";
      return `<c r="${ref}"${styleAttr} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
    }).join("");
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).filter(Boolean).join("");

  const sheetXmlBody = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cols>${colsXml}</cols><sheetData>${rowXml}</sheetData></worksheet>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="16"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF0F6C75"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF1F2"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="FFB7C2C4"/></left><right style="thin"><color rgb="FFB7C2C4"/></right><top style="thin"><color rgb="FFB7C2C4"/></top><bottom style="thin"><color rgb="FFB7C2C4"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="3" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/></cellXfs></styleSheet>`;

  const sheetName = `Munkaido`.slice(0, 31);

  return zipStore([
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: "xl/worksheets/sheet1.xml", data: sheetXmlBody },
    { name: "xl/styles.xml", data: stylesXml }
  ]);
}

function buildXlsx(projectId) {
  const rows = rowsForProject(projectId);
  const sheets = [
    { name: "Osszegzes", rows: rows.summary },
    { name: "Feladatok", rows: rows.tasks },
    { name: "CNC", rows: rows.cnc },
    { name: "BOM", rows: rows.boms },
    { name: "BOM_tetelek", rows: rows.bomItems },
    { name: "Szerszamok", rows: rows.tools },
    { name: "Anyagok", rows: rows.materials },
    { name: "Munkaido", rows: rows.logs },
    { name: "Fajlok", rows: rows.files }
  ];

  const sheetEntries = sheets.map((sheet, index) => ({
    name: `xl/worksheets/sheet${index + 1}.xml`,
    data: sheetXml(sheet.rows)
  }));

  const workbookSheets = sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("");
  const rels = sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("");
  const overrides = sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("");

  return zipStore([
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${overrides}</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`
    },
    ...sheetEntries
  ]);
}

async function handleUpload(req, res, urlObj) {
  const projectId = urlObj.searchParams.get("projectId");
  const project = db.projects[projectId];
  if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
  const creator = currentUser(req);
  const task = urlObj.searchParams.get("taskId")
    ? db.tasks.find((item) => item.id === urlObj.searchParams.get("taskId"))
    : null;
  if (urlObj.searchParams.get("taskId") && (!task || task.projectId !== project.id)) {
    return sendError(res, 400, "A csatolmány munkafolyamata nem ehhez a projekthez tartozik.");
  }

  const originalName = decodeURIComponent(req.headers["x-file-name"] || "feltoltes");
  const safeName = sanitizeFileName(originalName);
  const targetFolder = projectStorageFolder(project);
  const targetPath = uniquePath(targetFolder, safeName);
  const output = fs.createWriteStream(targetPath, { flags: "wx" });

  req.pipe(output);

  req.on("error", () => {
    output.destroy();
    fs.rm(targetPath, { force: true }, () => {});
  });

  output.on("error", (error) => sendError(res, 500, error.message));
  output.on("finish", () => {
    const record = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      taskId: task?.id || null,
      taskTitle: task?.title || "",
      kind: "upload",
      name: path.basename(targetPath),
      path: targetPath,
      size: fs.statSync(targetPath).size,
      ...creatorFieldsForUser(creator),
      createdAt: nowIso()
    };
    db.files.push(record);
    saveDb();
    sendJson(res, 201, record);
  });
}

async function createBomRecord({ project, name, revision, kind, filePath, fileName, size = null, creator = null }) {
  let parsed = { rows: [], items: [] };
  let importError = "";
  try {
    parsed = await importBomFile(filePath, fileName);
  } catch (error) {
    importError = error.message || "BOM import nem sikerült.";
  }
  const record = {
    id: id(),
    projectId: project.id,
    projectName: project.name,
    name: String(name || fileName || "BOM").trim() || "BOM",
    revision: String(revision || "").trim(),
    kind,
    fileName: fileName || path.basename(filePath),
    path: filePath,
    size,
    rows: parsed.rows.slice(0, 250),
    items: parsed.items,
    importError,
    ...creatorFieldsForUser(creator),
    createdAt: nowIso()
  };
  db.boms.unshift(record);
  saveDb();
  return record;
}

async function handleBomUpload(req, res, urlObj) {
  const project = db.projects[urlObj.searchParams.get("projectId")];
  if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
  const originalName = decodeURIComponent(req.headers["x-file-name"] || "bom.xlsx");
  const safeName = sanitizeFileName(originalName);
  const targetFolder = bomStorageFolder(project);
  const targetPath = uniquePath(targetFolder, safeName);
  const output = fs.createWriteStream(targetPath, { flags: "wx" });

  req.pipe(output);
  req.on("error", () => {
    output.destroy();
    fs.rm(targetPath, { force: true }, () => {});
  });
  output.on("error", (error) => sendError(res, 500, error.message));
  output.on("finish", async () => {
    try {
      const record = await createBomRecord({
        project,
        name: urlObj.searchParams.get("name") || path.parse(safeName).name,
        revision: urlObj.searchParams.get("revision") || "",
        kind: "upload",
        filePath: targetPath,
        fileName: path.basename(targetPath),
        size: fs.statSync(targetPath).size,
        creator: currentUser(req)
      });
      sendJson(res, 201, record);
    } catch (error) {
      sendError(res, 500, error.message);
    }
  });
}

function requestAttachmentFromBody(body) {
  const rawPath = String(body.attachmentPath || body.path || "").trim();
  if (!rawPath) return null;
  const filePath = validateYDrivePath(rawPath);
  const mime = requestAttachmentMimeType(filePath);
  if (!mime) throw new Error("Csak Y: meghajtón lévő Office- vagy PDF-fájl linkelhető.");
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    throw new Error("A melléklet nem található a megadott Y: útvonalon.");
  }
  if (!stat.isFile()) throw new Error("A melléklet útvonala nem fájl.");
  return {
    kind: "link",
    name: String(body.attachmentName || body.name || path.basename(filePath)).trim() || path.basename(filePath),
    path: filePath,
    size: stat.size,
    mime,
    createdAt: nowIso()
  };
}

function requestAttachmentConfig(routeName) {
  const configs = {
    "tool-requests": {
      collection: "toolRequests",
      missing: "Nincs ilyen szerszámigény.",
      noAttachment: "Nincs melléklet ehhez a szerszámigényhez.",
      title: (item) => `Szerszám melléklet - ${item.toolName || "Dokumentum"}`
    },
    "material-requests": {
      collection: "materialRequests",
      missing: "Nincs ilyen anyagigény.",
      noAttachment: "Nincs melléklet ehhez az anyagigényhez.",
      title: (item) => `Anyag melléklet - ${item.prefabTransport ? "Előgyártmány szállítás" : (item.material || item.type || item.size || item.length || "Dokumentum")}`
    },
    "fastener-requests": {
      collection: "fastenerRequests",
      missing: "Nincs ilyen kötőelem igény.",
      noAttachment: "Nincs melléklet ehhez a kötőelem igényhez.",
      title: (item) => `Kötőelem melléklet - ${item.grade || item.type || item.size || "Dokumentum"}`
    }
  };
  return configs[routeName] || null;
}

function requestAttachmentItem(routeName, itemId) {
  const config = requestAttachmentConfig(routeName);
  if (!config) return { config: null, item: null };
  return {
    config,
    item: (db[config.collection] || []).find((entry) => entry.id === itemId) || null
  };
}

async function handleRequestAttachmentLink(req, res, routeName, itemId) {
  const { config, item } = requestAttachmentItem(routeName, itemId);
  if (!config) return sendError(res, 404, "Ismeretlen melléklet típus.");
  if (!item) return sendError(res, 404, config.missing);
  const body = await readJsonBody(req);
  let attachment;
  try {
    attachment = requestAttachmentFromBody(body);
  } catch (error) {
    return sendError(res, 400, error.message);
  }
  if (!attachment) return sendError(res, 400, "Válassz Y: meghajtós Office- vagy PDF-fájlt.");
  if (item.attachment?.kind === "upload") safeRemoveErpFileOrFolder(item.attachment.path);
  item.attachment = attachment;
  saveDb();
  return sendJson(res, 200, item.attachment);
}

function resolveStoredFile(record) {
  if (!record) throw new Error("Nincs ilyen fájl.");
  const filePath = String(record.path || "").trim();
  validateNetworkLink(filePath);
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error("A fájl nem található vagy nem fájl.");
  return { filePath, stat };
}

function contentTypeForPath(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  const types = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".txt": "text/plain; charset=utf-8",
    ".csv": "text/csv; charset=utf-8",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  };
  return REQUEST_ATTACHMENT_MIME_TYPES.get(ext) || types[ext] || "application/octet-stream";
}

function sendFileResponse(res, record, disposition = "attachment") {
  let resolved;
  try {
    resolved = resolveStoredFile(record);
  } catch (error) {
    return sendError(res, 404, error.message);
  }
  const fileName = sanitizeFileName(record.name || path.basename(resolved.filePath));
  res.writeHead(200, {
    "Content-Type": contentTypeForPath(resolved.filePath),
    "Content-Length": resolved.stat.size,
    "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    "Cache-Control": "no-store"
  });
  fs.createReadStream(resolved.filePath).pipe(res);
}

function sendFileDownload(res, record) {
  return sendFileResponse(res, record, "attachment");
}

function htmlEscape(value) {
  return xmlEscape(value).replace(/'/g, "&#39;");
}

function isXlsxFileName(fileName) {
  return path.extname(String(fileName || "")).toLowerCase() === ".xlsx";
}

function sendXlsxViewer(res, record, titleText = "XLSX melléklet") {
  let resolved;
  try {
    resolved = resolveStoredFile(record);
  } catch (error) {
    return sendError(res, 404, error.message);
  }
  if (!isXlsxFileName(resolved.filePath)) {
    return sendError(res, 400, "Csak .xlsx fájl nézhető meg böngészőben.");
  }

  let rows;
  try {
    rows = parseXlsxRows(fs.readFileSync(resolved.filePath));
  } catch (error) {
    return sendError(res, 400, error.message || "Az XLSX fájl nem olvasható.");
  }

  const maxRows = 1000;
  const maxCols = Math.min(80, Math.max(1, ...rows.map((row) => row.length)));
  const visibleRows = rows.slice(0, maxRows);
  const tableRows = visibleRows.map((row, rowIndex) => {
    const tag = rowIndex === 0 ? "th" : "td";
    const cells = Array.from({ length: maxCols }, (_, index) => `<${tag}>${htmlEscape(row[index] || "")}</${tag}>`).join("");
    return `<tr>${cells}</tr>`;
  }).join("");
  const truncated = rows.length > maxRows
    ? `<p class="warning">Csak az első ${maxRows} sor látszik. A teljes fájl letölthető.</p>`
    : "";
  const fileName = sanitizeFileName(record.name || path.basename(resolved.filePath));
  const body = `<!doctype html>
<html lang="hu">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${htmlEscape(titleText)}</title>
  <style>
    :root { color-scheme: light; --bg:#eef1ee; --surface:#f6f8f5; --line:#ccd5cc; --text:#0d1b22; --muted:#5a6872; --orange:#ff6b12; }
    body { margin:0; font:14px/1.45 Arial, sans-serif; color:var(--text); background:var(--bg); }
    header { position:sticky; top:0; z-index:2; display:flex; justify-content:space-between; gap:12px; align-items:center; padding:14px 18px; background:var(--surface); border-bottom:1px solid var(--line); }
    h1 { margin:0; font-size:20px; }
    .meta { color:var(--muted); font-size:12px; margin-top:3px; }
    a { display:inline-flex; align-items:center; min-height:30px; padding:5px 10px; border:1px solid var(--line); border-radius:6px; color:var(--text); background:#fff; text-decoration:none; }
    main { padding:16px; }
    .table-wrap { overflow:auto; border:1px solid var(--line); background:#fff; border-radius:6px; }
    table { border-collapse:collapse; min-width:100%; }
    th, td { border:1px solid var(--line); padding:6px 8px; min-width:90px; max-width:360px; vertical-align:top; overflow-wrap:anywhere; }
    th { position:sticky; top:0; background:#eef1ee; text-align:left; font-weight:700; }
    .empty, .warning { padding:16px; color:var(--muted); }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>${htmlEscape(titleText)}</h1>
      <div class="meta">${htmlEscape(fileName)} · ${rows.length} sor</div>
    </div>
    <a href="${htmlEscape(record.downloadUrl || "#")}">Letöltés</a>
  </header>
  <main>
    ${truncated}
    ${rows.length ? `<div class="table-wrap"><table>${tableRows}</table></div>` : `<div class="empty">Az XLSX fájlban nincs megjeleníthető adat.</div>`}
  </main>
</body>
</html>`;
  const buffer = Buffer.from(body, "utf8");
  res.writeHead(200, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Length": buffer.length,
    "Cache-Control": "no-store"
  });
  res.end(buffer);
}

function requestBaseUrl(req, context = {}) {
  const firstHeader = (value) => String(Array.isArray(value) ? value[0] : value || "").split(",")[0].trim();
  const proto = firstHeader(req.headers["x-forwarded-proto"]) || (context.https ? "https" : "http");
  const host = firstHeader(req.headers["x-forwarded-host"]) || firstHeader(req.headers.host) || `localhost:${config.port || 4780}`;
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function helperInstallerContent(req, context = {}) {
  const baseUrl = requestBaseUrl(req, context);
  return [
    "@echo off",
    "setlocal",
    "title Workshop ERP Windows Helper telepito",
    `set "ERP_BASE=${baseUrl}"`,
    `set "INSTALL_PS=%TEMP%\\workshop-helper-install-%RANDOM%.ps1"`,
    "echo Workshop ERP Windows helper telepitese...",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Invoke-WebRequest -UseBasicParsing -Uri '%ERP_BASE%/api/helper/install-script' -OutFile '%INSTALL_PS%'\"",
    "if errorlevel 1 (",
    "  echo.",
    "  echo Nem sikerult letolteni a telepito scriptet.",
    "  pause",
    "  exit /b 1",
    ")",
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File \"%INSTALL_PS%\" -HelperUrl \"%ERP_BASE%/api/helper/script\"",
    "set \"INSTALL_EXIT=%ERRORLEVEL%\"",
    "del \"%INSTALL_PS%\" >nul 2>nul",
    "if not \"%INSTALL_EXIT%\"==\"0\" (",
    "  echo.",
    "  echo Telepites sikertelen. Ellenorizd, hogy van-e internet/ERP kapcsolat.",
    "  pause",
    "  exit /b %INSTALL_EXIT%",
    ")",
    "exit /b 0",
    ""
  ].join("\r\n");
}

function helperInstallScriptContent() {
  return `
param(
  [Parameter(Mandatory = $true)]
  [string]$HelperUrl,
  [switch]$Silent
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$installDir = Join-Path $env:LOCALAPPDATA 'WorkshopERPHelper'
$helperScript = Join-Path $installDir 'workshop-helper.ps1'
$startCmd = Join-Path $installDir 'start-helper.cmd'
$uninstallCmd = Join-Path $installDir 'uninstall-helper.cmd'

New-Item -ItemType Directory -Force -Path $installDir | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri $HelperUrl -OutFile $helperScript

@'
@echo off
setlocal
set "HELPER_SCRIPT=%~dp0workshop-helper.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -Command "try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4799/health' -TimeoutSec 2 | Out-Null; exit 0 } catch {}; $currentPid = $PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $currentPid -and $_.CommandLine -like '*WorkshopERPHelper*workshop-helper.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-STA','-WindowStyle','Hidden','-File',$env:HELPER_SCRIPT) -WindowStyle Hidden; for ($attempt = 0; $attempt -lt 20; $attempt++) { Start-Sleep -Milliseconds 500; try { Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4799/health' -TimeoutSec 2 | Out-Null; exit 0 } catch {} }; exit 1"
exit /b %ERRORLEVEL%
'@ | Set-Content -LiteralPath $startCmd -Encoding ASCII

@'
@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$currentPid = $PID; Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $currentPid -and $_.CommandLine -like '*WorkshopERPHelper*workshop-helper.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Remove-Item -LiteralPath ([Environment]::GetFolderPath('Startup') + '\\Workshop ERP Helper.vbs') -Force -ErrorAction SilentlyContinue; Write-Host 'Workshop ERP helper stopped. You can delete this folder after this window closes: %LOCALAPPDATA%\\WorkshopERPHelper'"
exit /b
'@ | Set-Content -LiteralPath $uninstallCmd -Encoding ASCII

$startupDir = [Environment]::GetFolderPath('Startup')
$startupVbs = Join-Path $startupDir 'Workshop ERP Helper.vbs'
@"
Set shell = CreateObject("WScript.Shell")
startCmd = shell.ExpandEnvironmentStrings("%LOCALAPPDATA%\\WorkshopERPHelper\\start-helper.cmd")
shell.Run Chr(34) & startCmd & Chr(34), 0, False
"@ | Set-Content -LiteralPath $startupVbs -Encoding ASCII

Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*workshop-helper.ps1*' } | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

$startResult = Start-Process -FilePath $startCmd -WindowStyle Hidden -PassThru
$startFinished = $startResult.WaitForExit(20000)

$nl = [Environment]::NewLine
$message = "Workshop ERP Windows helper telepitve es elinditva." + $nl + $nl + "Telepitesi mappa: $installDir" + $nl + "Windows indulaskor automatikusan indul."
try {
  if (-not $startFinished) { throw "A helper indito nem fejezodott be 20 masodpercen belul." }
  if ($startResult.ExitCode -ne 0) { throw "A helper inditasa sikertelen (exit $($startResult.ExitCode))." }
  Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:4799/health' -TimeoutSec 3 | Out-Null
} catch {
  $message = "Telepites kesz, de a helper meg nem valaszolt a health checkre." + $nl + $nl + "Inditsd ujra a gepet, vagy futtasd ezt: $startCmd"
}
if ($Silent) {
  Write-Host $message
} else {
  [System.Windows.Forms.MessageBox]::Show($message, 'Workshop ERP helper', 'OK', 'Information') | Out-Null
}
`;
}

function sendHelperInstaller(req, res, context = {}) {
  const body = Buffer.from(helperInstallerContent(req, context), "utf8");
  res.writeHead(200, {
    "Content-Type": "application/x-msdownload; charset=utf-8",
    "Content-Length": body.length,
    "Content-Disposition": "attachment; filename=\"WorkshopERP-Windows-Helper-Install.cmd\"",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendHelperScript(res) {
  const helperPath = path.join(APP_DIR, "helper", "workshop-helper.ps1");
  fs.readFile(helperPath, (error, data) => {
    if (error) return sendError(res, 404, "A helper script nem található.");
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": data.length,
      "Content-Disposition": "attachment; filename=\"workshop-helper.ps1\"",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

function sendHelperInstallScript(res) {
  const body = Buffer.from(helperInstallScriptContent(), "utf8");
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    "Content-Disposition": "attachment; filename=\"install-workshop-helper.ps1\"",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

async function handleApi(req, res, urlObj, context = {}) {
  const { pathname } = urlObj;
  const method = req.method;
  let match;

  if (method === "GET" && pathname === "/api/helper/installer") {
    return sendHelperInstaller(req, res, context);
  }

  if (method === "GET" && pathname === "/api/helper/script") {
    return sendHelperScript(res);
  }

  if (method === "GET" && pathname === "/api/helper/install-script") {
    return sendHelperInstallScript(res);
  }

  if (method === "GET" && pathname === "/api/auth") {
    const session = currentSession(req, context);
    return sendJson(res, 200, {
      authenticated: isAuthenticated(req, context),
      passwordSet: true,
      internet: Boolean(context.internet),
      authRequired: authRequiredForContext(context),
      users: publicUsers(),
      user: publicUser(session?.user || null, { private: true })
    });
  }

  if (method === "POST" && pathname === "/api/login") {
    const ip = clientIpFor(req, context);
    const body = await readJsonBody(req);
    const user = db.users.find((item) => item.id === body.userId);
    if (!user) {
      recordLoginAttempt({ ip, kind: "user", outcome: "fail" });
      return sendError(res, 401, "Válassz felhasználót.");
    }
    // The hidden modelling login always verifies against the Admin user's
    // password ("same as admin" stays true even after admin password
    // changes). Its own stored hash is never consulted.
    const passwordOwner = user.id === MODELLING_USER_ID ? (findAdminUser() || user) : user;
    if (!verifyUserPassword(passwordOwner, body.password)) {
      const blocked = recordLoginFailure(ip);
      recordLoginAttempt({ ip, kind: "user", userId: user.id, userName: user.name, outcome: blocked ? "blocked" : "fail" });
      if (blocked) {
        return sendError(res, 403, "3 hibás jelszó. Az IP-t letiltottuk.");
      }
      return sendError(res, 401, "Hibás felhasználói jelszó.");
    }
    clearLoginFailure(ip);
    const pwaSession = Boolean(body.pwa);
    const token = createSession(user.id, { ip, userAgent: String(req.headers?.["user-agent"] || ""), pwa: pwaSession });
    const session = sessions.get(token) || null;
    saveSessions(true); // persist immediately so a host handover right after login keeps it
    recordLoginAttempt({ ip, kind: "user", userId: user.id, userName: user.name, outcome: "success" });
    setSessionCookie(res, token, context, session);
    return sendJson(res, 200, { ok: true, user: publicUser(user, { private: true }) });
  }

  if (method === "POST" && pathname === "/api/logout") {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (token && sessions.delete(token)) { markSessionsDirty(); saveSessions(true); }
    res.setHeader("Set-Cookie", httpsCookieHeader(SESSION_COOKIE, "", 0, Boolean(context.https)));
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/client-error") {
    const body = await readJsonBody(req, 64 * 1024);
    recordClientError(req, context, body);
    return sendJson(res, 200, { ok: true });
  }

  if (!isAuthenticated(req, context)) return sendAuthRequired(res);

  if (method === "GET" && pathname === "/api/pwa/vapid-public-key") {
    return sendJson(res, 200, { publicKey: vapidPublicKey() });
  }

  if (method === "POST" && pathname === "/api/pwa/session") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    ctx.session.pwa = true;
    markSessionsDirty();
    saveSessions(true);
    setSessionCookie(res, ctx.token, context, ctx.session);
    return sendJson(res, 200, { ok: true, user: publicUser(ctx.user, { private: true }) });
  }

  if (method === "GET" && pathname === "/api/notifications/settings") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    return sendJson(res, 200, {
      settings: notificationSettingsForUser(ctx.user),
      subscriptionCount: activePushSubscriptionsForUser(ctx.user.id).length,
      vapidPublicKey: vapidPublicKey()
    });
  }

  if (method === "POST" && pathname === "/api/notifications/settings") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    const body = await readJsonBody(req);
    ctx.user.notificationSettings = normalizeNotificationSettings(body.settings || body);
    saveDb();
    return sendJson(res, 200, {
      ok: true,
      settings: notificationSettingsForUser(ctx.user),
      user: publicUser(ctx.user, { private: true })
    });
  }

  if (method === "POST" && pathname === "/api/push/subscribe") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    const body = await readJsonBody(req, 256 * 1024);
    let subscription;
    try {
      subscription = upsertPushSubscription(ctx.user, body.subscription || body, req, context);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    ctx.user.notificationSettings = normalizeNotificationSettings(ctx.user.notificationSettings || {});
    ctx.user.notificationSettings.enabled = true;
    const immediatePasswordReminder = passwordReminderDueForUser(ctx.user);
    if (immediatePasswordReminder) createPasswordReminderNotification(ctx.user);
    ctx.session.pwa = true;
    markSessionsDirty();
    saveDb();
    saveSessions(true);
    setSessionCookie(res, ctx.token, context, ctx.session);
    if (immediatePasswordReminder) queuePushSignalsForUsers([ctx.user.id]);
    return sendJson(res, 200, {
      ok: true,
      subscriptionId: subscription.id,
      subscriptionCount: activePushSubscriptionsForUser(ctx.user.id).length,
      user: publicUser(ctx.user, { private: true })
    });
  }

  if (method === "POST" && pathname === "/api/push/unsubscribe") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    const body = await readJsonBody(req, 256 * 1024);
    const endpoint = String(body.endpoint || body.subscription?.endpoint || "").trim();
    const changed = disablePushSubscription(endpoint, ctx.user.id);
    if (changed) saveDb();
    return sendJson(res, 200, { ok: true, subscriptionCount: activePushSubscriptionsForUser(ctx.user.id).length });
  }

  if (method === "POST" && pathname === "/api/push/test") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    createUserNotification(ctx.user, {
      type: "test",
      title: "Workshop ERP",
      body: "Teszt ertesites az ERP-bol.",
      url: "/?view=stats&panel=notifications",
      tag: `erp-test-${ctx.user.id}`
    });
    saveDb();
    queuePushSignalsForUsers([ctx.user.id]);
    return sendJson(res, 200, { ok: true });
  }

  if (method === "GET" && pathname === "/api/notifications/latest") {
    const ctx = currentSession(req, context);
    if (!ctx) return sendAuthRequired(res);
    const notification = latestNotificationForUser(ctx.user.id);
    return sendJson(res, 200, {
      notification: notification ? {
        id: notification.id,
        title: notification.title,
        body: notification.body,
        url: notification.url,
        tag: notification.tag,
        createdAt: notification.createdAt
      } : null
    });
  }

  if (method === "GET" && pathname === "/api/events") {
    return handleSseConnect(req, res, context);
  }

  // ----- Modelling photo page (hidden /modelling login) -----
  if (method === "GET" && pathname === "/api/modelling/folders") {
    let folders = [];
    try {
      folders = fs.readdirSync(MODELLING_PHOTO_BASE, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((a, b) => a.localeCompare(b, "hu"));
    } catch {
      // Base folder may not exist yet — created on first upload.
    }
    return sendJson(res, 200, { base: MODELLING_PHOTO_BASE, folders });
  }

  if (method === "POST" && pathname === "/api/modelling/photos") {
    const body = await readJsonBody(req, 24 * 1024 * 1024);
    const folderName = sanitizeFileName(String(body.folder || "").trim()).slice(0, 120);
    if (!folderName || folderName === "fajl" || /^\.+$/.test(folderName)) {
      return sendError(res, 400, "Adj meg projekt mappa nevet.");
    }
    const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\r\n]+)$/i.exec(String(body.imageDataUrl || ""));
    if (!match) return sendError(res, 400, "Csak PNG/JPG fotó tölthető fel.");
    const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
    if (!buffer.length) return sendError(res, 400, "Üres kép.");
    if (buffer.length > 20 * 1024 * 1024) return sendError(res, 400, "A fotó túl nagy (max 20 MB).");
    const extension = match[1].toLowerCase() === "png" ? "png" : "jpg";
    const targetDir = path.join(MODELLING_PHOTO_BASE, folderName);
    // Belt and braces against traversal even after sanitizeFileName.
    const relative = path.relative(MODELLING_PHOTO_BASE, targetDir);
    if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes("\\")) {
      return sendError(res, 400, "Érvénytelen mappa név.");
    }
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 23);
      let candidate = path.join(targetDir, `foto_${stamp}.${extension}`);
      let counter = 1;
      while (fs.existsSync(candidate)) {
        candidate = path.join(targetDir, `foto_${stamp}_${counter}.${extension}`);
        counter += 1;
      }
      fs.writeFileSync(candidate, buffer);
      const user = currentUser(req);
      console.log(`[modelling] foto mentve: ${candidate} (${Math.round(buffer.length / 1024)} kB, ${user?.name || "?"})`);
      return sendJson(res, 200, { ok: true, file: path.basename(candidate), folder: folderName });
    } catch (error) {
      return sendError(res, 500, `Nem sikerült menteni a fotót: ${error.message}`);
    }
  }

  if (pathname === "/api/host-status" || pathname === "/api/host-switch" || pathname === "/api/host-nicknames" || pathname === "/api/host-restart" || pathname === "/api/host-remove") {
    if (!userHasClearance(currentUser(req), 2)) return sendClearanceRequired(res);
  }

  if (method === "GET" && pathname === "/api/host-status") {
    return sendJson(res, 200, hostStatusSnapshot());
  }

  if (method === "POST" && pathname === "/api/host-remove") {
    const body = await readJsonBody(req);
    let hostname;
    try { hostname = hostKey(body.hostname); }
    catch (error) { return sendError(res, 400, error.message); }
    const lockRead = readHostLockDetailed();
    if (!lockRead.ok) return sendError(res, 503, "Az aktív host most nem ellenőrizhető; próbáld újra.");
    if (sameHostname(hostname, os.hostname()) || sameHostname(hostname, lockRead.lock?.hostname)) {
      return sendError(res, 400, "Az aktív host nem távolítható el. Előbb válts másik PC-re.");
    }
    const removed = hostEnrollment.state(hostname).removed;
    if (!removed && !hostStatusSnapshot().watchdogs.some(item => sameHostname(item.hostname, hostname))) {
      return sendError(res, 404, "Ez a PC nem szerepel a host listában.");
    }
    hostEnrollment.remove(hostname, currentUser(req)?.name || os.hostname());
    broadcastChange(); // coordination metadata, not a business DB mutation
    return sendJson(res, 200, {ok:true,status:hostStatusSnapshot()});
  }

  if (method === "POST" && pathname === "/api/host-nicknames") {
    const body = await readJsonBody(req);
    const hostname = String(body.hostname || "").trim();
    const key = normalizeHostname(hostname);
    if (!key) return sendError(res, 400, "Hiányzik a PC neve.");
    const nickname = String(body.nickname || "").trim().slice(0, 80);
    const next = normalizedHostNicknames();
    if (nickname) next[key] = nickname;
    else delete next[key];
    config.hostNicknames = next;
    saveConfig();
    return sendJson(res, 200, { ok: true, hostNicknames: next, status: hostStatusSnapshot() });
  }

  if (method === "POST" && pathname === "/api/host-switch") {
    const body = await readJsonBody(req);
    const targetHostname = String(body.hostname || body.targetHostname || "").trim();
    if (!targetHostname) return sendError(res, 400, "Hiányzik a cél PC neve.");
    const snapshot = hostStatusSnapshot();
    if (snapshot.currentHost?.hostname && sameHostname(snapshot.currentHost.hostname, targetHostname)) {
      return sendJson(res, 200, { ok: true, alreadyHost: true, status: snapshot });
    }
    const target = (snapshot.watchdogs || []).find((item) => sameHostname(item.hostname, targetHostname));
    if (!target || !target.ready) return sendError(res, 400, "Ez a PC most nem látszik kész watchdogként.");
    const request = {
      targetHostname: target.hostname,
      requestedAt: nowIso(),
      requestedBy: currentUser(req)?.name || os.hostname(),
      nonce: id()
    };
    writeHostSwitchRequest(request);
    return sendJson(res, 200, { ok: true, request, status: hostStatusSnapshot() });
  }

  if (method === "POST" && pathname === "/api/host-restart") {
    const snapshot = hostStatusSnapshot();
    const requestedBy = currentUser(req)?.name || os.hostname();
    const requestedAt = nowIso();
    const targets = (snapshot.watchdogs || [])
      .filter((item) => item.ready && item.switchable !== false && item.role !== "legacy")
      .filter((item) => !item.isCurrentHost && !sameHostname(item.hostname, os.hostname()));
    const watchdogCommands = [];
    for (const target of targets) {
      const command = {
        type: "restart-watchdog",
        targetHostname: target.hostname,
        requestedAt,
        requestedBy,
        sourceHostname: os.hostname(),
        sourceHostGeneration: hostGeneration,
        nonce: id()
      };
      writeWatchdogCommand(target.hostname, command);
      watchdogCommands.push({
        hostname: target.hostname,
        nickname: target.nickname || hostNickname(target.hostname),
        nonce: command.nonce
      });
    }
    const restart = scheduleLocalHostRestart(`settings host restart (${requestedBy})`);
    return sendJson(res, 200, {
      ok: true,
      requestedAt,
      currentHost: snapshot.currentHost?.hostname || os.hostname(),
      currentHostRestart: restart,
      standbyWatchdogRestarts: watchdogCommands,
      status: hostStatusSnapshot()
    });
  }

  // ----- Security panel endpoints (level-2 users only) -----
  if (pathname.startsWith("/api/security")) {
    if (!userHasClearance(currentUser(req), 2)) return sendClearanceRequired(res);
  }

  if (method === "GET" && pathname === "/api/security/state") {
    const now = Date.now();
    const activeSessions = [];
    for (const [token, session] of sessions.entries()) {
      if (now - session.lastSeen > SESSION_ACTIVE_WINDOW_MS) continue;
      const user = db.users.find((item) => item.id === session.userId);
      activeSessions.push({
        token,
        userId: session.userId,
        userName: user?.name || "",
        clearanceLevel: normalizeClearanceLevel(user?.clearanceLevel),
        ip: session.lastIp || session.ip || "",
        userAgent: session.userAgent || "",
        createdAt: new Date(session.createdAt).toISOString(),
        lastSeen: new Date(session.lastSeen).toISOString()
      });
    }
    const ipHistoryRows = (Array.isArray(db.ipHistory) ? db.ipHistory : [])
      .slice()
      .sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    return sendJson(res, 200, {
      whitelist: Array.isArray(db.security?.lockdownAllowlist) ? db.security.lockdownAllowlist : [],
      blockedIps: Array.isArray(db.blockedIps) ? db.blockedIps : [],
      activeSessions,
      recentAttempts: recentLoginAttempts.slice(0, 50),
      ipHistory: ipHistoryRows,
      currentClientIp: clientIpFor(req, context)
    });
  }

  if (method === "POST" && pathname === "/api/security/whitelist") {
    const body = await readJsonBody(req);
    const list = Array.isArray(body.whitelist) ? body.whitelist : [];
    db.security.lockdownAllowlist = list
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    saveDb();
    return sendJson(res, 200, {
      ok: true,
      whitelist: db.security.lockdownAllowlist
    });
  }

  if (method === "POST" && pathname === "/api/security/block-ip") {
    const body = await readJsonBody(req);
    const ip = String(body.ip || "").trim();
    if (!ip) return sendError(res, 400, "Hiányzik az IP cím.");
    const myIp = clientIpFor(req, context);
    if (ip === myIp) return sendError(res, 400, "Nem tilthatod le a saját IP-det.");
    db.blockedIps = Array.isArray(db.blockedIps) ? db.blockedIps : [];
    if (!db.blockedIps.some((entry) => entry && entry.ip === ip)) {
      db.blockedIps.push({
        ip,
        blockedAt: nowIso(),
        blockedBy: currentUser(req)?.name || "",
        reason: String(body.reason || "").trim()
      });
    }
    const kicked = disconnectIp(ip);
    saveDb();
    return sendJson(res, 200, { ok: true, ip, kicked });
  }

  if (method === "POST" && pathname === "/api/security/unblock-ip") {
    const body = await readJsonBody(req);
    const ip = String(body.ip || "").trim();
    if (!ip) return sendError(res, 400, "Hiányzik az IP cím.");
    db.blockedIps = (Array.isArray(db.blockedIps) ? db.blockedIps : []).filter((entry) => entry && entry.ip !== ip);
    saveDb();
    return sendJson(res, 200, { ok: true, ip });
  }

  if (method === "POST" && pathname === "/api/security/disconnect-session") {
    const body = await readJsonBody(req);
    const token = String(body.token || "").trim();
    if (!token) return sendError(res, 400, "Hiányzik a session azonosító.");
    const kicked = sessions.delete(token) ? 1 : 0;
    if (kicked) { markSessionsDirty(); saveSessions(true); }
    return sendJson(res, 200, { ok: true, kicked });
  }

  if (method === "GET" && pathname === "/api/state") {
    renewSessionCookie(req, res, context); // slide the cookie's Max-Age while the app is open
    return sendJson(res, 200, publicState(req));
  }

  if (method === "GET" && pathname === "/api/cadmodels/viewer-source") {
    const sourcePath = path.join(APP_DIR, "vendor", "erp-glb-viewer-measure-nav-20260926.zip");
    return fs.readFile(sourcePath, (error, contents) => {
      if (error) return sendError(res, 404, "A viewer forráscsomagja nem található.");
      res.writeHead(200, {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=\"erp-glb-viewer-source.zip\"",
        "Content-Length": contents.length,
        "Cache-Control": "private, no-store"
      });
      res.end(contents);
    });
  }

  match = pathname.match(/^\/api\/cadmodels\/([a-f0-9]{32})\/glb$/);
  if (match && method === "GET") {
    const model = activeCadModel(match[1]);
    if (!model) return sendError(res, 404, "Nincs ilyen 3D modell.");
    return streamCadModel(req, res, model);
  }

  match = pathname.match(/^\/api\/cadmodels\/([a-f0-9]{32})\/nickname$/);
  if (match && method === "PATCH") {
    const model = activeCadModel(match[1]);
    if (!model) return sendError(res, 404, "Nincs ilyen 3D modell.");
    const body = await readJsonBody(req);
    if (!body || typeof body.nickname !== "string") return sendError(res, 400, "Adj meg egy modellbecenevet vagy hagyd üresen.");
    const nickname = body.nickname.trim();
    if (nickname.length > 120 || /[\u0000-\u001f\u007f]/.test(nickname)) {
      return sendError(res, 400, "A modellbecenév legfeljebb 120 karakter lehet, vezérlőkarakter nélkül.");
    }
    model.nickname = nickname;
    model.nicknameUpdatedAt = nowIso();
    model.nicknameUpdatedByUserId = currentUser(req)?.id || "";
    saveDb();
    return sendJson(res, 200, { ok: true, model });
  }

  match = pathname.match(/^\/api\/cadmodels\/([a-f0-9]{32})$/);
  if (match && method === "PATCH") {
    if (!userHasClearance(currentUser(req), 2)) return sendClearanceRequired(res);
    const model = activeCadModel(match[1]);
    if (!model) return sendError(res, 404, "Nincs ilyen 3D modell.");
    const body = await readJsonBody(req);
    const projectId = String(body.projectId || "").trim();
    if (projectId && !db.projects[projectId]) return sendError(res, 400, "Válassz meglévő ERP projektet.");
    model.projectId = projectId;
    model.assignedAt = nowIso();
    model.assignedByUserId = currentUser(req)?.id || "";
    saveDb();
    return sendJson(res, 200, { ok: true, model });
  }
  if (match && method === "DELETE") {
    if (!userHasClearance(currentUser(req), 2)) return sendClearanceRequired(res);
    const model = activeCadModel(match[1]);
    if (!model) return sendError(res, 404, "Nincs ilyen 3D modell.");
    await waitForCompressedModel(model.id);
    let moved;
    try {
      moved = movePairToTrash(CAD_MODEL_INBOX, model, CAD_TRASH_ROOT, CAD_MODEL_CACHE_ROOT);
    } catch (error) {
      return sendError(res, 409, "A modell nem mozgatható a Y:\\trash mappába: " + error.message);
    }
    model.trashFolder = moved.trashFolder;
    model.trashMovedFiles = moved.movedFiles;
    model.trashMissingFiles = moved.missingFiles;
    model.trashCachedFiles = moved.cachedFiles;
    model.trashedAt = nowIso();
    model.trashedByUserId = currentUser(req)?.id || "";
    saveDb();
    return sendJson(res, 200, { ok: true, ...moved });
  }

  if (method === "POST" && pathname === "/api/ocr/drawing-number") {
    const body = await readJsonBody(req, 48 * 1024 * 1024);
    const images = Array.isArray(body.imageDataUrls) ? body.imageDataUrls : [body.imageDataUrl || ""];
    const result = await recognizeDrawingNumberImagesDetailed(images);
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/ocr/project-path") {
    const body = await readJsonBody(req, 48 * 1024 * 1024);
    const images = Array.isArray(body.imageDataUrls) ? body.imageDataUrls : [body.imageDataUrl || ""];
    const result = await recognizeProjectPathImagesDetailed(images);
    return sendJson(res, 200, result);
  }

  if (method === "POST" && pathname === "/api/ocr/drawing-correction") {
    if (!currentUser(req)) return sendAuthRequired(res);
    const body = await readJsonBody(req, 48 * 1024 * 1024);
    const result = saveOcrCorrectionSample(req, body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (method === "POST" && pathname === "/api/ocr/project-correction") {
    if (!currentUser(req)) return sendAuthRequired(res);
    const body = await readJsonBody(req, 48 * 1024 * 1024);
    const result = saveOcrProjectCorrectionSample(req, body);
    return sendJson(res, 200, { ok: true, ...result });
  }

  if (method === "POST" && pathname === "/api/project-notices/read") {
    const user = currentUser(req);
    if (!user) return sendAuthRequired(res);
    const body = await readJsonBody(req);
    const ids = new Set(Array.isArray(body.ids) ? body.ids.map(String) : []);
    let changed = false;
    for (const notice of db.projectNotices || []) {
      if (!ids.has(notice.id)) continue;
      notice.readByUserIds = notice.readByUserIds || [];
      if (!notice.readByUserIds.includes(user.id)) {
        notice.readByUserIds.push(user.id);
        changed = true;
      }
    }
    if (changed) saveDb();
    return sendJson(res, 200, { ok: true, ids: [...ids] });
  }

  if (method === "GET" && pathname === "/api/archive/state") {
    return sendJson(res, 200, archiveState());
  }

  match = pathname.match(/^\/api\/archive\/([^/]+)\/restore$/);
  if (match && method === "POST") {
    const user = currentUser(req);
    if (!userHasClearance(user, 2)) return sendClearanceRequired(res);
    const body = await readJsonBody(req);
    const archive = (db.archives || []).find((item) => item.id === match[1]);
    const project = db.projects[String(body.projectId || "")];
    if (!archive) return sendError(res, 404, "Nincs ilyen archív tétel.");
    if (!project) return sendError(res, 400, "Válassz meglévő célprojektet.");
    let result;
    try {
      result = restoreArchiveEntriesInto(db, archive, project, PROJECT_ARCHIVE_COLLECTIONS, user.name);
    } catch (error) { return sendError(res, 409, error.message); }
    if (!result.alreadyRestored) saveDb();
    return sendJson(res, 200, { ok: true, ...result, projectId: project.id, projectName: project.name });
  }

  match = pathname.match(/^\/api\/archive\/([^/]+)$/);
  if (match && method === "DELETE") {
    const removed = purgeArchivedRecord(match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen archív tétel.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "DELETE" && pathname === "/api/archive") {
    const body = await readJsonBody(req);
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean) : [];
    if (!ids.length) return sendError(res, 400, "Nincs kijelölt archív tétel.");
    const removed = [];
    for (const archiveId of ids) {
      const item = purgeArchivedRecord(archiveId);
      if (item) removed.push(item);
    }
    saveDb();
    return sendJson(res, 200, { ok: true, removedCount: removed.length });
  }

  if (pathname.startsWith("/api/finance") || pathname.startsWith("/api/export/finance")) {
    if (!userHasClearance(currentUser(req), 2)) return sendClearanceRequired(res);
  }

  if (method === "GET" && pathname === "/api/finance/state") {
    return sendJson(res, 200, financeState());
  }

  if (method === "POST" && pathname === "/api/me/password") {
    const body = await readJsonBody(req);
    const user = currentUser(req);
    if (!user) return sendAuthRequired(res);
    if (!verifyUserPassword(user, body.currentPassword)) return sendError(res, 401, "A jelenlegi személyes jelszó hibás.");
    try {
      setUserPassword(user, body.newPassword);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/scan") {
    await scanProjects();
    return sendJson(res, 200, publicState(req));
  }

  if (pathname === "/api/settings" && !userHasClearance(currentUser(req), 2)) {
    return sendClearanceRequired(res);
  }

  if (method === "POST" && pathname === "/api/settings") {
    const body = await readJsonBody(req);
    if (body.workingDirectory) {
      try { config.workingDirectory = assertCanonicalWorkingDirectory(body.workingDirectory); }
      catch (error) { return sendError(res, 400, error.message); }
    }
    if (Array.isArray(body.scanRoots)) config.scanRoots = body.scanRoots.map(String).filter(Boolean);
    if (Array.isArray(body.excludedPaths)) config.excludedPaths = body.excludedPaths.map(String).filter(Boolean);
    if (body.scanIntervalSeconds) config.scanIntervalSeconds = Math.max(3, Number(body.scanIntervalSeconds) || 10);
    config.localAuthRequired = true;
    if (typeof body.internetEnabled === "boolean") config.internetEnabled = body.internetEnabled;
    saveConfig();
    configureStorage(config.workingDirectory, true);
    await scanProjects();
    return sendJson(res, 200, publicState(req));
  }

  if (method === "POST" && pathname === "/api/finance/suppliers") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a beszállító neve.");
    const supplier = {
      id: id(),
      name,
      contact: String(body.contact || "").trim(),
      email: String(body.email || "").trim(),
      phone: String(body.phone || "").trim(),
      note: String(body.note || "").trim(),
      createdAt: nowIso()
    };
    db.financeSuppliers.push(supplier);
    db.financeSuppliers.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 201, supplier);
  }

  match = pathname.match(/^\/api\/finance\/suppliers\/([^/]+)$/);
  if (match && method === "PATCH") {
    const supplier = db.financeSuppliers.find((item) => item.id === match[1]);
    if (!supplier) return sendError(res, 404, "Nincs ilyen beszállító.");
    const body = await readJsonBody(req);
    for (const key of ["name", "contact", "email", "phone", "note"]) {
      if (key in body) supplier[key] = String(body[key] || "").trim();
    }
    if (!supplier.name) return sendError(res, 400, "Hiányzik a beszállító neve.");
    db.financeSuppliers.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 200, supplier);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financeSuppliers, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen beszállító.");
    for (const item of db.financePriceItems || []) {
      if (item.supplierId === removed.id) {
        item.supplierId = "";
        item.supplierName = item.supplierName || removed.name;
      }
    }
    for (const item of db.financeQuotes || []) {
      if (item.supplierId === removed.id) {
        item.supplierId = "";
        item.supplierName = item.supplierName || removed.name;
      }
    }
    for (const item of [...(db.financeOutsourceItems || []), ...(db.financeProductionItems || [])]) {
      if (item.supplierId === removed.id) {
        item.supplierId = "";
        item.supplierName = item.supplierName || removed.name;
      }
    }
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/price-items") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a tétel neve.");
    const supplier = db.financeSuppliers.find((item) => item.id === body.supplierId) || null;
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || String(body.supplierName || "").trim(),
      category: String(body.category || "Egyéb").trim(),
      name,
      quantity: Number(body.quantity || 0),
      unit: String(body.unit || "db").trim(),
      unitPrice: Number(body.unitPrice || 0),
      currency: String(body.currency || "HUF").trim(),
      status: String(body.status || "Tervezett").trim(),
      date: String(body.date || "").trim() || nowIso().slice(0, 10),
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso()
    };
    db.financePriceItems.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/price-items\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.financePriceItems.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen pénzügyi tétel.");
    const body = await readJsonBody(req);
    if ("supplierId" in body) {
      const supplier = db.financeSuppliers.find((entry) => entry.id === body.supplierId);
      item.supplierId = supplier?.id || "";
      item.supplierName = supplier?.name || item.supplierName || "";
    }
    for (const key of ["category", "name", "unit", "currency", "status", "date", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("projectId" in body && db.projects[body.projectId]) {
      item.projectId = body.projectId;
      item.projectName = db.projects[body.projectId].name;
    }
    if ("quantity" in body) item.quantity = Number(body.quantity || 0);
    if ("unitPrice" in body) item.unitPrice = Number(body.unitPrice || 0);
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financePriceItems, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen pénzügyi tétel.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/cost-items") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a tétel neve.");
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      category: String(body.category || "Egyéb").trim(),
      name,
      plannedAmount: Number(body.plannedAmount || 0),
      actualAmount: Number(body.actualAmount || 0),
      status: String(body.status || "Tervezett").trim(),
      date: String(body.date || "").trim() || nowIso().slice(0, 10),
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.financeCostItems.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/cost-items\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.financeCostItems.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen költségtétel.");
    const body = await readJsonBody(req);
    if ("projectId" in body && db.projects[body.projectId]) {
      item.projectId = body.projectId;
      item.projectName = db.projects[body.projectId].name;
    }
    for (const key of ["category", "name", "status", "date", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("plannedAmount" in body) item.plannedAmount = Number(body.plannedAmount || 0);
    if ("actualAmount" in body) item.actualAmount = Number(body.actualAmount || 0);
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financeCostItems, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen költségtétel.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/outsource-items") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const part = String(body.part || "").trim();
    if (!part) return sendError(res, 400, "Hiányzik az alkatrész.");
    const supplier = db.financeSuppliers.find((item) => item.id === body.supplierId) || null;
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      part,
      operation: String(body.operation || "").trim(),
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || "",
      issuedAt: String(body.issuedAt || "").trim(),
      expectedBackAt: String(body.expectedBackAt || "").trim(),
      plannedAmount: Number(body.plannedAmount || 0),
      actualAmount: Number(body.actualAmount || 0),
      status: String(body.status || "Új").trim(),
      nextStep: String(body.nextStep || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.financeOutsourceItems.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/outsource-items\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.financeOutsourceItems.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen bérmunka tétel.");
    const body = await readJsonBody(req);
    if ("supplierId" in body) {
      const supplier = db.financeSuppliers.find((entry) => entry.id === body.supplierId);
      item.supplierId = supplier?.id || "";
      item.supplierName = supplier?.name || item.supplierName || "";
    }
    for (const key of ["part", "operation", "issuedAt", "expectedBackAt", "status", "nextStep"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("plannedAmount" in body) item.plannedAmount = Number(body.plannedAmount || 0);
    if ("actualAmount" in body) item.actualAmount = Number(body.actualAmount || 0);
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financeOutsourceItems, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen bérmunka tétel.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/production-items") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const part = String(body.part || "").trim();
    if (!part) return sendError(res, 400, "Hiányzik az alkatrész.");
    const supplier = db.financeSuppliers.find((item) => item.id === body.supplierId) || null;
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      part,
      operation: String(body.operation || "").trim(),
      workplace: String(body.workplace || "").trim(),
      plannedHours: Number(body.plannedHours || 0),
      actualHours: Number(body.actualHours || 0),
      type: String(body.type || "Belső").trim(),
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || "",
      deadline: String(body.deadline || "").trim(),
      priority: String(body.priority || "Normál").trim(),
      status: String(body.status || "Új").trim(),
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.financeProductionItems.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/production-items\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.financeProductionItems.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen gyártási feladat.");
    const body = await readJsonBody(req);
    if ("supplierId" in body) {
      const supplier = db.financeSuppliers.find((entry) => entry.id === body.supplierId);
      item.supplierId = supplier?.id || "";
      item.supplierName = supplier?.name || item.supplierName || "";
    }
    for (const key of ["part", "operation", "workplace", "type", "deadline", "priority", "status", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("plannedHours" in body) item.plannedHours = Number(body.plannedHours || 0);
    if ("actualHours" in body) item.actualHours = Number(body.actualHours || 0);
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financeProductionItems, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen gyártási feladat.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/design-items") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const title = String(body.title || "").trim();
    if (!title) return sendError(res, 400, "Hiányzik a tétel neve.");
    let paths;
    try {
      paths = cleanDesignPaths(body);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      area: String(body.area || "").trim(),
      title,
      userId: isKnownUser(body.userId) ? body.userId : "",
      revision: String(body.revision || "").trim(),
      status: String(body.status || "Új").trim(),
      percent: Math.max(0, Math.min(100, Number(body.percent || 0))),
      ...paths,
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.engineeringDesignItems.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/design-items\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.engineeringDesignItems.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen mérnöki / tervezési tétel.");
    const body = await readJsonBody(req);
    let paths = {};
    try {
      paths = cleanDesignPaths(body, true);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    if ("userId" in body) item.userId = isKnownUser(body.userId) ? body.userId : "";
    for (const key of ["area", "title", "revision", "status", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("percent" in body) item.percent = Math.max(0, Math.min(100, Number(body.percent || 0)));
    Object.assign(item, paths);
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.engineeringDesignItems, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen mérnöki / tervezési tétel.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/quotes") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const title = String(body.title || "").trim();
    if (!title) return sendError(res, 400, "Hiányzik az ajánlat tárgya.");
    const supplier = db.financeSuppliers.find((item) => item.id === body.supplierId) || null;
    const item = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      supplierId: supplier?.id || "",
      supplierName: supplier?.name || "",
      title,
      amount: Number(body.amount || 0),
      currency: String(body.currency || "HUF").trim(),
      status: String(body.status || "Bekérve").trim(),
      validUntil: String(body.validUntil || "").trim(),
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso()
    };
    db.financeQuotes.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/finance\/quotes\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.financeQuotes.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen ajánlat.");
    const body = await readJsonBody(req);
    if ("projectId" in body && db.projects[body.projectId]) {
      item.projectId = body.projectId;
      item.projectName = db.projects[body.projectId].name;
    }
    if ("supplierId" in body) {
      const supplier = db.financeSuppliers.find((entry) => entry.id === body.supplierId);
      item.supplierId = supplier?.id || "";
      item.supplierName = supplier?.name || "";
    }
    for (const key of ["title", "currency", "status", "validUntil", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if ("amount" in body) item.amount = Number(body.amount || 0);
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.financeQuotes, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen ajánlat.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/engineering-notes") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const title = String(body.title || "").trim();
    if (!title) return sendError(res, 400, "Hiányzik a bejegyzés tárgya.");
    const userId = isKnownUser(body.userId) ? body.userId : "";
    const status = String(body.status || "Nyitott").trim();
    const note = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      type: String(body.type || "Döntés").trim(),
      title,
      userId,
      dueDate: String(body.dueDate || "").trim(),
      status,
      note: String(body.note || "").trim(),
      ...creatorFields(req),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      closedAt: normalizeKey(status) === normalizeKey("Lezárva") ? nowIso() : ""
    };
    db.engineeringNotes.unshift(note);
    saveDb();
    return sendJson(res, 201, note);
  }

  match = pathname.match(/^\/api\/finance\/engineering-notes\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.engineeringNotes.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen mérnöki bejegyzés.");
    const body = await readJsonBody(req);
    if ("projectId" in body && db.projects[body.projectId]) {
      item.projectId = body.projectId;
      item.projectName = db.projects[body.projectId].name;
    }
    if ("userId" in body) item.userId = isKnownUser(body.userId) ? body.userId : "";
    for (const key of ["type", "title", "dueDate", "status", "note"]) {
      if (key in body) item[key] = String(body[key] || "").trim();
    }
    if (normalizeKey(item.status) === normalizeKey("Lezárva") && !item.closedAt) item.closedAt = nowIso();
    if (normalizeKey(item.status) !== normalizeKey("Lezárva")) item.closedAt = "";
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.engineeringNotes, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen mérnöki bejegyzés.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/finance/settings") {
    const body = await readJsonBody(req);
    const cleanList = (items) => Array.isArray(items)
      ? items.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    db.financeSettings = {
      categories: cleanList(body.categories),
      currencies: cleanList(body.currencies),
      statuses: cleanList(body.statuses),
      quoteStatuses: cleanList(body.quoteStatuses),
      noteTypes: cleanList(body.noteTypes),
      noteStatuses: cleanList(body.noteStatuses),
      outsourceOperations: cleanList(body.outsourceOperations),
      outsourceStatuses: cleanList(body.outsourceStatuses),
      productionOperations: cleanList(body.productionOperations),
      productionWorkplaces: cleanList(body.productionWorkplaces),
      productionTypes: cleanList(body.productionTypes),
      productionPriorities: cleanList(body.productionPriorities),
      productionStatuses: cleanList(body.productionStatuses),
      costCategories: cleanList(body.costCategories),
      designAreas: cleanList(body.designAreas),
      designStatuses: cleanList(body.designStatuses)
    };
    saveDb();
    return sendJson(res, 200, financeState());
  }

  if (method === "POST" && pathname === "/api/dashboard/todos") {
    const body = await readJsonBody(req, 16 * 1024 * 1024);
    const text = String(body.text || "").trim();
    let image = null;
    try {
      image = storeDashboardTodoImage(body.imageDataUrl, body.imageName || "");
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    if (!text && !image) return sendError(res, 400, "Hiányzik a feladat vagy kép.");
    const todo = { id: id(), text, image, createdAt: nowIso(), checkedAt: null };
    db.dashboardTodos.unshift(todo);
    saveDb();
    return sendJson(res, 201, todo);
  }

  match = pathname.match(/^\/api\/dashboard\/todos\/([^/]+)$/);
  if (match && method === "PATCH") {
    const body = await readJsonBody(req);
    const todo = db.dashboardTodos.find((item) => item.id === match[1]);
    if (!todo) return sendError(res, 404, "Nincs ilyen feladat.");
    if (typeof body.text === "string") todo.text = body.text.trim();
    if (typeof body.checked === "boolean") todo.checkedAt = body.checked ? nowIso() : null;
    saveDb();
    return sendJson(res, 200, todo);
  }
  if (match && method === "DELETE") {
    const removed = removeFromCollection(db.dashboardTodos, match[1]);
    if (removed?.image?.kind === "upload") safeRemoveErpFileOrFolder(removed.image.path);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  match = pathname.match(/^\/api\/dashboard\/todos\/([^/]+)\/image$/);
  if (match && method === "GET") {
    const todo = db.dashboardTodos.find((item) => item.id === match[1]);
    if (!todo?.image) return sendError(res, 404, "Nincs kép ehhez a teendőhöz.");
    return sendFileResponse(res, todo.image, "inline");
  }

  if (method === "POST" && pathname === "/api/meetings") {
    const body = await readJsonBody(req);
    const title = String(body.title || "").trim();
    const time = String(body.time || "").trim();
    if (!title || !time) return sendError(res, 400, "Hiányzik a megbeszélés neve vagy időpontja.");
    const meeting = { id: id(), title, time: new Date(time).toISOString(), createdAt: nowIso() };
    db.meetings.push(meeting);
    saveDb();
    return sendJson(res, 201, meeting);
  }

  match = pathname.match(/^\/api\/meetings\/([^/]+)$/);
  if (match && method === "DELETE") {
    removeFromCollection(db.meetings, match[1]);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  // ----- Szabadnap (day-off) — shared dashboard list, visible to everyone -----
  if (method === "POST" && pathname === "/api/dayoffs") {
    const body = await readJsonBody(req);
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const startDate = String(body.startDate || body.date || "").trim();
    if (!dateRe.test(startDate)) return sendError(res, 400, "Add meg a kezdő dátumot (ÉÉÉÉ-HH-NN).");
    let endDate = String(body.endDate || "").trim();
    if (endDate && !dateRe.test(endDate)) return sendError(res, 400, "A vég dátum formátuma hibás.");
    if (!endDate) endDate = startDate;
    if (endDate < startDate) return sendError(res, 400, "A vég dátum nem lehet a kezdő dátum előtt.");
    const requester = currentUser(req);
    const target = (body.userId && isKnownUser(body.userId))
      ? db.users.find((u) => u.id === body.userId)
      : requester;
    if (!target) return sendError(res, 400, "Válassz felhasználót.");
    db.dayOffs = Array.isArray(db.dayOffs) ? db.dayOffs : [];
    const entry = {
      id: id(),
      userId: target.id,
      userName: target.name,
      startDate,
      endDate,
      createdByUserId: requester?.id || "",
      createdByName: requester?.name || "",
      createdAt: nowIso()
    };
    db.dayOffs.push(entry);
    saveDb();
    return sendJson(res, 201, entry);
  }

  match = pathname.match(/^\/api\/dayoffs\/([^/]+)$/);
  if (match && method === "DELETE") {
    db.dayOffs = Array.isArray(db.dayOffs) ? db.dayOffs : [];
    removeFromCollection(db.dayOffs, match[1]);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/projects/manual") {
    const body = await readJsonBody(req);
    const project = ensureManualProject(body.name);
    if (!project) return sendError(res, 400, "Hiányzik a projektnév.");
    if (typeof body.active === "boolean" && project.active !== body.active) {
      project.active = body.active;
      addProjectNotice(db, { kind: project.active ? "project-activated" : "project-deactivated", projectId: project.id, projectName: project.name, actorName: currentUser(req)?.name || "" });
    }
    saveDb();
    return sendJson(res, 201, project);
  }

  match = pathname.match(/^\/api\/projects\/([^/]+)\/browser$/);
  if (match && method === "GET") {
    const projectId = decodeURIComponent(match[1]);
    const project = db.projects[projectId] || db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    try {
      return sendJson(res, 200, await projectBrowserState(project));
    } catch (error) {
      return sendError(res, 400, error.message || "Projekt böngésző hiba.");
    }
  }

  match = pathname.match(/^\/api\/projects\/([^/]+)\/browser\/pdf$/);
  if (match && method === "GET") {
    const projectId = decodeURIComponent(match[1]);
    const project = db.projects[projectId] || db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    try {
      return sendFileResponse(res, projectBrowserPdfRecord(project, urlObj.searchParams.get("path") || ""), "inline");
    } catch (error) {
      return sendError(res, 400, error.message || "PDF megnyitási hiba.");
    }
  }

  match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match && method === "DELETE") {
    if (db.projects[match[1]]?.active !== false) return sendError(res, 400, "Archiválás előtt tedd inaktívvá a projektet.");
    const archive = archiveProjectFromErp(match[1], {
      excludeFromRescan: true,
      reason: "manual-delete",
      archivedByUser: currentUser(req)
    });
    if (!archive) return sendError(res, 404, "Nincs ilyen projekt.");
    saveDb();
    return sendJson(res, 200, { ok: true, archive, project: archive.project, excludedFolders: archive.project?.folderPaths || [] });
  }

  match = pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (match && method === "PATCH") {
    const project = db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    const body = await readJsonBody(req);
    const wasActive = project.active !== false;
    if (typeof body.active === "boolean") {
      project.active = body.active;
      if (!body.active) {
        project.priority = null;
        project.completedAt = body.completed ? nowIso() : project.completedAt;
        normalizePriorities();
      } else {
        project.completedAt = null;
      }
    }
    if (typeof body.completed === "boolean" && body.completed) {
      project.active = false;
      project.priority = null;
      project.completedAt = nowIso();
      normalizePriorities();
    }
    if ("responsibleUserIds" in body) {
      const ids = Array.isArray(body.responsibleUserIds) ? body.responsibleUserIds : [];
      project.responsibleUserIds = ids.filter((userId, index, arr) =>
        isKnownUser(userId) && arr.indexOf(userId) === index
      );
    }
    if ("deadline" in body) {
      const deadline = String(body.deadline || "").trim();
      project.deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : "";
    }
    if ("company" in body) {
      // Folder-derived company is authoritative; manual value is only
      // accepted when no scan root decides it (manual/legacy projects).
      // ensureProjectFields below re-derives anyway — this just keeps the
      // intent explicit.
      if (!deriveProjectCompany(project)) {
        project.company = normalizeCompany(body.company);
      }
    }
    if ("priority" in body) {
      const result = setProjectPriority(project.id, body.priority, Boolean(body.reorderPriority));
      if (!result.ok) return sendError(res, result.status || 400, result.error || "Prioritás hiba.");
    }
    ensureProjectFields(project);
    if (wasActive !== (project.active !== false)) {
      addProjectNotice(db, { kind: project.active ? "project-activated" : "project-deactivated", projectId: project.id, projectName: project.name, actorName: currentUser(req)?.name || "" });
    }
    saveDb();
    return sendJson(res, 200, project);
  }

  if (method === "POST" && pathname === "/api/boms") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    let filePath;
    try {
      filePath = validateNetworkLink(body.filePath);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    try {
      const stat = await fsp.stat(filePath);
      if (!stat.isFile()) return sendError(res, 400, "A BOM útvonal nem fájl.");
      const record = await createBomRecord({
        project,
        name: body.name || path.parse(filePath).name,
        revision: body.revision || "",
        kind: "link",
        filePath,
        fileName: path.basename(filePath),
        size: stat.size,
        creator: currentUser(req)
      });
      return sendJson(res, 201, record);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (method === "POST" && pathname === "/api/boms/upload") {
    return handleBomUpload(req, res, urlObj);
  }

  match = pathname.match(/^\/api\/boms\/([^/]+)$/);
  if (match && method === "DELETE") {
    const item = db.boms.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen BOM.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.boms, match[1]);
    if (removed.kind === "upload") safeRemoveErpFileOrFolder(removed.path);
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  match = pathname.match(/^\/api\/boms\/([^/]+)\/file$/);
  if (match && method === "GET") {
    const record = db.boms.find((entry) => entry.id === match[1]);
    return sendFileDownload(res, record);
  }

  if (method === "POST" && pathname === "/api/tasks") {
    const body = await readJsonBody(req, 32 * 1024 * 1024);
    const title = String(body.title || "").trim();
    if (!title) return sendError(res, 400, "Hiányzik a munkafolyamat neve.");
    if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    const rawImages = Array.isArray(body.imageDataUrls) ? body.imageDataUrls.slice(0, 10) : [];
    const storedImages = [];
    try {
      for (const dataUrl of rawImages) {
        const stored = storeTaskImage(dataUrl, "");
        if (stored) storedImages.push(stored);
      }
    } catch (error) {
      for (const image of storedImages) safeRemoveErpFileOrFolder(image.path);
      return sendError(res, 400, error.message);
    }
    const task = {
      id: id(),
      title,
      quantity: Math.max(0, Number(body.quantity || 0)) || 0,
      description: String(body.description || "").trim(),
      projectId: project.projectId,
      projectName: project.projectName,
      userId: body.userId || "",
      priority: normalizeTaskPriority(body.priority),
      images: storedImages,
      ...creatorFields(req),
      status: "open",
      createdAt: nowIso(),
      doneAt: null
    };
    db.tasks.unshift(task);
    saveDb();
    return sendJson(res, 201, task);
  }

  if (method === "POST" && pathname === "/api/cnc-tasks") {
    const body = await readJsonBody(req, 32 * 1024 * 1024);
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
    if (!isKnownMachine(body.machineId)) return sendError(res, 400, "Válassz CNC gépet.");
    let window;
    try {
      window = validateTimeWindow(body.plannedStart, body.plannedEnd);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const rawImages = Array.isArray(body.imageDataUrls) ? body.imageDataUrls.slice(0, 10) : [];
    const storedImages = [];
    try {
      for (const dataUrl of rawImages) {
        const stored = storeCncTaskImage(dataUrl, "");
        if (stored) storedImages.push(stored);
      }
    } catch (error) {
      // Clean up anything written so far on error
      for (const image of storedImages) safeRemoveErpFileOrFolder(image.path);
      return sendError(res, 400, error.message);
    }
    const item = {
      id: id(),
      projectId: project.projectId,
      projectName: project.projectName,
      machineId: body.machineId,
      machineName: machineName(body.machineId),
      userId: body.userId || "",
      plannedStart: window.plannedStart,
      plannedEnd: window.plannedEnd,
      note: String(body.note || "").trim(),
      images: storedImages,
      ...creatorFields(req),
      status: "open",
      createdAt: nowIso(),
      doneAt: null
    };
    db.cncTasks.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/cnc-tasks\/([^/]+)\/images\/(\d+)$/);
  if (match && method === "GET") {
    const task = db.cncTasks.find((entry) => entry.id === match[1]);
    if (!task) return sendError(res, 404, "Nincs ilyen CNC feladat.");
    const image = (task.images || [])[Number(match[2])];
    if (!image) return sendError(res, 404, "Nincs ilyen kép.");
    return sendFileResponse(res, image, "inline");
  }

  match = pathname.match(/^\/api\/cnc-tasks\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.cncTasks.find((task) => task.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen CNC feladat.");
    const body = await readJsonBody(req);
    let notificationRecipients = [];
    if ("done" in body) {
      if (body.done) {
        const actualStartTime = Date.parse(String(body.actualStart || ""));
        if (!Number.isFinite(actualStartTime)) return sendError(res, 400, "Add meg a valós kezdési időt.");
        const hours = Number(body.hours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return sendError(res, 400, "Az idő 0-nál nagyobb és legfeljebb 24 óra lehet.");
        const actualEndTime = actualStartTime + hours * 3600000;
        const actualEnd = new Date(actualEndTime).toISOString();
        const actualStart = new Date(actualStartTime).toISOString();
        markDone(db.cncTasks, match[1], actualEnd);
        item.actualEnd = actualEnd;
        item.actualStart = actualStart;

        // Drop any pasted creation-time images now that the task is reported.
        dropCncTaskImages(item);

        // Auto-create / refresh a worklog tied to this CNC task report.
        db.workLogs = (db.workLogs || []).filter((log) => log.sourceCncTaskId !== match[1]);
        const reportingUserId = body.userId && isKnownUser(body.userId) ? body.userId : item.userId;
        const reportingUser = db.users.find((entry) => entry.id === reportingUserId) || null;
        const creator = currentUser(req);
        const noteForLog = String(body.reportNote ?? item.reportNote ?? "").trim() || String(item.note || "").trim();
        const projectForLog = db.projects[item.projectId];
        const worklog = {
          id: id(),
          projectId: item.projectId,
          projectName: projectForLog?.name || item.projectName || "",
          workType: "CNC megmunkálás",
          hours,
          cncMachineId: item.machineId || "",
          cncMachineName: machineName(item.machineId) || item.machineName || "",
          workDate: dateOnly(actualEnd) || todayLocalDate(),
          overtime: false,
          note: noteForLog,
          filePath: "",
          fileName: "",
          sourceCncTaskId: match[1],
          userId: reportingUser?.id || reportingUserId || "",
          createdByUserId: creator?.id || reportingUser?.id || "",
          createdByName: creator?.name || reportingUser?.name || "",
          createdAt: nowIso()
        };
        db.workLogs.unshift(worklog);
        notificationRecipients = collectWorklogCreatedNotifications(worklog, creator || reportingUser);
      } else {
        item.status = "open";
        item.doneAt = null;
        item.actualEnd = null;
        item.actualStart = null;
        db.workLogs = (db.workLogs || []).filter((log) => log.sourceCncTaskId !== match[1]);
      }
    }
    if ("plannedStart" in body || "plannedEnd" in body) {
      let window;
      try {
        window = validateTimeWindow(body.plannedStart ?? item.plannedStart, body.plannedEnd ?? item.plannedEnd);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
      item.plannedStart = window.plannedStart;
      item.plannedEnd = window.plannedEnd;
    }
    if ("projectId" in body) {
      const project = db.projects[body.projectId];
      if (!project) return sendError(res, 400, "Válassz projektet.");
      item.projectId = project.id;
      item.projectName = project.name;
    }
    if ("userId" in body) {
      if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
      item.userId = body.userId;
    }
    if ("machineId" in body) {
      if (!isKnownMachine(body.machineId)) return sendError(res, 400, "Válassz CNC gépet.");
      item.machineId = body.machineId;
      item.machineName = machineName(body.machineId);
    }
    if ("note" in body) item.note = String(body.note || "").trim();
    if ("reportNote" in body) item.reportNote = String(body.reportNote || "").trim();
    saveDb();
    queuePushSignalsForUsers(notificationRecipients);
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.cncTasks.find((task) => task.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen CNC feladat.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.cncTasks, match[1]);
    for (const file of db.files || []) {
      if (file.cncTaskId === match[1] && file.kind === "upload") safeRemoveErpFileOrFolder(file.path);
    }
    for (const image of removed.images || []) {
      if (image?.kind === "upload") safeRemoveErpFileOrFolder(image.path);
    }
    db.files = (db.files || []).filter((file) => file.cncTaskId !== match[1]);
    db.workLogs = (db.workLogs || []).filter((log) => log.sourceCncTaskId !== match[1]);
    archiveDeletedTask("cnc-task", removed, currentUser(req));
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  match = pathname.match(/^\/api\/tasks\/([^/]+)\/images$/);
  if (match && method === "POST") {
    const item = db.tasks.find((task) => task.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen feladat.");
    const body = await readJsonBody(req, 16 * 1024 * 1024);
    item.images = item.images || [];
    if (item.images.length >= 10) return sendError(res, 400, "Maximum 10 kép csatolható egy feladathoz.");
    let image;
    try {
      image = storeTaskImage(body.imageDataUrl, body.imageName || "");
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    if (!image) return sendError(res, 400, "Hiányzik a kép.");
    item.images.push(image);
    saveDb();
    return sendJson(res, 201, image);
  }

  match = pathname.match(/^\/api\/tasks\/([^/]+)\/images\/(\d+)$/);
  if (match && method === "GET") {
    const task = db.tasks.find((entry) => entry.id === match[1]);
    if (!task) return sendError(res, 404, "Nincs ilyen feladat.");
    const image = (task.images || [])[Number(match[2])];
    if (!image) return sendError(res, 404, "Nincs ilyen kép.");
    return sendFileResponse(res, image, "inline");
  }

  match = pathname.match(/^\/api\/tasks\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.tasks.find((task) => task.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen feladat.");
    const body = await readJsonBody(req);
    let notificationRecipients = [];
    if ("done" in body) {
      if (body.done) {
        item.status = "done";
        item.doneAt = nowIso();
        dropTaskImages(item);
      } else {
        item.status = "open";
        item.doneAt = null;
      }
    }
    if ("title" in body) {
      const title = String(body.title || "").trim();
      if (!title) return sendError(res, 400, "Hiányzik a munkafolyamat neve.");
      item.title = title;
    }
    if ("description" in body) item.description = String(body.description || "").trim();
    if ("priority" in body) item.priority = normalizeTaskPriority(body.priority);
    if ("userId" in body) {
      if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
      item.userId = body.userId;
    }
    if ("projectId" in body) {
      const project = db.projects[body.projectId];
      if (!project) return sendError(res, 400, "Válassz projektet.");
      item.projectId = project.id;
      item.projectName = project.name;
    }
    if ("quantity" in body) item.quantity = Math.max(0, Number(body.quantity || 0)) || 0;
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.tasks.find((task) => task.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen feladat.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.tasks, match[1]);
    for (const file of db.files || []) {
      if (file.taskId === match[1] && file.kind === "upload") safeRemoveErpFileOrFolder(file.path);
    }
    dropTaskImages(removed);
    archiveDeletedTask("task", removed, currentUser(req));
    db.files = (db.files || []).filter((file) => file.taskId !== match[1]);
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/tool-requests") {
    const body = await readJsonBody(req);
    const toolName = String(body.toolName || "").trim();
    let attachment = null;
    try {
      attachment = requestAttachmentFromBody(body);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    if (!toolName && !attachment) return sendError(res, 400, "Hiányzik a szerszám neve.");
    const targetUserId = String(body.userId || currentUser(req)?.id || "").trim();
    if (!isKnownUser(targetUserId)) return sendError(res, 400, "Válassz felelőst a listából.");
    if (toolName) addCatalogValue("toolName", toolName);
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    const item = {
      id: id(),
      toolName,
      quantity: Math.max(0, Number(body.quantity || 0)) || 0,
      projectId: project.projectId,
      projectName: project.projectName,
      sideProject: false,
      sideDescription: "",
      description: String(body.description || "").trim(),
      userId: targetUserId,
      ...creatorFields(req),
      status: "open",
      createdAt: nowIso(),
      doneAt: null,
      ...(attachment ? { attachment } : {})
    };
    db.toolRequests.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/tool-requests\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.toolRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen szerszámigény.");
    const body = await readJsonBody(req);
    let notificationRecipients = [];
    if ("done" in body) {
      if (body.done) {
        item.status = "done";
        item.doneAt = nowIso();
      } else {
        item.status = "open";
        item.doneAt = null;
      }
    }
    if ("toolName" in body) {
      const toolName = String(body.toolName || "").trim();
      if (!toolName) return sendError(res, 400, "Hiányzik a szerszám neve.");
      item.toolName = toolName;
      addCatalogValue("toolName", toolName);
    }
    if ("description" in body) item.description = String(body.description || "").trim();
    if ("userId" in body) {
      if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
      item.userId = body.userId;
    }
    if ("projectId" in body) {
      const project = db.projects[body.projectId];
      if (!project) return sendError(res, 400, "Válassz projektet.");
      item.projectId = project.id;
      item.projectName = project.name;
    }
    if ("quantity" in body) item.quantity = Math.max(0, Number(body.quantity || 0)) || 0;
    if ("attachmentPath" in body || "path" in body) {
      let attachment = null;
      try {
        attachment = requestAttachmentFromBody(body);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
      if (item.attachment?.kind === "upload") safeRemoveErpFileOrFolder(item.attachment.path);
      if (attachment) item.attachment = attachment;
      else delete item.attachment;
    }
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.toolRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen szerszámigény.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.toolRequests, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen szerszámigény.");
    archiveDeletedTask("tool-request", removed, currentUser(req));
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/material-requests") {
    const body = await readJsonBody(req, 32 * 1024 * 1024);
    const prefabTransport = booleanFlag(body.prefabTransport);
    let material = String(body.material || "").trim();
    let size = String(body.size || "").trim();
    let length = String(body.length || "").trim();
    let quantity = Math.max(0, Number(body.quantity || 0)) || 0;
    let type = String(body.type || "").trim();
    let externalCompany = String(body.externalCompany || "").trim();
    let prefabTaskType = String(body.prefabTaskType || "").trim();
    const prefabDirection = normalizePrefabDirection(body.prefabDirection);
    let attachment = null;
    try {
      attachment = requestAttachmentFromBody(body);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const targetUserId = String(body.userId || currentUser(req)?.id || "").trim();
    if (!isKnownUser(targetUserId)) return sendError(res, 400, "Válassz felelőst a listából.");
    if (prefabTransport) {
      if (!externalCompany && !attachment) return sendError(res, 400, "Hiányzik a külsős cég.");
      if (externalCompany) addCatalogValue("externalCompany", externalCompany);
      if (prefabTaskType) addCatalogValue("prefabTaskType", prefabTaskType);
      material = "Előgyártmány szállítás";
      size = "";
      length = "";
      quantity = 0;
      type = "";
    } else {
      if (!material && !attachment) return sendError(res, 400, "Hiányzik az anyag.");
      externalCompany = "";
      prefabTaskType = "";
      if (material) addCatalogValue("material", material);
      if (type) addCatalogValue("type", type);
      if (length) addCatalogValue("materialLength", length);
    }
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    const rawImages = prefabTransport && Array.isArray(body.imageDataUrls) ? body.imageDataUrls.slice(0, 10) : [];
    const storedImages = [];
    try {
      for (const dataUrl of rawImages) {
        const stored = storeMaterialRequestImage(dataUrl, "");
        if (stored) storedImages.push(stored);
      }
    } catch (error) {
      for (const image of storedImages) safeRemoveErpFileOrFolder(image.path);
      return sendError(res, 400, error.message);
    }
    const item = {
      id: id(),
      prefabTransport,
      prefabDirection: prefabTransport ? prefabDirection : "",
      externalCompany,
      prefabTaskType: prefabTransport ? prefabTaskType : "",
      material,
      size,
      length,
      quantity,
      type,
      projectId: project.projectId,
      projectName: project.projectName,
      sideProject: false,
      sideDescription: "",
      description: String(body.description || "").trim(),
      images: prefabTransport ? storedImages : [],
      userId: targetUserId,
      ...creatorFields(req),
      status: "open",
      createdAt: nowIso(),
      doneAt: null,
      ...(attachment ? { attachment } : {})
    };
    db.materialRequests.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/material-requests\/([^/]+)\/images\/(\d+)$/);
  if (match && method === "GET") {
    const item = db.materialRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen anyagigény.");
    const image = (item.images || [])[Number(match[2])];
    if (!image) return sendError(res, 404, "Nincs ilyen kép.");
    return sendFileResponse(res, image, "inline");
  }

  match = pathname.match(/^\/api\/material-requests\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.materialRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen anyagigény.");
    const body = await readJsonBody(req);
    let notificationRecipients = [];
    if ("done" in body) {
      if (body.done) {
        item.status = "done";
        item.doneAt = nowIso();
        dropMaterialRequestImages(item);
      } else {
        item.status = "open";
        item.doneAt = null;
      }
    }
    if ("prefabTransport" in body || "externalCompany" in body || "prefabTaskType" in body || "material" in body || "size" in body || "length" in body || "type" in body || "quantity" in body) {
      const prefabTransport = "prefabTransport" in body ? booleanFlag(body.prefabTransport) : Boolean(item.prefabTransport);
      if (prefabTransport) {
        const externalCompany = String(("externalCompany" in body ? body.externalCompany : item.externalCompany) || "").trim();
        const prefabTaskType = String(("prefabTaskType" in body ? body.prefabTaskType : item.prefabTaskType) || "").trim();
        if (!externalCompany) return sendError(res, 400, "Hiányzik a külsős cég.");
        item.prefabTransport = true;
        item.prefabDirection = normalizePrefabDirection("prefabDirection" in body ? body.prefabDirection : item.prefabDirection);
        item.externalCompany = externalCompany;
        item.prefabTaskType = prefabTaskType;
        item.material = "Előgyártmány szállítás";
        item.size = "";
        item.length = "";
        item.type = "";
        item.quantity = 0;
        addCatalogValue("externalCompany", externalCompany);
        if (prefabTaskType) addCatalogValue("prefabTaskType", prefabTaskType);
      } else {
        const material = String(("material" in body ? body.material : item.material) || "").trim();
        if (!material) return sendError(res, 400, "Hiányzik az anyag.");
        dropMaterialRequestImages(item);
        item.prefabTransport = false;
        item.prefabDirection = "";
        item.externalCompany = "";
        item.prefabTaskType = "";
        item.material = material;
        item.size = "size" in body ? String(body.size || "").trim() : String(item.size || "").trim();
        item.length = "length" in body ? String(body.length || "").trim() : String(item.length || "").trim();
        const type = String(("type" in body ? body.type : item.type) || "").trim();
        item.type = type;
        item.quantity = "quantity" in body ? Math.max(0, Number(body.quantity || 0)) || 0 : Math.max(0, Number(item.quantity || 0)) || 0;
        addCatalogValue("material", material);
        if (type) addCatalogValue("type", type);
        if (item.length) addCatalogValue("materialLength", item.length);
      }
    }
    if ("description" in body) item.description = String(body.description || "").trim();
    if ("userId" in body) {
      if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
      item.userId = body.userId;
    }
    if ("projectId" in body) {
      const project = db.projects[body.projectId];
      if (!project) return sendError(res, 400, "Válassz projektet.");
      item.projectId = project.id;
      item.projectName = project.name;
    }
    if ("attachmentPath" in body || "path" in body) {
      let attachment = null;
      try {
        attachment = requestAttachmentFromBody(body);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
      if (item.attachment?.kind === "upload") safeRemoveErpFileOrFolder(item.attachment.path);
      if (attachment) item.attachment = attachment;
      else delete item.attachment;
    }
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.materialRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen anyagigény.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.materialRequests, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen anyagigény.");
    dropMaterialRequestImages(removed);
    archiveDeletedTask("material-request", removed, currentUser(req));
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/fastener-requests") {
    const body = await readJsonBody(req);
    const grade = String(body.grade || "").trim();
    const type = String(body.type || "").trim();
    if (grade) addCatalogValue("fastenerGrade", grade);
    if (type) addCatalogValue("fastenerType", type);
    const size = String(body.size || "").trim();
    if (size) addCatalogValue("fastenerSize", size);
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    let attachment = null;
    try {
      attachment = requestAttachmentFromBody(body);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const targetUserId = String(body.userId || currentUser(req)?.id || "").trim();
    if (!isKnownUser(targetUserId)) return sendError(res, 400, "Válassz felelőst a listából.");
    const item = {
      id: id(),
      grade,
      size,
      type,
      quantity: Math.max(0, Number(body.quantity || 0)) || 0,
      projectId: project.projectId,
      projectName: project.projectName,
      sideProject: false,
      sideDescription: "",
      description: String(body.description || "").trim(),
      userId: targetUserId,
      ...creatorFields(req),
      status: "open",
      createdAt: nowIso(),
      doneAt: null,
      ...(attachment ? { attachment } : {})
    };
    db.fastenerRequests.unshift(item);
    saveDb();
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/fastener-requests\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.fastenerRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen kötőelem igény.");
    const body = await readJsonBody(req);
    let notificationRecipients = [];
    if ("done" in body) {
      if (body.done) {
        item.status = "done";
        item.doneAt = nowIso();
      } else {
        item.status = "open";
        item.doneAt = null;
      }
    }
    if ("grade" in body) {
      const grade = String(body.grade || "").trim();
      item.grade = grade;
      if (grade) addCatalogValue("fastenerGrade", grade);
    }
    if ("size" in body) {
      const size = String(body.size || "").trim();
      item.size = size;
      if (size) addCatalogValue("fastenerSize", size);
    }
    if ("type" in body) {
      const type = String(body.type || "").trim();
      item.type = type;
      if (type) addCatalogValue("fastenerType", type);
    }
    if ("description" in body) item.description = String(body.description || "").trim();
    if ("userId" in body) {
      if (!isKnownUser(body.userId)) return sendError(res, 400, "Válassz felelőst a listából.");
      item.userId = body.userId;
    }
    if ("projectId" in body) {
      const project = db.projects[body.projectId];
      if (!project) return sendError(res, 400, "Válassz projektet.");
      item.projectId = project.id;
      item.projectName = project.name;
    }
    if ("quantity" in body) item.quantity = Math.max(0, Number(body.quantity || 0)) || 0;
    if ("attachmentPath" in body || "path" in body) {
      let attachment = null;
      try {
        attachment = requestAttachmentFromBody(body);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
      if (item.attachment?.kind === "upload") safeRemoveErpFileOrFolder(item.attachment.path);
      if (attachment) item.attachment = attachment;
      else delete item.attachment;
    }
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.fastenerRequests.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen kötőelem igény.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.fastenerRequests, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen kötőelem igény.");
    archiveDeletedTask("fastener-request", removed, currentUser(req));
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  match = pathname.match(/^\/api\/(tool-requests|material-requests|fastener-requests)\/([^/]+)\/attachment$/);
  if (match && method === "POST") {
    return handleRequestAttachmentLink(req, res, match[1], match[2]);
  }

  match = pathname.match(/^\/api\/(tool-requests|material-requests|fastener-requests)\/([^/]+)\/attachment\/download$/);
  if (match && method === "GET") {
    const { config, item } = requestAttachmentItem(match[1], match[2]);
    if (!config) return sendError(res, 404, "Ismeretlen melléklet típus.");
    if (!item?.attachment) return sendError(res, 404, config.noAttachment);
    return sendFileDownload(res, item.attachment);
  }

  match = pathname.match(/^\/api\/(tool-requests|material-requests|fastener-requests)\/([^/]+)\/attachment\/view$/);
  if (match && method === "GET") {
    const { config, item } = requestAttachmentItem(match[1], match[2]);
    if (!config) return sendError(res, 404, "Ismeretlen melléklet típus.");
    if (!item?.attachment) return sendError(res, 404, config.noAttachment);
    const downloadUrl = `/api/${match[1]}/${encodeURIComponent(item.id)}/attachment/download`;
    const attachmentName = item.attachment.path || item.attachment.name || "";
    if (isXlsxFileName(attachmentName)) {
      return sendXlsxViewer(res, { ...item.attachment, downloadUrl }, config.title(item));
    }
    if (path.extname(attachmentName).toLowerCase() === ".pdf") {
      return sendFileResponse(res, item.attachment, "inline");
    }
    return sendFileDownload(res, item.attachment);
  }

  if (method === "POST" && pathname === "/api/worklogs") {
    const body = await readJsonBody(req);
    const creator = currentUser(req);
    if (!creator) return sendAuthRequired(res);
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return sendError(res, 400, "Az idő 0-nál nagyobb és legfeljebb 24 óra lehet.");
    const targetUser = body.userId && isKnownUser(body.userId)
      ? db.users.find((entry) => entry.id === body.userId)
      : creator;
    if (!targetUser) return sendError(res, 400, "Válassz felhasználót a listából.");
    let cncMachineId = "";
    let cncMachineName = "";
    if (body.cncMachineId) {
      const machine = (db.cncMachines || []).find((entry) => entry.id === body.cncMachineId);
      if (!machine) return sendError(res, 400, "Válassz CNC gépet a listából.");
      cncMachineId = machine.id;
      cncMachineName = machine.name;
    }
    const rawDate = String(body.date || "").trim();
    const workDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayLocalDate();
    let filePath = "";
    if (body.filePath) {
      try {
        filePath = validateYDrivePath(body.filePath);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
    }
    const item = {
      id: id(),
      projectId: project.projectId,
      projectName: project.projectName,
      workType: cncMachineId ? "CNC megmunkálás" : String(body.workType || "").trim(),
      hours,
      cncMachineId,
      cncMachineName,
      workDate,
      overtime: canUseOvertimeFlag(creator) ? booleanFlag(body.overtime) : false,
      note: String(body.note || "").trim(),
      filePath,
      fileName: filePath ? path.basename(filePath) : "",
      userId: targetUser.id,
      createdByUserId: creator.id,
      createdByName: creator.name,
      createdAt: nowIso()
    };
    db.workLogs.unshift(item);
    const notificationRecipients = collectWorklogCreatedNotifications(item, creator);
    saveDb();
    queuePushSignalsForUsers(notificationRecipients);
    return sendJson(res, 201, item);
  }

  match = pathname.match(/^\/api\/worklogs\/([^/]+)$/);
  if (match && method === "PATCH") {
    const item = db.workLogs.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen naplózás.");
    const body = await readJsonBody(req);
    const editor = currentUser(req);
    if (!editor) return sendAuthRequired(res);
    const project = resolveProjectFromBody(body);
    if (!project.projectId) return sendError(res, 400, "Válassz projektet.");
    const hours = Number(body.hours);
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return sendError(res, 400, "Az idő 0-nál nagyobb és legfeljebb 24 óra lehet.");
    const targetUser = body.userId && isKnownUser(body.userId)
      ? db.users.find((entry) => entry.id === body.userId)
      : editor;
    if (!targetUser) return sendError(res, 400, "Válassz felhasználót a listából.");
    let cncMachineId = "";
    let cncMachineName = "";
    if (body.cncMachineId) {
      const machine = (db.cncMachines || []).find((entry) => entry.id === body.cncMachineId);
      if (!machine) return sendError(res, 400, "Válassz CNC gépet a listából.");
      cncMachineId = machine.id;
      cncMachineName = machine.name;
    }
    const rawDate = String(body.date || "").trim();
    const workDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : todayLocalDate();
    let filePath = "";
    if (body.filePath) {
      try {
        filePath = validateYDrivePath(body.filePath);
      } catch (error) {
        return sendError(res, 400, error.message);
      }
    }
    item.projectId = project.projectId;
    item.projectName = project.projectName;
    item.workType = cncMachineId ? "CNC megmunkálás" : String(body.workType || "").trim();
    item.hours = hours;
    delete item.setupHours;
    item.cncMachineId = cncMachineId;
    item.cncMachineName = cncMachineName;
    item.workDate = workDate;
    if (canUseOvertimeFlag(editor)) item.overtime = booleanFlag(body.overtime);
    item.note = String(body.note || "").trim();
    item.filePath = filePath;
    item.fileName = filePath ? path.basename(filePath) : "";
    item.userId = targetUser.id;
    item.updatedByUserId = editor.id;
    item.updatedByName = editor.name;
    item.updatedAt = nowIso();
    saveDb();
    return sendJson(res, 200, item);
  }
  if (match && method === "DELETE") {
    const item = db.workLogs.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen naplózás.");
    if (!requireDeleteOwnedEntry(req, res, item)) return;
    const removed = removeFromCollection(db.workLogs, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen naplózás.");
    archiveDeletedTask("work-log", removed, currentUser(req));
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if (method === "POST" && pathname === "/api/cnc-machines") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a CNC gép neve.");
    if (db.cncMachines.some((machine) => normalizeKey(machine.name) === normalizeKey(name))) {
      return sendError(res, 409, "Ez a CNC gép már létezik.");
    }
    const machine = { id: id(), name, createdAt: nowIso() };
    db.cncMachines.push(machine);
    db.cncMachines.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 201, machine);
  }

  match = pathname.match(/^\/api\/cnc-machines\/([^/]+)$/);
  if (match && method === "PATCH") {
    const machine = db.cncMachines.find((item) => item.id === match[1]);
    if (!machine) return sendError(res, 404, "Nincs ilyen CNC gép.");
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a CNC gép neve.");
    machine.name = name;
    for (const task of db.cncTasks || []) {
      if (task.machineId === machine.id) task.machineName = name;
    }
    db.cncMachines.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 200, machine);
  }
  if (match && method === "DELETE") {
    if ((db.cncTasks || []).some((task) => task.machineId === match[1] && task.status !== "done")) {
      return sendError(res, 409, "Nyitott CNC feladat használja ezt a gépet.");
    }
    const removed = removeFromCollection(db.cncMachines, match[1]);
    if (!removed) return sendError(res, 404, "Nincs ilyen CNC gép.");
    saveDb();
    return sendJson(res, 200, { ok: true, removed });
  }

  if ((pathname === "/api/users" || /^\/api\/users\/[^/]+$/.test(pathname)) && !userHasClearance(currentUser(req), 2)) {
    return sendClearanceRequired(res);
  }

  if (method === "POST" && pathname === "/api/users") {
    const body = await readJsonBody(req);
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a név.");
    if (db.users.some((user) => normalizeKey(user.name) === normalizeKey(name))) return sendError(res, 409, "Ez a felhasználó már létezik.");
    const user = { id: id(), name, createdAt: nowIso(), clearanceLevel: normalizeClearanceLevel(body.clearanceLevel) };
    assignUserPassword(user, body.password || DEFAULT_USER_PASSWORD);
    db.users.push(user);
    db.users.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 201, publicUser(user));
  }

  match = pathname.match(/^\/api\/users\/([^/]+)$/);
  if (match && method === "PATCH") {
    const body = await readJsonBody(req);
    const user = db.users.find((item) => item.id === match[1]);
    if (!user) return sendError(res, 404, "Nincs ilyen felhasználó.");
    const name = String(body.name || "").trim();
    if (!name) return sendError(res, 400, "Hiányzik a név.");
    if (db.users.some((item) => item.id !== user.id && normalizeKey(item.name) === normalizeKey(name))) return sendError(res, 409, "Ez a felhasználó már létezik.");
    user.name = name;
    if ("clearanceLevel" in body) user.clearanceLevel = normalizeClearanceLevel(body.clearanceLevel);
    if (body.password) assignUserPassword(user, body.password);
    db.users.sort((a, b) => a.name.localeCompare(b.name, "hu"));
    saveDb();
    return sendJson(res, 200, publicUser(user));
  }
  if (match && method === "DELETE") {
    const user = db.users.find((item) => item.id === match[1]);
    if (!user) return sendError(res, 404, "Nincs ilyen felhasználó.");
    const remaining = db.users.filter((item) => item.id !== user.id);
    if (!remaining.length) return sendError(res, 409, "Legalább egy felhasználónak maradnia kell.");
    if (normalizeClearanceLevel(user.clearanceLevel) >= 2 && !remaining.some((item) => normalizeClearanceLevel(item.clearanceLevel) >= 2)) {
      return sendError(res, 409, "Legalább egy 2-es jogosultságú felhasználónak maradnia kell.");
    }
    removeFromCollection(db.users, match[1]);
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/catalog") {
    const body = await readJsonBody(req);
    if (!catalogKey(body.kind)) return sendError(res, 400, "Ismeretlen katalógus típus.");
    addCatalogValue(body.kind, body.value);
    saveDb();
    return sendJson(res, 201, { ok: true });
  }
  if (method === "PATCH" && pathname === "/api/catalog") {
    const body = await readJsonBody(req);
    const key = catalogKey(body.kind);
    if (!key) return sendError(res, 400, "Ismeretlen katalógus típus.");
    db[key] = db[key] || [];
    const index = db[key].findIndex((item) => normalizeKey(item) === normalizeKey(body.oldValue));
    if (index < 0) return sendError(res, 404, "Nincs ilyen elem.");
    db[key][index] = String(body.value || "").trim();
    db[key].sort((a, b) => a.localeCompare(b, "hu"));
    saveDb();
    return sendJson(res, 200, { ok: true });
  }
  if (method === "DELETE" && pathname === "/api/catalog") {
    const key = catalogKey(urlObj.searchParams.get("kind"));
    if (!key) return sendError(res, 400, "Ismeretlen katalógus típus.");
    const value = urlObj.searchParams.get("value");
    db[key] = (db[key] || []).filter((item) => normalizeKey(item) !== normalizeKey(value));
    saveDb();
    return sendJson(res, 200, { ok: true });
  }

  if (method === "POST" && pathname === "/api/files/link") {
    const body = await readJsonBody(req);
    const project = db.projects[body.projectId];
    if (!project) return sendError(res, 404, "Válassz projektet.");
    const task = body.taskId ? db.tasks.find((item) => item.id === body.taskId) : null;
    const cncTask = body.cncTaskId ? db.cncTasks.find((item) => item.id === body.cncTaskId) : null;
    if (body.taskId && (!task || task.projectId !== project.id)) {
      return sendError(res, 400, "A csatolmány munkafolyamata nem ehhez a projekthez tartozik.");
    }
    if (body.cncTaskId && (!cncTask || cncTask.projectId !== project.id)) {
      return sendError(res, 400, "A csatolmány CNC feladata nem ehhez a projekthez tartozik.");
    }
    let filePath;
    try {
      filePath = validateNetworkLink(body.path);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const record = {
      id: id(),
      projectId: project.id,
      projectName: project.name,
      taskId: task?.id || null,
      cncTaskId: cncTask?.id || null,
      taskTitle: task?.title || (cncTask ? `CNC: ${cncTask.machineName || machineName(cncTask.machineId)}` : ""),
      kind: "link",
      name: String(body.name || path.basename(filePath)).trim() || path.basename(filePath),
      path: filePath,
      ...creatorFields(req),
      createdAt: nowIso()
    };
    db.files.unshift(record);
    saveDb();
    return sendJson(res, 201, record);
  }

  if (method === "GET" && pathname === "/api/files/browse") {
    try {
      return sendJson(res, 200, await browseFiles(urlObj.searchParams.get("path") || "", {
        officeOnly: urlObj.searchParams.get("filter") === "office"
      }));
    } catch (error) {
      return sendError(res, 400, error.message);
    }
  }

  if (method === "POST" && pathname === "/api/files/upload") {
    return handleUpload(req, res, urlObj);
  }

  match = pathname.match(/^\/api\/files\/([^/]+)\/preview$/);
  if (match && method === "GET") {
    const record = db.files.find((entry) => entry.id === match[1]);
    return sendFileResponse(res, record, "inline");
  }
  match = pathname.match(/^\/api\/files\/([^/]+)$/);
  if (match && method === "GET") {
    const record = db.files.find((entry) => entry.id === match[1]);
    return sendFileDownload(res, record);
  }
  match = pathname.match(/^\/api\/files\/([^/]+)\/download$/);
  if (match && method === "GET") {
    const record = db.files.find((entry) => entry.id === match[1]);
    return sendFileDownload(res, record);
  }

  match = pathname.match(/^\/api\/files\/([^/]+)$/);
  if (match && method === "DELETE") {
    const item = db.files.find((entry) => entry.id === match[1]);
    if (!item) return sendError(res, 404, "Nincs ilyen fájl.");
    if (!requireDeleteFileEntry(req, res, item)) return;
    const record = removeFromCollection(db.files, match[1]);
    saveDb();
    return sendJson(res, 200, { ok: true, record });
  }

  match = pathname.match(/^\/api\/export\/project\/([^/]+)$/);
  if (match && method === "GET") {
    const project = db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    const xlsx = buildXlsx(project.id);
    const filename = `${projectExportBaseName(project)}_statisztika.xlsx`;
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": xlsx.length,
      "Cache-Control": "no-store"
    });
    return res.end(xlsx);
  }

  match = pathname.match(/^\/api\/export\/worklog\/([^/]+)$/);
  if (match && method === "GET") {
    const project = db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    let xlsx;
    try {
      xlsx = buildWorklogXlsx(project.id);
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const filename = `${projectExportBaseName(project)}_munkaido.xlsx`;
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": xlsx.length,
      "Cache-Control": "no-store"
    });
    return res.end(xlsx);
  }

  if (method === "GET" && pathname === "/api/export/cnc-worklog") {
    let xlsx;
    const from = urlObj.searchParams.get("from") || "";
    const to = urlObj.searchParams.get("to") || "";
    try {
      xlsx = buildCncWorklogXlsx({ from, to });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const rangePart = from || to ? `_${from || "kezdet"}_${to || "veg"}` : "";
    const filename = `CNC_munkaido${rangePart}.xlsx`;
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": xlsx.length,
      "Cache-Control": "no-store"
    });
    return res.end(xlsx);
  }

  // Generalized worklog export — every worklog, optionally filtered by
  // projectId and/or userId (felelős); both combine (AND).
  if (method === "GET" && pathname === "/api/export/worklogs") {
    const projectId = urlObj.searchParams.get("projectId") || "";
    const userId = urlObj.searchParams.get("userId") || "";
    let xlsx;
    try {
      xlsx = buildWorklogExportXlsx({ projectId, userId });
    } catch (error) {
      return sendError(res, 400, error.message);
    }
    const project = projectId ? db.projects[projectId] : null;
    const userLabel = userId ? (userName(userId) || "") : "";
    let base = "Munkaido";
    if (project) base += `_${sanitizeFileName(project.name)}`;
    if (userLabel) base += `_${sanitizeFileName(userLabel)}`;
    const filename = `${base}.xlsx`;
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": xlsx.length,
      "Cache-Control": "no-store"
    });
    return res.end(xlsx);
  }

  match = pathname.match(/^\/api\/export\/finance\/project\/([^/]+)$/);
  if (match && method === "GET") {
    const project = db.projects[match[1]];
    if (!project) return sendError(res, 404, "Nincs ilyen projekt.");
    const xlsx = buildFinanceXlsx(project.id);
    const filename = `${projectExportBaseName(project)}_penzugy.xlsx`;
    res.writeHead(200, {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": xlsx.length,
      "Cache-Control": "no-store"
    });
    return res.end(xlsx);
  }

  return sendError(res, 404, "Ismeretlen API útvonal.");
}

function serveStatic(req, res, urlObj) {
  let requestPath = decodeURIComponent(urlObj.pathname);
  if (requestPath === "/") requestPath = "/index.html";
  // SPA alias: the hidden modelling photo page. app.js switches to the
  // modelling login/photo view based on location.pathname.
  if (requestPath === "/modelling" || requestPath === "/modelling/") requestPath = "/index.html";
  const targetPath = path.normalize(path.join(PUBLIC_DIR, requestPath));
  const relative = path.relative(PUBLIC_DIR, targetPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(targetPath, (error, data) => {
    if (error) {
      res.writeHead(404);
      return res.end("Not found");
    }
    const ext = path.extname(targetPath).toLowerCase();
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".webmanifest": "application/manifest+json; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml; charset=utf-8",
      ".png": "image/png"
    };
    res.writeHead(200, {
      "Content-Type": types[ext] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    res.end(data);
  });
}

async function handleRequest(req, res, context = {}) {
  const urlObj = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const clientIp = clientIpFor(req, context);
  if (urlObj.pathname.startsWith("/api/")) {
    recordIpHit(clientIp, String(req.headers?.["user-agent"] || ""));
  }
  if (isIpBlocked(clientIp)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    return res.end("Forbidden (IP blocked).");
  }
  try {
    if (urlObj.pathname.startsWith("/api/")) {
      if (isDirectApiBrowserVisit(req, urlObj.pathname) && !isIntentionalBrowserApiPath(urlObj.pathname)) {
        return sendApiBrowserPage(res);
      }
      return await handleApi(req, res, urlObj, context);
    }
    return serveStatic(req, res, urlObj);
  } catch (error) {
    console.error(error);
    return sendError(res, error.httpStatus || 500, error.message || "Szerver hiba.");
  }
}

async function main() {
  const hostEligibility = getHostEligibility();
  if (!hostEligibility.ok) {
    console.log(`[host-eligibility] ${hostEligibility.reason}. Host inditas megszakitva.`);
    stopLocalCloudflareProcesses("host not eligible");
    process.exit(0);
    return;
  }
  // Resolve canonical storage and check run-state BEFORE loading/writing any
  // business data. A disconnected share must never start a fallback ERP.
  effectiveWorkingDirectory = resolveWorkingDirForCli();
  dataDirectory = path.join(effectiveWorkingDirectory, "data");
  if (!fs.existsSync(path.join(dataDirectory,"erp.db"))) throw new Error("Canonical ERP database unavailable; startup aborted.");

  // Honor the global on/off switch; startup never changes it implicitly.
  // If the operator explicitly turned it off via stop-server.bat, refuse to start.
  const state = readServerState();
  if (!state.run) {
    console.log(`[server-state] kikapcsolva (${state.updatedBy || "ismeretlen"}, ${state.updatedAt || "—"}).`);
    console.log("[server-state] Indítás megszakítva. Először futtasd: start-server.bat (ami visszakapcsolja).");
    process.exit(0);
    return;
  }
  // Claim hosting before binding any port. Older hosts will detect the bumped
  // generation on their next poll and shut themselves down.
  try {
    claimHostLock();
  } catch (error) {
    console.error("[host-lock] kezdeti írás hiba:", error.message);
    throw error;
  }
  console.log("[start] configureStorage after host claim...");
  configureStorage(config.workingDirectory);
  console.log("[start] adatbazis kesz; fenced single-writer storage.");
  ensureAllProjectFields();
  saveDb();
  loadSessions();
  startHostLockWatcher();

  const intervalMs = Math.max(3, Number(config.scanIntervalSeconds) || 10) * 1000;
  const hostName = os.hostname();

  // Start the HTTP server FIRST. Folder scanning runs in the background so a slow
  // network share on Y:\CompanyProjects can't block server startup.
  const server = http.createServer((req, res) => handleRequest(req, res, { internet: false }));
  httpServers.push(server);
  try {
    await listenWithRetry(server, config.port, config.host, "LAN");
    console.log("Workshop ERP fut.");
    console.log(`Helyi cim:   http://localhost:${config.port}`);
    console.log(`Halozati cim: http://${hostName}:${config.port}`);
    console.log(`Munkakonyvtar: ${effectiveWorkingDirectory}${usingFallbackDirectory ? " (tartalek, Y: nem erheto el)" : ""}`);
  } catch (error) {
    console.error("[start] LAN port indítás sikertelen:", error.message);
    shutdownHost("listen failed");
    return;
  }

  runLogMaintenance("server-start", { force: true });
  backgroundTimers.push(setInterval(() => runLogMaintenance("server-scheduled"), LOG_MAINTENANCE_INTERVAL_MS));
  runServerAutoBackup("server-start").catch((error) => console.error("[backup] startup backup failed:", error.message));
  backgroundTimers.push(setInterval(() => {
    runServerAutoBackup("server-scheduled").catch((error) => console.error("[backup] scheduled backup failed:", error.message));
  }, SERVER_BACKUP_INTERVAL_MS));

  runPasswordReminderCheck("server-start");
  backgroundTimers.push(setInterval(() => runPasswordReminderCheck("scheduled"), PASSWORD_REMINDER_CHECK_MS));

  if (config.internetEnabled !== false) {
    const internetServer = http.createServer((req, res) => handleRequest(req, res, { internet: true }));
    httpServers.push(internetServer);
    listenWithRetry(internetServer, config.internetPort || 4781, config.internetHost || config.host || "0.0.0.0", "internet")
      .then(() => console.log(`Internet/Cloudflare cim: http://${hostName}:${config.internetPort || 4781}`))
      .catch((error) => console.error("[start] internet port indítás sikertelen:", error.message));
  }

  // Kick off the first scan in the background, then keep scanning on the configured interval.
  scanProjects()
    .then(() => console.log("[start] elso szken kesz."))
    .catch((error) => console.error("[start] elso szken hiba:", error.message));

  backgroundTimers.push(setInterval(() => {
    cleanupExpired();
    scanProjects().catch((error) => console.error("Scan failed", error.message));
  }, intervalMs));

  backgroundTimers.push(setInterval(() => {
    if (!ipHistoryDirty) return;
    try {
      saveDb();
      ipHistoryDirty = false;
    } catch (error) {
      console.error("IP history flush failed:", error.message);
    }
  }, IP_HISTORY_FLUSH_MS));

  backgroundTimers.push(setInterval(checkpointWal, 5 * 60 * 1000));

  // Flush session lastSeen/changes to the shared file every 30 s (only when
  // dirty). Login/logout/kick already force an immediate save; this captures
  // the lastSeen drift that keeps the 12h expiry accurate across handovers.
  backgroundTimers.push(setInterval(() => saveSessions(false), 30 * 1000));

  // External time-tracker worklog import: scan the drop folder right away,
  // then every 10 s. (The import pipeline existed; this timer registration
  // was the missing piece — without it importWorklogDropFolder never ran.)
  try { ensureWorklogImportDirs(); } catch (error) { console.error("[worklog-import] dir init failed:", error.message); }
  importWorklogDropFolder().catch((error) => console.error("[worklog-import] initial scan failed:", error.message));
  backgroundTimers.push(setInterval(() => {
    importWorklogDropFolder().catch((error) => console.error("[worklog-import] tick failed:", error.message));
  }, WORKLOG_IMPORT_INTERVAL_MS));

  try { scanCadModels(); } catch (error) { console.error("[cadmodels] initial scan failed:", error.message); }
  backgroundTimers.push(setInterval(() => {
    try { scanCadModels(); } catch (error) { console.error("[cadmodels] tick failed:", error.message); }
  }, CAD_MODEL_SCAN_INTERVAL_MS));

  // Host startup owns the connector. Clean stale local supervisors first, then
  // force one fresh launch so takeover does not wait for heartbeat expiry.
  stopLocalCloudflareProcesses("host startup cleanup");
  tickCloudflareSupervision({ force: true });
  backgroundTimers.push(setInterval(tickCloudflareSupervision, CLOUDFLARE_SUPERVISE_INTERVAL_MS));
}

if (!process.argv.includes("--watch-loop")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
