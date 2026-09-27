# Customize the local persistent demo

## One config file

On a new installation run `npm.cmd run setup`, then edit the resulting
Git-ignored `config.json` (UTF-8 JSON) for:

| Key | Purpose |
| --- | --- |
| `mode` | Must remain `localhost-demo`; prevents accidental backend mode changes. |
| `port` | Local-only HTTP port; 4780–4782 are reserved and rejected. |
| `scanRoots` | Optional local project-folder roots under `documents/scanned-projects`; empty by default. |
| `ocr` | Optional `{ "mode": "disabled" }` or a local Tesseract executable and language; disabled in the public template. |
| `appName` | Browser title and app display name. |
| `cadModelFormat` | Ready-pair CAD JSON `format` identifier; defaults to `workshop-cadmodel`. Match a different exporter here without editing code. |
| `companyNames` | Choices shown where the ERP asks for a company. |
| `users` | Initial `{id,name,clearanceLevel}` records; never put passwords here. |
| `activeUserId` | Default display user; in opt-in secure mode, the first level-2 admin. |
| `security` | Optional `{ "mode": "local-password" }` for localhost-only first-run login. Omit for the no-login sample mode. |
| `overtimeUserIds` | Which synthetic users may mark their own overtime. |
| `overtimeViewerIds` | Which synthetic users may see those users' overtime. |
| `projects` | Display-only `{id,name,company,active,priority}` records. |
| `catalogs` | Initial material, length, fastener, tool and work-type suggestions. |
| `financeSettings` | Initial finance dropdown choices. |
| `sampleData` | Initial synthetic rows for main and finance collections. |
| `futureHosting` | Validated but inactive deployment plan. The generic host-plan inspector reads it; neither running demo nor original guarded backend applies it. |

The validator rejects unknown top-level keys, credential-like seed fields,
URLs and drive/UNC paths in display labels and sample data, duplicate IDs,
unknown sample references, and production ports for the running localhost
demo. The separate `futureHosting` plan permits path and URL *references*
but remains inactive and rejects unknown fields, inline token fields, and
attempts to enable hosted services. This is not a general privacy guarantee:
never put real people, projects, paths, or credentials into a config intended
for GitHub.
The public `config.example.json` is a synthetic starter only. `setup` never
overwrites `config.json`. A future private installation should edit only its
own profile file, not the publishable template.

### Future company-hosting plan (not executable)

`futureHosting.status` must stay `reference-only`. Every nested service's
`enabled` value is deliberately `false`, and `watchdog.singleActiveHost`
must remain `true`. The demo validates these constraints before startup,
then ignores the entire section; `/api/state`, the UI, and the source ZIP do
not expose the edited private profile. The guarded `app/server.js` does not
consume this schema either. Editing these values does **not** start a tunnel,
change a listener, install a watchdog, or select a shared database.

| Group | Values to record for a later deployment |
| --- | --- |
| `organization` | Intended locale, time zone and currency. The present UI still has code-level wording and formatting decisions. |
| `storage` | Canonical UNC share, mapped drive, ERP/app/data/SQLite paths, project roots and exclusions, worklog and GLB inboxes, GLB cache, modelling photos, trash, logs and uploads. Leave unknown values blank; do not guess or point the localhost demo at a live share. |
| `server` | Proposed LAN/internet/HTTPS listener addresses and ports, public host, folder scan interval and allowed IP prefixes. The active demo still binds only `127.0.0.1` on top-level `port`. |
| `cloudflare` | Future remote-managed tunnel hostname, localhost origin URL, executable path and `tokenSourceFile`/`tokenLocalFile` path references. Store the actual token only in an ACL-protected file, never in JSON, Git or a screenshot. |
| `watchdog` | One-active-host policy, lock/switch/heartbeat paths, installer/launcher paths and optional host nicknames. Generic fail-closed launcher wrappers are included, but do not enroll or start a PC. |
| `helper` | Proposed local Helper URL, source script and install root. The demo currently blocks Helper calls. |
| `backups` | Proposed automatic/manual roots, retention counts and trash-only policy. The demo's separate `backup:profile` command never prunes; these values do not control it. |

