# Workshop ERP public-copy work notes

At the start of a session and after context recovery, re-enumerate and read
every current Markdown file in this repository checkout before changing it. At present
that includes this file, `README.md`, `CUSTOMIZE.md`,
`ERP-HANDOFF.md`,
`PUBLICATION-STATUS.md`, `PROVENANCE-LICENSING.md`,
`PRIVACY-REVIEW.md`, `WORKLOG-IMPORT.md`, `app/ORIGINAL-BACKEND.md`, `documents/README.md`, `docs/images/README.md`,
`app/public/erp-glb-viewer/README.md`, and
`app/vendor/erp-glb-viewer-source/README.md`.
Re-enumerate instead of relying on this list after later patches.
Exclude historical backups, `node_modules`, and generated `dist`/runtime
directories.
Then recheck source hashes, the localhost listener and the verified C-only
backup for the current patch. This is a localhost-demo source checkout,
**not** the live network ERP.

## Scope and safety

- Work only in this isolated demo checkout for repository changes. Do not
  write, restart, or test against the private network production ERP.
- Preserve before changing. Never delete an existing file to reset the demo.
  Backups live in `<private-backup-root>`; the initial all-menu pre-change
  snapshot is `20260926-163747-full-menu-demo-before` and the private-profile
  snapshot is `20260926-163747-private-profile-before`.
- The prior generic demo DB was integrity-checked and moved, without deletion,
  to `<private-backup-root>\20260926-172000-demo-db-before-expanded-seed`.
  The current `<demo-root>\.demo-data\erp-demo.db` is a fresh, persistent local
  seed. It is not the live database and is ignored by Git.
- The private company-branded profile is outside this tree at
  `<private-profile-root>`. Never publish, screenshot, or copy it into the
  generic tree. Its users are display-only, not credential backups.
- The retained sanitized full-backend reference is outside this tree at
  `<private-backup-root>\20260926-retained-reference-source`. A byte-identical
  guarded copy is now staged under `app/` and included in the C-only source
  candidate. It still has an intentional startup throw and dangerous
  host/share/backup assumptions. Do not execute it, remove its guard, or
  replace `demo-server.mjs` with it without a separate adaptation and tests.
- `demo-server.mjs` always binds `127.0.0.1` and rejects cross-site/nonlocal
  requests. The default profile has no login; an opt-in single-process
  localhost password mode exists. Never attach either mode to a tunnel/LAN
  interface until shared-write fencing, backup safety, deployment hardening,
  and the complete hosted auth flow are implemented and tested. The user
  explicitly agreed optional hosting must remain disabled until secure
  setup exists.

## Current implementation (2026-09-27)

- The full original 25-view frontend is present. Demo-specific Settings
  explains the localhost/security boundary.
- `config.example.json` is the publishable synthetic starter. `npm.cmd run
  setup` copies it once to Git-ignored `config.json`, which supplies users,
  projects, catalogs, finance settings, and first-run sample records.
  `images/logo.svg` is the fixed-name generic
  branding asset. A separate profile can be selected with `--config`.
- The starter and the separate private C: profile now include a strict
  `futureHosting` reference schema for organization, share/project/import/
  backup paths, host ports, Cloudflare token-file locations, single-host
  watchdog and Helper. Only path references are stored; no token value is
  copied. `demo-server.mjs` validates the structure and refuses activation,
  but never consumes or exposes it. The guarded original backend is still
  unwired. `ERP-HANDOFF.md` explains the source ERP's company-wide website
  workflow and the gap to this localhost copy.
- Root-level generic `.bat`/`.cmd` wrappers now call
  `hosting/host-control.mjs`, which statically inspects the one-file
  `futureHosting` plan and refuses every operational action. No Startup
  entry, watcher, server, tunnel, service, firewall or shared file is changed
  by these wrappers. The original backend is still guarded and not wired to
  this plan. See `hosting/README.md`; this is source scaffolding, not a
  deployable host kit.
- `demo-store.mjs` stores the full demo state in a profile-local SQLite DB.
  The config seeds only a new DB; it does not overwrite later user edits.
  Opt-in `security.mode=local-password` adds per-user hashed credentials in
  that same local DB. `demo-auth.mjs` owns first-run admin setup, 12-hour
  memory-only sessions, CSRF, login limits and password changes. The default
  display-only demo remains unchanged. Existing credentials refuse a
  configuration downgrade back to no-login mode. Both modes bind localhost
  only; this is not shared-storage or hosted security.
