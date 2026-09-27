# Public-copy privacy review — 2026-09-27

This is Codex's technical review of the C: source candidate, **not** a legal
privacy clearance or approval to publish. The user need not review source
code; the user approved the current English screenshot gallery. At the time of
this C-only review, no commit, remote, push, tunnel, or production database was
involved. The dedicated repository requires its own exact staged-tree check.

## What was checked

- The explicit source-package allowlist and Git candidate inventory matched.
  Runtime `config.json`, SQLite files, the separate screenshot profile,
  private host-launcher references, Node binary, tunnel credentials, and
  uploads are excluded from the source ZIP.
- A case-insensitive search for the known company/person/project/host/domain
  identifiers from the private deployment returned zero current source hits.
  A real project-name test fixture and one specific project-folder exclusion
  were found and replaced after separate C-only backups. Synthetic rename
  tests still pass.
- A private IPv4, personal user-home path, private-key marker, and long
  token-pattern scan returned zero hits. The one email-shaped string in the
  guarded backend uses the reserved `example.invalid` domain. The remaining
  `192.0.2.10` host literal is a documentation/example address, not a live
  server address.
- All 39 candidate PNGs were structurally read: their only chunk types were
  `IHDR`, `IDAT`, and `IEND`; there were no text, EXIF, or ICC chunks. A
  visual sample of the dashboard, material requests, finance, archive, model
  list/viewer, worklog popup, and project browser showed synthetic labels.
- The bundled GLB is glTF 2.0 with a synthetic box node, no images, and no
  external URI. The viewer source ZIP has 17 members and no known private
  marker hit in its text entries. The sample DXF contains a single generic
  line, not customer geometry.
- Codex inspected the sample config, frontend/backend identity and path
  constants, Helper source, browser fetch destinations, source-package rules,
  test credentials, and every flagged URL, domain, email, IPv4, UNC/drive,
  project-code, phone, tax and address-like literal across the publishable
  text members. The disabled original backend still describes an old
  network-host architecture; its startup guard remains at the top.
- This deeper pass found one plausible real public IPv4 literal in a
  security-panel placeholder, missed by the prior private-IP scan. After a
  hash-verified C-only backup, both visible IP examples were changed to the
  reserved documentation address `203.0.113.10`. A source-package test now
  rejects any non-loopback, non-documentation IPv4 literal in text members.
  The current isolated suite passes 19/19.
- Every member of the nested 17-file viewer-source ZIP was rehashed against
  its C: source (zero mismatches), and its text members were scanned again.
  All 39 PNGs were checked for format/chunk structure (only `IHDR`, `IDAT`,
  `IEND`); this does **not** inspect the pixels.
- After the 2026-09-27 C-only English UI patch, the earlier 39 PNGs were
  hash-checked and moved to the private pre-translation backup before
  recapture. A repeat known-company/host/path marker scan found zero source
  candidate hits. The 39 new PNGs again have only `IHDR`, `IDAT`, `IEND`
  chunks. Chrome checked English labels across 25 menus, four function views,
  several non-submitting edit flows, and isolated first-run/login screens.
  A visual sample of dashboard, material, finance, settings, mobile and
  model-viewer images looked synthetic and English. On 2026-09-27 the user
  confirmed the current English gallery images are good. This acceptance
  does not clear the source, licenses, or future changed images for publication.

## Release checks and remaining gates

1. The user accepted the current 39-image [English synthetic gallery](docs/images/README.md).
   Repeat the visual review if any PNG changes. Code/file review remains
   Codex's job; future source changes or a staged commit need a fresh audit.
   Pattern and structural checks cannot prove absence of unknown private data.
2. The user confirmed company permission covers this exact frontend, guarded
   backend/Helper copy and approved screenshots under AGPL-3.0-or-later. This
   is the user's authorization attestation, not independent legal advice.
   Recheck third-party notices and corresponding source in any changed bundle.
3. Have the maintainer/agent review the final staged Git diff and binary
   assets after staging; repeat the exact ZIP/manifest checks. No file is
   staged or pushed by this review. Keep older ZIPs containing the former
   placeholder private in `<private-backup-root>`.
4. Keep hosted/tunnel mode disabled. The guarded original backend still has
   network-share, process-management and backup assumptions; adding a
   config file and Cloudflare connector alone does not make it safe or
   operational. Complete first-run hosted authentication, shared-write
   fencing, backup/restore, deployment and security tests separately.

## Exact candidate follow-up after image approval

On 2026-09-27, Codex compared a separate temporary Git index with the 129
allowlisted source files; the normal index remained unstaged. The current
source ZIP and nested viewer ZIP matched their source files by SHA-256.
Known-private-identifier and external-destination reviews found no new
private deployment marker. All 39 approved PNGs have no text, EXIF, or ICC
chunks; the user's visual acceptance covers only these current pixels. A
fresh C-only installation passed the API, 25-menu/GLB and secure-login
checks, with all extracted source hashes unchanged afterward. No Y: file
was opened for this follow-up. The technical findings are recorded in
`PUBLICATION-STATUS.md`; they do not independently establish rightsholder
authorization or clear a future changed release tree.

The user then explicitly confirmed that company permission covers this exact
C-only candidate, including the guarded backend/Helper and approved images
under the chosen AGPL license. Record this as the user's scope attestation;
it does not turn the technical privacy scan into independent legal review or
authorize publication of a later changed set. The five edited notes were
backed up at `<private-backup-root>\20260927-authorization-confirmation-before`.

## Generic host-wrapper delta (2026-09-27)

The new public launchers are short wrappers around a C-only, fail-closed
static inspector. They contain no private share, PC, person, token value,
service name or process-kill command. The old private launcher copies remain
outside the repository. The changed staged tree and source ZIP must be
rechecked before push; prior exact-file findings do not cover this delta.
The C-only 140-file allowlist includes only the new generic wrappers,
inspector, tests and documentation alongside prior public content. A scan
for known company, host, domain, person and password markers found no hit
in publishable text. The new scripts were read in full; they only call the
read-only, fail-closed adapter. This limited review does not validate any
future operational implementation or prove that unknown private content is
absent.
