// Allowlisted viewer source ZIP. Never include installed packages, dist, or CAD fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sourceRoot = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--out' || !path.isAbsolute(args[1])) {
  throw new Error('Usage: node scripts/package-source.mjs --out <new absolute local ZIP path>');
}
const output = path.resolve(args[1]);
const outputParent = fs.realpathSync(path.dirname(output));
if (/^(?:\\\\|\/\/|y:)/i.test(outputParent) || outputParent.toLowerCase() !== path.dirname(output).toLowerCase()) {
  throw new Error('Source ZIP output must be in a real local non-Y directory');
}
if (fs.existsSync(output)) throw new Error('Refusing to overwrite an existing source ZIP');

const names = [
  'LICENSE.txt', 'THIRD-PARTY-LICENSES.txt', 'README.md', 'index.html',
  'package.json', 'package-lock.json', 'server.mjs', 'viewer.css',
  'scripts/build.mjs', 'scripts/generate-sample.mjs', 'scripts/package-source.mjs',
  'src/face-patches.mjs', 'src/glb-guard.mjs', 'src/main.mjs', 'src/viewer.mjs',
  'tests/browser-smoke.mjs', 'tests/geometry.test.mjs'
];
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, bytes] of files) {
    const nameBytes = Buffer.from(name, 'utf8');
    if (bytes.length > 0xffffffff || offset > 0xffffffff) throw new Error('Viewer source ZIP is too large');
    const checksum = crc32(bytes);
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt32LE(checksum, 14);
    localHeader.writeUInt32LE(bytes.length, 18);
    localHeader.writeUInt32LE(bytes.length, 22);
    localHeader.writeUInt16LE(nameBytes.length, 26);
    local.push(localHeader, nameBytes, bytes);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt32LE(checksum, 16);
    centralHeader.writeUInt32LE(bytes.length, 20);
    centralHeader.writeUInt32LE(bytes.length, 24);
    centralHeader.writeUInt16LE(nameBytes.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    central.push(centralHeader, nameBytes);
    offset += localHeader.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

const files = names.map((name) => {
  const file = path.join(sourceRoot, ...name.split('/'));
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 5_000_000) {
    throw new Error(`Unsafe or oversize source file: ${name}`);
  }
  return [`erp-glb-viewer-source/${name}`, fs.readFileSync(file)];
});
fs.writeFileSync(output, zip(files), { flag: 'wx' });
console.log(`Created ${output} with ${files.length} allowlisted source files.`);