- Main record, finance, catalog, project, user-display, archive/restore and
  model metadata routes are implemented locally. Deletes are archived in
  SQLite; model GLB/JSON delete moves existing files to profile-local
  `.demo-data/trash`. Archive purge is deliberately refused.
- A synthetic GLB/JSON pair is in the generic `imports/cadmodels` folder. The
  local scanner validates ready pairs every 10 seconds, never assigns a
  project automatically, and streams GLB bytes on demand. The matched viewer
  build and AGPL source/license are in `app/public/erp-glb-viewer` and
  `app/vendor/erp-glb-viewer-source`; the source ZIP download is present.
- The PWA manifest and network-pass-through service worker are present. The
  demo has no push subscription backend. Three XLSX export links produce
  simple local workbooks with no external file access.
- The local `documents/` sandbox supports Office/PDF request attachments,
  file links and a folder browser, plus CSV/TXT/XLSX BOM links/uploads and a
  bounded first-sheet parser. It rejects paths and symlink/junction escapes
  outside the profile before opening them. Uploaded BOM bytes live only in
  the profile-local `.demo-data/uploads` folder; see `documents/README.md`.
- The project browser scans only `documents/projects/<SHA-256 project ID>` in
  the selected profile, with file/directory/depth limits and no followed
  symlinks or junctions. Drawing, CAD assembly/part, and PDF files are listed;
  PDFs can open inline and any listed file can download. There is no Y: scan,
  automatic project creation, or Helper-based local file opening in this demo
  browser. The folder convention is in `documents/README.md`.
- PNG/JPEG/WebP dashboard, task, CNC and prefab-material images are written
  with unique names to profile-local `.demo-data/images` and served through
  their existing UI routes. The submitted batch is validated before writes;
  a record archive retains its image files. There is no file deletion or
  production image access.
- The original special modelling-photo page is reachable from demo Settings
  without adding a 26th menu or pretending there is a login. Its folder list
  and uploads are confined to `.demo-data/modelling/<simple folder name>` in
  the selected profile. `demo-modelling.mjs` validates image bytes and rejects
  traversal, redirected directories, and over-200-MB folders. It does not
  infer or create ERP projects. Uploaded files are never auto-deleted.
- The user confirmed the bundled GLB viewer is adapted from their own earlier
  Codex-built viewer and approved redistribution of this derivative and its
  source. The source ZIP matches the on-disk source by SHA-256. `.gitignore`
  now admits the viewer/PWA and synthetic GLB pair. The user selected
  AGPL-3.0-or-later for the whole C: ERP copy and a root `LICENSE` was added;
  the user later confirmed company permission covers the exact C-only
  candidate, including the guarded backend/Helper and approved images.
  Any public commit still needs its exact changed files and notices checked.
- `demo-worklog-import.mjs` watches only a profile-local JSON inbox. It
  requires an explicit visible user, preserves originals in `processed/`,
  separates bad entries in `failed/`, and does not default to any person or
  auto-create projects. The config/logo, CAD/import, documents, image and
  SQLite/upload roots reject redirected profile folders before use. See
  `WORKLOG-IMPORT.md`.
- `scripts/backup-profile.mjs` creates a non-overwriting, offline profile
  snapshot outside the profile tree. It checks the configured localhost port,
  refuses redirected paths, copies only known profile roots, verifies file
  hashes and a consistent SQLite `VACUUM INTO` snapshot, and writes a manifest
  last. It never prunes. Tests retain their OS-temp fixtures.
- `scripts/package-source.mjs` has an explicit public-file allowlist matching
  the current Git candidates. It excludes editable `config.json`, runtime
  DB/uploads/imports and the private profile. The server snapshots that
  source ZIP at startup and links it from the always-visible demo ribbon,
  including login; `/LICENSE` serves the root text. Neither script is a
  substitute for exact release-file and screenshot privacy review.
- `demo-project-scan.mjs` optionally inventories only immediate directories
  under configured local `documents/scanned-projects[/name]` roots. A complete
  inventory precedes mutation. Exact paths win; slight renames require a
  unique same-parent, same-project-number match. Missing folders never archive
  records and warn only after three complete scans. Renames preserve IDs,
  entries and per-user project-notice history. The existing project browser
  can read scanned folders only within local profile documents. Generic
  `config.json` has no scan roots, so this stays off by default.
