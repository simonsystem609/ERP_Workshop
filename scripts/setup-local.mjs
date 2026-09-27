// First-run local config creation. This never replaces an edited profile.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function initializeLocalConfig(projectRoot) {
  const root = fs.realpathSync(projectRoot);
  const example = path.join(root, "config.example.json");
  const target = path.join(root, "config.json");
  const stat = fs.lstatSync(example);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(example).toLowerCase() !== example.toLowerCase()) {
    throw new Error("The generic config template must be a regular file inside this project");
  }
  if (fs.existsSync(target)) return { created: false, target };
  fs.copyFileSync(example, target, fs.constants.COPYFILE_EXCL);
  return { created: true, target };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  if (process.argv.length !== 2) {
    console.error("Usage: node scripts/setup-local.mjs");
    process.exitCode = 2;
  } else {
    try {
      const result = initializeLocalConfig(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
      console.log(result.created ? `Created ${result.target} from the generic template. Edit it before use.`
        : `${result.target} already exists and was left unchanged.`);
    } catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; }
  }
}
