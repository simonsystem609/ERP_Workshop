// Profile-local image bytes for the localhost demo. No production paths.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const formats = {
  png: { mime: "image/png", extension: "png" },
  jpeg: { mime: "image/jpeg", extension: "jpg" },
  jpg: { mime: "image/jpeg", extension: "jpg" },
  webp: { mime: "image/webp", extension: "webp" }
};
const maxImageBytes = 8_000_000;
const maxTotalBytes = 20_000_000;

function parseDataUrl(value) {
  const match = /^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(String(value || ""));
  if (!match) throw new Error("Use a PNG, JPEG, or WebP image");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > maxImageBytes || bytes.toString("base64") !== match[2]) throw new Error("Invalid or oversized demo image (8 MB max each)");
  const kind = match[1].toLowerCase();
  const valid = kind === "png" ? bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
    : kind === "webp" ? bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP"
      : bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex"));
  if (!valid) throw new Error("Image bytes do not match their format");
  return { bytes, ...formats[kind] };
}

export function createImageArea(storeDir) {
  const parent = fs.realpathSync(storeDir);
  const root = path.join(parent, "images");
  fs.mkdirSync(root, { recursive: true });
  if (fs.lstatSync(root).isSymbolicLink() || fs.realpathSync(root).toLowerCase() !== root.toLowerCase()) {
    throw new Error("Demo image folder must not redirect outside its profile");
  }
  function prepare(values) {
    if (!Array.isArray(values) || values.length > 10) throw new Error("At most 10 demo images are allowed");
    const images = values.map(parseDataUrl);
    if (images.reduce((sum, image) => sum + image.bytes.length, 0) > maxTotalBytes) throw new Error("Demo images are limited to 20 MB total");
    return images;
  }
  function save(prepared) {
    return prepared.map((image) => {
      const name = `${randomUUID()}.${image.extension}`;
      fs.writeFileSync(path.join(root, name), image.bytes, { flag: "wx" });
      return { name, mime: image.mime, size: image.bytes.length };
    });
  }
  function open(image) {
    const name = String(image?.name || "");
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/.test(name)) throw new Error("Invalid demo image reference");
    const candidate = path.join(root, name);
    const target = fs.realpathSync(candidate);
    if (path.dirname(target).toLowerCase() !== root.toLowerCase() || !fs.statSync(target).isFile()) throw new Error("Image is outside local demo storage");
    return { path: target, mime: formats[path.extname(name).slice(1) === "jpg" ? "jpeg" : path.extname(name).slice(1)].mime, size: fs.statSync(target).size };
  }
  return { prepare, save, open };
}