- `demo-ocr.mjs` is an optional local Tesseract CLI bridge. The generic
  profile stays disabled; a selected profile must name an existing local
  executable and language in `ocr`. Bounded PNG crops are sent through stdin
  to a hidden subprocess (no shell/network), with per-run timeout and no
  source-image storage. Correction text is private SQLite state, omitted from
  `/api/state`. Only mock-engine behavior was tested; Tesseract itself is
  not installed or bundled.
- The original `app/server.js` and six local modules/package plus the
  PowerShell Helper source were copied from the retained sanitized reference.
  After a separate hash-verified backup, one concrete project-folder
  exclusion was removed from the C-only `server.js`; it is no longer
  byte-identical to that reference. `server.js` still throws at line 3,
  before imports.
  `scripts/create-original-fixture.mjs` builds a fresh original-schema SQLite
  DB from only `config.example.json`, with dummy in-app notices, no push
  subscriptions or tunnel keys, and locked random user credentials. The
  generated `<demo-root>\.demo-data\original-erp-synthetic.db` is ignored by Git.
  Five live host launchers were copied read-only as inert `.txt` references,
  then moved to private `<private-backup-root>\20260927-091000-private-host-reference`
  so their real share/PC details are outside this public tree and source ZIP.
  See `app/ORIGINAL-BACKEND.md`.
- A fresh ignored profile under `.demo-data/synthetic-screenshot-profile-20260927`
  supplied the 25-menu/four-function [synthetic screenshot gallery](docs/images/README.md).
  It copied only generic config/logo/GLB/CSV and the new one-line sample DXF.
  The screenshot test never submits records and does not overwrite existing
  images unless explicitly asked. See `PRIVACY-REVIEW.md` for limited checks.
- The localhost UI is presented in English through `app/public/english-ui.js`,
  which translates rendered labels, placeholders and browser prompts only when
  `ERP_DEMO_CONFIG` is present. It does not rewrite user data, select values,
  API keys or the guarded original backend. `financeSettings()` supplies
  English fallback choices only for the demo; dates/numbers use `en-GB` there.
  The 39 synthetic screenshots were backed up and recaptured in English. Run
  browser smoke with `--check-english` for 25 menus, function views, request
  edit forms and opt-in secure-mode pages. Existing user-authored text can
  still have its original language.
- OCR, Helper, full production host/watchdog/Cloudflare stack, hosted
  authentication/security, and
  production-equivalent project scanning remain incomplete. Do **not**
  describe this as a feature-complete ERP or ready-to-publish package.
  `PUBLICATION-STATUS.md` tracks release gates.

## Cheap verification

From `<demo-root>`, use `npm.cmd run check`, `npm.cmd test`, and
`node tests\browser-smoke.mjs --check-viewer --check-english` while `npm.cmd start` runs.
Run `node tests\secure-browser-smoke.mjs` separately to test an opt-in
password profile and Chrome first-run/login/logout in a fresh retained OS-temp
directory; it does not use the generic DB or screenshots.
The browser smoke is read-only unless `--write-samples` is supplied; it does
not overwrite existing screenshots unless `--refresh-screenshots` is supplied.
`tests/full-api.test.mjs` writes only to a unique OS-temp profile and leaves
that fixture intact. `tests/api-smoke.mjs` is read-only. Node 22.5+ is needed
for built-in `node:sqlite`; this PC has Node 24.18.0.
For a fresh public-source extraction, run `npm.cmd run setup` before checking
or starting; it refuses overwriting an existing editable config. The
non-overwriting source/profile packaging scripts write only to explicit new
local targets outside the project.

## Changelog

- 2026-09-26: Backed up the C demo, enabled all 25 frontend views, added
  profile-local persistent SQLite, expanded synthetic config and local API
  routes, restored and tested the synthetic GLB viewer/PWA shell, added local
  XLSX exports and isolated persistence/browser tests. Live Y: was untouched.
- 2026-09-26: After a second hash-verified C-only backup at
  `<private-backup-root>\20260926-174006-document-safety-before`, added a
  profile-local document browser/link sandbox, request Office/PDF links and
  basic CSV/TXT/XLSX BOM link/upload. Tightened lexical and real-path checks
  before document reads; uploads and demo SQLite folders reject redirection
  outside the local profile. Isolated API tests cover traversal rejection,
  UTF-8 XLSX preview, BOM import and restart persistence. No live writes.
