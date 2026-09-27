import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { sampleGlb } from '../scripts/generate-sample.mjs';
import { validateSelfContainedGlb } from '../src/glb-guard.mjs';
import { buildFacePatches, geometryForPatch, measureFaces } from '../src/face-patches.mjs';

test('synthetic self-contained GLB parses into one mesh', async () => {
  const bytes = sampleGlb();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  validateSelfContainedGlb(buffer);
  const gltf = await new GLTFLoader().parseAsync(buffer, '');
  const mesh = gltf.scene.children[0];
  assert.equal(mesh.isMesh, true);
  assert.equal(mesh.geometry.getAttribute('position').count, 24);
});

test('box triangles form six connected planar faces', () => {
  const geometry = new THREE.BoxGeometry(2, 1, 0.5);
  const result = buildFacePatches(geometry);
  assert.equal(result.patches.length, 6);
  assert.equal(result.patches.every(patch => patch.triangles.length === 2), true);
  const overlay = geometryForPatch(geometry, result.patches[0]);
  assert.equal(overlay.getAttribute('position').count, 6);
  overlay.dispose();
  geometry.dispose();
});

test('normal distance and stable model-axis components are distinct', () => {
  const first = { pointModel: new THREE.Vector3(0, 0, 0), normalModel: new THREE.Vector3(0, 0, 1) };
  const second = { pointModel: new THREE.Vector3(0.2, -0.1, 0.5), normalModel: new THREE.Vector3(0, 0, -1) };
  const measured = measureFaces(first, second, 1);
  assert.equal(measured.parallel, true);
  assert.equal(measured.normalMm, 500);
  assert.equal(measured.xMm, 200);
  assert.equal(measured.yMm, -100);
  assert.equal(measured.zMm, 500);
});

test('nonparallel faces are flagged as normal component, not plane separation', () => {
  const first = { pointModel: new THREE.Vector3(), normalModel: new THREE.Vector3(1, 0, 0) };
  const second = { pointModel: new THREE.Vector3(2, 0, 0), normalModel: new THREE.Vector3(0, 1, 0) };
  assert.equal(measureFaces(first, second).parallel, false);
});

test('rejects malformed GLB header and external resource URI', () => {
  const bytes = sampleGlb();
  const malformed = Buffer.from(bytes);
  malformed.writeUInt32LE(0, 0);
  assert.throws(() => validateSelfContainedGlb(malformed.buffer.slice(malformed.byteOffset, malformed.byteOffset + malformed.byteLength)), /not a glTF/);
  const text = '{"asset":{"version":"2.0"},"images":[{"uri":"https://example.com/a.png"}]}';
  const json = Buffer.alloc((Buffer.byteLength(text) + 3) & ~3, 0x20);
  json.write(text);
  const external = Buffer.alloc(20 + json.length);
  external.writeUInt32LE(0x46546c67, 0);
  external.writeUInt32LE(2, 4);
  external.writeUInt32LE(external.length, 8);
  external.writeUInt32LE(json.length, 12);
  external.writeUInt32LE(0x4e4f534a, 16);
  json.copy(external, 20);
  assert.throws(() => validateSelfContainedGlb(external.buffer.slice(external.byteOffset, external.byteOffset + external.byteLength)), /self-contained/);
});
