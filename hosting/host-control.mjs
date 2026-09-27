// Generic launcher entry point. Deliberately does no installation or hosting
// until the preserved backend's security, paths and trash-only retention are adapted.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHostPlan, validateHostPlan } from "./host-plan.mjs";

const args = process.argv.slice(2);
const action = args[0] || "inspect";
const configAt = args.indexOf("--config");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configFile = configAt >= 0 ? args[configAt + 1] : path.join(root, "config.json");
const allowed = new Set(["inspect", "install", "watch", "start", "stop", "restart", "cloudflare"]);

try {
  if (!allowed.has(action) || !configFile || !path.isAbsolute(configFile)) {
    throw new Error("Usage: node hosting/host-control.mjs <inspect|install|watch|start|stop|restart|cloudflare> --config <absolute private config.json>");
  }
  const plan = readHostPlan(configFile);
  const issues = validateHostPlan(plan);
  if (issues.length) {
    for (const issue of issues) console.error(`Host plan: ${issue}`);
    process.exitCode = 2;
  } else if (action === "inspect") {
    console.log("Host plan path relationships pass static checks. No drive, database, token, port, process or service was opened.");
  } else {
    // This must remain a second, independent gate even when config is filled.
    // Do not let an edited JSON field activate the legacy backend by accident.
    throw new Error(`${action} is not enabled: original backend startup, hosted authentication, trash-only retention and failover have not passed disposable-host validation. No action was taken.`);
  }
} catch (error) {
  console.error(`Host action refused: ${error.message}`);
  process.exitCode = 1;
}