- 2026-09-26: Made another hash-verified C-only backup at
  `<private-backup-root>\20260926-174531-local-images-before`. Added bounded,
  format-checked local image storage and existing image routes for dashboard
  todos, tasks/CNC tasks and prefab material requests. Isolated API tests
  verify image reads, append, unsafe SVG rejection and restart persistence.
- 2026-09-26: After hash-verified C backup
  `<private-backup-root>\20260926-175012-local-worklog-import-before`, added
  the profile-local worklog JSON watcher. Valid entries persist with exact
  user/project and overtime rules; originals move to profile-local processed
  history, failures and reasons are retained, and repeated files are deduped.
  Isolated mixed-batch and restart tests pass. No Y: import was touched.
- 2026-09-26: Found the request-link UI's old Y:-only validation during a
  privacy/path scan. After C backup
  `<private-backup-root>\20260926-175812-demo-ui-paths-before`, made demo
  request links accept only server-validated profile documents; `documents/`
  relative paths and CNC worklog document links now work locally. The C demo
  frontend cache-buster is `20260926-full-demo5`. Removed the exact private
  production path from this public-copy note.
- 2026-09-26: After hash-verified C backup
  `<private-backup-root>\20260926-180508-profile-roots-before`, hardened
  config, logo, CAD inbox and import-root checks against junction/symlink
  redirection. The worklog import root is checked before the CAD scan starts.
  Config, isolated API tests and an OS-temp junction escape test passed;
  production was not touched.
- 2026-09-26: After hash-verified C-only backup
  `<private-backup-root>\20260926-200901-project-browser-before`, added a
  bounded profile-local project file browser and PDF/download routes. The
  demo UI uses browser links and path-copy controls instead of the production
  Helper for those files. Isolated API and Chrome tests cover the route and
  in-page modal. Bumped app cache-buster to `20260926-full-demo6`; no live
  Y: file or process changed.
- 2026-09-26: After hash-verified C-only backup
  `<private-backup-root>\20260926-202253-modelling-local-before`, added a
  Settings entry to the existing modelling-photo UI and profile-local folder
  list/upload routes. Test fixtures verified format/path rejection and restart
  persistence; Chrome verified open/exit, 25 menus, and viewer. Bumped frontend
  cache-buster to `20260926-full-demo7`. No production data was touched.
- 2026-09-26: After hash-verified C-only backup
  `<private-backup-root>\20260926-203628-secure-local-before`, added opt-in
  localhost-only first-run admin passwords, per-user salted hashes,
  memory-only sessions, same-origin/CSRF checks, role gates, and a visible
  secure-mode logout. Replaced fixed-admin write attribution with the signed-in
  actor, prevented a config downgrade after credentials exist, and left
  default sample mode display-only. Isolated API tests passed 5/5; generic
  25-menu/viewer Chrome smoke and secure setup/logout/login Chrome smoke
  passed. App cache-buster was `20260926-full-demo8`. No live Y: changes.
- 2026-09-26: Recorded the user's explicit viewer-origin/redistribution
  confirmation. Verified all 14 source-ZIP entries against on-disk SHA-256
  hashes, then narrowed `.gitignore` to include the approved viewer build,
  matching source/ZIP, generic PWA shell and synthetic model while continuing
  to exclude runtime imports, credentials and retained internal backend.
  Replaced one residual real-format project-code placeholder with a generic
  demo name; app cache-buster is `20260926-full-demo9`. The ERP core license
  and exact-commit release review remain open.
- 2026-09-26: After a second narrow hash-verified C-only viewer-package backup
  at `<private-backup-root>\20260926-211437-viewer-package-before`, added the
  missing viewer source README and complete three.js r160 MIT notice to source
  and runtime. The source build now copies the notice. Rebuilt the 16-entry
  source ZIP, compared every file hash to the source, and moved the old ZIP to
  that backup without deletion. An offline pinned-dependency rebuild matched
  the active viewer JS/CSS/HTML/license by SHA-256; six unreferenced old chunks
  moved to the same C-only backup. Viewer unit tests passed 5/5, ERP tests
  passed 5/5, and Chrome still rendered all 25 menus and the GLB. Generated
  viewer `dist/` and `node_modules/` stay ignored. No production files changed.
- 2026-09-26: Found the frontend still defaulted to an installed localhost
  Helper URL despite the demo's isolated backend. Demo mode now rejects every
  Helper URL before a browser fetch and directs users to local `documents/`;
  Chrome smoke checks the guard. Bumped app cache-buster to
  `20260926-full-demo10`. An old screenshot incorrectly claimed edits reset.
  Hash-verified all ten PNGs at
  `<private-backup-root>\20260926-213127-demo-screenshots-before`, then
  refreshed the generic 25-menu/viewer screenshots. No Y: work occurred.
