// Localhost-demo modelling photo drop. No project scan or network path access.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const maxFolderBytes = 200_000_000;
const maxFolders = 200;

function localDirectory(folder) {
  const stat = fs.lstatSync(folder);
  if (stat.isSymbolicLink() || !stat.isDirectory() || fs.realpathSync(folder).toLowerCase() !== folder.toLowerCase()) {
    throw new Error("Demo modelling folder must not redirect outside its profile");
  }
}

function folderName(value) {
  const name = String(value || "").trim();
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]{0,79}$/u.test(name) || /[. ]$/.test(name)
      || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) {
    throw new Error("Use a simple modelling folder name without a path");
  }
  return name;
}

export function createModellingArea(storeDir, images) {
  const parent = fs.realpathSync(storeDir);
  const root = path.join(parent, "modelling");
  fs.mkdirSync(root, { recursive: true });
  localDirectory(root);

  function folders() {
    localDirectory(root);
    return fs.readdirSync(root, { withFileTypes: true }).slice(0, maxFolders + 1)
      .filter((entry) => {
        if (!entry.isDirectory() || entry.isSymbolicLink()) return false;
        try { localDirectory(path.join(root, entry.name)); return true; }
        catch { return false; }
      }).map((entry) => entry.name).sort((a, b) => a.localeCompare(b));
  }

  function save(folder, dataUrl) {
    const name = folderName(folder);
    const [photo] = images.prepare([dataUrl]);
    localDirectory(root);
    const destination = path.join(root, name);
    if (!fs.existsSync(destination)) {
      if (folders().length >= maxFolders) throw new Error("Demo modelling folder limit reached");
      fs.mkdirSync(destination);
    }
    localDirectory(destination);
    const entries = fs.readdirSync(destination, { withFileTypes: true });
    if (entries.length > 1000) throw new Error("Demo modelling folder file limit reached");
    let existingBytes = 0;
    for (const entry of entries) {
      const file = path.join(destination, entry.name);
      const stat = fs.lstatSync(file);
      if (stat.isSymbolicLink() || !stat.isFile() || fs.realpathSync(file).toLowerCase() !== file.toLowerCase()) {
        throw new Error("Redirected or nested modelling files are not allowed");
      }
      existingBytes += stat.size;
    }
    if (existingBytes + photo.bytes.length > maxFolderBytes) throw new Error("Demo modelling folder is limited to 200 MB");
    const filename = `${randomUUID()}.${photo.extension}`;
    fs.writeFileSync(path.join(destination, filename), photo.bytes, { flag: "wx" });
    return { folder: name, name: filename, size: photo.bytes.length,
      relativePath: `.demo-data/modelling/${name}/${filename}` };
  }

  return { folders, save, root };
}
