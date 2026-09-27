// Read-only smoke against the C-only localhost demo. Writes are covered by full-api.test.mjs.
import assert from "node:assert/strict";
import http from "node:http";

const base = "http://127.0.0.1:4777";
async function json(path, init) {
  const response = await fetch(`${base}${path}`, init);
  return { response, value: await response.json() };
}
const auth = await json("/api/auth");
assert.equal(auth.response.status, 200);
assert.equal(auth.value.user.name, "Demo User");
const initial = await json("/api/state");
assert.equal(initial.value.data.materialRequests.length >= 2, true);
assert.equal(initial.value.config.host, "127.0.0.1");

assert.equal((await json("/api/finance/state")).response.status, 200);
assert.equal((await json("/api/archive/state")).response.status, 200);
assert.equal((await fetch(`${base}/erp-glb-viewer/index.html`)).status, 200);
assert.equal((await fetch(`${base}/api/cadmodels/viewer-source`)).status, 200);
assert.equal((await fetch(`${base}/manifest.webmanifest`)).status, 200);
assert.equal((await fetch(`${base}/sw.js`)).status, 200);

assert.equal((await fetch(`${base}/config.json`)).status, 404);
assert.equal((await fetch(`${base}/app/server.js`)).status, 404);
assert.equal((await fetch(`${base}/api/cadmodels`)).status, 501);
assert.equal((await fetch(`${base}/images/logo.svg`)).status, 200);
const crossSite = await json("/api/material-requests", {
  method: "POST", headers: { "Content-Type": "application/json", Origin: "https://example.org" }, body: "{}"
});
assert.equal(crossSite.response.status, 403);
const badHost = await new Promise((resolve, reject) => {
  http.get({ host: "127.0.0.1", port: 4777, path: "/api/state", headers: { Host: "example.org" } }, (res) => { res.resume(); resolve(res.statusCode); }).on("error", reject);
});
assert.equal(badHost, 403);
console.log("API smoke OK: local state, finance, archive, viewer, PWA shell, and localhost isolation.");
