# Publication status: localhost source, not a hosted ERP

This dedicated repository contains the sanitized source of the 25-view
localhost demo. The user approved the exact source and synthetic screenshots
for release under AGPL-3.0-or-later. Repository publication is not permission
to expose the demo through a tunnel or to run the guarded original backend.
The dated C-only review history below records the checks and remaining
functional/security limits; it is not a claim of production parity.

The generic demo starts with `npm.cmd start`, binds only `127.0.0.1:4777`, and
persists synthetic/configured records in a separate profile-local SQLite DB.
An opt-in, localhost-only password mode now has first-run admin setup,
per-user hashed credentials, same-origin/CSRF checks, role gates, and in-memory
sessions. The default sample mode still has no login. Neither mode can bind
LAN or start Cloudflare/watchdog processes.
The guarded original backend is *not* used by the localhost demo. Its retained
source reference remains outside `<demo-root>` at
`<private-backup-root>\20260926-retained-reference-source`; a byte-identical
copy of its modules, package and Helper source was staged in `<demo-root>\app`.
One concrete folder exclusion was then removed from the C-only `server.js`
for privacy; the original startup throw remains intact. The matching synthetic GLB viewer build/source and
generic PWA shell have been restored into `<demo-root>`. The user states the
earlier source viewer was their own work and approves releasing this
derivative. Viewer source ZIP and directory hashes match. An offline rebuild
matched the active runtime JS/CSS/HTML/license by SHA-256; the three.js MIT
notice is now included. An exact-commit license/privacy review is still due.
The user selected AGPL-3.0-or-later for the entire C: ERP copy on 2026-09-27;
the new root `LICENSE` exactly matches the viewer's existing AGPL text.

The original sanitized source copy is cataloged in the archived
`SOURCE-MANIFEST.json`. That manifest records the first export's hashes, not
the later demo patches.
On 2026-09-27, a local Git repository was initialized in `<demo-root>` solely to
inventory the candidate files. At that stage there was no commit, remote, or
push. Git's untracked/non-ignored inventory had 129 files, including `LICENSE`,
the generic `config.example.json`, and the non-overwriting setup, backup, and
source-package scripts/tests plus the guarded original backend source. The
mutable `config.json` and generated original-schema fixture DB are ignored.
`git check-ignore`
confirmed that the demo SQLite DB, viewer `node_modules` and generated `dist`,
the old internal source manifest, and runtime worklog feed are excluded. A
read-only scan of candidate bytes found none of the known company, person,
host, domain, or private-password identifiers checked for this copy. The ten
synthetic PNGs contain only image chunks (no text/EXIF chunks), and the
synthetic GLB JSON contains only generic fixture names. These checks are
limited pattern/metadata checks, **not** a privacy clearance; the exact
staged files still need human review before any public commit.
The verified all-menu pre-change backup is
`<private-backup-root>\20260926-163747-full-menu-demo-before`. The previous
generic demo DB was integrity-checked and moved without deletion to
`<private-backup-root>\20260926-172000-demo-db-before-expanded-seed` before
the expanded placeholder seed. No live ERP file, database, launcher, or
service was changed by this C-only work.

## Release status and remaining gates

1. The user explicitly confirmed on 2026-09-27 that company permission covers
   this exact C-only 129-file source candidate, including the copied guarded
   backend/Helper and the approved 39 images under AGPL-3.0-or-later. This
   resolves the requested scope clarification as a user attestation; it is
   not independent legal verification. Reconfirm if the release set changes.
2. Review the restored GLB viewer's AGPL-3.0-or-later source distribution and
   third-party notice obligations in the exact release. The user confirmed
   original ownership and derivative redistribution permission. A complete
   three.js r160 MIT notice is included in source and runtime. `.gitignore`
   now permits the viewer
   build/source/ZIP, PWA shell and synthetic GLB pair in a candidate commit;
   runtime imports and private profiles remain excluded. Verify the exact
   proposed commit before publishing.
