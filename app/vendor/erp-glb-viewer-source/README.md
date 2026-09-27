# ERP GLB viewer source

This is the editable source for the bundled, in-browser GLB viewer. It was
adapted from an earlier viewer by the same author. It reads GLB bytes in the
browser; the ERP host only serves files. Model visibility, transparency,
selection and measurements do not modify source files.

The viewer is licensed under AGPL-3.0-or-later; see `LICENSE.txt`. The browser
bundle contains three.js r160 (MIT); its full notice is in
`THIRD-PARTY-LICENSES.txt`. `esbuild` is a development-time build tool and is
not shipped in the browser bundle.

From this directory, with Node.js 22 or newer:

```text
npm ci
npm run build
npm test
```

`npm run build` writes `dist/` with the runtime assets, the license files,
and a synthetic sample GLB. It requires no ERP server. `npm run test:browser`
additionally needs the local browser-test prerequisites from `package.json`.
To make a source ZIP, use `npm run package:source -- --out <new absolute local
path>.zip`. The command refuses an existing output and includes only 17
allowlisted source files, never `node_modules`, `dist`, or model fixtures.
The environment variable `ERP_GLB_TEST_MODEL` may point to an optional
locally held larger fixture; no private fixture is included in this source.

For the ERP demo, the checked-in runtime copy is under
`app/public/erp-glb-viewer/`. The editable source and a downloadable source
ZIP must stay with any public or hosted derivative of the viewer. Before a
release, rebuild and compare the runtime bundle with this source, and review
the exact release files and third-party notices.
