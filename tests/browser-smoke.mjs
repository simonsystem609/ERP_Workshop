// Dependency-free visual smoke test against the local demo only.
// Captures synthetic GitHub screenshots without ever opening the live ERP.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const base = "http://127.0.0.1:4777";
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = path.join(os.tmpdir(), "workshop-erp-demo-browser-smoke");
const screenshotDir = path.join(import.meta.dirname, "..", "docs", "images");
const port = 9234;
const refreshScreenshots = process.argv.includes("--refresh-screenshots");
const refreshOne = process.argv.find((arg) => arg.startsWith("--refresh-one="))?.slice("--refresh-one=".length) || "";
const writeSamples = process.argv.includes("--write-samples");
const checkViewer = process.argv.includes("--check-viewer");
const captureAllMenus = process.argv.includes("--capture-all-menus");
const auditUi = process.argv.includes("--audit-ui");
const checkEnglish = process.argv.includes("--check-english");
const uiFragments = new Set();
const uiOrigins = new Map();
const fullViews = [
  ["dashboard", "Home"], ["project-view", "Project overview"],
  ["cnc-summary", "CNC summary"], ["todos", "Tasks"],
  ["cnc", "CNC machining"], ["tools", "Tool requests"],
  ["materials", "Material requests"], ["fasteners", "Fastener requests"],
  ["worklog", "Work log"], ["bom", "BOM"],
  ["cad-models", "3D models"], ["suppliers", "Suppliers"],
  ["price-items", "Project prices"], ["cost-planning", "Project cost planning"],
  ["outsourcing", "Outsourcing / external operations"], ["production-items", "Production items"],
  ["design", "Engineering / Design"], ["quotes", "Quotes"],
  ["engineering-notes", "Engineering log"], ["production", "Production schedule"],
  ["finance-reports", "Reports"], ["projects", "Project management"],
  ["parameters", "Parameters"], ["stats", "Settings"],
  ["archive", "Archive"]
];
if (!fs.existsSync(chrome)) throw new Error("Installed Chrome not found");
if (!(await fetch(`${base}/api/auth`)).ok) throw new Error("Start the local demo first: npm.cmd start");

