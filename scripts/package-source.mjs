// Explicit, non-overwriting corresponding-source bundle for the local ERP.
// Review every changed file before using this as a release or hosted source offer.
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const SOURCE_FILES = Object.freeze([
  ".github/dependabot.yml", ".github/workflows/tests.yml", ".gitignore", "AGENTS.md", "CUSTOMIZE.md", "ERP-HANDOFF.md", "LICENSE", "PROVENANCE-LICENSING.md",
  "PUBLICATION-STATUS.md", "PRIVACY-REVIEW.md", "README.md", "WORKLOG-IMPORT.md",
  "app/ORIGINAL-BACKEND.md", "app/package.json", "app/server.js",
  "app/storageSafety.js", "app/hostEnrollment.js", "app/projectContinuity.js",
  "app/cadModels.js", "app/cadModelCache.js", "app/helper/workshop-helper.ps1",
  "app/public/app.js", "app/public/english-ui.js", "app/public/index.html", "app/public/manifest.webmanifest",
  "app/public/styles.css", "app/public/sw.js",
  "app/public/erp-glb-viewer/LICENSE.txt", "app/public/erp-glb-viewer/README.md",
  "app/public/erp-glb-viewer/THIRD-PARTY-LICENSES.txt",
  "app/public/erp-glb-viewer/chunks/chunk-Q2YQ3HJI.js",
  "app/public/erp-glb-viewer/erp-glb-viewer.js", "app/public/erp-glb-viewer/index.html",
  "app/public/erp-glb-viewer/main.js", "app/public/erp-glb-viewer/viewer.css",
  "app/vendor/erp-glb-viewer-source.zip",
  "app/vendor/erp-glb-viewer-source/LICENSE.txt", "app/vendor/erp-glb-viewer-source/README.md",
  "app/vendor/erp-glb-viewer-source/THIRD-PARTY-LICENSES.txt",
  "app/vendor/erp-glb-viewer-source/index.html", "app/vendor/erp-glb-viewer-source/package-lock.json",
  "app/vendor/erp-glb-viewer-source/package.json",
  "app/vendor/erp-glb-viewer-source/scripts/build.mjs",
  "app/vendor/erp-glb-viewer-source/scripts/generate-sample.mjs",
  "app/vendor/erp-glb-viewer-source/scripts/package-source.mjs",
  "app/vendor/erp-glb-viewer-source/server.mjs",
  "app/vendor/erp-glb-viewer-source/src/face-patches.mjs",
  "app/vendor/erp-glb-viewer-source/src/glb-guard.mjs",
  "app/vendor/erp-glb-viewer-source/src/main.mjs",
  "app/vendor/erp-glb-viewer-source/src/viewer.mjs",
  "app/vendor/erp-glb-viewer-source/tests/browser-smoke.mjs",
  "app/vendor/erp-glb-viewer-source/tests/geometry.test.mjs",
  "app/vendor/erp-glb-viewer-source/viewer.css",
  "cloudflare-launcher.cmd", "install-startup.bat", "restart-server.bat", "start-server.bat", "stop-server.bat", "watchdog-launcher.cmd",
  "hosting/README.md", "hosting/host-control.mjs", "hosting/host-plan.mjs",
  "config.example.json", "demo-auth.mjs", "demo-documents.mjs", "demo-images.mjs", "demo-ocr.mjs",
  "demo-modelling.mjs", "demo-project-browser.mjs", "demo-project-scan.mjs", "demo-server.mjs", "demo-store.mjs",
  "demo-worklog-import.mjs", "xlsx-demo.mjs", "package.json",
  "docs/index.html", "docs/gallery.html", "docs/images/README.md", "docs/images/cad-models.png", "docs/images/dashboard.png",
  "docs/images/materials-mobile.png", "docs/images/materials.png", "docs/images/model-viewer.png",
  "docs/images/modelling.png", "docs/images/projects.png", "docs/images/settings.png",
  "docs/images/suppliers.png", "docs/images/worklog.png",
  "docs/images/functions/model-viewer.png", "docs/images/functions/modelling.png",
  "docs/images/functions/project-browser.png", "docs/images/functions/worklog-fullscreen.png",
  "docs/images/menus/01-dashboard.png", "docs/images/menus/02-project-view.png",
  "docs/images/menus/03-cnc-summary.png", "docs/images/menus/04-todos.png",
  "docs/images/menus/05-cnc.png", "docs/images/menus/06-tools.png",
  "docs/images/menus/07-materials.png", "docs/images/menus/08-fasteners.png",
  "docs/images/menus/09-worklog.png", "docs/images/menus/10-bom.png",
  "docs/images/menus/11-cad-models.png", "docs/images/menus/12-suppliers.png",
  "docs/images/menus/13-price-items.png", "docs/images/menus/14-cost-planning.png",
  "docs/images/menus/15-outsourcing.png", "docs/images/menus/16-production-items.png",
  "docs/images/menus/17-design.png", "docs/images/menus/18-quotes.png",
  "docs/images/menus/19-engineering-notes.png", "docs/images/menus/20-production.png",
  "docs/images/menus/21-finance-reports.png", "docs/images/menus/22-projects.png",
  "docs/images/menus/23-parameters.png", "docs/images/menus/24-stats.png",
  "docs/images/menus/25-archive.png",
  "documents/README.md", "documents/demo-bom.csv",
  "documents/projects/d1df4d9de458995a26a8f5f9cdc83da3242ca3f93d0b5c2aa5323591fd61be81/synthetic-line.dxf",
  "images/logo.svg",
  "imports/cadmodels/demo-synthetic-box.glb", "imports/cadmodels/demo-synthetic-box.json",
  "scripts/backup-profile.mjs", "scripts/create-original-fixture.mjs", "scripts/create-synthetic-glb.mjs",
  "scripts/package-source.mjs", "scripts/setup-local.mjs",
  "tests/api-smoke.mjs", "tests/backup-profile.test.mjs", "tests/browser-smoke.mjs",
  "tests/config.test.mjs", "tests/fixtures/unsafe-config.json", "tests/full-api.test.mjs", "tests/host-plan.test.mjs",
  "tests/ocr.test.mjs", "tests/original-fixture.test.mjs", "tests/profile-isolation.test.mjs", "tests/project-scan-api.test.mjs", "tests/project-scan.test.mjs",
  "tests/secure-browser-smoke.mjs", "tests/secure-local.test.mjs", "tests/setup-local.test.mjs",
  "tests/source-package.test.mjs"
]);

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    if (bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error("Source ZIP is too large");
    const checksum = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 names
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(bytes.length, 18);
    localHeader.writeUInt32LE(bytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    local.push(localHeader, nameBytes, bytes);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(bytes.length, 20);
    centralHeader.writeUInt32LE(bytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

export function createSourceZip(rootDir) {
  const root = fs.realpathSync(rootDir);
  if (/^(?:\\\\|\/\/|y:)/i.test(root)) throw new Error("Source must be on a local non-Y drive");
  if (new Set(SOURCE_FILES).size !== SOURCE_FILES.length) throw new Error("Duplicate source allowlist member");
  const entries = [];
  const manifest = [];
  let total = 0;
  for (const name of SOURCE_FILES) {
    if (!/^[A-Za-z0-9._/-]+$/.test(name) || name.split("/").some((part) => part === ".." || part === "." || !part)) throw new Error(`Unsafe source name: ${name}`);
    const file = path.join(root, ...name.split("/"));
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(file).toLowerCase() !== file.toLowerCase() || stat.size > 5_000_000) {
      throw new Error(`Unsafe or oversize source file: ${name}`);
    }
    const bytes = fs.readFileSync(file);
    if (bytes.length !== stat.size || fs.statSync(file).mtimeMs !== stat.mtimeMs) throw new Error(`Source changed while packaging: ${name}`);
    total += bytes.length;
    if (total > 100_000_000) throw new Error("Source package exceeds 100 MB safety limit");
    entries.push([`workshop-erp-source/${name}`, bytes]);
    manifest.push({ path: name, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") });
  }
  entries.push(["workshop-erp-source/SOURCE-FILES.json", Buffer.from(JSON.stringify({ format: "workshop-erp-source-v1", files: manifest }, null, 2) + "\n")]);
  return { bytes: zip(entries), manifest };
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !path.isAbsolute(args[1])) {
    console.error("Usage: node scripts/package-source.mjs --out <new absolute local ZIP path>");
    process.exitCode = 2;
  } else {
    try {
      const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
      const output = path.resolve(args[1]);
      const parent = path.dirname(output);
      if (/^(?:\\\\|\/\/|y:)/i.test(parent) || fs.realpathSync(parent).toLowerCase() !== parent.toLowerCase()
          || (path.relative(root, output) === "" || (!path.relative(root, output).startsWith("..") && !path.isAbsolute(path.relative(root, output))))) {
        throw new Error("Source ZIP output must be outside the project on a real local non-Y directory");
      }
      if (fs.existsSync(output)) throw new Error("Refusing to overwrite an existing source ZIP");
      const result = createSourceZip(root);
      fs.writeFileSync(output, result.bytes, { flag: "wx" });
      console.log(`Created ${output} with ${result.manifest.length} explicitly allowlisted files; review archive and hashes before release.`);
    } catch (error) { console.error(`Packaging failed: ${error.message}`); process.exitCode = 1; }
  }
}