- 2026-09-26: Verified the 17-file allowlisted viewer source ZIP member by
  member against editable-source SHA-256 hashes, then moved the older ZIP to
  `<private-backup-root>\20260926-211437-viewer-package-before` and installed
  the new ZIP. `package:source` refuses overwrites and omits dependencies,
  generated files and CAD fixtures. Corrected the served runtime README so
  it points to the editable source instead of claiming to be source itself.
- 2026-09-26: A narrow nine-file C-only backup at
  `<private-backup-root>\20260926-235400-cad-format-before` preceded removal
  of the last branded CAD format marker in the candidate tree. The synthetic
  sidecar and generator now use `workshop-cadmodel`; `cadModelFormat` in the
  single profile config can name another exporter format. Config validation,
  ERP tests (6/6), viewer tests (5/5), and a known-identifier byte scan passed.
  The package description now correctly says edits persist locally. No
  private profile or production exporter was rewritten.
- 2026-09-26: Hash-backed up the generic demo DB in the same narrow C backup
  (`PRAGMA integrity_check=ok`), then ran read-only localhost API and Chrome
  checks. All 25 menus opened, the generic synthetic GLB rendered, and Chrome
  reported zero JavaScript exceptions. The localhost server was stopped and
  port 4777 has no listener. Corrected the startup banner's stale
  "disposable" wording; edits persist in the local SQLite DB.
- 2026-09-27: Initialized Git only in `<demo-root>` for an exact public-file
  inventory; no file was staged, committed or pushed. The initial 74-file
  inventory and ignore checks exclude the local DB, viewer dependencies,
  generated viewer build and runtime worklog feed. Known-identifier byte
  scanning found no hits, PNG chunks have no text/EXIF metadata, and the
  synthetic GLB payload contains generic fixture names. Recorded these as
  limited checks in `PUBLICATION-STATUS.md`, not publication approval. Secure
  Chrome setup/logout/login smoke also passed on a fresh OS-temp profile.
  Release notes were hash-backed up at
  `<private-backup-root>\20260927-000500-public-inventory-before` first.
- 2026-09-27: After a three-file hash-matched C backup at
  `<private-backup-root>\20260927-001000-archive-ui-before`, aligned the
  demo Archivált panel with its existing no-purge backend: it no longer
  offers permanent-delete buttons or selection, retains restore actions,
  and describes local retention instead of Y: project folders. Demo project
  archive confirmation also names only the local archive. Production UI
  branches were not changed; app cache-buster is `20260927-demo-archive1`.
  Browser smoke now asserts that no purge control is rendered in the demo;
  frontend syntax, ERP tests (6/6), 25-menu/GLB Chrome smoke and zero browser
  exceptions passed. The localhost server was stopped afterward.
- 2026-09-27: The user explicitly selected AGPL-3.0-or-later for the whole
  C: ERP copy. After hash-verifying a five-file pre-change backup at
  `<private-backup-root>\20260927-001900-agpl-before`, added root `LICENSE`
  as a byte-identical copy of the existing viewer AGPLv3 text, set package
  metadata to `AGPL-3.0-or-later`, and updated README/provenance/release
  notes. An initial apply-patch copy with an EOF-only newline difference was
  preserved in that backup before the exact mechanical copy. No commit,
  publication, production write or host restart occurred. Ownership scope,
  exact-file privacy review, and hosted corresponding-source offer remain
  open release gates.
  `npm.cmd run check`, ERP tests (6/6), exact root/viewer license hash,
  75-file Git candidate inventory, no-remote/no-staging checks and the
  known-identifier scan passed; port 4777 has no listener.
- 2026-09-27: After hash-verifying six C-only files at
  `<private-backup-root>\20260927-020000-install-kit-before` and the demo
  server/HTML at `<private-backup-root>\20260927-023000-source-offer-before`,
  copied the synthetic config byte-for-byte to `config.example.json` and
  Git-ignored the mutable `config.json`. Added non-overwriting first-run
  setup, local profile snapshot, and explicit whole-source ZIP scripts with
  isolated tests. The localhost app now offers that bundle and the root
  license on both login and main screens. No production host/tunnel or live
  Y: data was accessed or changed; exact-file release review and optional
  integrations remain open.
