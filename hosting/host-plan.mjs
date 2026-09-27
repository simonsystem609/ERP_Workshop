// Read-only deployment-plan validation. No share, token, or process is opened.
import fs from "node:fs";
import path from "node:path";

const win = path.win32;
const norm = (value) => win.normalize(String(value || "").trim()).replace(/[\\/]+$/, "").toLowerCase();
const same = (a, b) => Boolean(a && b && norm(a) === norm(b));
const childOf = (parent, child) => {
  if (!parent || !child) return false;
  const rel = win.relative(parent, child);
  return Boolean(rel && rel !== ".." && !rel.startsWith("..\\") && !win.isAbsolute(rel));
};
const isDrivePath = (value, drive) => /^[A-Z]:\\/i.test(String(value || "")) && String(value).slice(0, 2).toUpperCase() === drive;
const isLocalPath = (value, drive) => /^[A-Z]:\\/i.test(String(value || "")) && !isDrivePath(value, drive);

export function readHostPlan(configFile) {
  if (!path.isAbsolute(configFile)) throw new Error("Config path must be absolute");
  const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config) || !config.futureHosting) {
    throw new Error("Missing futureHosting in the single config file");
  }
  return config.futureHosting;
}

export function validateHostPlan(plan) {
  const issues = [];
  const need = (condition, message) => { if (!condition) issues.push(message); };
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["futureHosting must be an object"];
  const storage = plan.storage || {}, server = plan.server || {}, cloudflare = plan.cloudflare || {};
  const watchdog = plan.watchdog || {}, backups = plan.backups || {};
  need(plan.schemaVersion === 1, "schemaVersion must be 1");
  need(plan.status === "reference-only", "status must remain reference-only until the hosted backend passes deployment gates");
  need(/^\\\\[^\\]+\\[^\\]+$/.test(storage.canonicalShare || "") && !/192\.0\.2\./.test(storage.canonicalShare || ""), "storage.canonicalShare must be a real two-component UNC share, not the example");
  need(/^[A-Z]:$/i.test(storage.mappedDrive || ""), "storage.mappedDrive must be one Windows drive letter");
  const drive = String(storage.mappedDrive || "").toUpperCase();
  need(isDrivePath(storage.erpRoot, drive) && !same(storage.erpRoot, drive + "\\"), "storage.erpRoot must be below the mapped drive root");
  need(same(storage.appDirectory, win.join(storage.erpRoot || "", "app")), "storage.appDirectory must equal erpRoot\\app");
  need(same(storage.dataDirectory, win.join(storage.erpRoot || "", "data")), "storage.dataDirectory must equal erpRoot\\data");
  need(same(storage.databaseFile, win.join(storage.dataDirectory || "", "erp.db")), "storage.databaseFile must equal dataDirectory\\erp.db");
  for (const [key, expectedRoot] of [["worklogInbox", storage.erpRoot], ["cadModelInbox", storage.erpRoot], ["cadModelCache", storage.erpRoot], ["logsDirectory", storage.erpRoot], ["uploadsDirectory", storage.erpRoot]]) {
    need(childOf(expectedRoot, storage[key]), `storage.${key} must be inside erpRoot`);
  }
  need(same(storage.trashDirectory, win.join(storage.canonicalShare || "", "trash")), "storage.trashDirectory must be the canonical share's trash folder");
  need(Array.isArray(storage.projectRoots) && storage.projectRoots.length > 0 && storage.projectRoots.every((root) => isDrivePath(root, drive) && !childOf(storage.erpRoot, root)), "storage.projectRoots must be nonempty mapped-drive paths outside erpRoot");
  need(Array.isArray(storage.excludedProjectPaths || []), "storage.excludedProjectPaths must be an array");
  need(server.localAuthRequired === true, "server.localAuthRequired must be true");
  need(server.host && server.host !== "127.0.0.1", "server.host must be an explicit LAN bind address");
  need(Number.isInteger(server.port) && server.port > 0 && server.port < 65536, "server.port must be a valid port");
  need(server.internetEnabled === false, "server.internetEnabled must remain false; tunnel origin uses the single authenticated listener");
  need(watchdog.singleActiveHost === true, "watchdog.singleActiveHost must be true");
  need(same(watchdog.hostLockFile, win.join(storage.dataDirectory || "", ".host-lock.json")), "watchdog.hostLockFile must be inside the configured data directory");
  need(same(watchdog.hostSwitchFile, win.join(storage.dataDirectory || "", ".host-switch.json")), "watchdog.hostSwitchFile must be inside the configured data directory");
  need(childOf(storage.dataDirectory, watchdog.heartbeatDirectory), "watchdog.heartbeatDirectory must be inside dataDirectory");
  need(backups.trashOnly === true, "backups.trashOnly must be true");
  need(Number.isInteger(backups.keepLatestAutomatic) && backups.keepLatestAutomatic >= 3, "backups.keepLatestAutomatic must be at least 3");
  need(Number.isInteger(backups.keepLatestManual) && backups.keepLatestManual >= 3, "backups.keepLatestManual must be at least 3");
  need(isDrivePath(backups.automaticRoot, drive) && !childOf(storage.erpRoot, backups.automaticRoot), "backups.automaticRoot must be outside erpRoot on the mapped drive");
  need(isDrivePath(backups.manualRoot, drive) && !childOf(storage.erpRoot, backups.manualRoot) && !same(backups.manualRoot, backups.automaticRoot), "backups.manualRoot must be separate and outside erpRoot");
  need(cloudflare.tunnelType === "remotely-managed", "cloudflare.tunnelType must be remotely-managed");
  need(cloudflare.originUrl === `http://127.0.0.1:${server.port}`, "cloudflare.originUrl must target the configured local authenticated listener");
  need(!cloudflare.enabled || (cloudflare.publicHostname && /\.exe$/i.test(cloudflare.binaryPath || "") && /\.txt$/i.test(cloudflare.tokenSourceFile || "") && /\.txt$/i.test(cloudflare.tokenLocalFile || "") && isLocalPath(cloudflare.tokenLocalFile, drive)), "enabled Cloudflare requires hostname, binary and token-file paths; the local token copy cannot be on the share");
  const cloudflareKeys = new Set(["enabled", "tunnelType", "publicHostname", "originUrl", "binaryPath", "tokenSourceFile", "tokenLocalFile"]);
  need(Object.keys(cloudflare).every((key) => cloudflareKeys.has(key)), "cloudflare accepts only documented fields; inline credentials are forbidden");
  return issues;
}

export function validateObservedMapping(plan, mapping) {
  const expected = plan?.storage?.canonicalShare;
  const registered = mapping?.registered;
  const provider = mapping?.provider;
  if (!expected || !same(registered, expected) || !mapping?.diskPresent || !same(provider, expected)) {
    throw new Error("Mapped drive does not resolve to the configured canonical share; refusing host action");
  }
  return true;
}
