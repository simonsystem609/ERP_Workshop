import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const base = resolve(fileURLToPath(new URL('../', import.meta.url)));
const browserPath = process.env.ERP_GLB_BROWSER || [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].find(existsSync);
if (!browserPath) throw new Error('Set ERP_GLB_BROWSER to a Chromium/Edge executable for the browser smoke test.');

const port = 42000 + Math.floor(Math.random() * 10000);
const url = `http://127.0.0.1:${port}/`;
const server = spawn(process.execPath, ['server.mjs'], {
  cwd: base,
  env: { ...process.env, ERP_GLB_VIEWER_PORT: String(port) },
  stdio: 'pipe',
});
let browser;
const waitForServer = async () => {
  for (let attempt = 0; attempt < 80; attempt++) {
    try { if ((await fetch(url)).ok) return; } catch {}
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Localhost test server did not start.');
};
const visibleFaces = async page => page.evaluate(() => {
  const viewer = window.erpGlbViewer;
  const rect = viewer.canvas.getBoundingClientRect();
  const faces = new Map();
  for (let yi = 2; yi <= 18; yi++) for (let xi = 2; xi <= 18; xi++) {
    const x = rect.left + rect.width * xi / 20;
    const y = rect.top + rect.height * yi / 20;
    const hit = viewer._raycastAt(x, y);
    if (!hit) continue;
    const patch = viewer._patchForHit(hit);
    if (!patch) continue;
    const key = `${hit.object.uuid}:${patch.patchIndex}`;
    const previous = faces.get(key) || [];
    previous.push({ x, y });
    faces.set(key, previous);
  }
  return [...faces.values()].sort((a, b) => b.length - a.length).map(points => points[Math.floor(points.length / 2)]);
});
const tap3 = async (page, point) => {
  for (let i = 0; i < 3; i++) await page.mouse.click(point.x, point.y);
};
const appearance = async page => page.evaluate(() => {
  const viewer = window.erpGlbViewer;
  const materials = [...viewer.materials.values()].flat();
  return {
    meshCount: viewer.getState().meshCount,
    nonNeutral: materials.filter(material => material.color.getHex() !== 0xb8bec8 ||
      material.metalness !== 0 || material.roughness !== 0.82 || material.map).length,
    sourceMaterials: viewer.importedMaterials.size,
    sourceTextures: viewer.importedTextures.size,
    distantMirrorNodes: viewer.gltfScene.children.reduce((count, object) => {
      object.traverse(node => { if (node.name.startsWith('Mirror') && node.position.x > 5) count++; });
      return count;
    }, 0),
  };
});

try {
  await waitForServer();
  browser = await chromium.launch({
    executablePath: browserPath,
    headless: true,
    args: ['--disable-gpu', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => window.erpGlbViewer?.getState().meshCount === 1);
  assert.equal((await appearance(page)).nonNeutral, 0, 'the sample displays without imported colors');
  assert.match(await page.locator('.erp-glb-status').textContent(), /sample\.glb/);
  const faces = await visibleFaces(page);
  assert.ok(faces.length >= 2, 'sample box exposes at least two visible faces');
  await page.locator('.erp-glb-measure-button').click();
  await tap3(page, faces[0]);
  assert.equal(await page.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 1);
  await tap3(page, faces[1]);
  assert.equal(await page.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 2);
  const measurement = await page.evaluate(() => {
    const panel = document.querySelector('.erp-glb-measure-panel');
    const badges = [...document.querySelectorAll('.erp-glb-measure-badge')];
    const stage = document.querySelector('.erp-glb-stage').getBoundingClientRect();
    return {
      panelWidth: panel.getBoundingClientRect().width,
      panelText: panel.textContent,
      badges: badges.map(badge => ({
        text: badge.textContent, visible: !badge.hidden,
        bounds: badge.getBoundingClientRect().toJSON(),
      })),
      stage: stage.toJSON(),
      leaders: [...document.querySelectorAll('.erp-glb-measure-leader')].map(line => line.getAttribute('visibility')),
    };
  });
  assert.ok(measurement.panelWidth <= 250, 'only a compact selection popup remains in the corner');
  assert.doesNotMatch(measurement.panelText, /Point-to-point|ΔX|ΔY|ΔZ/, 'measurements are not in the selection popup');
  assert.deepEqual(measurement.badges.map(badge => badge.visible), [true, true, true, true]);
  assert.match(measurement.badges.map(badge => badge.text).join(' '), /(?:Normal|N component).*ΔX.*ΔY.*ΔZ/s);
  assert.doesNotMatch(measurement.badges.map(badge => badge.text).join(' '), /Point-to-point/);
  assert.ok(measurement.badges.every(badge => badge.bounds.left >= measurement.stage.left &&
    badge.bounds.right <= measurement.stage.right &&
    badge.bounds.top >= measurement.stage.top &&
    badge.bounds.bottom <= measurement.stage.bottom), 'callouts remain inside the viewport');
  assert.deepEqual(measurement.leaders, ['visible', 'visible', 'visible', 'visible']);
  assert.equal(await page.locator('.erp-glb-measure-line').getAttribute('visibility'), 'visible');
  if (process.env.ERP_GLB_SCREENSHOT) await page.screenshot({ path: process.env.ERP_GLB_SCREENSHOT });
  await page.getByRole('button', { name: 'Change face 1' }).click();
  await tap3(page, faces.length > 2 ? faces[2] : faces[0]);
  assert.equal(await page.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 2);
  await page.getByRole('button', { name: 'Remove face 2' }).click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 1);

  const navigation = await page.evaluate(() => {
    const viewer = window.erpGlbViewer;
    return { q: viewer.viewQuaternion.toArray(), pivot: viewer.pivot.position.toArray() };
  });
  await page.mouse.move(faces[0].x, faces[0].y);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(faces[0].x + 65, faces[0].y + 25, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  const rotation = await page.evaluate(() => {
    const viewer = window.erpGlbViewer;
    const anchorAfter = viewer.dragOrbitLocal.clone().applyQuaternion(viewer.viewQuaternion).add(viewer.pivot.position);
    return { q: viewer.viewQuaternion.toArray(), anchorError: anchorAfter.distanceTo(viewer.dragOrbitWorld) };
  });
  assert.notDeepEqual(rotation.q, navigation.q);
  assert.ok(rotation.anchorError < 1e-8, `surface pivot should stay anchored (${rotation.anchorError})`);
  const menu = page.locator('.erp-glb-context-menu');
  await page.mouse.click(faces[0].x, faces[0].y, { button: 'right' });
  assert.equal(await menu.isVisible(), true, 'right-click opens the component menu');
  assert.equal(await page.evaluate(() => window.erpGlbViewer.selectedMeshes.size), 1);
  await menu.locator('[data-context-action="transparent"]').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.meshOpacity.get(window.erpGlbViewer.meshes[0])), 0.3);
  await page.mouse.click(faces[0].x, faces[0].y, { button: 'right' });
  assert.equal(await menu.locator('[data-context-action="transparent"]').textContent(), 'Restore solid');
  await menu.locator('[data-context-action="transparent"]').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.meshOpacity.get(window.erpGlbViewer.meshes[0])), 1);
  await page.mouse.click(faces[0].x, faces[0].y, { button: 'right' });
  await menu.locator('[data-context-action="hide"]').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.meshes[0].visible), false);
  await page.locator('.erp-glb-show-all').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.meshes[0].visible), true);
  const panBefore = await page.evaluate(() => window.erpGlbViewer.pivot.position.toArray());
  await page.mouse.move(faces[0].x, faces[0].y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(faces[0].x + 40, faces[0].y + 20, { steps: 4 });
  await page.mouse.up({ button: 'right' });
  assert.equal(await menu.isVisible(), false, 'right-drag keeps pan without opening the menu');
  assert.notDeepEqual(await page.evaluate(() => window.erpGlbViewer.pivot.position.toArray()), panBefore);
  await page.locator('.erp-glb-fit').click();
  const zoomPoint = (await visibleFaces(page))[0];
  assert.ok(zoomPoint, 'a visible surface is available for cursor-anchored zoom');
  const zoomBefore = await page.evaluate(point => {
    const viewer = window.erpGlbViewer;
    const hit = viewer._raycastAt(point.x, point.y);
    window.__zoomMesh = hit.object;
    window.__zoomLocal = hit.object.worldToLocal(hit.point.clone());
    window.__zoomNdc = hit.point.clone().project(viewer.camera).toArray();
    return { depth: viewer.dist - hit.point.z, radius: viewer.modelRadius };
  }, zoomPoint);
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  for (let i = 0; i < 45; i++) await page.mouse.wheel(0, -120);
  const zoomAfter = await page.evaluate(() => {
    const viewer = window.erpGlbViewer;
    viewer.camera.updateMatrixWorld(true);
    viewer.scene.updateMatrixWorld(true);
    const anchor = window.__zoomMesh.localToWorld(window.__zoomLocal.clone());
    const projected = anchor.clone().project(viewer.camera);
    return {
      depth: viewer.dist - anchor.z,
      near: viewer.camera.near,
      projected: projected.toArray(),
      originalProjection: window.__zoomNdc,
    };
  });
  assert.ok(zoomAfter.depth < zoomBefore.radius * 0.08,
    'zoom passes the former whole-assembly distance floor');
  assert.ok(zoomAfter.depth > zoomAfter.near, 'the zoom anchor stays in front of the near plane');
  assert.ok(Math.abs(zoomAfter.projected[0]) <= 1 && Math.abs(zoomAfter.projected[1]) <= 1,
    'the surface remains inside the viewport');
  assert.ok(Math.abs(zoomAfter.projected[0] - zoomAfter.originalProjection[0]) < 0.12 &&
    Math.abs(zoomAfter.projected[1] - zoomAfter.originalProjection[1]) < 0.12,
    'the same surface stays under the cursor during close zoom: ' + JSON.stringify(zoomAfter));
  const closeNavigation = await page.evaluate(point => {
    const viewer = window.erpGlbViewer;
    const centerDepth = viewer.dist - viewer.pivot.position.z;
    viewer._beginRotation(point.x, point.y);
    const navigationDepth = viewer.navigationDepth;
    const beforePan = viewer.pivot.position.clone();
    viewer._pan(20, 0);
    const panDistance = viewer.pivot.position.distanceTo(beforePan);
    const beforeAngle = viewer.viewQuaternion.clone();
    viewer._updateRotation(point.x + 20, point.y);
    const angle = beforeAngle.angleTo(viewer.viewQuaternion);
    return {
      centerDepth,
      navigationDepth,
      radius: viewer.modelRadius,
      panDistance,
      angle,
      stageHeight: viewer.stage.clientHeight,
      baselineAngle: 20 * 2 / Math.min(viewer.canvas.clientWidth, viewer.canvas.clientHeight),
    };
  }, zoomPoint);
  assert.ok(closeNavigation.navigationDepth < closeNavigation.radius * 0.16,
    'the picked surface reaches close-navigation range');
  assert.ok(closeNavigation.panDistance >=
    20 * 2 * Math.max(closeNavigation.centerDepth, closeNavigation.radius * 0.01) *
      Math.tan(Math.PI / 8) / closeNavigation.stageHeight * 1.2,
  'close pan is faster than the old whole-assembly-center scaling');
  assert.ok(closeNavigation.angle > closeNavigation.baselineAngle * 1.2,
    'close orbit is more responsive than fit-distance orbit');
  const depthBeforeZoomOut = await page.evaluate(() => window.erpGlbViewer.dist);
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 120);
  assert.ok(await page.evaluate(before => window.erpGlbViewer.dist > before, depthBeforeZoomOut),
    'zoom-out progresses from an extreme close view');
  const closePan = await page.evaluate(() => window.erpGlbViewer.pivot.position.toArray());
  await page.mouse.move(zoomPoint.x, zoomPoint.y);
  await page.mouse.down({ button: 'right' });
  await page.mouse.move(zoomPoint.x + 20, zoomPoint.y + 10, { steps: 2 });
  await page.mouse.up({ button: 'right' });
  assert.notDeepEqual(await page.evaluate(() => window.erpGlbViewer.pivot.position.toArray()), closePan,
    'right-drag pan still works after close zoom');
  assert.equal(await menu.isVisible(), false, 'right-drag does not open the context menu after zoom');
  await page.locator('.erp-glb-fit').click();
  await page.mouse.click(faces[0].x, faces[0].y, { button: 'right' });
  await menu.locator('[data-context-action="delete"]').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.deletedMeshes.has(window.erpGlbViewer.meshes[0])), true);
  assert.equal(await page.evaluate(() => window.erpGlbViewer.meshes[0].visible), false);
  await page.locator('.erp-glb-input-mode').click();
  assert.equal(await page.evaluate(() => window.erpGlbViewer.getState().inputMode), 'touch');
  assert.equal(await page.locator('.erp-glb-canvas').evaluate(element => getComputedStyle(element).touchAction), 'none');
  if (process.env.ERP_GLB_TEST_MODEL) {
    await page.locator('.erp-glb-file').setInputFiles(process.env.ERP_GLB_TEST_MODEL);
    await page.waitForFunction(() => window.erpGlbViewer?.getState().meshCount > 1);
    const real = await appearance(page);
    assert.ok(real.meshCount > 1, 'the supplied private GLB has renderable meshes');
    assert.equal(real.nonNeutral, 0, 'all source colors and metallic finishes are ignored for display');
    assert.ok(real.sourceMaterials > 0, 'original materials are retained only for cleanup');
    assert.ok(real.sourceTextures >= 0, 'texture count remains observable without assuming an export format');
    assert.ok(await page.evaluate(() => {
      const viewer = window.erpGlbViewer;
      return viewer.meshes.some(mesh => viewer.componentByMesh.get(mesh)?.userData.viewerMeshes?.length > 1);
    }), 'multi-primitive CAD nodes are grouped as one selectable component');
    const groupedSelection = await page.evaluate(() => {
      const viewer = window.erpGlbViewer;
      const mesh = viewer.meshes.find(item => viewer.componentByMesh.get(item)?.userData.viewerMeshes?.length > 1);
      const component = viewer.componentByMesh.get(mesh);
      const rect = viewer.stage.getBoundingClientRect();
      viewer._openContextMenu({ clientX: rect.left + 50, clientY: rect.top + 50 }, { object: mesh });
      return { expected: component.userData.viewerMeshes.length, selected: viewer.selectedMeshes.size };
    });
    assert.equal(groupedSelection.selected, groupedSelection.expected, 'a picked face selects every mesh of its CAD component');
    await page.locator('.erp-glb-fit').click();
    const realPoint = (await visibleFaces(page))[0];
    assert.ok(realPoint, 'the private GLB exposes a visible surface');
    const realZoom = await page.evaluate(point => {
      const viewer = window.erpGlbViewer;
      const hit = viewer._raycastAt(point.x, point.y);
      const localPoint = hit.object.worldToLocal(hit.point.clone());
      const before = viewer.dist - hit.point.z;
      for (let i = 0; i < 50; i++) viewer._zoomAt(point.x, point.y, 0.8);
      viewer.scene.updateMatrixWorld(true);
      const currentPoint = hit.object.localToWorld(localPoint);
      return { before, after: viewer.dist - currentPoint.z, radius: viewer.modelRadius };
    }, realPoint);
    assert.ok(realZoom.after < realZoom.radius * 0.08 && realZoom.after < realZoom.before,
      'the wide private assembly also zooms beyond the former whole-model limit');
  }
  assert.deepEqual(errors, []);
  await context.close();

  const touchContext = await browser.newContext({ viewport: { width: 650, height: 700 }, hasTouch: true, isMobile: true });
  const touchPage = await touchContext.newPage();
  touchPage.on('pageerror', error => errors.push(error.message));
  await touchPage.goto(url, { waitUntil: 'load' });
  await touchPage.waitForFunction(() => window.erpGlbViewer?.getState().meshCount === 1);
  await touchPage.evaluate(() => window.erpGlbViewer.setInputMode('touch'));
  const touchFaces = await visibleFaces(touchPage);
  assert.ok(touchFaces.length >= 1);
  for (let i = 0; i < 3; i++) await touchPage.touchscreen.tap(touchFaces[0].x, touchFaces[0].y);
  const touchMenu = touchPage.locator('.erp-glb-context-menu');
  assert.equal(await touchMenu.isVisible(), true, 'three taps open component actions outside Measure');
  assert.equal(await touchPage.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 0);
  const menuBounds = await touchPage.evaluate(() => {
    const menuRect = document.querySelector('.erp-glb-context-menu').getBoundingClientRect();
    const stageRect = document.querySelector('.erp-glb-stage').getBoundingClientRect();
    return menuRect.left >= stageRect.left && menuRect.top >= stageRect.top &&
      menuRect.right <= stageRect.right && menuRect.bottom <= stageRect.bottom;
  });
  assert.equal(menuBounds, true, 'touch menu stays inside the viewport');
  await touchMenu.locator('[data-context-action="transparent"]').click();
  assert.equal(await touchPage.evaluate(() => window.erpGlbViewer.meshOpacity.get(window.erpGlbViewer.meshes[0])), 0.3);
  await touchPage.locator('.erp-glb-measure-button').click();
  for (let i = 0; i < 3; i++) await touchPage.touchscreen.tap(touchFaces[0].x, touchFaces[0].y);
  assert.equal(await touchPage.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 1);
  assert.equal(await touchMenu.isVisible(), false, 'Measure triple-tap does not open component actions');
  assert.ok(touchFaces.length >= 2, 'touch viewport exposes two faces for a full measurement');
  for (let i = 0; i < 3; i++) await touchPage.touchscreen.tap(touchFaces[1].x, touchFaces[1].y);
  assert.equal(await touchPage.evaluate(() => window.erpGlbViewer.getState().selectedFaces), 2);
  assert.equal(await touchPage.locator('.erp-glb-measure-badge:not([hidden])').count(), 4,
    'touch measurement has four in-viewport readouts');
  assert.ok(await touchPage.evaluate(() => {
    const stage = document.querySelector('.erp-glb-stage').getBoundingClientRect();
    const panel = document.querySelector('.erp-glb-measure-panel').getBoundingClientRect();
    return panel.left >= stage.left && panel.right <= stage.right && panel.bottom <= stage.bottom;
  }), 'compact Measure popup stays inside the mobile viewport');
  const touchBefore = await touchPage.evaluate(() => window.erpGlbViewer.viewQuaternion.toArray());
  const session = await touchContext.newCDPSession(touchPage);
  const a = touchFaces[0];
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x + 50, y: a.y + 20, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const touchAfter = await touchPage.evaluate(() => window.erpGlbViewer.viewQuaternion.toArray());
  assert.notDeepEqual(touchAfter, touchBefore);
  const distBefore = await touchPage.evaluate(() => window.erpGlbViewer.dist);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x - 30, y: a.y, id: 1 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x - 30, y: a.y, id: 1 }, { x: a.x + 30, y: a.y, id: 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: a.x - 60, y: a.y + 10, id: 1 }, { x: a.x + 60, y: a.y + 10, id: 2 }] });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  const distAfter = await touchPage.evaluate(() => window.erpGlbViewer.dist);
  assert.ok(distAfter < distBefore, 'pinch out zooms in');
  assert.deepEqual(errors, []);
  await touchContext.close();
  process.stdout.write('Browser smoke passed: component context actions, face measurement, mouse pan/orbit, mode toggle, touch triple-tap/orbit/pinch.\n');
} finally {
  await browser?.close();
  server.kill();
}