- 2026-09-27: Verified the 81-file source-review ZIP member-by-member,
  tested its download/license links and the 25-view/GLB browser, then
  extracted it into a fresh isolated C: installation. Setup, config check,
  all isolated tests, server start and API/source offer passed; the test
  server was stopped. The generic profile was separately backed up at
  `<private-backup-root>\20260927-030000-generic-profile-before-smoke`.
  After a further hash-matched eight-file backup at
  `<private-backup-root>\20260927-040000-local-scan-before`, added optional
  profile-contained project folder discovery, conservative continuity,
  per-user notices and real project browser roots. Unit and isolated API
  tests cover unique 028-vs-029 identity, rename preservation, no automatic
  archive after missing scans, and source-package allowlist parity. Live Y:
  was untouched; network hosting remains disabled.
- 2026-09-27: A final C-only ambiguity check moved duplicate same-name
  folders to separate additions instead of attaching both to one manual
  project; nested scan roots are rejected. Backed up scanner/tests at
  `<private-backup-root>\20260927-050000-scan-ambiguity-before` first.
  Backed up frontend/HTML at
  `<private-backup-root>\20260927-053000-local-scan-ui-before`, then made
  demo Settings state the actual local scan status and replaced the scanned
  project modal's unavailable Helper action with the existing in-app browser.
  Bumped C-only app cache-buster to `20260927-local-scan1`. The full isolated
  suite passed 15/15 and Chrome visited all 25 menus plus the synthetic GLB
  with zero JavaScript exceptions; generic localhost was stopped. A limited
  84-candidate identifier scan, private-key marker check, PNG metadata check,
  and GLB name inspection found no known private markers, but do not replace
  independent exact-file privacy review. Optional Cloudflare/watchdog mode
  remains unimplemented and disabled, not ready by adding a token.
- 2026-09-27: After a ten-file hash-verified C-only backup at
  `<private-backup-root>\20260927-080000-optional-ocr-before`, added
  disabled-by-default local Tesseract OCR endpoints for the existing CNC
  worklog camera UI. An additional hash-verified module/test backup at
  `<private-backup-root>\20260927-083000-ocr-bounds-before` preceded PNG
  dimension limits. The C-only UI now explains the missing optional engine
  instead of launching an unusable camera flow. No engine was installed,
  no live share was touched, and real OCR quality remains unverified.
- 2026-09-27: The current C-only suite passed 17/17 and viewer tests 5/5;
  Chrome visited all 25 menus plus the synthetic GLB with zero JavaScript
  exceptions. The default-disabled OCR API reported `ocrEnabled: false`
  and HTTP 501. A limited 86-candidate identifier/private-key/file-type and
  ten-PNG metadata scan found no known private marker, but is not independent
  exact-file privacy review. Release-note edits were preceded by a verified
  C-only backup at
  `<private-backup-root>\20260927-090000-ocr-verify-notes-before`.
- 2026-09-27: The first post-OCR 86-file source-review ZIP was verified
  member-by-member against its SHA-256 manifest (zero mismatches/forbidden
  paths). Its fresh C-only extraction passed setup, config check and 17/17
  isolated tests; a brief localhost run served the same ZIP and license with
  HTTP 200 and was stopped afterward. The docs were backed up again at
  `<private-backup-root>\20260927-100000-final-review-notes-before` before
  recording those results. No private share or production process changed.
- 2026-09-27: After the hash-verified C-only backup at
  `<private-backup-root>\20260927-084500-original-stage-before`, copied the
  guarded original backend/Helper source from the retained sanitized archive
  into `app/` without overwriting existing files. The original server remains
  startup-disabled. Added a non-overwriting synthetic original-schema SQLite
  fixture generator and retained its first failed-test version at
  `<private-backup-root>\20260927-085500-fixture-fix-before` before fixing a
  missing users collection. The generator created a new ignored C-only
  database with two dummy notifications; no live database was read. Copied
  five current launchers read-only to ignored `.txt` references, never ran
  them, and did not change the live ERP. A byte-identical shared `node.exe`
  copy is kept in ignored `app/node/` and was never executed; no Cloudflare
  binary/token was copied. The public
  source allowlist and Git inventory now match at 97 files; known private
  identifier scan had zero hits, and isolated tests passed 18/18. This is
  source staging, **not** original-backend runtime validation or publication
  approval.
