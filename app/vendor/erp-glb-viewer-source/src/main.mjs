import { createERPGlbViewer } from './viewer.mjs';

const viewer = createERPGlbViewer(document.getElementById('erp-glb-viewer'));
window.erpGlbViewer = viewer;

const params = new URLSearchParams(location.search);
const model = params.get('model');
const units = params.get('sourceUnit');
if (units) viewer.setSourceUnit(units);
viewer.loadUrl(model || './sample.glb').catch(() => {});
