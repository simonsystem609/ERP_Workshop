# ERP purpose and deployment handoff

## What the source system does

The source ERP is a company-wide **website** for a small engineering and
manufacturing organization. Staff open the same browser/PWA application from
workstations and phones; it is not a separate desktop app on each PC. A Node.js
server on one active Windows host serves the frontend and API, and persists
shared records in SQLite. A Cloudflare tunnel can expose that one host to
authorized users outside the office. The tunnel transports requests; it does
not render pages or 3D models on the host. Browsers render the UI and GLB
viewer locally.

The common unit of work is a project. A configured set of project directories
is scanned and reconciled with ERP project IDs. Staff use those projects to
coordinate tasks, CNC work, tool/material/fastener requests, BOMs, worklogs,
production planning, documents, and 3D model exports. The same website also
has an engineering/finance area for suppliers, prices, costs, outsourcing,
quotes and notes. Settings manages people, permissions, catalogs and host
status; archive and warning views preserve history and flag project-folder
changes. The PWA shell is a convenient installed entry point, not an offline
copy of the database.

Typical flow:

1. Engineering creates or discovers a project and assigns work.
2. Staff enter tasks and requests, attach/link drawings or Office/PDF files,
   and log manual or CNC time against that project.
3. Purchasing/engineering tracks BOMs, suppliers and project costs.
4. A separate CAD export can drop a GLB plus metadata into the model inbox.
   The ERP indexes it and streams the model to the in-browser viewer.
5. Everyone sees saved changes through the server's API/SSE. Project renames,
   missing folders and manual activation changes produce visible notices.

The production design uses one active host at a time. Other enrolled PCs run
standby watchdogs; a standby can take over after the active host fails. The
active host alone runs the HTTP server and tunnel connector. This file-based
coordination, network-share SQLite access, storage fencing, startup installers
and backup pruning are operational safety mechanisms, not optional decoration.
Changing a path or token without adapting and testing those mechanisms can
lose data or start competing hosts.

## What this repository currently runs

`npm.cmd start` runs `demo-server.mjs` only on `127.0.0.1`. It shows all
25 menu views with synthetic, profile-local persistent data. Optional local
password mode is still localhost-only. Its local project/document scans are
confined to the selected profile. It does not use a real network share,
watchdog, tunnel, production Helper or production database.

The original Node backend source is preserved under `app/` for adaptation,
but `app/server.js` intentionally throws before any startup work. The real
host launchers, Cloudflare executable and token are not in this repository.
Generic wrappers with the expected `.bat`/`.cmd` names now live at the root;
they perform static plan checks and refuse operational actions. They are not
substitutes for a working installer, standby watchdog or connector manager.
The full source is provided under AGPL-3.0-or-later; the bundled GLB viewer
has matching source and third-party notices. See
[`app/ORIGINAL-BACKEND.md`](app/ORIGINAL-BACKEND.md).

## Configuration boundary

`config.example.json` is the public, synthetic single-file starter. Its
ordinary fields configure the **running localhost demo**: name, people,
projects, catalogs, sample data, port, optional local OCR and security. The
new `futureHosting` section records the intended organization, storage,
network, Cloudflare token-file paths, one-host watchdog, Helper and backup
settings for a later company deployment. It is parsed and checked, but
**never applied** by this server. Its `status` and every hosted-service
`enabled` field must remain disabled. Put no token value or password in the
file; `tokenSourceFile` and `tokenLocalFile` are path references only.
An installation's edited `config.json` is ignored by Git and excluded from
the downloadable source ZIP. More field detail is in
[`CUSTOMIZE.md`](CUSTOMIZE.md).

For a different organization, use a separate local profile, generic logo and
new local database for the demo. To build a real hosted deployment later,
engineers must first replace the original backend's fixed share/drive/project/
Helper/backup/process paths with validated config access, complete and review
the fail-closed generic launchers, implement first-run hosted accounts and secure
sessions, prove single-writer takeover and restore behavior on a test share,
then review tunnel, source offer and permissions. Do not use the live source
system's database or token as a test fixture. Configuration values alone do
not turn this localhost demo into a company-wide hosted ERP.
