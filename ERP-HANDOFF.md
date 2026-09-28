# Workshop ERP deployment handoff

Workshop ERP is a free, open-source ERP backbone/template based on a working,
field-tested implementation. The public source has been sanitized and runs as
a synthetic localhost copy. This handoff describes how an adopter could turn
that source into a shared deployment; it is **not** a claim that the current
download can be exposed on a network by filling in paths and tokens.

## Intended architecture

The shared ERP is a **website** opened from workstations and phones, not a
separate desktop app on each PC. A Node.js server on one active host serves
the frontend and API. Browsers render the UI and GLB viewer locally. Users on
the same LAN could reach a secured host directly; remote users could reach it
through a Cloudflare Tunnel with an access policy. Neither path is enabled in
this public copy.

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

The design calls for one active host at a time. Standby machines may take
over only after a tested, exclusive handoff. The active host alone runs the
HTTP server and optional tunnel connector. Storage fencing, crash recovery,
startup control and backups are safety requirements, not just settings.
Changing a path or token without implementing and testing them could start
competing hosts or lose data.

## What the public repository currently runs

`npm.cmd start` runs `demo-server.mjs` only on `127.0.0.1`. It shows all
25 menu views with synthetic, profile-local persistent data. Optional local
password mode is still localhost-only. Its local project/document scans are
confined to the selected profile. It does not use shared storage, a watchdog,
a tunnel or the fuller backend.

The fuller Node backend source is preserved under `app/` for adaptation,
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
new `futureHosting` section records the intended site, storage,
network, Cloudflare token-file paths, one-host watchdog, Helper and backup
settings for a later deployment. It is parsed and checked, but
**never applied** by this server. Its `status` and every hosted-service
`enabled` field must remain disabled. Put no token value or password in the
file; `tokenSourceFile` and `tokenLocalFile` are path references only.
An installation's edited `config.json` is ignored by Git and excluded from
the downloadable source ZIP. More field detail is in
[`CUSTOMIZE.md`](CUSTOMIZE.md).

For a local trial, use a separate profile, generic logo and new local
database. Never use real records, a live database or a tunnel token as a test
fixture. Configuration values alone do not turn this source into a shared ERP.

## What an adopter must implement before shared use

1. **Adapt the backend and paths.** Refactor the guarded `app/server.js` and
   its storage, CAD, Helper, backup and process modules to consume validated
   configuration. Remove the startup guard only after those side effects are
   isolated and tested. The local `demo-server.mjs` is not a shortcut to a
   network host.
2. **Choose and test shared data storage.** Decide where records and files
   live, define migrations and consistency checks, and prove that a crash or
   disconnected share cannot corrupt or split the data. Implement an
   exclusive single-writer lease/fence before allowing a standby to take over.
3. **Complete hosted accounts and authorization.** Provide first-run admin
   creation with no default password, individual sign-in, role checks for all
   sensitive API routes, secure sessions, CSRF protection and abuse limits.
   The current optional password mode is only a single-process localhost
   trial. LAN users need this protection too. If using a tunnel, Cloudflare
   [Access can enforce an outer MFA gate](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/mfa-requirements/),
   but it does not replace ERP permissions or protect an unguarded LAN path.
4. **Implement non-destructive host controls.** The supplied launchers and
   `hosting/host-control.mjs` currently refuse install/start/watch/stop/
   restart/tunnel actions. Adapt them for a specific installation with exact
   process identity, monitored health, exclusive takeover and reversible
   startup registration. Test active-host failure and recovery with two
   disposable hosts before using persistent records.
5. **Prove backup and restore.** Make consistent snapshots, verify hashes,
   test a complete restore, and set retention deliberately. Do not rely on
   the localhost profile-backup script for shared-host recovery.
6. **Configure remote access only after the app passes these gates.** A
   remotely managed Cloudflare Tunnel can route a chosen hostname to the
   active host; keep connector credentials in a protected file, not Git or
   the template JSON. Apply a Cloudflare Access policy for intended users.
   A LAN-only installation can omit the tunnel but still needs secure app
   login, transport protection and host/firewall controls.
7. **Finish installation-specific features.** The financial area is
   unfinished. Helper integration, push, a bundled/tested OCR engine and
   network project scans are not complete in this public copy. Implement only
   the features required by a particular installation, then test their
   permissions and data handling.

The public skeleton is useful source for this work, but no hosted deployment,
failover, live-data migration or security acceptance has been performed on
this sanitized copy. See the official [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
and [Cloudflare Access web-app guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/)
when designing remote access.
