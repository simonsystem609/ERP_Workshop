import { build } from 'esbuild';
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { writeSample } from './generate-sample.mjs';

const base = resolve(fileURLToPath(new URL('../', import.meta.url)));
const outdir = resolve(base, 'dist');
await mkdir(outdir, { recursive: true });
await build({
  entryPoints: {
    main: resolve(base, 'src/main.mjs'),
    'erp-glb-viewer': resolve(base, 'src/viewer.mjs'),
  },
  outdir,
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  legalComments: 'eof',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
});
await copyFile(resolve(base, 'index.html'), resolve(outdir, 'index.html'));
await copyFile(resolve(base, 'viewer.css'), resolve(outdir, 'viewer.css'));
await copyFile(resolve(base, 'LICENSE.txt'), resolve(outdir, 'LICENSE.txt'));
await copyFile(resolve(base, 'THIRD-PARTY-LICENSES.txt'), resolve(outdir, 'THIRD-PARTY-LICENSES.txt'));
await copyFile(resolve(base, 'README.md'), resolve(outdir, 'README.md'));
await writeSample(resolve(outdir, 'sample.glb'));
process.stdout.write(`Built ${outdir}\n`);
