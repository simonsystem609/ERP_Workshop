import {
  createERPGlbViewer
} from "./chunks/chunk-Q2YQ3HJI.js";

// src/main.mjs
var viewer = createERPGlbViewer(document.getElementById("erp-glb-viewer"));
window.erpGlbViewer = viewer;
var params = new URLSearchParams(location.search);
var model = params.get("model");
var units = params.get("sourceUnit");
if (units) viewer.setSourceUnit(units);
viewer.loadUrl(model || "./sample.glb").catch(() => {
});