- 2026-09-27: Verified the 97-file source ZIP member-by-member, then tested a
  fresh C-only extraction. First-run setup, config validation, all 18
  isolated tests, read-only API smoke and Chrome's 25-menu/synthetic-GLB smoke
  passed with zero JavaScript exceptions. The extracted source files still
  matched the ZIP manifest after testing and the localhost test server was
  stopped. Backed up these notes at
  `<private-backup-root>\20260927-085800-verified-notes-before` before
  recording the result. No guarded original server, production process, or
  network-share workflow was run.
- 2026-09-27: Noticed the ignored launcher references still contained live
  share/PC details inside the candidate working tree. Verified the exact
  five-file directory, moved it without deletion to private
  `<private-backup-root>\20260927-091000-private-host-reference`, and verified
  all moved hashes. Backed up these notes at
  `<private-backup-root>\20260927-091100-private-ref-docs-before` before
  updating their current-location descriptions. The original backend's
  guarded watch-loop source remains in C:; no live host was touched.
- 2026-09-27: After the hash-verified C-only backup at
  `<private-backup-root>\20260927-091700-screenshot-work-before`, added a
  non-overwriting `--capture-all-menus` browser mode and captured 25 menu
  screenshots plus worklog fullscreen, project browser, modelling and GLB
  viewer from an isolated synthetic localhost profile. Preserved the first
  empty project-browser capture in that backup, then added a generic one-line
  DXF and recaptured it. The synthetic GLB rendered; Chrome reported zero
  JavaScript exceptions and the server was stopped. An identifier scan found
  a real project-name unit-test fixture; after backing up the tests at
  `<private-backup-root>\20260927-092500-privacy-fixture-before`, replaced it
  with synthetic 028/029 examples and removed private literals from the
  screenshot guard. The identity tests still pass. After a separate backup at
  `<private-backup-root>\20260927-093500-backend-privacy-before`, removed one
  concrete project-folder exclusion from the guarded C-only backend; no
  original server was run. The limited privacy findings are documented in
  `PRIVACY-REVIEW.md`. This did not enable hosted/tunnel operation.
- 2026-09-27: The expanded 128-file source ZIP was checked member-by-member
  against its SHA-256 manifest and current source, with no runtime DB,
  editable config, Node binary, private host reference or screenshot profile.
  A fresh C-only extraction passed `setup`, config validation, all 18
  isolated tests, read-only API smoke, and Chrome's 25-menu/synthetic-GLB
  smoke with zero JavaScript exceptions. All extracted source hashes were
  unchanged after testing. The test server was stopped, port 4777 had no
  listener, the root demo DB hash was unchanged, and the original backend
  guard remained at the top. Backed up these notes at
  `<private-backup-root>\20260927-095500-final-verification-notes-before`
  before recording that result. No hosted or live ERP process was run.
- 2026-09-27: Codex took ownership of code privacy review so the user can
  focus on the screenshot gallery. After the narrow hash-verified C-only
  backup at `<private-backup-root>\20260927-110000-code-privacy-review-before`,
  replaced a realistic public IP left in the security-panel example with a
  reserved documentation IP, made the second example consistent, and bumped
  the C frontend cache-buster to `20260927-privacy-ip1`. Added a source test
  rejecting non-documentation IPv4 literals in publishable text; the isolated
  suite passes 19/19. Rehashed all 17 nested viewer ZIP members against
  source, and checked all 39 PNGs for metadata chunks. The final staged-tree
  and screenshot pixel reviews remain pending; no live Y: action occurred.
- 2026-09-27: After the hash-verified C-only backup at
  `<private-backup-root>\20260927-english-ui-before`, added a demo-only English
  presentation layer, English finance fallback choices and `en-GB` display
  formatting. The original 39 PNGs were individually moved to that backup
  after hash matching, then recreated from the isolated synthetic localhost
  profile with a non-overwriting browser command. All 25 menus, four function
  views, several non-submitting edit flows, and isolated first-run/login pages
  passed English/browser checks; the GLB rendered with zero JS exceptions.
  No stored values, root generic demo DB, live Y: files or production process
  were changed.
- 2026-09-27: The 129-file English UI review ZIP was verified member-by-member
  against its SHA-256 manifest and current C-only source, then extracted to a
  new local directory. Fresh `setup`, config validation, 19 isolated tests,
  read-only API smoke, 25-menu/GLB English Chrome smoke, and secure first-run/
  login Chrome smoke passed. The extracted server offered the byte-identical
  source ZIP; all 129 extracted source files retained their hashes. Both
  localhost servers were stopped afterward. The review ZIP validates only
  this localhost workbench, not the guarded backend or hosted operation.