For a future tunnel, Cloudflare's [token-file
documentation](https://developers.cloudflare.com/tunnel/reference/run-parameters/)
describes `cloudflared tunnel run --token-file <PATH>`; the token is a
credential capable of running that tunnel, so protect and rotate it as
described in [Cloudflare's token
guidance](https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/).
The public template intentionally leaves token paths and public hostname
blank. A private profile may record *where* a token file would be found,
without copying or validating its contents.

This plan is a checklist, not a completed deployment adapter. The
[`hosting/`](hosting/README.md) inspector checks path relationships without
opening the share or token, and generic batch/cmd wrappers refuse operational
actions. Before a
different company can run the original host stack, the guarded backend and
its storage-safety/CAD/Helper modules must be refactored to consume the
validated paths; the wrappers must be implemented as reviewed, non-destructive
startup/watchdog/Cloudflare launchers; first-run hosted authentication, CSRF/authorization,
single-writer failover, backup/restore and security behavior must be tested
on a disposable share. Only then should a reviewed activation mechanism
replace `reference-only`. Never remove the guard or put this localhost
server behind a tunnel just because all fields are filled.

Save `images/logo.svg` next to `config.json` under the **exact** path
`images/logo.svg`. The demo uses this one logo in the sidebar, browser icon,
and PWA manifest.
The SVG must be self-contained (no scripts, event handlers, external
references or CSS `url(...)`). There are no other company-specific static
images in the demo; the old PWA raster icons are not included or served.
Images attached to ERP entries are production content, not demo branding.

To keep private branding separate, place a second `config.json` and
`images/logo.svg` in a different local directory and start with
`node demo-server.mjs --config C:\path\to\profile\config.json`. The config
and image are read from that same directory; the demo code stays generic.
Do not use a mapped production drive or UNC path for demo config.

Each profile stores its own persistent records at `.demo-data/erp-demo.db`
beside that profile's `config.json`. Config is a **first-run seed**, not a
live override of edited records. Before intentionally reseeding, stop the
server and move the existing DB to a uniquely named local backup; do not
delete or overwrite it. The generic demo's previous DB was preserved under
`<private-backup-root>\20260926-172000-demo-db-before-expanded-seed`.
In optional `security.mode=local-password`, the same SQLite file also stores
salted/scrypt-hashed credentials. The first browser visit requires a unique
14–128-character admin password; a level-2 admin can set another user's
password under Settings, while users change their own from the personal
password panel. Passwords never belong in config. Keep the security setting
enabled once credentials exist; removing it refuses startup rather than
silently downgrading to display-only access. Sessions are local process memory,
so restart requires login again. This mode still binds only to `127.0.0.1`.
Each profile also has its own `documents/` folder for the server browser and
linked files. The generic profile includes only a synthetic BOM CSV. BOM
uploads go to that profile's `.demo-data/uploads` folder; neither route
browses or copies from a production share. See [`documents/README.md`](documents/README.md).
For project-browser files, create `documents/projects/<SHA-256 project ID>`
under that same profile and place publishable drawings, CAD files or PDFs
there. The in-app project browser shows the exact relative folder to use.
The public tree includes one tiny synthetic DXF for `demo-project-a` under
that convention. A separate profile must copy that sample into its own
`documents/` folder to show it. This is a local folder convention, not
automatic production folder scanning;
it never adds or reactivates ERP projects.

For opt-in local project discovery, create
`documents/scanned-projects` beside the selected profile's config, then set
`"scanRoots": ["documents/scanned-projects"]`. A root may instead name one
simple subfolder such as `documents/scanned-projects/2026`; each root's
immediate child directories become projects. Only local, profile-contained,
non-redirected folders are accepted. The server scans on startup, once per
minute, and when `Refresh folders` is pressed. An incomplete/unreadable root
changes no projects. Exact paths win; a unique slight rename within the same
parent retains the project ID and linked records, while different project
numbers remain separate. If a folder disappears for three complete scans,
the project and entries remain active and a warning appears. No scan archives
or deletes a project. The project browser reads files directly from a scanned
project's local folder with the same containment checks as other documents.
This is deliberately not a Y:/UNC production scan or multi-host coordination.

For optional camera OCR, install the Tesseract command-line engine and the
needed language data separately on this PC. Then set, for example,
`"ocr": { "mode": "tesseract", "executable": "C:\\Program Files\\Tesseract-OCR\\tesseract.exe", "language": "hun+eng" }`
in the selected local `config.json` and restart. The executable must be an
existing regular local file, never a Y:/UNC target; the configured language
must exist in that Tesseract installation. The ERP sends up to four bounded
PNG crop variants through subprocess stdin with a 12-second limit each, never
to an external OCR service. Correction text (not source photos) is retained
privately in the profile database, capped at 5,000 rows, and omitted from
`/api/state`. No OCR engine or traineddata is included in this public copy;
mock-engine tests pass, but recognition quality with a real installation has
not been verified here. With OCR disabled, the worklog explains how to enable
it instead of opening a nonworking camera flow.

The layout, color palette, fields, workflows and advanced features still live
in `app/public/app.js`, `app/public/styles.css`, and `app/public/index.html`.
The localhost demo translates interface labels through
`app/public/english-ui.js` while leaving stored values and API keys unchanged;
its missing finance dropdown defaults are English in demo mode only. This is
not a configurable translation service. Customize visuals and wording in
code, keep a backup, and rerun browser tests. Existing user-authored record
text may still be in its original language. The demo adapter is
`demo-server.mjs`; it never imports the production backend.

## Backup and source package

Stop the local server and use `npm.cmd run backup:profile -- --config
C:\absolute\profile\config.json --out C:\absolute\existing-backup-parent\new-snapshot`.
The destination must not exist or be inside the profile. The script preflights
redirected paths, copies config/logo, profile `documents` and `imports`, plus
local images/uploads/modelling/trash, and creates a consistent SQLite snapshot
with `VACUUM INTO`. Every copied file and the database are hashed; the
`backup-manifest.json` is written last, so its absence marks an incomplete
backup. It never deletes or prunes a source or prior snapshot. Keep backups
private: they may contain user records, passwords in the SQLite database,
uploaded files, and local document content. This is a single-PC backup; it
does not solve shared multi-host coordination or provide an overwrite-based
restore tool.

The app's `/SOURCE.zip` link exposes only an explicit public-source
allowlist captured at server start. The archive includes `SOURCE-FILES.json`
with SHA-256 hashes, but no runtime `config.json`, database, private profile,
or worklog inbox. It now includes the guarded original backend source, whose
startup throw remains in place, plus the generic fail-closed launcher wrappers,
but **not** the ignored live host-launcher references. `npm.cmd run package:source -- --out <new absolute local ZIP>`
creates a separate non-overwriting bundle for review. When a source file is
added, update the allowlist and check it against the exact Git candidate set;
review the archive before any public or hosted distribution. This packaging
is not a privacy or license clearance.

## Original-backend schema fixture (not a runnable server)

To create a new SQLite file in the original backend's JSON collection schema,
run `npm.cmd run original:fixture -- --out C:\absolute\new-original-fixture.db`.
The destination parent must already exist and the file must not. This reads
**only** the publishable `config.example.json`, not the editable profile config
or any production database. It seeds synthetic users/projects and sample
records, one in-app notification per user and one project notice. Push
subscriptions, VAPID keys and tunnel tokens stay empty. Account hashes come
from discarded random secrets: there is no known default password or usable
login. The one created for this working tree is the Git-ignored
`<demo-root>\.demo-data\original-erp-synthetic.db`; it is separate from the
running demo's `erp-demo.db`.

The copied `app/server.js` refuses startup before doing anything. A safe
first-run admin setup, removal of fixed Y:/UNC paths, local-only listener,
host/backup/Helper isolation and regression tests are still necessary before
this fixture can power the UI. Do not point the original backend at the
existing demo DB: the schemas differ. See [`app/ORIGINAL-BACKEND.md`](app/ORIGINAL-BACKEND.md).

## Supported vs. intentionally omitted

All 25 original views are shown. Most text/number record flows use local
SQLite-backed CRUD: tasks, CNC, requests, worklogs, projects, finance,
catalogs, users, archives, model metadata. The default users are display-only;
the optional local-password mode gives them local credentials. Worklog, project and
finance links produce simple XLSX workbooks. The local CAD inbox imports ready
GLB/JSON pairs and serves them to the bundled in-page viewer; it never creates
or auto-assigns a project. Model deletion moves files to profile-local trash.
The PWA shell uses a network-pass-through service worker and generic SVG.
The local document browser, project drawing/CAD/PDF browser, Office/PDF request links, CNC worklog file links,
and CSV/TXT/XLSX BOM links/uploads work only inside the profile. XLSX parsing reads the first
worksheet, not formulas or the full workbook feature set.
Dashboard, task, CNC and prefab-request photos are accepted as PNG/JPEG/WebP,
up to 10 per batch, 8 MB per file and 20 MB total. Their bytes are stored with
unique names in that profile's `.demo-data/images`; archive operations retain
the files. No production image folder is read.
The modelling-photo page is available from local demo Settings. It accepts
PNG/JPEG/WebP files up to 8 MB each into `.demo-data/modelling/<folder>` under
the selected profile, with a 200 MB limit per folder. It does not add ERP
projects, and existing photo files are never auto-deleted. The profile folder
name is a single simple name, not a path; redirects are refused.
The separate profile's `imports/worklogs/inbox` accepts JSON worklog drops;
the scanner creates its work-type feed and retains processed/failed source
files. User IDs, project IDs and overtime eligibility come from this same
profile's config and persistent state. See [`WORKLOG-IMPORT.md`](WORKLOG-IMPORT.md).

the OCR engine itself, Helper,
push notifications, hosted or multi-host security,
production/network project-folder scans, and multi-PC host takeover/tunnel are incomplete. The
default localhost demo deliberately has no password; the optional password
mode is a local trial, not permission to expose the service. Shared-write
fencing, coordinated backups, host registration/takeover, TLS/tunnel
configuration, and review are still required before an optional host stack
can be enabled. Do not copy the
archived production backend into this demo or point it at the live share.

## Quick checks

```powershell
npm.cmd run check
npm.cmd start
# in another terminal, while the demo is running:
node tests/api-smoke.mjs
node tests/browser-smoke.mjs --check-viewer
node tests/secure-browser-smoke.mjs
```

The browser test does not overwrite an existing screenshot by default. Back
up the PNGs before intentionally running it with `--refresh-screenshots`.
The PWA shell is available on localhost, but push is not connected.
