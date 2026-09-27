const MAX_GLB_BYTES = 256 * 1024 * 1024;

export function validateSelfContainedGlb(buffer) {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('Expected a GLB ArrayBuffer.');
  if (buffer.byteLength < 20 || buffer.byteLength > MAX_GLB_BYTES) {
    throw new Error('GLB must be between 20 bytes and 256 MiB.');
  }
  const view = new DataView(buffer);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('This is not a glTF 2.0 binary (.glb) file.');
  }
  if (view.getUint32(8, true) !== buffer.byteLength) throw new Error('GLB length is invalid.');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength < 2 || 20 + jsonLength > buffer.byteLength) {
    throw new Error('GLB JSON chunk is invalid.');
  }
  let json;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(buffer, 20, jsonLength)));
  } catch {
    throw new Error('GLB JSON could not be read.');
  }
  if (json.asset?.version !== '2.0') throw new Error('Only glTF 2.0 is supported.');
  const walk = (value) => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri' && typeof child === 'string' && !child.startsWith('data:')) {
        throw new Error('This GLB refers to an external resource. Please export a self-contained GLB.');
      }
      walk(child);
    }
  };
  walk(json);
  return json;
}

export { MAX_GLB_BYTES };