- 2026-09-27: A second narrow hash-verified C-only backup at
  `<private-backup-root>\20260927-english-edge-dialogs-before` preceded English
  labels for common native prompts, confirmations and status toasts. The
  browser smoke now checks sample archive/delete/model/priority/password
  messages without invoking a destructive action; 25 menus, GLB, edit flows
  and isolated secure login still pass with zero JavaScript exceptions. The
  pre-edge ZIP is retained as history; rebuild/verify an exact-source ZIP
  after any further note or source change. The 39 screenshots did not need
  recapture because these messages are outside their captured states.
- 2026-09-27: The user reviewed the current 39 English screenshots and said
  the images are good. Four C-only status/gallery notes were hash-backed up
  at `<private-backup-root>\20260927-gallery-approval-before` before recording
  that acceptance. This is a visual approval of the current images only, not
  publication clearance; recaptured PNGs must be reviewed again. No code,
  image, database, production host or Y: file was changed for this update.
- 2026-09-27: Before recording a final C-only release audit, hash-backed up
  these notes plus `PUBLICATION-STATUS.md` and `PRIVACY-REVIEW.md` at
  `<private-backup-root>\20260927-release-audit-notes-before`. A separate
  temporary Git index matched all 129 source-package candidates without
  staging the normal index. The only default `git diff --check` finding was
  a trailing blank line in each identical AGPL license copy. The 17-file
  viewer source ZIP matched editable source; the three.js MIT notice
  contains the installed package's exact license. Both full and production-
  only npm audits reported zero advisories at check time. All 52 candidate
  JavaScript files passed syntax checks, 39 approved PNGs had no metadata
  chunks, and the fresh C-only source extraction passed setup, config, 19
  isolated tests, read-only API, 25-menu/GLB English browser and secure-local
  first-run/login tests. All 129 extracted source hashes remained unchanged;
  port 4777 was closed afterward. The refreshed review ZIP is
  `<private-backup-root>\workshop-erp-release-audited-20260927.zip`. This is
  technical evidence for a localhost demo, not rightsholder approval or
  permission to expose the guarded backend. No Y: operation, commit, or push.
- 2026-09-27: The user explicitly clarified that company publication
  permission covers the exact C-only 129-file candidate, including its
  copied guarded backend/Helper source and the approved 39 images under the
  selected AGPL-3.0-or-later license. This records the user's scope
  confirmation, not independent legal verification. Five release notes were
  hash-backed up at
  `<private-backup-root>\20260927-authorization-confirmation-before` before
  the clarification was recorded. The refreshed source snapshot is
  `<private-backup-root>\workshop-erp-authorization-recorded-20260927.zip`.
  No code, image, database, Y: process/file, commit, or push changed.
- 2026-09-27: For the dedicated Workshop_ERP repository, copied the 129-file
  sanitized source set into a new C-only checkout with manifest hash checks.
  The four repository-facing notes were backed up and hash-verified before
  correcting historical pre-publication wording. The original C: workbench,
  private profile and live Y: ERP were not changed. This transfer remains a
  localhost demo; the guarded backend and optional host stack are not enabled.
- 2026-09-27: After a hash-verified C-only backup at
  `<private-backup-root>\20260927-deployment-plan-before`, added an inactive
  `futureHosting` schema to the generic and separate private configs. The
  latter records known path references and local overtime visibility, never
  token bytes or passwords. Added `ERP-HANDOFF.md` and included it in the
  130-file source allowlist. Config-only validation and its fail-closed tests
  pass without starting another server; the existing port-4780 Node host was
  not stopped or changed. Hosted startup still requires code adaptation,
  launchers and a security/failover review; no Y: file was accessed.
- 2026-09-27: After verifying the 130-file source snapshot at
  `<private-backup-root>\20260927-host-kit-before-01\public-source.zip`, added
  generic launcher wrappers and a read-only deployment-plan inspector. Their
  operational actions fail closed even with a filled synthetic config; no
  original backend guard was removed. The wrappers do not copy files, enroll
  PCs, open a port, run a watchdog/tunnel, or modify production. Static
  path/mapping/refusal tests use only synthetic fixtures. Hosted runtime
  adaptation and disposable failover/security validation remain open.