3. Codex has reviewed the privacy-bearing code, exact source inventory,
   network/path/identity literals, viewer archive and binary structure; see
   `PRIVACY-REVIEW.md`. The user accepted the current 39 English screenshots
   on 2026-09-27. Recaptured images require another visual review. Before a
   public commit, the maintainer/agent must repeat the review on the final
   staged diff and binary assets; a future change invalidates this snapshot.
   A pattern scan alone cannot prove absence of private content. Do not
   commit or push without that exact-staged-tree review.
4. Complete the missing ERP workflows or label the release as a partial demo.
   The 25 views render and local document/BOM links, bounded profile-local
   project file browsing, opt-in local project-folder scanning with conservative
   continuity, task/request/modelling photos, and worklog JSON import work,
   but a working original backend, Helper integration, a bundled/tested real
   OCR engine, push, hosted authentication,
   production/network folder scans, and host takeover are not yet present.
5. Before enabling LAN/Cloudflare or multi-PC hosting: implement first-run
   account creation with no default password, authorization, CSRF protection,
   shared-write fencing, migrations, backups, and a security review. The
   first three exist only for a single localhost process and are not an
   end-to-end hosted security proof. The user explicitly agreed this gate;
   the current server remains localhost only and must not be put behind a
   tunnel. A whole-ERP AGPL source-offer link and allowlisted ZIP now exist
   for this localhost copy, but the exact offered tree must be independently
   reviewed again before any hosted deployment. No public release URL,
   shared-write fence, or hosted rollout exists.

The install kit now has `npm.cmd run setup` (copies a generic template only
when `config.json` is absent), and a separate local profile backup command.
The backup refuses an existing destination, checks for a running localhost
server, and retains every source file. A tested source-package command and
the app's prominent `/SOURCE.zip` link exclude the edited config and runtime
data. These are readiness improvements, not evidence that missing production
integrations or the remaining review gates are complete.
The prior C-only check suite passed 17/17, and the viewer tests passed 5/5.
The 25-menu/GLB Chrome smoke passes with zero JavaScript exceptions;
secure-local Chrome setup, logout and login also pass. The local scan tests
cover unique renames, number boundaries, ambiguous same-name folders, per-user
notice acknowledgment and missing-folder retention. The generic localhost
server was stopped after browser checks. A limited 86-candidate scan after
the OCR adapter found no known company/host/password identifiers in the
inspected names, no private-key marker, no database/executable/token
candidate, no text/EXIF PNG chunks across ten synthetic screenshots, and only
a generic "Synthetic box" GLB node. This is **not** an independent human
privacy review of every screenshot and source line.
An optional Tesseract CLI bridge was then added after the hash-verified
`<private-backup-root>\20260927-080000-optional-ocr-before` snapshot. It is
disabled unless a local executable/language is explicitly configured, has
bounded PNG/stdin/subprocess execution, and does not store source photos.
Its tests use a fake local engine; there is no installed Tesseract on this PC,
so actual recognition quality remains unverified. The default-disabled OCR
API reports `ocrEnabled: false` and returns HTTP 501 for OCR requests; the
browser smoke still visits all 25 views and the synthetic GLB without errors.
The source allowlist had 86 files at that point. The first post-OCR review ZIP at
`<private-backup-root>\workshop-erp-source-review-20260927-093000.zip` was
checked member-by-member against its SHA-256 manifest: 86 files, zero
mismatches or forbidden runtime/credential paths. Its fresh C-only extraction
passed first-run setup, config validation and all 17 isolated tests. The
extracted localhost server served the root, state, license and byte-identical
`/SOURCE.zip` with HTTP 200, then was stopped. This is an installation check,
not privacy clearance, release approval, or proof of production parity.
After staging the guarded original source, the current allowlist and Git
candidate inventory match at 97 files; isolated tests pass 18/18. A known
private-identifier scan of the newly copied backend/Helper text had zero
hits, but every new source file still needs independent privacy and ownership
review before a public commit. The synthetic original-format database at
`<demo-root>\.demo-data\original-erp-synthetic.db` is deliberately ignored and
must never be added to the source ZIP. The original backend has not been run.
The source-review ZIP was extracted into a fresh C-only test directory; its
first-run setup, config check, isolated tests and localhost API start all
passed. After a separate hash-verified C-only backup at
`<private-backup-root>\20260927-040000-local-scan-before`, an opt-in scanner
was added for local profile project folders. It never reads Y:/UNC roots,
does not auto-archive missing folders, and retains entry IDs through a unique
same-number rename; isolated unit and API tests exercise these boundaries.

