// One-off fixture generator. Refuses to overwrite an existing model or sidecar.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const inbox = path.join(root, "imports", "cadmodels");
const stem = "demo-synthetic-box";
const glbPath = path.join(inbox, `${stem}.glb`);
const jsonPath = path.join(inbox, `${stem}.json`);
if (fs.existsSync(glbPath) || fs.existsSync(jsonPath)) throw new Error("Synthetic model already exists; no files were overwritten");

const vertices = [];
const normals = [];
function face(a, b, c, d, n) {
  for (const point of [a, b, c, a, c, d]) { vertices.push(...point); normals.push(...n); }
}
face([-1,-.5,.25],[1,-.5,.25],[1,.5,.25],[-1,.5,.25],[0,0,1]);
face([1,-.5,-.25],[-1,-.5,-.25],[-1,.5,-.25],[1,.5,-.25],[0,0,-1]);
face([-1,.5,.25],[1,.5,.25],[1,.5,-.25],[-1,.5,-.25],[0,1,0]);
face([-1,-.5,-.25],[1,-.5,-.25],[1,-.5,.25],[-1,-.5,.25],[0,-1,0]);
face([1,-.5,.25],[1,-.5,-.25],[1,.5,-.25],[1,.5,.25],[1,0,0]);
face([-1,-.5,-.25],[-1,-.5,.25],[-1,.5,.25],[-1,.5,-.25],[-1,0,0]);
const positionBytes = Buffer.from(new Float32Array(vertices).buffer);
const normalBytes = Buffer.from(new Float32Array(normals).buffer);
const binary = Buffer.concat([positionBytes, normalBytes]);
const document = {
  asset: { version: "2.0", generator: "Workshop ERP synthetic fixture" },
  scene: 0, scenes: [{ nodes: [0] }], nodes: [{ name: "Synthetic box", mesh: 0 }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 } }] }],
  buffers: [{ byteLength: binary.length }],
  bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
    { buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length, target: 34962 }],
  accessors: [{ bufferView: 0, componentType: 5126, count: vertices.length / 3, type: "VEC3", min: [-1,-.5,-.25], max: [1,.5,.25] },
    { bufferView: 1, componentType: 5126, count: normals.length / 3, type: "VEC3" }]
};
const json = Buffer.from(JSON.stringify(document));
const jsonPadded = Buffer.alloc((json.length + 3) & ~3, 0x20);
json.copy(jsonPadded);
const glb = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binary.length);
glb.write("glTF", 0, "ascii"); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
glb.writeUInt32LE(jsonPadded.length, 12); glb.write("JSON", 16, "ascii"); jsonPadded.copy(glb, 20);
const offset = 20 + jsonPadded.length;
glb.writeUInt32LE(binary.length, offset); glb.write("BIN\0", offset + 4, "ascii"); binary.copy(glb, offset + 8);
const sidecar = {
  format: "workshop-cadmodel", formatVersion: 1, glbFile: `${stem}.glb`,
  source: { type: "assembly", name: "Synthetic_Box.SLDASM", root: "C:\\Examples\\Demo Project" },
  projectName: "Demo Project", exportedAt: "2026-09-25T12:00:00.000Z", bytes: glb.length
};
fs.mkdirSync(inbox, { recursive: true });
fs.writeFileSync(glbPath, glb, { flag: "wx" });
fs.writeFileSync(jsonPath, `${JSON.stringify(sidecar, null, 2)}\n`, { flag: "wx" });
console.log(`Created synthetic GLB/JSON pair (${glb.length} bytes) in ${inbox}`);
