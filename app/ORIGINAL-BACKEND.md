# Preserved original ERP backend source — disabled

The files beside this note (`server.js`, its local modules, `package.json`,
and `helper/workshop-helper.ps1`) are a hash-checked, sanitized source copy of
the original ERP backend. They are included for adaptation and source review,
**not** used by the default localhost demo. `server.js` intentionally throws
before any imports, storage access, process cleanup, listener, or host loop.
Do not remove that guard and do not run `npm start` from this `app/` directory.

The original code still assumes a specific Y: share and project roots,
network listeners, host-lock/watchdog coordination, Cloudflare processes,
scheduled backup pruning, direct Helper access, and account bootstrap that
cannot accept a safe generic default password. A new SQLite file alone does
not isolate those effects. In particular, the original `install-startup.bat`
can stop processes, move local files, alter a service and change firewall
rules. It is not a generic installer.

The root `config.example.json` now has a validated `futureHosting`
reference plan for the paths, ports, token-file locations, one-host watchdog,
Helper and backup destinations a new company would need to choose. This
source copy does **not** consume that plan: `server.js`,
`storageSafety.js`, `cadModels.js` and the retained Helper still contain
fixed assumptions. The production launchers are not included; the root-level
generic wrappers run only a static inspector and refuse operational actions.
Do not remove
the startup guard after only editing config; adapt and review every affected
module and run isolated failover, recovery and security tests first. See
[`ERP-HANDOFF.md`](../ERP-HANDOFF.md) and
[`CUSTOMIZE.md`](../CUSTOMIZE.md).

`npm.cmd run original:fixture -- --out <new local absolute .db path>` at the
project root creates a fresh **synthetic** SQLite file using the original
collection/singleton schema. It reads only `config.example.json`, refuses an
existing destination, and seeds dummy in-app notifications but no push
subscriptions or tunnel keys. User password hashes are generated from random
unknown secrets and cannot be used to sign in. The original backend is still
not runnable; a first-run administrator setup and isolation of every external
path/host/backup action are required before it can replace `demo-server.mjs`.

The five current production batch launchers are retained privately outside
this public tree as `.txt` files under
`<private-backup-root>\20260927-091000-private-host-reference`. Their original
brand/share paths and destructive process/service commands are not part of
the public source allowlist. The new root wrappers contain none of those
operations; their actual installer/watchdog/connector work must still be
implemented and reviewed before use.
A copy of the shared `node.exe` is retained under ignored `app/node/` and was
hash-verified without execution. No Node or Cloudflare binary, token,
service, Startup entry or scheduled task is included in the public source
package.
