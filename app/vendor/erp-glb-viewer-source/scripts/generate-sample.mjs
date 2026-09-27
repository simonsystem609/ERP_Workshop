import { BoxGeometry } from 'three';
import { writeFile } from 'node:fs/promises';

function pad4(length) { return (length + 3) & ~3; }

export function sampleGlb() {
  const geometry = new BoxGeometry(2, 1, 0.5);
  const positions = new Float32Array(geometry.getAttribute('position').array);
  const normals = new Float32Array(geometry.getAttribute('normal').array);
  const indices = new Uint16Array(geometry.getIndex().array);
  geometry.dispose();
  const positionBytes = Buffer.from(positions.buffer);
  const normalBytes = Buffer.from(normals.buffer);
  const indexBytes = Buffer.from(indices.buffer);
  const binLength = pad4(positionBytes.length + normalBytes.length + indexBytes.length);
  const binary = Buffer.alloc(binLength);
  positionBytes.copy(binary, 0);
  normalBytes.copy(binary, positionBytes.length);
  indexBytes.copy(binary, positionBytes.length + normalBytes.length);
  const json = {
    asset: { version: '2.0', generator: 'ERP GLB viewer synthetic sample' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: 'Sample box' }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ name: 'Sample metal', pbrMetallicRoughness: { baseColorFactor: [0.73, 0.77, 0.81, 1], metallicFactor: 0.15, roughnessFactor: 0.7 } }],
    buffers: [{ byteLength: binLength }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length, target: 34962 },
      { buffer: 0, byteOffset: positionBytes.length + normalBytes.length, byteLength: indexBytes.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min: [-1, -0.5, -0.25], max: [1, 0.5, 0.25] },
      { bufferView: 1, componentType: 5126, count: normals.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indices.length, type: 'SCALAR' },
    ],
  };
  const jsonText = JSON.stringify(json);
  const jsonBytes = Buffer.from(jsonText, 'utf8');
  const jsonPadded = Buffer.alloc(pad4(jsonBytes.length), 0x20);
  jsonBytes.copy(jsonPadded);
  const glb = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binary.length);
  glb.writeUInt32LE(0x46546c67, 0);
  glb.writeUInt32LE(2, 4);
  glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(jsonPadded.length, 12);
  glb.writeUInt32LE(0x4e4f534a, 16);
  jsonPadded.copy(glb, 20);
  const binStart = 20 + jsonPadded.length;
  glb.writeUInt32LE(binary.length, binStart);
  glb.writeUInt32LE(0x004e4942, binStart + 4);
  binary.copy(glb, binStart + 8);
  return glb;
}

export async function writeSample(path) { await writeFile(path, sampleGlb()); }
