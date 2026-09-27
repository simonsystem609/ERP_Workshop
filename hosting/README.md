# Optional Windows host kit (staged, not active)

The root `install-startup.bat`, `watchdog-launcher.cmd`, `start-server.bat`,
`stop-server.bat`, `restart-server.bat`, and `cloudflare-launcher.cmd` are
generic wrappers. They use Node from `PATH` and the adjacent private
`config.json`; no company share, PC name, tunnel token, or credential is
embedded. They all call `host-control.mjs` and currently **refuse operational
actions**. They do not install a Startup entry, stop a process, change a
service/firewall, write to a share, or launch a server/tunnel. The original
private launchers are not included.

`host-plan.mjs` validates the single-file `futureHosting` path relationships
without opening the named share, database, token, binary, or network port. It
also provides a pure observed-mapping check for a future installer; a wrong or
unavailable mapping must prevent any launch. Inspect a private plan with:

```powershell
node hosting/host-control.mjs inspect --config C:\path\to\private\config.json
```

The public template deliberately has blank paths, so inspection reports
missing fields. A fully filled plan passing this static check is **not** a
deployment approval. The preserved `app/server.js` still throws at startup.
Its authentication bootstrap, fixed paths in several modules, deletion-based
backup/log cleanup, single-writer takeover, local Helper, and tunnel manager
need adaptation and disposable-share tests before any wrapper can become
operational. Do not remove its guard or bypass `host-control.mjs` to try it.
Keep the default `npm.cmd start` localhost demo off LAN and Cloudflare.

The final installer must be non-destructive: verify both live and registered
mapped-drive targets against the configured canonical UNC share, fail closed
if unavailable, move known displaced files only to the configured canonical
trash, never kill unrelated processes, and preserve existing Startup entries
unless their exact identity is established. The active host alone may run
Node's HTTP listener and cloudflared; standby PCs run only a watchdog.
