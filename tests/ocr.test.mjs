import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { createDemoOcr, validateOcrConfig } from "../demo-ocr.mjs";

const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/Xj8AAAAASUVORK5CYII=", "base64");

test("OCR stays disabled by default and refuses unsafe executables", () => {
  assert.equal(createDemoOcr(undefined).enabled, false);
  assert.throws(() => validateOcrConfig({ mode: "tesseract", executable: "Y:\\ocr.exe" }), /local non-Y/);
  assert.throws(() => validateOcrConfig({ mode: "tesseract", executable: "\\\\server\\share\\ocr.exe" }), /local non-Y/);
  assert.throws(() => validateOcrConfig({ mode: "tesseract", executable: process.execPath, language: "../../bad" }), /language/);
});

test("optional OCR uses a bounded local subprocess with no image file write", async () => {
  const area = fs.mkdtempSync(path.join(os.tmpdir(), "erp-local-ocr-test-"));
  const fake = path.join(area, "fake-ocr.mjs");
  fs.writeFileSync(fake, 'process.stdin.resume();process.stdin.on("end",()=>process.stdout.write("DEMO-042 Conveyor Prototype"));\n', { flag: "wx" });
  const ocr = createDemoOcr({ mode: "tesseract", executable: process.execPath, language: "eng" }, { prefixArgs: [fake] });
  const result = await ocr.recognize([pixel], "project-path");
  assert.equal(result.text, "DEMO-042 Conveyor Prototype");
  assert.equal(result.engine, "tesseract-cli");
  assert.ok(result.debugId);
  assert.deepEqual(fs.readdirSync(area), ["fake-ocr.mjs"]);
  await assert.rejects(ocr.recognize([Buffer.from("not a PNG")], "drawing-number"), /PNG/);
  const oversized = Buffer.from(pixel);
  oversized.writeUInt32BE(100_000, 16);
  await assert.rejects(ocr.recognize([oversized], "drawing-number"), /dimensions/);
});