The requested optional Cloudflare/watchdog stack is deliberately not enabled.
The original `--watch-loop` code is present only inside the guarded backend.
Five current host launchers were copied from the live share read-only as
inert `.txt` references, then moved to private
`<private-backup-root>\20260927-091000-private-host-reference` after their
real share/PC details were noticed inside the ignored candidate tree. They
are outside `<demo-root>` and the source ZIP. A 91.7-MB `node.exe` was copied
byte-identically into Git-ignored `app/node/` without execution; it is not
in the public source ZIP. No cloudflared binary or token was copied. The new
original-format synthetic DB has dummy notifications, but
locked unknown user passwords; it is not an operational replacement server.
This project does not yet contain a safe, ready-to-activate multi-PC hosting
implementation; editing a config token would **not** complete the shared
storage, takeover, hosted-auth and security gates. Do not describe this as a
fully deployable internet ERP until those pieces are actually built and tested.

The verified pre-security C-only backup is
`<private-backup-root>\20260926-203628-secure-local-before`. It includes the
prior generic SQLite DB and edited sources, with compared SHA-256 values.
The new secure-local API and Chrome tests write only fresh retained OS-temp
profiles. No production server, share, watchdog, or tunnel was changed.

Do **not** publish the separate `<private-profile-root>` folder or paste its
contents into issues, screenshots, or commits. Do not copy demo files back to
the production ERP.

## Latest C-only fresh-install check (2026-09-27)

The 97-file guarded-original-source review ZIP was verified against its
SHA-256 manifest and extracted to a new C-only installation directory.
First-run setup and config validation passed; all 18 isolated tests passed.
The extracted localhost server passed the read-only API and Chrome smoke
tests: all 25 menus and the synthetic GLB opened with zero JavaScript
exceptions. Its 97 packaged source files still matched their manifest after
testing, and the test server was stopped with no port-4777 listener. This is
fresh-install evidence for the **localhost demo**, not proof that the guarded
original backend or host launchers run safely.

## Latest synthetic gallery and privacy check (2026-09-27)

A new ignored C-only profile, seeded exclusively from the public example
config/logo/GLB/CSV and a one-line synthetic DXF, produced 25 menu screenshots
and four function captures. Chrome rendered the in-page synthetic GLB with
zero JavaScript exceptions; no record-submitting option was used. The old
empty project-browser image was moved to a C-only backup before its
replacement, not overwritten. The screenshot server is stopped.

The expanded source candidate contains 128 allowlisted files. A broader
identifier scan found a real project-name test fixture and one specific
folder exclusion in the guarded backend; both were replaced after separate
hash-verified C-only backups. Current known-identifier, private-IP,
key-marker and long-token scans show no hits. All 39 candidate PNGs contain
only image/data/end PNG chunks, with no text/EXIF/ICC metadata. The GLB JSON
contains a synthetic box and no external URI; the nested viewer ZIP's 17
text/source members had no known private marker hit. See
`PRIVACY-REVIEW.md` for precise scope and limitations. These checks do not
clear the exact source/screenshots for publication, nor make Cloudflare
hosting safe: config and connector setup alone still cannot run the guarded
original backend or provide secure multi-host operation.

The expanded 128-file source ZIP was verified member-by-member against its
manifest and current source, then extracted into a new C-only installation.
That extraction passed first-run setup, config validation, 18 isolated tests,
read-only API smoke, and Chrome's 25-menu/synthetic-GLB smoke with zero
JavaScript exceptions. Every extracted source hash still matched after the
tests, the test server was stopped, port 4777 had no listener, and the root
demo database hash was unchanged. This validates the localhost distribution
path only; it does not validate the disabled original backend or Cloudflare.

