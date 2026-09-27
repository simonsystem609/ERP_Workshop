import * as THREE from 'three';

const tempA = new THREE.Vector3();
const tempB = new THREE.Vector3();
const tempC = new THREE.Vector3();

// GLB has triangles, not CAD face IDs. Merge edge-connected, coplanar triangles.
export function buildFacePatches(geometry) {
  const position = geometry.getAttribute('position');
  if (!position || position.itemSize !== 3) throw new Error('Mesh has no 3D positions.');
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const triangleCount = Math.floor(count / 3);
  if (triangleCount > 1_000_000) throw new Error('Mesh is too large for face picking.');
  geometry.computeBoundingBox();
  const diagonal = geometry.boundingBox.getSize(new THREE.Vector3()).length();
  const positionTolerance = Math.max(diagonal * 1e-7, 1e-9);
  const planeTolerance = Math.max(diagonal * 1e-5, 1e-8);
  const normals = new Array(triangleCount);
  const offsets = new Float64Array(triangleCount);
  const parents = new Int32Array(triangleCount);
  const ranks = new Uint8Array(triangleCount);
  const edges = new Map();
  const vertexIds = new Map();
  const vertexKey = (vertex) => [vertex.x, vertex.y, vertex.z].map(v => Math.round(v / positionTolerance)).join(',');
  const idFor = (vertex) => {
    const key = vertexKey(vertex);
    let id = vertexIds.get(key);
    if (id === undefined) { id = vertexIds.size; vertexIds.set(key, id); }
    return id;
  };
  const rootOf = (triangle) => {
    while (parents[triangle] !== triangle) {
      parents[triangle] = parents[parents[triangle]];
      triangle = parents[triangle];
    }
    return triangle;
  };
  const union = (a, b) => {
    let ra = rootOf(a), rb = rootOf(b);
    if (ra === rb) return;
    if (ranks[ra] < ranks[rb]) [ra, rb] = [rb, ra];
    parents[rb] = ra;
    if (ranks[ra] === ranks[rb]) ranks[ra]++;
  };
  const vertexAt = (ordinal, target) => target.fromBufferAttribute(position, index ? index.getX(ordinal) : ordinal);
  const coplanar = (a, b) => normals[a] && normals[b]
    && normals[a].dot(normals[b]) > 0.999
    && Math.abs(offsets[a] - offsets[b]) <= planeTolerance;

  for (let triangle = 0; triangle < triangleCount; triangle++) {
    parents[triangle] = triangle;
    const a = vertexAt(triangle * 3, tempA).clone();
    const b = vertexAt(triangle * 3 + 1, tempB).clone();
    const c = vertexAt(triangle * 3 + 2, tempC).clone();
    const normal = b.sub(a).cross(c.sub(a));
    if (normal.lengthSq() < 1e-24) continue;
    normal.normalize();
    normals[triangle] = normal;
    offsets[triangle] = normal.dot(a);
    const ids = [idFor(a), idFor(tempB), idFor(tempC)];
    for (let edge = 0; edge < 3; edge++) {
      const v0 = ids[edge], v1 = ids[(edge + 1) % 3];
      const key = v0 < v1 ? `${v0}:${v1}` : `${v1}:${v0}`;
      let neighbors = edges.get(key);
      if (!neighbors) { neighbors = []; edges.set(key, neighbors); }
      for (const neighbor of neighbors) if (coplanar(neighbor, triangle)) union(neighbor, triangle);
      neighbors.push(triangle);
    }
  }
  const patchByRoot = new Map();
  const triangleToPatch = new Int32Array(triangleCount).fill(-1);
  const patches = [];
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    if (!normals[triangle]) continue;
    const root = rootOf(triangle);
    let patchIndex = patchByRoot.get(root);
    if (patchIndex === undefined) {
      patchIndex = patches.length;
      patchByRoot.set(root, patchIndex);
      patches.push({ id: patchIndex, normal: normals[triangle].clone(), triangles: [] });
    }
    triangleToPatch[triangle] = patchIndex;
    patches[patchIndex].triangles.push(triangle);
  }
  return { triangleToPatch, patches };
}

export function geometryForPatch(geometry, patch) {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  const points = new Float32Array(patch.triangles.length * 9);
  let offset = 0;
  for (const triangle of patch.triangles) {
    for (let vertex = 0; vertex < 3; vertex++) {
      const source = index ? index.getX(triangle * 3 + vertex) : triangle * 3 + vertex;
      points[offset++] = position.getX(source);
      points[offset++] = position.getY(source);
      points[offset++] = position.getZ(source);
    }
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute('position', new THREE.BufferAttribute(points, 3));
  result.computeVertexNormals();
  return result;
}

export function measureFaces(first, second, metersPerUnit = 1) {
  if (!first || !second) return null;
  const vector = new THREE.Vector3().subVectors(second.pointModel, first.pointModel);
  const a = first.normalModel.clone().normalize();
  const b = second.normalModel.clone().normalize();
  const scale = metersPerUnit * 1000;
  return {
    normalMm: Math.abs(vector.dot(a)) * scale,
    signedNormalMm: vector.dot(a) * scale,
    xMm: vector.x * scale,
    yMm: vector.y * scale,
    zMm: vector.z * scale,
    directMm: vector.length() * scale,
    parallel: Math.abs(a.dot(b)) >= 0.999,
  };
}