const browser = spawn(chrome, [
  "--headless=new", "--enable-unsafe-swiftshader", "--no-first-run", "--no-default-browser-check",
  "--disable-extensions", "--disable-background-networking", `--user-data-dir=${profile}`,
  `--remote-debugging-port=${port}`, "--remote-allow-origins=*", "about:blank"
], { windowsHide: true, stdio: "ignore" });
let socket;
let nextId = 0;
const pending = new Map();
const errors = [];
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function waitForDebugger() {
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* Chrome not listening yet */ }
    if (browser.exitCode !== null) throw new Error(`Chrome exited: ${browser.exitCode}`);
    await delay(250);
  }
  throw new Error("Chrome DevTools did not start in 15 seconds");
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
  const result = await cdp("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser expression failed");
  return result.result?.value;
}
async function waitForText(fragment) {
  for (let i = 0; i < 50; i++) {
    const content = await evaluate("document.querySelector('#app')?.innerText || ''");
    if (content.includes(fragment)) return content;
    await delay(200);
  }
  throw new Error(`Browser did not render ${fragment}`);
}
async function collectUi() {
  if (!auditUi && !checkEnglish) return;
  const values = await evaluate(`(() => {
    const found = new Map();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !parent.getClientRects().length) continue;
      const value = node.nodeValue.replace(/\\s+/g, ' ').trim();
      if (value && !found.has(value)) found.set(value, parent.outerHTML.slice(0, 180));
    }
    for (const element of document.querySelectorAll('[placeholder], [title], [aria-label]')) {
      if (!element.getClientRects().length) continue;
      for (const key of ['placeholder', 'title', 'aria-label']) {
        const value = element.getAttribute(key)?.replace(/\\s+/g, ' ').trim();
        if (value && !found.has(value)) found.set(value, element.outerHTML.slice(0, 180));
      }
    }
    for (const element of document.querySelectorAll('option, textarea, input[type=button], input[type=submit], input[type=reset]')) {
      const value = (element.tagName === 'TEXTAREA' ? element.value : element.tagName === 'INPUT' ? element.value : element.textContent)?.replace(/\\s+/g, ' ').trim();
      if (value && !found.has(value)) found.set(value, element.outerHTML.slice(0, 180));
    }
    return [...found];
  })()`);
  for (const [value, origin] of values) {
    uiFragments.add(value);
    if (!uiOrigins.has(value)) uiOrigins.set(value, origin);
  }
}
async function captureNew(relativeName) {
  const output = path.join(screenshotDir, relativeName);
  if (!output.startsWith(`${screenshotDir}${path.sep}`)) throw new Error("Screenshot path escaped docs/images");
  if (fs.existsSync(output)) {
    console.log(`Screenshot preserved: ${output}`);
    return;
  }
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.writeFileSync(output, Buffer.from(shot.data, "base64"), { flag: "wx" });
  console.log(`Screenshot captured: ${output}`);
}
async function visit(view, title, imageName) {
  await cdp("Page.navigate", { url: `${base}/?view=${view}` });
  const content = await waitForText(title);
  if (content.includes("Betoltesi hiba") || content.includes("ERP betoltesi hiba")) throw new Error(`ERP startup failed on ${view}`);
  await delay(400);
  const output = path.join(screenshotDir, imageName);
  if (!fs.existsSync(output) || refreshScreenshots || refreshOne === imageName) {
    const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(output, Buffer.from(shot.data, "base64"), { flag: refreshScreenshots || refreshOne === imageName ? "w" : "wx" });
  }
  console.log(`${view}: ${content.slice(0, 90).replace(/\s+/g, " ")} -> ${output}`);
}
try {
  await waitForDebugger();
  const response = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
  if (!response.ok) throw new Error(`Cannot create Chrome test tab: ${response.status}`);
  const target = await response.json();
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
  await cdp("Network.enable");
  await cdp("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp("Runtime.enable");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  await visit("dashboard", "General tasks", "dashboard.png");
  await visit("materials", "Material requests", "materials.png");
  const draftLink = await evaluate("(() => { setPendingRequestAttachmentLink('material', 'documents/sample.pdf'); return getPendingRequestAttachment('material')?.path || ''; })()");
  if (draftLink !== "documents/sample.pdf") throw new Error("Local request attachment path was rejected by the browser UI");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1000, deviceScaleFactor: 1, mobile: false });
  await visit("worklog", "Log work time", "worklog.png");
  await visit("suppliers", "Add supplier", "suppliers.png");
  await visit("projects", "Add project", "projects.png");
  await visit("stats", "Local demo settings", "settings.png");
  const helperGuard = await evaluate("(() => { try { helperBaseUrl(); return 'unexpected-helper-url'; } catch (error) { return error.message; } })()");
  if (!helperGuard.includes("nem kapcsolódik a telepített Helperhez")) throw new Error("Demo browser could contact the installed local Helper");
  await visit("cad-models", "3D models", "cad-models.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 420, height: 900, deviceScaleFactor: 1, mobile: true });
  await visit("materials", "Material requests", "materials-mobile.png");
  await cdp("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
  for (const [view, label] of fullViews) {
    await cdp("Page.navigate", { url: `${base}/?view=${view}` });
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const page = await evaluate("({ title: document.querySelector('#view-title')?.textContent, content: document.querySelector('#app')?.innerText || '' })");
      if (page.title === label && page.content && !page.content.includes("adatok betöltése") && !page.content.includes("Loading data")) { ready = true; break; }
      await delay(150);
    }
    if (!ready) throw new Error(`Full menu did not render: ${view}`);
    await collectUi();
    if (captureAllMenus) {
      const ribbon = await evaluate("document.querySelector('.demo-ribbon')?.innerText || ''");
      if (!ribbon.includes("LOCAL DEMO") || !ribbon.includes("synthetic data")) {
        throw new Error(`Screenshot target is not the synthetic demo: ${view}`);
      }
      await delay(300);
      await captureNew(`menus/${String(fullViews.findIndex(([name]) => name === view) + 1).padStart(2, "0")}-${view}.png`);
    }
    if (view === "archive") {
      const archive = await evaluate("({ html: document.querySelector('#app')?.innerHTML || '', text: document.querySelector('#app')?.innerText || '' })");
      if (archive.html.includes('data-action="purge-archive"') || archive.html.includes('data-action="purge-selected-archives"')
          || !archive.text.includes("not permanently deleted")) {
        throw new Error("Demo archive still exposes permanent deletion or production-only wording");
      }
    }
  }
  if (captureAllMenus) {
    await cdp("Page.navigate", { url: `${base}/?view=worklog` });
    await waitForText("Log work time");
    await evaluate("document.querySelector('[data-action=\"open-worklog-fullscreen\"]')?.click()");
    let fullscreenReady = false;
    for (let i = 0; i < 30; i++) {
      if (await evaluate("Boolean(document.querySelector('.worklog-fullscreen-modal'))")) { fullscreenReady = true; break; }
      await delay(150);
    }
    if (!fullscreenReady) throw new Error("Worklog fullscreen did not open");
    await collectUi();
    await captureNew("functions/worklog-fullscreen.png");
  }
  await cdp("Page.navigate", { url: `${base}/?view=project-view` });
  await waitForText("Project browser");
  await evaluate("openProjectBrowser('demo-project-a')");
  let localBrowserReady = false;
  for (let i = 0; i < 40; i++) {
    const dialog = await evaluate("document.querySelector('.project-browser-modal')?.innerText || ''");
    if (dialog.includes("documents/projects/") && dialog.includes("DEMO-001 Conveyor Prototype")) { localBrowserReady = true; break; }
    await delay(150);
  }
  if (!localBrowserReady) throw new Error("Profile-local project browser did not open in Chrome");
  await collectUi();
  if (captureAllMenus) await captureNew("functions/project-browser.png");
  await cdp("Page.navigate", { url: `${base}/?view=stats` });
  await waitForText("Local demo settings");
  await evaluate("document.querySelector('[data-action=\"open-demo-modelling\"]')?.click()");
  const modellingPage = await waitForText("Upload photos");
  if (!modellingPage.includes(".demo-data/modelling/") || modellingPage.includes("Y:\\")) {
    throw new Error("Demo modelling page did not use the profile-local folder");
  }
  await collectUi();
  if (captureAllMenus) await captureNew("functions/modelling.png");
  const modellingImage = path.join(screenshotDir, "modelling.png");
  if (!fs.existsSync(modellingImage) || refreshScreenshots || refreshOne === "modelling.png") {
    const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.writeFileSync(modellingImage, Buffer.from(shot.data, "base64"), { flag: refreshScreenshots || refreshOne === "modelling.png" ? "w" : "wx" });
  }
  await evaluate("document.querySelector('[data-action=\"exit-demo-modelling\"]')?.click()");
  await waitForText("Local demo settings");
  if (checkViewer) {
    await cdp("Page.navigate", { url: `${base}/?view=cad-models` });
    await waitForText("Synthetic_Box.SLDASM");
    await evaluate("document.querySelector('[data-action=\"open-cad-model\"]')?.click()");
    let modelLoaded = false;
    for (let i = 0; i < 80; i++) {
      const state = await evaluate("document.querySelector('.cad-viewer-frame')?.contentWindow?.erpGlbViewer?.getState?.() || null");
      if (state?.meshCount > 0) { modelLoaded = true; break; }
      await delay(250);
    }
    if (!modelLoaded) {
      const status = await evaluate("document.querySelector('.cad-viewer-frame')?.contentWindow?.document?.querySelector('.erp-glb-status')?.textContent || ''");
      throw new Error(`Synthetic GLB did not render: ${status}`);
    }
    await collectUi();
    if (captureAllMenus) await captureNew("functions/model-viewer.png");
    const viewerImage = path.join(screenshotDir, "model-viewer.png");
    if (!fs.existsSync(viewerImage) || refreshScreenshots) {
      const shot = await cdp("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      fs.writeFileSync(viewerImage, Buffer.from(shot.data, "base64"), { flag: refreshScreenshots ? "w" : "wx" });
    }
    console.log("Synthetic GLB rendered in the in-page viewer.");
  }
  if (checkEnglish) {
    for (const [view, readyText, selector] of [
      ["dashboard", "General tasks", '[data-action="personal-tasks"]'],
      ["materials", "New material request", '[data-action="edit-material"][data-id]'],
      ["tools", "New tool request", '[data-action="edit-tool"][data-id]'],
      ["fasteners", "New fastener request", '[data-action="edit-fastener"][data-id]'],
      ["worklog", "Log work time", '[data-action="edit-worklog"][data-id]']
    ]) {
      console.log(`English action audit: ${view} ${selector}`);
      await cdp("Page.navigate", { url: `${base}/?view=${view}` });
      await waitForText(readyText);
      const opened = await evaluate(`(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button) return false; button.click(); return true; })()`);
      if (!opened) throw new Error(`Missing English-audit action: ${view} ${selector}`);
      await delay(200);
      await collectUi();
      console.log(`English action audited: ${view}`);
    }
  }
  if (writeSamples) {
    await cdp("Page.navigate", { url: `${base}/?view=materials` });
    await waitForText("New material request");
    await evaluate(`(() => {
    const form = document.querySelector('form[data-action="add-material-request"]');
    form.querySelector('[name="material"]').value = 'UI smoke material';
    form.querySelector('[name="size"]').value = '25 mm';
    form.querySelector('[name="length"]').value = '1500';
    form.querySelector('[name="quantity"]').value = '2';
    form.querySelector('[data-project-id]').value = 'demo-project-a';
    form.querySelector('[data-project-picker-input]').value = 'DEMO-001 Conveyor Prototype';
    form.requestSubmit();
    return true;
  })()`);
    await waitForText("UI smoke material");
    await cdp("Page.navigate", { url: `${base}/?view=worklog` });
    await waitForText("Log work time");
    await evaluate(`(() => {
    const form = document.querySelector('form[data-action="add-worklog"]');
    form.querySelector('[name="hours"]').value = '1.5';
    form.querySelector('[name="note"]').value = 'UI smoke worklog';
    form.querySelector('[data-project-id]').value = 'demo-project-a';
    form.querySelector('[data-project-picker-input]').value = 'DEMO-001 Conveyor Prototype';
    form.requestSubmit();
    return true;
  })()`);
    await waitForText("UI smoke worklog");
  }
  const result = await evaluate("({ title: document.title, nav: [...document.querySelectorAll('.nav-button')].map(x => x.innerText), logo: document.querySelector('.brand img')?.getAttribute('src'), ribbon: document.querySelector('.demo-ribbon')?.innerText })");
  if (result.logo !== "/images/logo.svg" || !result.ribbon?.includes("LOCAL DEMO")) throw new Error("Demo branding failed");
  if (result.nav.length !== fullViews.length) throw new Error(`Expected ${fullViews.length} menu links, found ${result.nav.length}`);
  if (errors.length) throw new Error(`Browser JavaScript exceptions: ${errors.join("; ")}`);
  if (checkEnglish) {
    const leftover = [...uiFragments].filter((value) => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/u.test(value));
    if (leftover.length) throw new Error(`Untranslated visible UI fragments (${leftover.length}): ${leftover.slice(0, 80).map((value) => `${value} @ ${uiOrigins.get(value)}`).join(" | ")}`);
    if (await evaluate("document.documentElement.lang") !== "en") throw new Error("Demo document language is not English");
    const edgeDialogs = await evaluate(`(() => {
      const translate = globalThis.ERP_ENGLISH_UI?.translate;
      if (!translate) return null;
      return [
        translate('A helyi admin beállítva.'),
        translate('Demo User új jelszava'),
        translate('Tényleg törlöd?\\n\\nExample\\n\\nA művelet nem visszavonható.'),
        translate('A(z) 1. prioritás már foglalt: Demo A\\n\\nÁtadod ezt a prioritást és átrendezed a többit?'),
        translate('Eltávolítjuk a modellt a listából? Az elérhető GLB és JSON fájlokat a helyi .demo-data/trash mappába mozgatjuk; a már hiányzó fájlok nem okoznak hibát.\\n\\nSynthetic box')
      ];
    })()`);
    if (!edgeDialogs || edgeDialogs.some((value) => /[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/u.test(value))) {
      throw new Error(`Untranslated demo dialog: ${JSON.stringify(edgeDialogs)}`);
    }
  }
  if (auditUi) console.log(`AUDIT_UI=${JSON.stringify([...uiFragments].sort((a, b) => a.localeCompare(b, "hu-HU")))}`);
  console.log(`Browser smoke OK: ${result.title}, ${result.nav.length} demo menus, zero JS exceptions.`);
} finally {
  try { socket?.close(); } catch { /* no-op */ }
  browser.kill();
}