## Agent code review follow-up (2026-09-27)

The deeper C-only privacy pass found one realistic public IPv4 address used
as a security-panel example. It was replaced with a reserved documentation
address after the hash-verified backup at
`<private-backup-root>\20260927-110000-code-privacy-review-before`; the
second IP example was made consistent. The frontend cache-buster is now
`20260927-privacy-ip1`. A new test rejects non-documentation IPv4 literals
across allowlisted text files, and the isolated suite passes 19/19. The
viewer-source ZIP still matches its 17 on-disk members by SHA-256, and all
39 candidate PNGs contain only image/data/end chunks. Codex owns the code
review; the user's remaining review is the screenshot gallery. This does not
clear rightsholder scope, pixels, the exact future staged diff, or hosted
deployment. No live ERP process, share data or launcher was changed.

## English localhost gallery update (2026-09-27)

After the hash-verified C-only `20260927-english-ui-before` backup, the
localhost frontend gained a demo-only English presentation layer, English
fallback finance choices and English date/number display. The prior 39 PNGs
were hash-matched to the backup and moved individually into its
`original-images-moved` folder. All 39 replacement screenshots were captured
without overwriting any existing image from the isolated synthetic localhost
profile. Chrome checked all 25 menus, the GLB viewer, four function views,
several request/worklog edit actions, and the opt-in first-run/login flow.
No JavaScript exceptions were reported. `npm.cmd run check`, 19 isolated tests
and read-only API smoke passed. A known-private-marker scan returned zero
candidate-tree hits; the new PNGs contain only `IHDR`, `IDAT` and `IEND`
chunks. A visual sample shows generic English screenshots, but every new
image still needs the user's pixel review. The original backend remains
startup-disabled, hosted mode remains unavailable, and this tree is not
cleared for GitHub publication. No live Y: operation occurred.

The 129-file English source review ZIP was checked member-by-member against
its manifest and C-only working files, then extracted into a fresh local
directory. First-run setup, config validation, 19 isolated tests, read-only
API smoke, 25-menu/GLB English Chrome smoke, and secure first-run/login
Chrome smoke passed there. Its localhost `/SOURCE.zip` matched the reviewed
archive byte-for-byte, all 129 extracted source hashes stayed unchanged, and
the test server was stopped. This verifies the localhost distribution path,
not the disabled original backend, production parity, or publication safety.

A subsequent narrow C-only backup preceded English translations for common
hidden prompts, confirmations and status toasts. Chrome checked sample
dialog strings without performing delete/archive actions, then repeated the
25-menu/GLB/edit and secure-login smoke successfully. The earlier review ZIP
remains historical. The exact post-dialog tree is packaged for review as
`<private-backup-root>\workshop-erp-english-ui-final2-20260927.zip`, with
per-member SHA-256 verification. The gallery pixels were not changed by the
dialog-only patch; public release gates above remain open.

The user has since approved the current 39 English gallery images. This
clears only their visual-review item, not exact-file source/ownership review
or hosted security. The approval-only documentation revision is backed up at
`<private-backup-root>\20260927-gallery-approval-before` and the refreshed
129-file source snapshot is
`<private-backup-root>\workshop-erp-english-ui-gallery-approved-20260927.zip`.

## Exact C-only candidate audit after gallery approval (2026-09-27)

The current 129-file candidate set was staged into a separate temporary Git
index at `<private-backup-root>\20260927-final-audit.index` for comparison;
the normal Git index remains empty, and there is no commit or remote. Its
file set exactly matched the source ZIP allowlist. `git diff --cached --check`
flagged only one extra blank line at EOF in each of the three byte-identical
AGPL license copies; with that cosmetic check disabled, there were no other
whitespace findings. This was not a source or license edit.

