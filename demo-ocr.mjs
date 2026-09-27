// Optional local Tesseract CLI bridge. Disabled until explicitly configured.
// Images go through stdin; this module never stores OCR source photos.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const pngSignature = Buffer.from("89504e470d0a1a0a", "hex");
export function validateOcrConfig(value) {
  if (value === undefined) return { mode: "disabled" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ocr must be an object");
  const keys = Object.keys(value);
  if (value.mode === "disabled" && keys.length === 1) return { mode: "disabled" };
  if (value.mode !== "tesseract" || keys.some((key) => !["mode", "executable", "language"].includes(key))) {
    throw new Error("ocr supports only disabled or a configured local Tesseract executable");
  }
  const executable = value.executable;
  if (typeof executable !== "string" || !path.isAbsolute(executable) || /^(?:\\\\|\/\/|y:)/i.test(executable)) {
    throw new Error("ocr.executable must be an absolute local non-Y file path");
  }
  const resolved = path.resolve(executable);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(resolved).toLowerCase() !== resolved.toLowerCase()) {
    throw new Error("ocr.executable must be a regular local executable without redirection");
  }
  const language = value.language || "hun+eng";
  if (typeof language !== "string" || !/^[a-z]{3}(?:\+[a-z]{3}){0,2}$/.test(language)) {
    throw new Error("ocr.language must name one to three Tesseract language codes");
  }
  return { mode: "tesseract", executable: resolved, language };
}

function ocrOnce(executable, prefixArgs, bytes, language, kind) {
  return new Promise((resolve, reject) => {
    const args = [...prefixArgs, "stdin", "stdout", "-l", language, "--psm", kind === "drawing-number" ? "7" : "6"];
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let output = "", errorText = "", settled = false;
    const finish = (error, text = "") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(text);
    };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Local OCR timed out after 12 seconds")); }, 12_000);
    child.on("error", (error) => finish(new Error(`Local OCR failed to start: ${error.message}`)));
    child.stdout.on("data", (chunk) => {
      output += chunk.toString("utf8");
      if (output.length > 100_000) { child.kill(); finish(new Error("Local OCR output was too large")); }
    });
    child.stderr.on("data", (chunk) => { errorText = (errorText + chunk.toString("utf8")).slice(-2000); });
    child.on("close", (code) => finish(code === 0 ? null : new Error(`Local OCR exited ${code}: ${errorText.trim().slice(0, 160)}`), output));
    child.stdin.on("error", () => {}); // an early engine exit is handled by close
    child.stdin.end(bytes);
  });
}

export function createDemoOcr(config, { prefixArgs = [] } = {}) {
  const settings = validateOcrConfig(config);
  let busy = false;
  async function recognize(values, kind) {
    if (settings.mode !== "tesseract") throw new Error("Local OCR is disabled; install Tesseract and configure the local profile first");
    if (!Array.isArray(values) || !values.length || values.length > 10 || !["drawing-number", "project-path"].includes(kind)) {
      throw new Error("Choose one to ten OCR image variants and a supported recognition mode");
    }
    let total = 0;
    for (const bytes of values) {
      if (!Buffer.isBuffer(bytes) || bytes.length < 33 || bytes.length > 8_000_000
          || !bytes.subarray(0, 8).equals(pngSignature) || bytes.toString("ascii", 12, 16) !== "IHDR") {
        throw new Error("OCR accepts only bounded PNG images");
      }
      const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
      if (!width || !height || width > 4096 || height > 4096 || width * height > 16_000_000) {
        throw new Error("OCR PNG dimensions exceed the safe limit");
      }
      total += bytes.length;
    }
    if (total > 20_000_000) throw new Error("OCR images exceed the 20 MB request limit");
    if (busy) throw new Error("Another local OCR request is already running");
    busy = true;
    try {
      let best = "";
      for (const bytes of values.slice(0, 4)) {
        const raw = await ocrOnce(settings.executable, prefixArgs, bytes, settings.language, kind);
        const text = raw.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        if (text.replace(/[^a-z0-9]/gi, "").length > best.replace(/[^a-z0-9]/gi, "").length) best = text;
        if (best.length >= 30) break;
      }
      return { text: best, confidence: null, engine: "tesseract-cli", debugId: randomUUID() };
    } finally { busy = false; }
  }
  return { enabled: settings.mode === "tesseract", recognize };
}
