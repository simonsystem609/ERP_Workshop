import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { buildFacePatches, geometryForPatch, measureFaces } from './face-patches.mjs';
import { validateSelfContainedGlb, MAX_GLB_BYTES } from './glb-guard.mjs';

const MOUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 2v8"/></svg>';
const TOUCH_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 13V5a2 2 0 0 1 4 0v6"/><path d="M13 9a2 2 0 0 1 4 0v3"/><path d="M17 11a2 2 0 0 1 3 1.7v4.1c0 2.9-2.3 5.2-5.2 5.2h-2.7a5 5 0 0 1-3.8-1.8L5 16.5a2 2 0 0 1 3-2.7l1 1.1"/></svg>';
const UNIT_SCALE = { m: 1, cm: 0.01, mm: 0.001 };
const byClass = (root, className) => root.querySelector(`.${className}`);
const formatMm = value => `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 3 })} mm`;

function neutralDisplayMaterial(source) {
  const opacity = Number.isFinite(source?.opacity) ? source.opacity : 1;
  return new THREE.MeshStandardMaterial({
    color: 0xb8bec8,
    metalness: 0,
    roughness: 0.82,
    side: source?.side ?? THREE.FrontSide,
    opacity,
    transparent: opacity < 0.999,
    depthWrite: opacity >= 0.999,
  });
}

const TEMPLATE = `
  <header class="erp-glb-header">
    <b class="erp-glb-title">ERP GLB viewer</b>
    <span class="erp-glb-subtitle">3D model</span>
    <button type="button" class="erp-glb-components-button" aria-expanded="false">Components</button>
    <label class="file-button" for="erp-glb-file">Open GLB...</label>
    <input id="erp-glb-file" class="erp-glb-file" type="file" accept=".glb,model/gltf-binary">
    <button type="button" class="erp-glb-fit" title="Fit visible components">Fit</button>
    <button type="button" class="erp-glb-edges" aria-pressed="true" title="Toggle model edges">Edges</button>
    <button type="button" class="erp-glb-measure-button" aria-pressed="false" title="Select two faces for measurement">Measure</button>
    <span class="erp-glb-status" role="status">Open a GLB or try sample.glb.</span>
    <div class="erp-glb-header-end">
      <button type="button" class="erp-glb-input-mode" title="Input mode" aria-label="Input mode"></button>
    </div>
  </header>
  <div class="erp-glb-workspace">
    <aside class="erp-glb-tree-panel">
      <div class="erp-glb-panel-title"><strong>Components</strong><span class="erp-glb-selection-count">0 selected</span></div>
      <div class="erp-glb-tree-actions">
        <button type="button" class="erp-glb-hide" title="Hide selected components">Hide</button>
        <button type="button" class="erp-glb-isolate" title="Show only selected components">Isolate</button>
        <button type="button" class="erp-glb-show-all" title="Show all hidden components">Show all</button>
        <button type="button" class="erp-glb-delete" title="Remove selected components from this view">Delete</button>
      </div>
      <div class="erp-glb-opacity-controls">
        <label><span>Model</span><input class="erp-glb-model-opacity" type="range" min="0.05" max="1" step="0.05" value="1"><output class="erp-glb-model-opacity-value">100%</output></label>
        <label><span>Selected</span><input class="erp-glb-selected-opacity" type="range" min="0.05" max="1" step="0.05" value="1" disabled><output class="erp-glb-selected-opacity-value">-</output></label>
      </div>
      <div class="erp-glb-tree"><div class="erp-glb-tree-empty">No model loaded</div></div>
    </aside>
    <div class="erp-glb-stage">
      <canvas class="erp-glb-canvas" tabindex="0" aria-label="3D model viewport"></canvas>
      <div class="erp-glb-hint"><b>Drop a GLB here</b>or use Open GLB...</div>
      <svg class="erp-glb-annotation" aria-hidden="true"><line class="erp-glb-measure-line"/><line class="erp-glb-measure-leader" data-measure="normal"/><line class="erp-glb-measure-leader" data-measure="x"/><line class="erp-glb-measure-leader" data-measure="y"/><line class="erp-glb-measure-leader" data-measure="z"/><circle class="erp-glb-measure-dot-a" r="6"/><circle class="erp-glb-measure-dot-b" r="6"/></svg>
      <div class="erp-glb-measure-callouts" aria-live="polite">
        <div class="erp-glb-measure-badge normal" data-measure="normal" hidden></div>
        <div class="erp-glb-measure-badge axis-x" data-measure="x" hidden></div>
        <div class="erp-glb-measure-badge axis-y" data-measure="y" hidden></div>
        <div class="erp-glb-measure-badge axis-z" data-measure="z" hidden></div>
      </div>
      <button type="button" class="erp-glb-touch-roll" aria-pressed="false" title="Use one-finger drag to roll the view">Roll</button>
      <div class="erp-glb-context-menu" role="menu" aria-label="Component actions" hidden>
        <strong class="erp-glb-context-name"></strong>
        <button type="button" role="menuitem" data-context-action="hide">Hide</button>
        <button type="button" role="menuitem" data-context-action="delete">Delete from view</button>
        <button type="button" role="menuitem" data-context-action="transparent">Transparent</button>
        <small>View only · the GLB file is unchanged.</small>
      </div>
      <section class="erp-glb-measure-panel" aria-label="Face measurement" hidden>
        <div class="erp-glb-measure-heading"><strong>Measure</strong><button type="button" class="erp-glb-measure-close" aria-label="Close measurement">×</button></div>
        <p class="erp-glb-measure-help">Triple-click/tap two faces.</p>
        <div class="erp-glb-face-list"></div>
        <label class="erp-glb-measure-settings">Source model units
          <select class="erp-glb-source-unit" aria-label="Source model units">
            <option value="m">m (glTF)</option>
            <option value="cm">cm</option>
            <option value="mm">mm</option>
          </select>
        </label>
      </section>
    </div>
  </div>`;