The root AGPL license matches both viewer AGPL copies by SHA-256. The runtime
and editable-source three.js notices match each other, and contain the
installed three.js 0.160.0 MIT license text verbatim. The nested 17-member
viewer source ZIP matches its editable files member by member. Full and
production-only npm advisory audits of the pinned viewer dependency tree
reported zero vulnerabilities at check time. All 52 candidate JavaScript
files passed `node --check`; viewer unit tests passed 5/5. The known private
identifier scan found zero hits; URL/path review found only generic demo,
documentation, standards and package-registry destinations outside the
guarded backend. All 39 user-approved PNGs have valid structure and only
`IHDR`, `IDAT`, `IEND` chunks, with no embedded metadata. These checks
cannot prove absence of unknown private information.

The freshly extracted reviewed ZIP passed first-run setup, config check,
19/19 isolated tests, read-only API smoke, Chrome's 25 English menus and
synthetic GLB with zero JavaScript exceptions, and an isolated secure-local
first-run/logout/login flow. Every packaged source file retained its SHA-256
hash after testing. The localhost test server was stopped and port 4777 has
no listener. The docs-only audit update was preceded by a verified backup at
`<private-backup-root>\20260927-release-audit-notes-before`. The updated
129-file source review snapshot is
`<private-backup-root>\workshop-erp-release-audited-20260927.zip`.

Technical checks are now current for this exact **localhost demo**. The user
has since confirmed company permission for this exact guarded backend/Helper,
source and image set under AGPL-3.0-or-later. This confirmation is recorded
as an attestation, not independent legal verification. A final check of any
changed staged tree remains necessary before release. The preserved original
backend still cannot start; optional LAN/Cloudflare/watchdog hosting remains
unimplemented and must not be enabled from this package. The clarification
was recorded after a verified five-file C-only backup at
`<private-backup-root>\20260927-authorization-confirmation-before`; the
updated review snapshot is
`<private-backup-root>\workshop-erp-authorization-recorded-20260927.zip`.

## Single-file configuration and operational handoff (2026-09-27)

The source tree now has 130 explicitly allowlisted files, including
`ERP-HANDOFF.md`, which describes the real system as a company-wide
engineering/operations website and separates that architecture from the
localhost demo. The public `config.example.json` gained a
`futureHosting` reference section for organization, storage/project/import
paths, listener proposals, Cloudflare binary and token-*file* locations,
one-active-host watchdog, Helper and backup roots/retention. A separate
private C: profile records the known company-specific paths and users outside
Git; no token contents or passwords were read or copied. The section is
strictly validated, but neither applied nor exposed through `/api/state`;
the guarded backend does not use it. Attempts to mark it active or put a raw
token field there fail validation. The current localhost app remains
unchanged in network behavior.

These values are a migration contract, not an operational deployment:
the original backend still has fixed paths and a startup guard, generic host
operational launchers are absent (generic fail-closed wrappers are present),
and its backup/pruning, single-writer failover and
hosted authentication are unverified. The plan's trash-only backup policy
is **not** an implementation of the preserved backend's old pruning code.
Config-only and source-package isolated tests passed without starting any
second ERP server, tunnel or watchdog. No production share/database/process
was changed. Another company must complete the implementation and test it
on a disposable environment before enabling internet or multi-PC hosting.

## Generic host source wrappers (2026-09-27)

The root now includes generic files named `install-startup.bat`,
`watchdog-launcher.cmd`, `start-server.bat`, `stop-server.bat`,
`restart-server.bat`, and `cloudflare-launcher.cmd`. They call one C-only
`hosting/host-control.mjs` adapter. `hosting/host-plan.mjs` checks the
private single-file plan's path relationships and offers a pure mapping
comparison. It never reads the named share or token. Every operational
command refuses to act, even if the plan is complete; the original server's
startup throw remains. There is no Startup installation, process cleanup,
firewall change, host takeover, or tunnel launch in this public kit yet.
The old private launchers remain outside the repository. This is additional
reviewable source, **not** evidence that changing config makes hosting work.
The C-only source package now has 140 allowlisted files. Its review ZIP was
compared byte-for-byte with a fresh package built from the current source,
the isolated suite passed 23/23, and `cmd /c install-startup.bat` refused
the incomplete private config without installing anything. No listener was
started: only the pre-existing port-4780 process remained. A known-private-
identifier scan of publishable text found no hit. These are limited static
and localhost checks, not a hosted security or failover test.
