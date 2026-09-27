// Visual first-run/login smoke against a new OS-temp secure-local demo profile.
// It never visits production, changes the generic demo DB, or writes screenshots.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";

const root = path.dirname(import.meta.dirname);
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
if (!fs.existsSync(chrome)) throw new Error("Installed Chrome is required for this optional smoke test");
async function unusedPort() {
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-secure-browser-profile-"));
const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "erp-secure-browser-chrome-"));
fs.mkdirSync(path.join(profile, "images"));
fs.copyFileSync(path.join(root, "images", "logo.svg"), path.join(profile, "images", "logo.svg"));
const appPort = await unusedPort();
const debugPort = await unusedPort();
const base = `http://127.0.0.1:${appPort}`;
const config = JSON.parse(fs.readFileSync(path.join(root, "config.example.json"), "utf8"));
config.port = appPort;
config.security = { mode: "local-password" };
fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify(config), { flag: "wx" });
const password = "A-unique-browser-smoke-password-2026";
const server = spawn(process.execPath, [path.join(root, "demo-server.mjs"), "--config", path.join(profile, "config.json")], {
  cwd: root, windowsHide: true, stdio: "ignore"
});
let browser;
let socket;
let nextId = 0;
const pending = new Map();
const errors = [];
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(url, label) {
  for (let i = 0; i < 80; i++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await delay(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function cdp(method, params = {}) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15_000);
    pending.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const value = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (value.exceptionDetails) throw new Error(value.exceptionDetails.text || "Browser expression failed");
  return value.result?.value;
}
async function waitForUi(fragment) {
  let last = "";
  for (let i = 0; i < 80; i++) {
    last = await evaluate("document.querySelector('#app')?.innerText || ''");
    if (last.includes(fragment)) return;
    await delay(150);
  }
  const toast = await evaluate("document.querySelector('#toast')?.innerText || ''");
  throw new Error(`Browser did not show ${fragment}; last UI: ${last.slice(0, 300)}; toast: ${toast}; exceptions: ${errors.join('; ')}`);
}
async function assertEnglishUi(stage) {
  const accents = await evaluate(`(() => {
    const values = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (node.parentElement?.getClientRects().length) values.push(node.nodeValue);
    for (const el of document.querySelectorAll('option, textarea, [placeholder], [title], [aria-label]')) {
      values.push(el.tagName === 'TEXTAREA' ? el.value : el.tagName === 'OPTION' ? el.textContent : [el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('aria-label')].filter(Boolean).join(' '));
    }
    return [...new Set(values.map(x => x?.replace(/\\s+/g, ' ').trim()).filter(x => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/u.test(x)))];
  })()`);
  if (accents.length) throw new Error(`Untranslated ${stage} UI: ${accents.slice(0, 25).join(' | ')}`);
}
try {
  await waitFor(`${base}/api/auth`, "secure local server");
  browser = spawn(chrome, ["--headless=new", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-background-networking", `--user-data-dir=${chromeProfile}`,
    `--remote-debugging-port=${debugPort}`, "--remote-allow-origins=*", "about:blank"], { windowsHide: true, stdio: "ignore" });
  await waitFor(`http://127.0.0.1:${debugPort}/json/version`, "Chrome debugger");
  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: "PUT" });
  if (!targetResponse.ok) throw new Error(`Chrome tab failed: ${targetResponse.status}`);
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails?.text || "Browser exception");
    if (!message.id) return;
    const item = pending.get(message.id);
    if (!item) return;
    pending.delete(message.id); clearTimeout(item.timer);
    if (message.error) item.reject(new Error(message.error.message));
    else item.resolve(message.result || {});
  });
  await cdp("Page.enable");
  await cdp("Runtime.enable");
  await cdp("Page.navigate", { url: base });
  await waitForUi("Set up local administrator");
  await assertEnglishUi("first-run");
  await evaluate(`(() => { const f=document.querySelector('[data-action="setup-demo-admin"]'); f.elements.password.value=${JSON.stringify(password)}; f.elements.passwordAgain.value=${JSON.stringify(password)}; f.requestSubmit(); })()`);
  await waitForUi("General tasks");
  await assertEnglishUi("signed-in home");
  const first = await evaluate("({ user: currentUser?.id, csrf: authCsrfToken.length, secure: state?.config?.localAuthRequired })");
  if (first.user !== "demo-user" || first.csrf !== 64 || !first.secure) throw new Error("Secure setup did not establish the browser session");
  await cdp("Page.navigate", { url: `${base}/?view=stats` });
  await waitForUi("Personal password");
  await assertEnglishUi("secure Settings");
  const secureSettings = await evaluate("document.querySelector('#app')?.innerText || ''");
  if (!secureSettings.includes("Local password mode is active") || secureSettings.includes("Password login is off")) throw new Error(`Secure Settings text is inconsistent: ${secureSettings.slice(0, 800)}`);
  await evaluate("document.querySelector('#logout-button')?.click()");
  await waitForUi("Sign in");
  await assertEnglishUi("login");
  await evaluate(`(() => { const f=document.querySelector('[data-action="login"]'); f.elements.userId.value='demo-user'; f.elements.password.value=${JSON.stringify(password)}; f.requestSubmit(); })()`);
  await waitForUi("Local demo settings");
  if (await evaluate("currentUser?.id") !== "demo-user") throw new Error("Browser login did not restore the admin session");
  if (errors.length) throw new Error(`Browser exception: ${errors.join("; ")}`);
  console.log("Secure-local Chrome smoke OK: first-run setup, protected Settings, logout and login.");
} finally {
  try { socket?.close(); } catch {}
  browser?.kill();
  server.kill();
  console.log(`Isolated test profile retained at ${profile}`);
}
