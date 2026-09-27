# Provenance and licensing review — AGPL selected, release gates remain

This is a technical inventory, **not** legal advice or permission to publish.

| Component | Observed provenance / license status | Initial public demo disposition |
| --- | --- | --- |
| ERP core frontend (`app/public/app.js`, HTML, CSS) | De-branded copy of the company's private ERP. The user confirmed company permission covers this exact C-only candidate under AGPL-3.0-or-later on 2026-09-27. AI-assisted authorship used a company account. This is a user attestation, not independent legal verification. | Root `LICENSE` contains the full AGPLv3 text. Review the exact final staged tree before publishing. |
| Guarded backend and Helper source (`app/server.js` and peers) | Derived from the private ERP and initially copied from the retained sanitized C-only reference. The C-only `server.js` then had one concrete folder exclusion removed for privacy; the startup throw remains. The user confirmed this copied backend/Helper is within the company's permission for the exact candidate. | Included in the candidate source ZIP for review, not in the running demo. Do not run the guarded server; review any changed final release files. |
| Host launchers and Node/cloudflared runtime | Five current batch launchers were copied read-only as inert `.txt`, then moved outside this public tree to private `<private-backup-root>\20260927-091000-private-host-reference`; they contain original share/PC process and service commands. New root `.bat`/`.cmd` wrappers and `hosting/` inspector are generic, fail-closed source, not copies of those private scripts. A hash-matched Node executable is retained under ignored `app/node/`, but was not run. No Cloudflare executable or token was copied. | The private launcher references and binaries are excluded. Generic wrappers are included under the ERP AGPL but cannot install or start a host. Distribution of any Node runtime needs separate packaging/notice review. |
| `demo-server.mjs`, `demo-store.mjs`, `demo-auth.mjs`, `xlsx-demo.mjs`, generic config/logo, synthetic screenshots/model | Newly authored for this local demo. They do not transfer rights in the copied ERP frontend. The user approved the current 39 English screenshots and confirmed company permission covers this exact candidate. | Covered by the selected root AGPL license; re-review changed files or images before release. |
| `app/public/erp-glb-viewer` and `app/vendor/erp-glb-viewer-source` | Matching build/source/license restored from the local archive. Bundled license says AGPL-3.0-or-later. The user states the earlier viewer was their own Codex-assisted work and approves this derivative and source. The source ZIP was byte-hash compared with the on-disk source. | Included with its source ZIP and AGPL notices. The bundled three.js MIT notice matches the installed package; recheck any changed release. |
| three.js r160 and esbuild 0.25.12 | Their official repositories carry MIT license notices. The browser bundle contains three.js; the full r160 notice is included in both viewer source and runtime. esbuild is a build-time tool, not bundled in the browser runtime. | Keep the notices and verify the exact dependency tree at release. |
| Optional Tesseract OCR | External CLI and language data are not bundled. The local adapter invokes a user-configured executable only when explicitly enabled. The official Tesseract project states Apache-2.0 for its engine; an installer may have additional dependency notices. | No third-party OCR binary/model enters this source package. Review any separately supplied OCR installation and its notices. |

The [OpenAI business agreement, section 4.1](https://openai.com/policies/services-agreement/)
addresses output ownership between Customer and OpenAI, subject to law. The
user explicitly confirmed company publication permission for this exact
C-only candidate and chose AGPL-3.0-or-later for it. The root `LICENSE` is
byte-identical to the existing viewer AGPL license. The
[GNU AGPL license](https://www.gnu.org/licenses/agpl-3.0.en.html)
has network-use/source-offer obligations. The localhost app now offers an
explicitly allowlisted whole-ERP source ZIP from `/SOURCE.zip` on login and
main screens; its exact contents and any future hosted deployment still need
review. The user confirmed viewer derivative
ownership and redistribution approval on 2026-09-26; these are user
attestations, not independent legal determinations. See the official
[three.js MIT notice](https://github.com/mrdoob/three.js/blob/dev/LICENSE)
and [esbuild MIT notice](https://github.com/evanw/esbuild/blob/main/LICENSE.md).
The optional OCR integration follows the official
[Tesseract command-line interface](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
and does not redistribute its engine or language data.

The user explicitly confirmed on 2026-09-27 that company publication
permission covers the exact C-only 129-file candidate, including the guarded
backend/Helper source and approved images under the chosen AGPL-3.0-or-later
license. This is a user attestation about rightsholder scope, not an
independent legal determination. The copied viewer derivative was separately
confirmed as the user's own work. The current license/notice/source bundle
passed the technical checks in `PUBLICATION-STATUS.md`; any changed final
commit still needs an exact-file privacy and corresponding-source review.
Adding a license file alone would not have cleared those gates.
