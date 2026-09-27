// Local-only document sandbox for the generic demo. No Y:/UNC browsing.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const office = new Set([".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".vsd", ".vsdx", ".accdb", ".mdb", ".pub", ".one", ".odt", ".ods", ".odp", ".odg", ".pdf"]);
const mime = { ".pdf": "application/pdf", ".csv": "text/csv; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation" };

function inside(root, target) {
  const rel = path.relative(root, target);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}
export function documentArea(profileDir) {
  const profileRoot = fs.realpathSync(profileDir);
  if (/^(?:\\\\|\/\/|y:)/i.test(profileRoot)) throw new Error("Demo documents must be on a local non-Y drive");
  const docs = path.join(profileRoot, "documents");
  fs.mkdirSync(docs, { recursive: true });
  const root = fs.realpathSync(docs);
  if (fs.lstatSync(docs).isSymbolicLink() || !inside(profileRoot, root)
      || root.toLowerCase() !== docs.toLowerCase()) {
    throw new Error("Demo documents folder must not redirect outside its profile");
  }
  function resolve(input = "", { file = false, officeOnly = false } = {}) {
    const value = String(input || "").trim();
    if (/^[A-Za-z]:/.test(value) && !path.isAbsolute(value)) throw new Error("Drive-relative paths are not allowed");
    const relative = value.replace(/^documents(?:[\\/]|$)/i, "");
    const candidate = path.resolve(value ? (path.isAbsolute(value) ? value : path.join(root, relative)) : root);
    if (!inside(root, candidate)) throw new Error("Path is outside the local demo documents folder");
    const target = fs.realpathSync(candidate);
    if (!inside(root, target)) throw new Error("Path is outside the local demo documents folder");
    const stat = fs.statSync(target);
    if (file && !stat.isFile()) throw new Error("Choose a document file");
    if (officeOnly && !office.has(path.extname(target).toLowerCase())) throw new Error("Choose an Office, OpenDocument, or PDF file");
    return { path: target, stat };
  }
  function browse(input = "", officeOnly = false) {
    const { path: current, stat } = resolve(input);
    if (!stat.isDirectory()) throw new Error("Choose a folder");
    const parent = current === root ? null : path.dirname(current);
    const entries = fs.readdirSync(current, { withFileTypes: true }).slice(0, 500).flatMap((entry) => {
      try {
        const item = resolve(path.join(current, entry.name));
        if (item.stat.isDirectory()) return [{ kind: "folder", name: entry.name, path: item.path }];
        if (item.stat.isFile() && (!officeOnly || office.has(path.extname(entry.name).toLowerCase()))) return [{ kind: "file", name: entry.name, path: item.path }];
      } catch { /* inaccessible or symlink outside the sandbox */ }
      return [];
    }).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "folder" ? -1 : 1));
    return { current, parent, entries };
  }
  return { root, resolve, browse, mime };
}

function xmlDecode(value) {
  return String(value || "").replace(/&#x([0-9a-f]+);/gi, (_, raw) => String.fromCodePoint(Number.parseInt(raw, 16)))
    .replace(/&#([0-9]+);/g, (_, raw) => String.fromCodePoint(Number.parseInt(raw, 10)))
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}
function unzipXmlEntries(buffer) {
  const files = {};
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 66_000); i--) if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("Invalid XLSX archive");
  const count = buffer.readUInt16LE(eocd + 10);
  if (count > 100) throw new Error("XLSX has too many entries");
  let offset = buffer.readUInt32LE(eocd + 16);
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid XLSX directory");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const outputSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28), extraLength = buffer.readUInt16LE(offset + 30), commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if (compressedSize > 20_000_000 || outputSize > 20_000_000 || total + outputSize > 30_000_000) throw new Error("XLSX too large");
    if (name.startsWith("xl/") && name.endsWith(".xml")) {
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid XLSX entry");
      const dataStart = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
      if (dataStart + compressedSize > buffer.length) throw new Error("Truncated XLSX entry");
      const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
      files[name] = method === 0 ? compressed : method === 8 ? zlib.inflateRawSync(compressed, { maxOutputLength: 20_000_000 }) : Buffer.alloc(0);
      total += files[name].length;
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}
function columnIndex(ref) {
  let n = 0;
  for (const ch of String(ref).replace(/[^A-Z]/g, "")) n = n * 26 + ch.charCodeAt(0) - 64;
  return Math.max(0, n - 1);
}
export function spreadsheetRows(buffer, filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext !== ".xlsx") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const lines = text.split(/\r?\n/).filter((line) => line.trim());
    const sample = lines.slice(0, 5).join("\n");
    const separator = (sample.match(/;/g) || []).length >= (sample.match(/,/g) || []).length ? ";" : ",";
    return lines.slice(0, 5000).map((line) => {
      const cells = []; let cell = "", quoted = false;
      for (let i = 0; i < line.length; i++) {
        if (line[i] === '"' && line[i + 1] === '"') { cell += '"'; i++; }
        else if (line[i] === '"') quoted = !quoted;
        else if (line[i] === separator && !quoted) { cells.push(cell.trim()); cell = ""; }
        else cell += line[i];
      }
      cells.push(cell.trim()); return cells;
    });
  }
  const entries = unzipXmlEntries(buffer);
  const sharedXml = entries["xl/sharedStrings.xml"]?.toString("utf8") || "";
  const shared = Array.from(sharedXml.matchAll(/<si[\s\S]*?<\/si>/g), (match) => Array.from(match[0].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (part) => xmlDecode(part[1])).join(""));
  const sheetName = Object.keys(entries).find((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetName) throw new Error("No worksheet in XLSX");
  const xml = entries[sheetName].toString("utf8");
  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cell of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = columnIndex(cell[1].match(/\br="([A-Z]+\d+)"/)?.[1] || "");
      const type = cell[1].match(/\bt="([^"]+)"/)?.[1] || "";
      const raw = type === "inlineStr" ? Array.from(cell[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (item) => xmlDecode(item[1])).join("") : xmlDecode(cell[2].match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1] || "");
      row[col] = type === "s" ? shared[Number(raw)] || "" : raw;
    }
    if (row.some((part) => String(part || "").trim())) rows.push(row.map((part) => String(part || "").trim()));
    if (rows.length >= 5000) break;
  }
  return rows;
}
export function bomItems(rows) {
  if (!rows.length) return [];
  const headers = rows[0].map((value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, ""));
  const col = (names, fallback) => { const i = headers.findIndex((head) => names.includes(head)); return i < 0 ? fallback : i; };
  const indexes = [col(["tetel", "pozicio", "item"], 0), col(["cikkszam", "rajzszam", "partnumber", "pn"], 1), col(["nev", "megnevezes", "name", "description"], 2), col(["anyag", "material"], 3), col(["mennyiseg", "db", "qty", "quantity"], 4), col(["egyseg", "unit"], 5), col(["megjegyzes", "note"], 6)];
  return rows.slice(1).filter((row) => row.some((value) => String(value || "").trim())).map((row) => Object.fromEntries(["item", "partNumber", "name", "material", "quantity", "unit", "note"].map((key, i) => [key, row[indexes[i]] || ""])));
}
export function documentMime(filename) { return mime[path.extname(filename).toLowerCase()] || "application/octet-stream"; }