class ERPGlbViewer {
  constructor(root, options = {}) {
    if (!(root instanceof HTMLElement)) throw new TypeError('Viewer root must be an HTML element.');
    this.root = root;
    root.classList.add('erp-glb-viewer');
    root.innerHTML = TEMPLATE;
    this.canvas = byClass(root, 'erp-glb-canvas');
    this.stage = byClass(root, 'erp-glb-stage');
    this.contextMenu = byClass(root, 'erp-glb-context-menu');
    this.status = byClass(root, 'erp-glb-status');
    this.tree = byClass(root, 'erp-glb-tree');
    this.treePanel = byClass(root, 'erp-glb-tree-panel');
    this.measurePanel = byClass(root, 'erp-glb-measure-panel');
    this.annotation = byClass(root, 'erp-glb-annotation');
    this.measureBadges = [...root.querySelectorAll('.erp-glb-measure-badge')];
    this.measureLeaders = [...root.querySelectorAll('.erp-glb-measure-leader')];
    this.loader = new GLTFLoader();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e6);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8f777c, 0.65));
    const light1 = new THREE.DirectionalLight(0xffffff, 0.65);
    light1.position.set(1, 1.5, 1);
    this.scene.add(light1);
    const light2 = new THREE.DirectionalLight(0xffffff, 0.25);
    light2.position.set(-1, -0.6, -1);
    this.scene.add(light2);
    this.pivot = new THREE.Group();
    this.scene.add(this.pivot);
    this.modelRoot = null;
    this.gltfScene = null;
    this.meshes = [];
    this.edgeObjects = [];
    this.materials = new Map();
    this.importedMaterials = new Set();
    this.importedTextures = new Set();
    this.stateMaterials = [];
    this.ownedEdgeGeometries = [];
    this.edgeMaterial = new THREE.LineBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.8, depthWrite: false });
    this.selectedMeshes = new Set();
    this.hiddenMeshes = new Set();
    this.deletedMeshes = new Set();
    this.meshOpacity = new Map();
    this.componentByMesh = new Map();
    this.contextMeshes = [];
    this.contextTapSequence = null;
    this.modelOpacity = 1;
    this.faceCache = new WeakMap();
    this.faces = [null, null];
    this.replaceSlot = null;
    this.tapSequence = null;
    this.measuring = false;
    this.touchRoll = false;
    this.touches = new Map();
    this.touchGesture = null;
    this.touchHadMulti = false;
    this.pointerAction = null;
    this.pointerMoved = false;
    this.dist = 3;
    this.modelRadius = 1;
    this.defaultViewEuler = new THREE.Euler(-0.5, 0.6, 0);
    this.viewQuaternion = new THREE.Quaternion().setFromEuler(this.defaultViewEuler);
    this.rotationDelta = new THREE.Quaternion();
    this.rotationAxis = new THREE.Vector3();
    this.viewAxis = new THREE.Vector3(0, 0, 1);
    this.dragInverseQuaternion = new THREE.Quaternion();
    this.dragOrbitWorld = new THREE.Vector3();
    this.dragOrbitLocal = new THREE.Vector3();
    this.rotatedOrbitLocal = new THREE.Vector3();
    this.zoomPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this.zoomAnchor = new THREE.Vector3();
    this.zoomReference = null;
    this.navigationDepth = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.renderPending = false;
    this.loadGeneration = 0;
    this.fetchAbort = null;
    this.destroyed = false;
    this.modelName = null;
    this.sourceUnit = 'm';
    this.inputMode = options.inputMode === 'touch' || options.inputMode === 'mouse'
      ? options.inputMode : (matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse');
    this._setInputModeUI();
    this.setSourceUnit(options.sourceUnit || 'm');
    try {
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true });
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.setClearColor(0xf7eded, 1);
    } catch (error) {
      this._status(`WebGL unavailable: ${error.message}`);
      this.renderer = null;
    }
    this._bindControls();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.stage);
    this.resize();
    this._refreshControls();
    this._refreshMeasureUI();
  }

  _status(message) { this.status.textContent = message; }

  _setInputModeUI() {
    this.root.dataset.inputMode = this.inputMode;
    const button = byClass(this.root, 'erp-glb-input-mode');
    button.innerHTML = this.inputMode === 'touch' ? TOUCH_ICON : MOUSE_ICON;
    button.setAttribute('aria-label', `${this.inputMode === 'touch' ? 'Touch' : 'Mouse and keyboard'} mode. Switch input mode.`);
    button.title = this.inputMode === 'touch'
      ? 'Touch mode: drag to rotate, two fingers to pan/pinch. Click to switch to mouse.'
      : 'Mouse and keyboard mode: middle-drag rotate, right-drag pan, wheel zoom. Click to switch to touch.';
  }

  setInputMode(mode) {
    if (mode !== 'mouse' && mode !== 'touch') throw new Error('Input mode must be mouse or touch.');
    this.inputMode = mode;
    this.touches.clear();
    this.touchGesture = null;
    this.pointerAction = null;
    this.contextTapSequence = null;
    this._closeContextMenu();
    this._setInputModeUI();
    return mode;
  }

  setSourceUnit(unit) {
    if (!(unit in UNIT_SCALE)) throw new Error('Source unit must be m, cm or mm.');
    this.sourceUnit = unit;
    byClass(this.root, 'erp-glb-source-unit').value = unit;
    this._refreshMeasureUI();
    this.invalidate();
    return unit;
  }

  _bindControls() {
    const query = name => byClass(this.root, `erp-glb-${name}`);
    query('file').addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (file) await this.loadFile(file).catch(() => {});
      event.target.value = '';
    });
    query('fit').addEventListener('click', () => this.fit());
    query('edges').addEventListener('click', event => {
      const show = event.currentTarget.getAttribute('aria-pressed') !== 'true';
      event.currentTarget.setAttribute('aria-pressed', String(show));
      for (const edge of this.edgeObjects) edge.visible = show;
      this.invalidate();
    });
    query('measure-button').addEventListener('click', () => this._toggleMeasure(!this.measuring));
    query('measure-close').addEventListener('click', () => this._toggleMeasure(false));
    query('input-mode').addEventListener('click', () => this.setInputMode(this.inputMode === 'mouse' ? 'touch' : 'mouse'));
    query('touch-roll').addEventListener('click', event => {
      this.touchRoll = !this.touchRoll;
      event.currentTarget.setAttribute('aria-pressed', String(this.touchRoll));
    });
    query('components-button').addEventListener('click', event => {
      const open = this.treePanel.classList.toggle('open');
      event.currentTarget.setAttribute('aria-expanded', String(open));
    });
    query('hide').addEventListener('click', () => {
      for (const mesh of this.selectedMeshes) this.hiddenMeshes.add(mesh);
      this._refreshMeshState();
    });
    query('isolate').addEventListener('click', () => {
      if (!this.selectedMeshes.size) return;
      for (const mesh of this.meshes) {
        if (this.selectedMeshes.has(mesh)) this.hiddenMeshes.delete(mesh);
        else this.hiddenMeshes.add(mesh);
      }
      this._refreshMeshState();
      this.fit();
    });
    query('show-all').addEventListener('click', () => { this.hiddenMeshes.clear(); this._refreshMeshState(); this.fit(); });
    query('delete').addEventListener('click', () => this._deleteSelection());
    query('model-opacity').addEventListener('input', event => {
      this.modelOpacity = Number(event.currentTarget.value);
      query('model-opacity-value').textContent = `${Math.round(this.modelOpacity * 100)}%`;
      this.edgeMaterial.opacity = 0.8 * this.modelOpacity;
      this._refreshMeshState();
    });
    query('selected-opacity').addEventListener('input', event => {
      const opacity = Number(event.currentTarget.value);
      for (const mesh of this.selectedMeshes) this.meshOpacity.set(mesh, opacity);
      this._refreshMeshState();
    });
    query('source-unit').addEventListener('change', event => this.setSourceUnit(event.currentTarget.value));
    this.contextMenu.addEventListener('click', event => {
      const button = event.target.closest('button[data-context-action]');
      if (!button || !this.contextMenu.contains(button)) return;
      const meshes = this.contextMeshes.filter(mesh => !this.deletedMeshes.has(mesh));
      if (button.dataset.contextAction === 'hide') {
        for (const mesh of meshes) this.hiddenMeshes.add(mesh);
      } else if (button.dataset.contextAction === 'delete') {
        for (const mesh of meshes) this.deletedMeshes.add(mesh);
        this.selectedMeshes.clear();
      } else if (button.dataset.contextAction === 'transparent') {
        const restore = meshes.every(mesh => (this.meshOpacity.get(mesh) ?? 1) <= 0.35);
        for (const mesh of meshes) this.meshOpacity.set(mesh, restore ? 1 : 0.3);
      }
      this._closeContextMenu();
      this._refreshMeshState();
    });
    this.root.addEventListener('pointerdown', event => {
      if (!this.contextMenu.hidden && !this.contextMenu.contains(event.target)) this._closeContextMenu();
    });
    byClass(this.root, 'erp-glb-face-list').addEventListener('click', event => {
      const button = event.target.closest('button[data-slot]');
      if (!button) return;
      const slot = Number(button.dataset.slot);
      if (button.dataset.action === 'change') {
        this.replaceSlot = slot;
        this.tapSequence = null;
        this._status(`Triple-click or triple-tap the replacement for face ${slot + 1}.`);
        this._refreshMeasureUI();
      } else if (button.dataset.action === 'remove') {
        this._clearFace(slot);
        this.replaceSlot = null;
        this._refreshMeasureUI();
        this.invalidate();
      }
    });
    this.canvas.addEventListener('pointerdown', event => this._onPointerDown(event));
    this.canvas.addEventListener('pointermove', event => this._onPointerMove(event));
    this.canvas.addEventListener('pointerup', event => this._onPointerUp(event));
    this.canvas.addEventListener('pointercancel', event => this._onPointerCancel(event));
    this.canvas.addEventListener('dblclick', event => { event.preventDefault(); event.stopImmediatePropagation(); });
    this.canvas.addEventListener('contextmenu', event => event.preventDefault());
    this.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? this.stage.clientHeight : 1);
      this._zoomAt(event.clientX, event.clientY, Math.exp(delta * 0.001));
    }, { passive: false });
    this.root.addEventListener('keydown', event => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Delete') { this._deleteSelection(); event.preventDefault(); }
      if (event.key === 'Escape') {
        if (!this.contextMenu.hidden) this._closeContextMenu();
        else { this.selectedMeshes.clear(); this._refreshMeshState(); }
        event.preventDefault();
      }
    });
    this.stage.addEventListener('dragover', event => { event.preventDefault(); this.stage.classList.add('drag'); });
    this.stage.addEventListener('dragleave', () => this.stage.classList.remove('drag'));
    this.stage.addEventListener('drop', async event => {
      event.preventDefault();
      this.stage.classList.remove('drag');
      const file = event.dataTransfer?.files?.[0];
      if (file) await this.loadFile(file).catch(() => {});
    });
  }

  _deleteSelection() {
    for (const mesh of this.selectedMeshes) this.deletedMeshes.add(mesh);
    this.selectedMeshes.clear();
    this._refreshMeshState();
  }

  _closeContextMenu() {
    this.contextMenu.hidden = true;
    this.contextMeshes = [];
  }

  _openContextMenu(event, hit) {
    if (!hit || this.deletedMeshes.has(hit.object)) return;
    const component = this.componentByMesh.get(hit.object) || hit.object;
    const meshes = (component.userData.viewerMeshes || [hit.object]).filter(mesh => !this.deletedMeshes.has(mesh));
    if (!meshes.length) return;
    this.contextMeshes = meshes;
    this._selectMeshes(meshes);
    const name = component.name || hit.object.name || 'Component';
    byClass(this.contextMenu, 'erp-glb-context-name').textContent = name;
    byClass(this.contextMenu, 'erp-glb-context-name').title = name;
    this.contextMenu.querySelector('button[data-context-action="transparent"]').textContent =
      meshes.every(mesh => (this.meshOpacity.get(mesh) ?? 1) <= 0.35) ? 'Restore solid' : 'Transparent';
    this.contextMenu.hidden = false;
    const stageRect = this.stage.getBoundingClientRect();
    this.contextMenu.style.left = `${Math.max(8, Math.min(event.clientX - stageRect.left, this.stage.clientWidth - this.contextMenu.offsetWidth - 8))}px`;
    this.contextMenu.style.top = `${Math.max(8, Math.min(event.clientY - stageRect.top, this.stage.clientHeight - this.contextMenu.offsetHeight - 8))}px`;
    this.contextMenu.querySelector('button').focus({ preventScroll: true });
  }

  _toggleMeasure(show) {
    this.measuring = Boolean(show);
    this.contextTapSequence = null;
    this._closeContextMenu();
    this.measurePanel.hidden = !show;
    byClass(this.root, 'erp-glb-measure-button').setAttribute('aria-pressed', String(show));
    if (!show) { this.replaceSlot = null; this.tapSequence = null; }
    for (const face of this.faces) if (face?.overlay) face.overlay.visible = Boolean(show);
    this._refreshMeasureUI();
    this.invalidate();
  }

  _clearFace(slot) {
    const face = this.faces[slot];
    if (face?.overlay) {
      face.mesh.remove(face.overlay);
      face.overlay.geometry.dispose();
      face.overlay.material.dispose();
    }
    this.faces[slot] = null;
  }

  _refreshMeasureUI() {
    if (!this.root) return;
    const list = byClass(this.root, 'erp-glb-face-list');
    if (!list) return;
    list.replaceChildren();
    for (let slot = 0; slot < 2; slot++) {
      const face = this.faces[slot];
      const row = document.createElement('div');
      row.className = `erp-glb-face-row${this.replaceSlot === slot ? ' pending' : ''}`;
      const name = document.createElement('span');
      name.textContent = face ? `${slot + 1}. ${face.mesh.name || 'Mesh'} · face ${face.patchIndex + 1}` : `${slot + 1}. Select a face`;
      name.title = name.textContent;
      row.append(name);
      if (face) {
        for (const [action, label] of [['change', 'Change'], ['remove', 'Remove']]) {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.slot = String(slot);
          button.dataset.action = action;
          button.textContent = label;
          button.setAttribute('aria-label', `${label} face ${slot + 1}`);
          row.append(button);
        }
      }
      list.append(row);
    }
    const metric = measureFaces(this.faces[0], this.faces[1], UNIT_SCALE[this.sourceUnit]);
    if (!metric) {
      for (const badge of this.measureBadges) badge.hidden = true;
      return;
    }
    const labels = [
      `${metric.parallel ? 'Normal' : 'N component'} ${formatMm(metric.normalMm)}`,
      `ΔX ${formatMm(metric.xMm)}`,
      `ΔY ${formatMm(metric.yMm)}`,
      `ΔZ ${formatMm(metric.zMm)}`,
    ];
    this.measureBadges.forEach((badge, index) => {
      badge.textContent = labels[index];
      badge.title = index === 0 && !metric.parallel
        ? 'Faces are not parallel: this is the picked-point component along face 1 normal, not perpendicular face spacing.'
        : 'X, Y and Z follow the model axes.';
      badge.hidden = !this.measuring;
    });
  }

  _refreshControls() {
    const active = this.selectedMeshes.size > 0;
    for (const name of ['hide', 'isolate', 'delete']) byClass(this.root, `erp-glb-${name}`).disabled = !active;
    byClass(this.root, 'erp-glb-selection-count').textContent = `${this.selectedMeshes.size} selected`;
    const control = byClass(this.root, 'erp-glb-selected-opacity');
    const output = byClass(this.root, 'erp-glb-selected-opacity-value');
    control.disabled = !active;
    if (!active) output.textContent = '-';
    else {
      const values = [...this.selectedMeshes].map(mesh => this.meshOpacity.get(mesh) ?? 1);
      const mixed = values.some(value => Math.abs(value - values[0]) > 1e-6);
      if (!mixed) control.value = String(values[0]);
      output.textContent = mixed ? 'Mixed' : `${Math.round(values[0] * 100)}%`;
    }
    for (const row of this.tree.querySelectorAll('.erp-glb-tree-row')) {
      const object = this.treeNodes?.get(row.dataset.node);
      const meshes = object?.userData?.viewerMeshes || [];
      row.classList.toggle('selected', meshes.length > 0 && meshes.every(mesh => this.selectedMeshes.has(mesh)));
      row.classList.toggle('hidden', meshes.length > 0 && meshes.every(mesh => this.hiddenMeshes.has(mesh) || this.deletedMeshes.has(mesh)));
      row.classList.toggle('deleted', meshes.length > 0 && meshes.every(mesh => this.deletedMeshes.has(mesh)));
    }
  }

  _refreshMeshState() {
    for (const material of this.stateMaterials) material.dispose();
    this.stateMaterials = [];
    for (const mesh of this.meshes) {
      mesh.visible = !this.hiddenMeshes.has(mesh) && !this.deletedMeshes.has(mesh);
      const opacity = Math.max(0.01, Math.min(1, this.modelOpacity * (this.meshOpacity.get(mesh) ?? 1)));
      const original = this.materials.get(mesh);
      const apply = source => {
        const material = source.clone();
        if (this.selectedMeshes.has(mesh)) {
          if (material.color) material.color.lerp(new THREE.Color(0xe04456), 0.55);
          if (material.emissive) { material.emissive.setHex(0x3d0911); material.emissiveIntensity = 0.3; }
        }
        material.opacity = (source.opacity ?? 1) * opacity;
        material.transparent = material.transparent || material.opacity < 0.999;
        material.depthWrite = !material.transparent;
        this.stateMaterials.push(material);
        return material;
      };
      mesh.material = Array.isArray(original) ? original.map(apply) : apply(original);
    }
    for (let slot = 0; slot < 2; slot++) {
      const face = this.faces[slot];
      if (face && !face.mesh.visible) this._clearFace(slot);
    }
    this._refreshControls();
    this._refreshMeasureUI();
    this.invalidate();
  }

  _renderTree() {
    this.tree.replaceChildren();
    this.treeNodes = new Map();
    if (!this.gltfScene) {
      const empty = document.createElement('div'); empty.className = 'erp-glb-tree-empty'; empty.textContent = 'No model loaded';
      this.tree.append(empty); return;
    }
    let nextId = 0;
    const renderNode = (object, depth) => {
      const allMeshes = [];
      object.traverse(child => { if (child.isMesh) allMeshes.push(child); });
      if (!allMeshes.length && !object.children.some(child => child.isMesh || child.children.length)) return null;
      const item = document.createElement('li');
      const row = document.createElement('div'); row.className = 'erp-glb-tree-row';
      const id = String(nextId++); row.dataset.node = id; this.treeNodes.set(id, object);
      object.userData.viewerMeshes = allMeshes;
      const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'erp-glb-tree-toggle';
      const label = document.createElement('button'); label.type = 'button'; label.className = 'erp-glb-tree-label';
      label.textContent = object.name || (object.isMesh ? 'Mesh' : depth === 0 ? 'Model' : 'Group');
      label.title = label.textContent;
      label.addEventListener('click', event => this._selectMeshes(allMeshes, { additive: event.shiftKey, toggle: event.ctrlKey || event.metaKey }));
      row.append(toggle, label); item.append(row);
      const children = object.children.map(child => renderNode(child, depth + 1)).filter(Boolean);
      if (children.length) {
        const list = document.createElement('ul'); list.append(...children); item.append(list);
        const open = depth < 2;
        list.hidden = !open; toggle.textContent = open ? '-' : '+'; toggle.setAttribute('aria-expanded', String(open));
        toggle.addEventListener('click', () => {
          const show = list.hidden;
          list.hidden = !show; toggle.textContent = show ? '-' : '+';
          toggle.setAttribute('aria-expanded', String(show));
        });
      } else { toggle.textContent = '·'; toggle.disabled = true; }
      return item;
    };
    const tree = document.createElement('ul');
    const rootItem = renderNode(this.gltfScene, 0);
    if (rootItem) tree.append(rootItem);
    this.tree.append(tree);
    this._refreshControls();
  }

  _selectMeshes(meshes, { additive = false, toggle = false } = {}) {
    if (!additive && !toggle) this.selectedMeshes.clear();
    const active = meshes.filter(mesh => !this.deletedMeshes.has(mesh));
    if (toggle) {
      const remove = active.length > 0 && active.every(mesh => this.selectedMeshes.has(mesh));
      for (const mesh of active) remove ? this.selectedMeshes.delete(mesh) : this.selectedMeshes.add(mesh);
    } else for (const mesh of active) this.selectedMeshes.add(mesh);
    this._refreshMeshState();
  }

  _disposeLoaded() {
    this.zoomReference = null;
    this._closeContextMenu();
    this.contextTapSequence = null;
    for (let slot = 0; slot < 2; slot++) this._clearFace(slot);
    for (const material of this.stateMaterials) material.dispose();
    this.stateMaterials = [];
    if (this.modelRoot) this.pivot.remove(this.modelRoot);
    const geometries = new Set(this.ownedEdgeGeometries);
    const materials = new Set();
    const textures = new Set();
    this.gltfScene?.traverse(object => {
      if (!object.isMesh) return;
      geometries.add(object.geometry);
      const originals = this.materials.get(object);
      for (const material of (Array.isArray(originals) ? originals : originals ? [originals] : [])) {
        materials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      }
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
    for (const material of this.importedMaterials) material.dispose();
    for (const texture of this.importedTextures) texture.dispose();
    this.gltfScene = null; this.modelRoot = null; this.meshes = []; this.edgeObjects = [];
    this.ownedEdgeGeometries = []; this.materials.clear(); this.meshOpacity.clear();
    this.importedMaterials.clear(); this.importedTextures.clear();
    this.selectedMeshes.clear(); this.hiddenMeshes.clear(); this.deletedMeshes.clear();
    this.componentByMesh.clear();
    this.faceCache = new WeakMap(); this.modelName = null;
    this._renderTree(); this._refreshMeasureUI(); this.invalidate();
  }

  async loadFile(file) {
    try {
      if (!file || !String(file.name).toLowerCase().endsWith('.glb')) throw new Error('Choose a .glb file.');
      if (file.size > MAX_GLB_BYTES) throw new Error('GLB exceeds 256 MiB.');
      return await this._loadBuffer(await file.arrayBuffer(), file.name);
    }
    catch (error) { this._status(error.message); throw error; }
  }

  async loadUrl(url) {
    const resolved = new URL(url, location.href);
    if (resolved.origin !== location.origin || !['http:', 'https:'].includes(resolved.protocol)) {
      throw new Error('Model URL must be on the same localhost site.');
    }
    this.fetchAbort?.abort();
    const controller = new AbortController();
    this.fetchAbort = controller;
    this._status('Opening GLB...');
    try {
      const response = await fetch(resolved, { mode: 'same-origin', credentials: 'same-origin', signal: controller.signal });
      if (!response.ok) throw new Error(`GLB request failed (${response.status}).`);
      if (new URL(response.url).origin !== location.origin) throw new Error('Redirected GLB URL is not on this localhost site.');
      if (Number(response.headers.get('content-length')) > MAX_GLB_BYTES) throw new Error('GLB exceeds 256 MiB.');
      const buffer = await response.arrayBuffer();
      if (buffer.byteLength > MAX_GLB_BYTES) throw new Error('GLB exceeds 256 MiB.');
      return await this._loadBuffer(buffer, decodeURIComponent(resolved.pathname.split('/').pop() || 'model.glb'));
    } catch (error) {
      if (error.name !== 'AbortError') this._status(error.message);
      throw error;
    } finally {
      if (this.fetchAbort === controller) this.fetchAbort = null;
    }
  }

  async _loadBuffer(buffer, name) {
    if (this.destroyed) throw new Error('Viewer is closed.');
    if (!this.renderer) throw new Error('WebGL is unavailable.');
    validateSelfContainedGlb(buffer);
    const generation = ++this.loadGeneration;
    this._status('Parsing GLB...');
    const gltf = await this.loader.parseAsync(buffer, '');
    if (generation !== this.loadGeneration || this.destroyed) return;
    const scene = gltf.scene;
    const meshes = [];
    scene.traverse(object => { if (object.isMesh && object.geometry?.getAttribute('position')) meshes.push(object); });
    if (!meshes.length) throw new Error('GLB contains no renderable triangle meshes.');
    const box = new THREE.Box3().setFromObject(scene);
    const center = box.getCenter(new THREE.Vector3());
    if (box.isEmpty() || ![center.x, center.y, center.z, box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) {
      throw new Error('GLB has no finite model bounds.');
    }
    this._disposeLoaded();
    this.gltfScene = scene;
    this.meshes = meshes;
    const associations = gltf.parser.associations;
    for (const mesh of meshes) {
      let component = mesh;
      for (let object = mesh; object && object !== scene; object = object.parent) {
        if (associations.get(object)?.nodes !== undefined) { component = object; break; }
      }
      this.componentByMesh.set(mesh, component);
    }
    this.modelRoot = new THREE.Group();
    this.modelRoot.add(scene);
    this.pivot.add(this.modelRoot);
    this.modelRoot.position.copy(center).negate();
    const neutralMaterials = new Map();
    const neutralize = source => {
      if (!neutralMaterials.has(source)) {
        this.importedMaterials.add(source);
        for (const value of Object.values(source)) if (value?.isTexture) this.importedTextures.add(value);
        neutralMaterials.set(source, neutralDisplayMaterial(source));
      }
      return neutralMaterials.get(source);
    };
    for (const mesh of meshes) {
      this.materials.set(mesh, Array.isArray(mesh.material)
        ? mesh.material.map(neutralize) : neutralize(mesh.material));
      this.meshOpacity.set(mesh, 1);
      const geometry = new THREE.EdgesGeometry(mesh.geometry, 1);
      this.ownedEdgeGeometries.push(geometry);
      const line = new THREE.LineSegments(geometry, this.edgeMaterial);
      line.raycast = () => {};
      line.visible = byClass(this.root, 'erp-glb-edges').getAttribute('aria-pressed') === 'true';
      mesh.add(line);
      this.edgeObjects.push(line);
    }
    this.viewQuaternion.setFromEuler(this.defaultViewEuler);
    this.modelOpacity = 1;
    byClass(this.root, 'erp-glb-model-opacity').value = '1';
    byClass(this.root, 'erp-glb-model-opacity-value').textContent = '100%';
    this._renderTree();
    this._refreshMeshState();
    byClass(this.root, 'erp-glb-hint').hidden = true;
    this.modelName = name;
    this.fit();
    requestAnimationFrame(() => { if (this.modelRoot) this.fit(); });
    this._status(`${name} · ${meshes.length} mesh${meshes.length === 1 ? '' : 'es'}`);
    this.root.dispatchEvent(new CustomEvent('erp-glb-viewer:loaded', { detail: { name, meshCount: meshes.length } }));
    return { name, meshCount: meshes.length };
  }

  resize() {
    if (!this.renderer || this.destroyed) return;
    const width = Math.max(this.stage.clientWidth, 1);
    const height = Math.max(this.stage.clientHeight, 1);
    const ratio = Math.min(devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.annotation.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.invalidate();
  }

  fit() {
    if (!this.modelRoot) return;
    this.zoomReference = null;
    this.pivot.position.set(0, 0, 0);
    this.pivot.quaternion.copy(this.viewQuaternion);
    this.scene.updateMatrixWorld(true);
    const box = new THREE.Box3();
    for (const mesh of this.meshes) {
      if (!mesh.visible) continue;
      box.expandByObject(mesh);
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    this.pivot.position.sub(center);
    const radius = box.getBoundingSphere(new THREE.Sphere()).radius;
    if (!Number.isFinite(radius) || radius <= 0) return;
    const verticalFov = this.camera.fov * Math.PI / 180;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(this.camera.aspect, 0.01));
    const halfFov = Math.max(Math.min(verticalFov, horizontalFov) * 0.5, 0.01);
    this.modelRadius = Math.max(radius * 1.2, 1e-6);
    this.dist = this.modelRadius / Math.sin(halfFov);
    this._updateCameraClipping();
    this.camera.position.set(0, 0, this.dist);
    this.camera.lookAt(0, 0, 0);
    this.invalidate();
  }

  _updateCameraClipping() {
    const margin = this.modelRadius * 1.15;
    const centerDepth = this.dist - this.pivot.position.z;
    const near = Math.max(this.modelRadius * 1e-5, centerDepth - margin);
    const far = Math.max(near * 1.01, centerDepth + margin);
    if (Math.abs(this.camera.near - near) > near * 1e-5 || Math.abs(this.camera.far - far) > far * 1e-5) {
      this.camera.near = near; this.camera.far = far; this.camera.updateProjectionMatrix();
    }
  }

  invalidate() {
    if (this.renderPending || !this.renderer || this.destroyed) return;
    this.renderPending = true;
    requestAnimationFrame(() => {
      this.renderPending = false;
      if (this.destroyed) return;
      this.pivot.quaternion.copy(this.viewQuaternion);
      this.camera.position.z = this.dist;
      this._updateCameraClipping();
      this.camera.updateMatrixWorld(true);
      this.scene.updateMatrixWorld(true);
      this.renderer.render(this.scene, this.camera);
      this._positionMeasurement();
    });
  }

  _raycastAt(clientX, clientY) {
    if (!this.meshes.length) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.camera.position.z = this.dist;
    this.camera.updateMatrixWorld(true);
    this.scene.updateMatrixWorld(true);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    return this.raycaster.intersectObjects(this.meshes.filter(mesh => mesh.visible), false)[0] || null;
  }

  _beginRotation(clientX, clientY) {
    const hit = this._raycastAt(clientX, clientY);
    this.navigationDepth = hit ? this.dist - hit.point.z
      : this.zoomReference ? this.dist - this.zoomReference.point.z
        : this.dist - this.pivot.position.z;
    this.zoomReference = null;
    this.dragInverseQuaternion.copy(this.viewQuaternion).invert();
    if (hit) this.dragOrbitLocal.copy(hit.point).sub(this.pivot.position).applyQuaternion(this.dragInverseQuaternion);
    else this.dragOrbitLocal.set(0, 0, 0);
    this.dragOrbitWorld.copy(this.dragOrbitLocal).applyQuaternion(this.viewQuaternion).add(this.pivot.position);
    this.px = clientX; this.py = clientY;
  }

  _updateRotation(clientX, clientY, roll = false) {
    const closeDepth = Math.max(this.navigationDepth ?? this.dist - this.pivot.position.z, this.modelRadius * 1e-5);
    const speed = Math.min(4, Math.max(1, Math.sqrt(this.modelRadius * 0.16 / closeDepth)));
    if (roll) {
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.left + rect.width * 0.5, cy = rect.top + rect.height * 0.5;
      const sx = this.px - cx, sy = cy - this.py, ex = clientX - cx, ey = cy - clientY;
      const startRadius = Math.hypot(sx, sy), endRadius = Math.hypot(ex, ey);
      const angle = (Math.min(startRadius, endRadius) > 8
        ? Math.atan2(sx * ey - sy * ex, sx * ex + sy * ey) : -(clientX - this.px) * 0.01) * speed;
      this.rotationDelta.setFromAxisAngle(this.viewAxis, angle);
    } else {
      const dx = clientX - this.px, dy = clientY - this.py;
      const radiansPerPixel = 2 / Math.max(Math.min(this.canvas.clientWidth, this.canvas.clientHeight), 1);
      const angle = Math.hypot(dx, dy) * radiansPerPixel * speed;
      if (angle <= 1e-12) return;
      this.rotationAxis.set(dy, dx, 0).normalize();
      this.rotationDelta.setFromAxisAngle(this.rotationAxis, angle);
    }
    this.viewQuaternion.premultiply(this.rotationDelta).normalize();
    this.rotatedOrbitLocal.copy(this.dragOrbitLocal).applyQuaternion(this.viewQuaternion);
    this.pivot.position.copy(this.dragOrbitWorld).sub(this.rotatedOrbitLocal);
  }

  _pan(dx, dy) {
    const viewDepth = Math.max(this.dist - this.pivot.position.z, this.modelRadius * 0.16);
    const closeDepth = Math.max(this.navigationDepth ?? viewDepth, this.modelRadius * 1e-5);
    const boost = Math.min(2.5, Math.max(1, Math.sqrt(this.modelRadius * 0.16 / closeDepth)));
    const unitsPerPixel = 2 * viewDepth * boost * Math.tan(this.camera.fov * Math.PI / 360) / Math.max(this.stage.clientHeight, 1);
    this.pivot.position.x += dx * unitsPerPixel;
    this.pivot.position.y -= dy * unitsPerPixel;
  }

  _zoomAt(clientX, clientY, factor) {
    if (!this.modelRoot) return;
    const previous = this.zoomReference;
    const sameAnchor = previous && Math.hypot(clientX - previous.x, clientY - previous.y) <= 24;
    const hit = sameAnchor ? null : this._raycastAt(clientX, clientY);
    if (sameAnchor) this.zoomAnchor.copy(previous.point);
    else if (hit) this.zoomAnchor.copy(hit.point);
    else {
      const fallbackDepth = Math.min(this.pivot.position.z, this.dist - Math.max(this.modelRadius * 0.01, 1e-6));
      this.zoomPlane.constant = -fallbackDepth;
      this.raycaster.ray.intersectPlane(this.zoomPlane, this.zoomAnchor) ||
        this.zoomAnchor.set(this.pivot.position.x, this.pivot.position.y, fallbackDepth);
    }
    const anchor = this.zoomAnchor;
    const oldDepth = this.dist - anchor.z;
    const minDepth = Math.max(this.modelRadius * 4e-5, 1e-6);
    const newDepth = Math.min(this.modelRadius * 100, Math.max(minDepth, oldDepth * factor));
    if (oldDepth > 1e-6 && newDepth > 1e-6) {
      const scale = newDepth / oldDepth;
      this.pivot.position.x += anchor.x * (scale - 1);
      this.pivot.position.y += anchor.y * (scale - 1);
      this.dist += newDepth - oldDepth;
      anchor.x *= scale;
      anchor.y *= scale;
      this.zoomReference = { point: anchor.clone(), x: clientX, y: clientY };
    } else this.zoomReference = null;
    this.invalidate();
  }

  _onPointerDown(event) {
    if (event.pointerType === 'touch') {
      if (this.inputMode !== 'touch') return;
      this.canvas.setPointerCapture(event.pointerId);
      this.touches.set(event.pointerId, { x: event.clientX, y: event.clientY, startX: event.clientX, startY: event.clientY, moved: false });
      if (this.touches.size === 1) {
        this.touchHadMulti = false;
        this._beginRotation(event.clientX, event.clientY);
      } else {
        this.touchHadMulti = true;
        this.contextTapSequence = null;
        this._setTouchGesture();
      }
      event.preventDefault();
      this.canvas.focus({ preventScroll: true });
      return;
    }
    const action = event.button === 0 ? 'select' : event.button === 1 ? 'rotate' : event.button === 2 ? 'pan' : null;
    if (!action) return;
    this.pointerAction = action;
    this.pointerMoved = false;
    this.downX = this.px = event.clientX;
    this.downY = this.py = event.clientY;
    if (action === 'pan') {
      const hit = this._raycastAt(event.clientX, event.clientY);
      this.navigationDepth = hit ? this.dist - hit.point.z
        : this.zoomReference ? this.dist - this.zoomReference.point.z
          : this.dist - this.pivot.position.z;
      this.zoomReference = null;
    }
    if (action === 'rotate') this._beginRotation(event.clientX, event.clientY);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.focus({ preventScroll: true });
    event.preventDefault();
  }

  _touchMetrics() {
    const points = [...this.touches.values()];
    if (points.length < 2) return null;
    const [a, b] = points;
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.hypot(b.x - a.x, b.y - a.y) };
  }

  _setTouchGesture() {
    this.touchGesture = this._touchMetrics();
    if (this.touchGesture) {
      const hit = this._raycastAt(this.touchGesture.x, this.touchGesture.y);
      this.navigationDepth = hit ? this.dist - hit.point.z
        : this.zoomReference ? this.dist - this.zoomReference.point.z
          : this.dist - this.pivot.position.z;
    }
  }

  _onPointerMove(event) {
    if (event.pointerType === 'touch') {
      const pointer = this.touches.get(event.pointerId);
      if (!pointer) return;
      pointer.x = event.clientX; pointer.y = event.clientY;
      if (Math.hypot(pointer.x - pointer.startX, pointer.y - pointer.startY) > 4) pointer.moved = true;
      if (pointer.moved) this.contextTapSequence = null;
      if (this.touches.size === 1 && pointer.moved && !this.touchHadMulti) {
        this._updateRotation(pointer.x, pointer.y, this.touchRoll);
        this.px = pointer.x; this.py = pointer.y;
        this.invalidate();
      } else if (this.touches.size >= 2) {
        const current = this._touchMetrics();
        const previous = this.touchGesture;
        if (current && previous) {
          if (current.distance > 5 && previous.distance > 5) {
            this._zoomAt(previous.x, previous.y, previous.distance / current.distance);
          }
          this._pan(current.x - previous.x, current.y - previous.y);
          this.touchGesture = current;
          this.invalidate();
        }
      }
      event.preventDefault();
      return;
    }
    if (!this.pointerAction) return;
    const dx = event.clientX - this.px, dy = event.clientY - this.py;
    if (Math.hypot(event.clientX - this.downX, event.clientY - this.downY) > 3) this.pointerMoved = true;
    if (this.pointerAction === 'rotate' && this.pointerMoved) this._updateRotation(event.clientX, event.clientY, event.altKey);
    if (this.pointerAction === 'pan' && this.pointerMoved) this._pan(dx, dy);
    if (this.pointerAction === 'rotate' || this.pointerAction === 'pan') this.invalidate();
    this.px = event.clientX; this.py = event.clientY;
  }

  _onPointerUp(event) {
    if (event.pointerType === 'touch') {
      const pointer = this.touches.get(event.pointerId);
      if (pointer && this.touches.size === 1 && !pointer.moved && !this.touchHadMulti) this._handleTap(event);
      this.touches.delete(event.pointerId);
      this._setTouchGesture();
      if (this.touches.size === 1) {
        const remaining = [...this.touches.values()][0];
        this._beginRotation(remaining.x, remaining.y);
      }
      if (!this.touches.size) this.touchHadMulti = false;
      if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (this.pointerAction === 'select' && !this.pointerMoved) this._handleTap(event);
    if (this.pointerAction === 'pan' && !this.pointerMoved && this.inputMode === 'mouse') {
      this._openContextMenu(event, this._raycastAt(event.clientX, event.clientY));
    }
    this.pointerAction = null;
    if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
  }

  _onPointerCancel(event) {
    if (event.pointerType === 'touch') { this.touches.delete(event.pointerId); this._setTouchGesture(); this.contextTapSequence = null; }
    else this.pointerAction = null;
  }

  _handleTap(event) {
    if (this.measuring) {
      const hit = this._raycastAt(event.clientX, event.clientY);
      if (!hit) { this.tapSequence = null; return; }
      try {
        const face = this._patchForHit(hit);
        if (!face) return;
        const now = performance.now();
        const key = `${hit.object.uuid}:${face.patch.id}`;
        const previous = this.tapSequence;
        const continued = previous && previous.key === key && now - previous.at <= 600
          && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= (event.pointerType === 'touch' ? 28 : 10);
        const count = continued ? previous.count + 1 : 1;
        this.tapSequence = { key, count, at: now, x: event.clientX, y: event.clientY };
        if (count >= 3) { this.tapSequence = null; this._selectFace(hit, face); }
        else this._status(`${count}/3 taps on this face`);
      } catch (error) { this._status(error.message); }
      return;
    }
    const hit = this._raycastAt(event.clientX, event.clientY);
    if (event.pointerType === 'touch' && this.inputMode === 'touch' && hit) {
      const component = this.componentByMesh.get(hit.object) || hit.object;
      const previous = this.contextTapSequence;
      const now = performance.now();
      const continued = previous && previous.component === component && now - previous.at <= 600
        && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 28;
      const count = continued ? previous.count + 1 : 1;
      this.contextTapSequence = { component, count, at: now, x: event.clientX, y: event.clientY };
      if (count >= 3) { this.contextTapSequence = null; this._openContextMenu(event, hit); return; }
    } else this.contextTapSequence = null;
    if (hit) {
      const component = this.componentByMesh.get(hit.object) || hit.object;
      this._selectMeshes(component.userData.viewerMeshes || [hit.object], {
        additive: event.shiftKey, toggle: event.ctrlKey || event.metaKey,
      });
    }
    else if (!event.shiftKey && !event.ctrlKey && !event.metaKey) this._selectMeshes([]);
  }

  _patchForHit(hit) {
    let cache = this.faceCache.get(hit.object.geometry);
    if (!cache) { cache = buildFacePatches(hit.object.geometry); this.faceCache.set(hit.object.geometry, cache); }
    const patchIndex = cache.triangleToPatch[hit.faceIndex];
    if (patchIndex < 0) return null;
    return { patchIndex, patch: cache.patches[patchIndex] };
  }

  _selectFace(hit, { patchIndex, patch }) {
    const mesh = hit.object;
    const duplicate = this.faces.findIndex(face => face?.mesh === mesh && face.patchIndex === patchIndex);
    if (duplicate >= 0 && duplicate !== this.replaceSlot) {
      this._status('That face is already selected. Choose another face.');
      return;
    }
    const slot = this.replaceSlot ?? this.faces.findIndex(face => !face);
    if (slot < 0) { this._status('Only two faces are allowed. Use Change or Remove in the measurement list.'); return; }
    this._clearFace(slot);
    this.scene.updateMatrixWorld(true);
    const pointModel = this.modelRoot.worldToLocal(hit.point.clone());
    const normalWorld = patch.normal.clone().applyMatrix3(new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)).normalize();
    const modelQuaternion = this.modelRoot.getWorldQuaternion(new THREE.Quaternion()).invert();
    const normalModel = normalWorld.applyQuaternion(modelQuaternion).normalize();
    const overlay = new THREE.Mesh(geometryForPatch(mesh.geometry, patch), new THREE.MeshBasicMaterial({
      color: slot === 0 ? 0xffbf47 : 0x43b9e8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.48,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    }));
    overlay.raycast = () => {};
    overlay.renderOrder = 10;
    mesh.add(overlay);
    this.faces[slot] = { mesh, patchIndex, pointModel, normalModel, overlay };
    this.replaceSlot = null;
    this._refreshMeasureUI();
    this._status(this.faces[0] && this.faces[1] ? 'Two faces selected.' : 'Face 1 selected. Triple-click/tap face 2.');
    this.invalidate();
  }

  _positionMeasurement() {
    const line = byClass(this.root, 'erp-glb-measure-line');
    const dots = [byClass(this.root, 'erp-glb-measure-dot-a'), byClass(this.root, 'erp-glb-measure-dot-b')];
    line.setAttribute('visibility', 'hidden');
    dots.forEach(dot => dot.setAttribute('visibility', 'hidden'));
    this.measureLeaders.forEach(leader => leader.setAttribute('visibility', 'hidden'));
    if (!this.measuring || !this.modelRoot) {
      this.measureBadges.forEach(badge => { badge.hidden = true; });
      return;
    }
    const rect = this.stage.getBoundingClientRect();
    const projected = this.faces.map(face => {
      if (!face) return null;
      const world = this.modelRoot.localToWorld(face.pointModel.clone());
      const forward = this.camera.getWorldDirection(new THREE.Vector3());
      if (world.clone().sub(this.camera.position).dot(forward) <= 0) return null;
      const clip = world.project(this.camera);
      if (!Number.isFinite(clip.x) || !Number.isFinite(clip.y)) return null;
      return { x: (clip.x + 1) * rect.width / 2, y: (1 - clip.y) * rect.height / 2 };
    });
    projected.forEach((point, index) => {
      if (!point) return;
      dots[index].setAttribute('cx', String(point.x));
      dots[index].setAttribute('cy', String(point.y));
      dots[index].setAttribute('visibility', 'visible');
    });
    if (projected[0] && projected[1]) {
      line.setAttribute('x1', String(projected[0].x)); line.setAttribute('y1', String(projected[0].y));
      line.setAttribute('x2', String(projected[1].x)); line.setAttribute('y2', String(projected[1].y));
      line.setAttribute('visibility', 'visible');
      const midpointX = (projected[0].x + projected[1].x) / 2;
      const midpointY = (projected[0].y + projected[1].y) / 2;
      const side = midpointX > rect.width / 3 ? -1 : 1;
      const x = Math.max(82, Math.min(rect.width - 82, midpointX + side * 112));
      let firstY = Math.max(16, Math.min(rect.height - 94, midpointY - 39));
      const panel = this.measurePanel.getBoundingClientRect();
      const panelLeft = panel.left - rect.left;
      const panelBottom = panel.bottom - rect.top;
      if (x + 78 > panelLeft && firstY < panelBottom && firstY + 82 > 0) {
        firstY = Math.max(16, Math.min(rect.height - 94, panelBottom + 16));
      }
      const anchors = [0.5, 0.2, 0.5, 0.8];
      this.measureBadges.forEach((badge, index) => {
        const badgeY = firstY + index * 26;
        badge.style.left = `${x}px`;
        badge.style.top = `${badgeY}px`;
        badge.hidden = false;
        const anchor = anchors[index];
        const leader = this.measureLeaders[index];
        leader.setAttribute('x1', String(projected[0].x + (projected[1].x - projected[0].x) * anchor));
        leader.setAttribute('y1', String(projected[0].y + (projected[1].y - projected[0].y) * anchor));
        leader.setAttribute('x2', String(x));
        leader.setAttribute('y2', String(badgeY));
        leader.setAttribute('visibility', 'visible');
      });
    } else this.measureBadges.forEach(badge => { badge.hidden = true; });
  }

  getState() {
    return { name: this.modelName, meshCount: this.meshes.length, inputMode: this.inputMode,
      measuring: this.measuring, selectedFaces: this.faces.filter(Boolean).length, sourceUnit: this.sourceUnit };
  }

  destroy() {
    if (this.destroyed) return;
    this.fetchAbort?.abort();
    this.loadGeneration++;
    this.resizeObserver.disconnect();
    this._disposeLoaded();
    this.edgeMaterial.dispose();
    this.renderer?.dispose();
    this.destroyed = true;
    this.root.replaceChildren();
    this.root.classList.remove('erp-glb-viewer');
  }
}

export function createERPGlbViewer(root, options = {}) { return new ERPGlbViewer(root, options); }
