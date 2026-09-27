"use strict";

const app = document.getElementById("app");
const nav = document.getElementById("nav");
const modalRoot = document.getElementById("modal-root");
const cadViewerRoot = document.getElementById("cad-viewer-root");
const toast = document.getElementById("toast");
const title = document.getElementById("view-title");
const subtitle = document.getElementById("view-subtitle");
const serverStatus = document.getElementById("server-status");
const refreshButton = document.getElementById("refresh-button");
const logoutButton = document.getElementById("logout-button");
const projectNoticeRoot = document.getElementById("project-notice-root");
const projectNoticeDialog = document.getElementById("project-notice-dialog");
let projectNoticeTimer = null;
let projectNoticePopupIds = [];
let projectNoticePreviousFocus = null;
let projectNoticeReadBusy = false;

const VIEWS = [
    ["dashboard", "Kezdőképernyő", "Közös teendők, megbeszélések és kiemelt projektek."],
    ["project-view", "Projekt nézet", "Aktív projektek prioritás és frissesség szerint."],
    ["cnc-summary", "CNC összesítő", "Gépenkénti CNC feladatlista és aktuális munka."],
    ["todos", "Feladatok", "Munkafolyamatok és projektfájlok."],
    ["cnc", "CNC megmunkálás", "Gyártási feladatok, gépek és időablakok."],
    ["tools", "Szerszámigények", "Maró-, fúró- és egyéb szerszámkérések."],
    ["materials", "Anyagigények", "Beszerzendő alapanyagok és méretek."],
    ["fasteners", "Kötőelem igények", "Csavarok, anyák, alátétek és egyéb kötőelemek igényei."],
    ["worklog", "Munkaidő napló", "Munkaórák rögzítése projektekhez."],
    ["bom", "BOM", "Darabjegyzékek linkelése, feltöltése és importja."],
    ["cad-models", "3D modellek", "A Helperből exportált GLB modellek megtekintése és projekthez kapcsolása."],
    ["suppliers", "Beszállítók", "Védett pénzügyi és mérnökségi törzsadatok.", true],
    ["price-items", "Projekt árak", "Projektbeszerzések, darabárak és státuszok.", true],
    ["cost-planning", "Projekt költségtervezés", "Terv és tény költségek projekt és kategória szerint.", true],
    ["outsourcing", "Bérmunka / külső műveletek", "Kiadott külső munkák, várható visszaérkezés és tényköltség.", true],
    ["production-items", "Gyártási feladatok", "Belső és külső gyártási műveletek órával, határidővel és státusszal.", true],
    ["design", "Mérnöki / Tervezés", "CAD/CAM, villamos és PLC tervezési tételek dokumentumállapottal.", true],
    ["quotes", "Ajánlatok", "Beszállítói ajánlatok, érvényesség és projektköltség előkészítés.", true],
    ["engineering-notes", "Mérnöki napló", "Projekt döntések, kockázatok és műszaki változások.", true],
    ["production", "Gyártás ütemezés", "CNC gépek napi terhelése és szabad idősávjai.", true],
    ["finance-reports", "Riportok", "Projektköltségek és negyedéves összesítők.", true],
    ["projects", "Projektek kezelése", "Aktiválás, lezárás és prioritás."],
    ["parameters", "Paraméterek", "Anyag-, anyagtípus- és pénzügyi/mérnökségi törzslisták."],
    ["stats", "Beállítások", "Mappák, jelszavak és felhasználók."],
    ["archive", "Archivált", "ERP-ből törölt projektek megőrzött adatai."]
];

const ICONS = {
    dashboard: "01",
    "project-view": "02",
    "cnc-summary": "03",
    todos: "04",
    cnc: "05",
    tools: "06",
    materials: "07",
    fasteners: "08",
    worklog: "09",
    bom: "10",
    "cad-models": "11",
    suppliers: "F1",
    "price-items": "F2",
    "cost-planning": "F3",
    outsourcing: "F4",
    "production-items": "F5",
    design: "F6",
    quotes: "F7",
    "engineering-notes": "F8",
    production: "F9",
    "finance-reports": "F10",
    projects: "12",
    parameters: "14",
    stats: "15",
    archive: "16"
};

const PROTECTED_VIEWS = new Set(["suppliers", "price-items", "cost-planning", "outsourcing", "production-items", "design", "quotes", "engineering-notes", "production", "finance-reports"]);
const LEVEL2_VIEWS = new Set([...PROTECTED_VIEWS, "parameters", "archive"]);
const FINANCE_DATA_VIEWS = new Set([...PROTECTED_VIEWS, "parameters"]);
const LOGIN_USER_STORAGE_KEY = "workshop_last_login_user_id";

// Catalog accessors — driven by state so additions/edits in Paraméterek are reflected immediately.
function workTypes() {
    return data().workTypes || [];
}
function fastenerGrades() {
    return data().fastenerGrades || [];
}
function fastenerTypes() {
    return data().fastenerTypes || [];
}
function fastenerSizes() {
    return data().fastenerSizes || [];
}
function toolNames() {
    return data().toolNames || [];
}

const PROJECT_COMPANIES = Array.isArray(globalThis.ERP_DEMO_CONFIG?.companyNames)
    ? globalThis.ERP_DEMO_CONFIG.companyNames
    : ["Example Manufacturing Ltd", "Example Engineering Ltd"];
const DEMO_VIEWS = new Set(VIEWS.map(([id]) => id));
const REQUEST_HISTORY_LIMIT = 500;
function companyOptions(selected = "") {
    return [`<option value="">— nincs —</option>`]
        .concat(PROJECT_COMPANIES.map((c) => `<option value="${attr(c)}" ${c === selected ? "selected" : ""}>${esc(c)}</option>`))
        .join("");
}

let state = null;
let archiveState = null;
let restoringArchiveId = "";
let archiveRestoreProjectId = "";
let currentView = "dashboard";
let modalProjectId = null;
let statsProjectId = "";
let projectViewSearch = "";
let projectViewOwnerId = "";
let projectBrowserProjectId = "";
let projectBrowser = { open: false, projectId: "", loading: false, error: "", files: [], roots: [], missingRoots: [], truncated: false, scannedAt: "" };
let projectManageSearch = "";
let taskUserFilter = "";
let productionDate = localInputDate();
let editingCncTaskId = "";
let editingTaskId = "";
let editingToolRequestId = "";
let editingMaterialRequestId = "";
let editingFastenerRequestId = "";
let editingWorklogId = "";
let requestRepeatLoading = false;
let toolRequestSearch = "";
let toolRequestProjectFilter = "";
let materialRequestSearch = "";
let materialRequestProjectFilter = "";
let fastenerRequestSearch = "";
let fastenerRequestProjectFilter = "";
let loginFailureCount = 0;
let modellingPhotos = [];
let modellingFolders = null;
let modellingFolderName = "";
let modellingUploadBusy = false;
let demoModellingMode = false;
let worklogProjectId = "";
let cncWorklogProjectId = "";
let cncExportFrom = "";
let cncExportTo = "";
let cncFilterProjectId = "";
let pendingCncTaskImages = [];
let cncImageView = { taskId: "", index: 0 };
let linkBrowser = { open: false, target: "task", current: "", parent: null, entries: [], loading: false, error: "" };
let pendingTaskLinks = [];
let pendingTaskImages = [];
let pendingMaterialPrefabImages = [];
let taskImageView = { taskId: "", index: 0 };
let materialImageView = { requestId: "", index: 0 };
let pendingToolAttachment = null;
let pendingMaterialAttachment = null;
let mobilePhotoCapture = { open: false, target: "", stream: null, starting: false };
let taskDetailId = "";
let personalTasksOpen = false;
let pendingFastenerAttachment = null;
let pendingDashboardTodoImage = null;
let dashboardImageTodoId = "";
let bomLinkPath = "";
let bomLinkName = "";
let financeState = null;
let financeUnlocked = false;
let financeMenuOpen = localStorage.getItem("workshop_finance_menu_open") === "1";
let financeProjectId = "";
let financeYear = String(new Date().getFullYear());
let costPlanningProjectId = "";
let costPlanningUserFilter = "";
let outsourceProjectFilter = "";
let outsourceUserFilter = "";
let productionItemProjectFilter = "";
let productionItemUserFilter = "";
let designProjectFilter = "";
let designUserFilter = "";
let worklogUserFilter = "";
let worklogProjectFilter = "";
let worklogListFullscreen = false;
let assigningCadModelId = "";
let cadAssignProjectId = "";
let editingCadModelNicknameId = "";
let openCadViewerId = "";
let worklogExportProjectId = "";
let worklogExportUserId = "";
let responsibleFlyoutProjectId = null;
let deadlineFlyoutProjectId = null;
let priorityFlyoutProjectId = null;
let reportingCncTaskId = "";
let refreshTimer = null;
let hostStatusRefreshTimer = null;
let eventStream = null;
let eventStreamRetryTimer = null;
let liveUpdatesActive = false;
let pendingLoadState = false;
let queuedLoadState = false;
let backgroundRenderPending = false;
let backgroundRenderTimer = null;
let lastResumeRefreshAt = 0;
let securityState = null;
let pendingSecurityFetch = false;
let hostStatus = null;
let pendingHostStatusFetch = false;
let selectedArchiveIds = new Set();
let authRequired = false;
let authPasswordSet = false;
let authUsers = [];
let authCsrfToken = "";
let currentUser = null;
let deferredInstallPrompt = null;
let notificationActionBusy = false;
let pwaSessionEnsuredForUserId = "";
let pendingSettingsPanelFocus = "";
let pwaStatus = {
    swReady: false,
    pushSupported: false,
    notificationPermission: "default",
    standalone: false,
    subscribed: false,
    registration: null
};
let clientErrorReportCount = 0;
let lastFormInteractionAt = 0;
let projectPickerSeq = 0;
let optionPickerSeq = 0;
let drawingOcr = {
    open: false,
    phase: "camera",
    step: "project",
    stream: null,
    image: null,
    crop: null,
    activePointers: new Map(),
    view: null,
    starting: false
};
let pendingDrawingOcrCorrection = null;
let pendingProjectOcrCorrection = null;

function esc(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function attr(value) {
    return esc(value).replace(/`/g, "&#096;");
}

function fmtDate(value, withTime = true) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return esc(value);
    const options = withTime
        ? { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
        : { year: "numeric", month: "2-digit", day: "2-digit" };
    return new Intl.DateTimeFormat(globalThis.ERP_DEMO_CONFIG ? "en-GB" : "hu-HU", options).format(date);
}

function summarizeUserAgent(ua) {
    if (!ua) return "—";
    let browser = "?";
    if (/Edg\//.test(ua)) browser = "Edge";
    else if (/OPR\/|Opera/.test(ua)) browser = "Opera";
    else if (/Firefox\//.test(ua)) browser = "Firefox";
    else if (/Chrome\//.test(ua)) browser = "Chrome";
    else if (/Safari\//.test(ua)) browser = "Safari";
    let os = "?";
    if (/Windows NT/.test(ua)) os = "Win";
    else if (/Mac OS X|Macintosh/.test(ua)) os = "Mac";
    else if (/Android/.test(ua)) os = "Android";
    else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
    else if (/Linux/.test(ua)) os = "Linux";
    return `${browser}/${os}`;
}

function localInputDate(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function localInputDateTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    const hour = String(date.getHours()).padStart(2, "0");
    const minute = String(date.getMinutes()).padStart(2, "0");
    return `${year}-${month}-${day}T${hour}:${minute}`;
}

function defaultCncEnd() {
    const date = new Date();
    date.setHours(date.getHours() + 2, 0, 0, 0);
    return localInputDateTime(date);
}

function currentHourRoundedUp() {
    const date = new Date();
    if (date.getMinutes() > 0 || date.getSeconds() > 0 || date.getMilliseconds() > 0) {
        date.setHours(date.getHours() + 1);
    }
    date.setMinutes(0, 0, 0);
    return localInputDateTime(date);
}

function hoursDatalist() {
    const options = [];
    for (let i = 1; i <= 16; i++) {
        options.push(`<option value="${i * 0.5}">`);
    }
    return `<datalist id="hours-options-list">${options.join("")}</datalist>`;
}

function hoursInput(value = 1, attrs = "") {
    return `${hoursDatalist()}<div class="hours-input-wrap"><input class="hours-input" type="number" name="hours" step="0.5" min="0.5" max="24" required value="${attr(value)}" list="hours-options-list" placeholder="óra (pl. 1.5)" inputmode="decimal" ${attrs}><div class="hours-stepper"><button class="hours-step-button" type="button" data-action="hours-step" data-step="0.5" aria-label="Óra növelése">▲</button><button class="hours-step-button" type="button" data-action="hours-step" data-step="-0.5" aria-label="Óra csökkentése">▼</button></div></div>`;
}

function normalizedHourValue(value) {
    const number = Number(String(value || "").replace(",", "."));
    const base = Number.isFinite(number) ? number : 1;
    return Math.min(24, Math.max(0.5, Math.round(base * 2) / 2));
}

function formatHourValue(value) {
    const rounded = normalizedHourValue(value);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function stepHoursInput(button) {
    const input = button.closest(".hours-input-wrap")?.querySelector("input.hours-input");
    if (!input) return;
    const step = Number(button.dataset.step || 0);
    const current = normalizedHourValue(input.value);
    input.value = formatHourValue(current + step);
    input.focus();
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function isOvertime(value) {
    return value === true || value === 1 || value === "1" || value === "true" || value === "on";
}

function canUseOvertime(user = currentUser) {
    if (globalThis.ERP_DEMO_CONFIG) return (globalThis.ERP_DEMO_CONFIG.overtimeUserIds || []).includes(user?.id);
    const id = normalizeSearch(user?.id);
    const name = normalizeSearch(user?.name);
    return id === "demouser" || id === "admin" || name === "demouser" || name === "admin";
}

function isNamedUser(user, expectedName) {
    const expected = normalizeSearch(expectedName);
    return normalizeSearch(user?.id) === expected || normalizeSearch(user?.name) === expected;
}

function canViewOvertimeForUser(userId, viewer = currentUser) {
    if (!userId) return false;
    if (globalThis.ERP_DEMO_CONFIG) return (globalThis.ERP_DEMO_CONFIG.overtimeViewerIds || []).includes(viewer?.id)
        && (globalThis.ERP_DEMO_CONFIG.overtimeUserIds || []).includes(userId);
    if (canUseOvertime(viewer)) return true;
    if (!isNamedUser(viewer, "demo-supervisor")) return false;
    const target = users().find((user) => String(user.id) === String(userId));
    return normalizeSearch(userId) === "demouser" || isNamedUser(target, "demouser");
}

function canShowWorklogOvertime(log) {
    if (!isOvertime(log?.overtime)) return false;
    if (canUseOvertime()) return true;
    return Boolean(worklogUserFilter
        && String(log?.userId || "") === String(worklogUserFilter)
        && canViewOvertimeForUser(worklogUserFilter));
}

function logTotalHours(log) {
    return Number(log?.hours || 0) || 0;
}

function worklogOvertimeSummary(userId) {
    if (!canViewOvertimeForUser(userId)) return "";
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const previousMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const previousMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
    const startKey = localInputDate(monthStart);
    const previousStartKey = localInputDate(previousMonthStart);
    const previousEndKey = localInputDate(previousMonthEnd);
    const todayKey = localInputDate(now);
    const totalBetween = (fromKey, toKey) => (data().workLogs || []).reduce((sum, log) => {
        if (!isOvertime(log.overtime)) return sum;
        if (String(log.userId || "") !== String(userId)) return sum;
        const day = String(log.workDate || log.createdAt || "").slice(0, 10);
        if (!day || day < fromKey || day > toKey) return sum;
        return sum + logTotalHours(log);
    }, 0);
    const monthNames = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember", "október", "november", "december"];
    const user = users().find((item) => item.id === userId);
    const currentLabel = `${monthNames[now.getMonth()]} 1-től máig`;
    const previousLabel = `előző hónap (${monthNames[previousMonthStart.getMonth()]})`;
    return `${esc(user?.name || "Kiválasztott felhasználó")} túlóra: ${esc(currentLabel)} ${esc(formatHours(totalBetween(startKey, todayKey)))} óra · ${esc(previousLabel)} ${esc(formatHours(totalBetween(previousStartKey, previousEndKey)))} óra`;
}

function worklogCompanySectionHtml(projectId) {
    const proj = projectId ? projects(false).find((p) => p.id === projectId) : null;
    const line = proj
        ? (proj.company
            ? `<div class="row-meta" style="margin: 4px 0 8px"><strong>Cég:</strong> ${esc(proj.company)}${proj.companyAuto ? ` <span style="opacity: 0.7">(mappa alapján automatikus)</span>` : ""}</div>`
            : `<div class="row-meta" style="margin: 4px 0 8px; color: var(--danger)"><strong>Cég:</strong> hiányzik — válassz egyet alább</div>`)
        : `<div class="row-meta" style="margin: 4px 0 8px">Válassz projektet a Cég adat megjelenítéséhez.</div>`;
    const select = proj && !proj.company
        ? `<label style="display: block; margin-top: 6px">Cég megadása a projekthez<select name="company" required style="display: block; margin-top: 4px; width: 100%"><option value="" disabled selected>Cég választása</option>${PROJECT_COMPANIES.map((c) => `<option value="${attr(c)}">${esc(c)}</option>`).join("")}</select></label>`
        : "";
    return line + select;
}
function cncWorklogCompanySectionHtml() {
    return worklogCompanySectionHtml(cncWorklogProjectId);
}

function activeCncWorklogForm() {
    return document.querySelector('form[data-action="add-cnc-worklog"]')
        || Array.from(document.querySelectorAll('form[data-action="edit-worklog"]')).find((form) => form.querySelector('select[name="cncMachineId"]'))
        || null;
}

function selectCncWorklogProject(project) {
    if (!project?.id) return;
    cncWorklogProjectId = project.id;
    const form = activeCncWorklogForm();
    const picker = form?.querySelector?.("[data-project-picker]");
    if (picker) setProjectPickerValue(picker, project, true);
    const section = document.getElementById("cnc-worklog-company-section");
    if (section) section.innerHTML = cncWorklogCompanySectionHtml();
}

function resetWorklogEditForms() {
    document.querySelectorAll('form[data-action="edit-worklog"]').forEach((form) => {
        const isCnc = Boolean(form.querySelector('select[name="cncMachineId"]'));
        form.dataset.action = isCnc ? "add-cnc-worklog" : "add-worklog";
        form.querySelector('input[name="id"]')?.remove();
        form.querySelector('[data-worklog-edit-cancel]')?.remove();
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.textContent = isCnc ? "CNC naplózás" : "Naplózás";
    });
}

function selectValue(select, value) {
    if (!select) return;
    select.value = value || "";
    if (value && select.value !== value) {
        select.insertAdjacentHTML("afterbegin", `<option value="${attr(value)}" selected>${esc(value)}</option>`);
        select.value = value;
    }
}

function loadWorklogIntoForm(log, { createNew = false } = {}) {
    if (!log) return;
    resetWorklogEditForms();
    editingWorklogId = createNew ? "" : (log.id || "");
    const isCnc = Boolean(log.cncMachineId);
    const form = isCnc
        ? document.querySelector('form[data-action="add-cnc-worklog"]')
        : document.querySelector('form[data-action="add-worklog"]');
    if (!form) return;
    if (createNew) {
        form.dataset.action = isCnc ? "add-cnc-worklog" : "add-worklog";
        form.querySelector('input[name="id"]')?.remove();
    } else {
        form.dataset.action = "edit-worklog";
        let idInput = form.querySelector('input[name="id"]');
        if (!idInput) {
            form.insertAdjacentHTML("afterbegin", `<input type="hidden" name="id" value="${attr(log.id)}">`);
            idInput = form.querySelector('input[name="id"]');
        }
        if (idInput) idInput.value = log.id || "";
    }

    const project = projectById(log.projectId);
    const picker = form.querySelector("[data-project-picker]");
    if (picker && project) setProjectPickerValue(picker, project, false);
    if (isCnc) {
        cncWorklogProjectId = log.projectId || "";
        const section = document.getElementById("cnc-worklog-company-section");
        if (section) section.innerHTML = worklogCompanySectionHtml(cncWorklogProjectId);
        selectValue(form.querySelector('select[name="cncMachineId"]'), log.cncMachineId || "");
        const note = form.querySelector('textarea[name="note"]');
        if (note) note.value = log.note || "";
        const file = form.querySelector('input[name="filePath"]');
        if (file) file.value = log.filePath || "";
    } else {
        worklogProjectId = log.projectId || "";
        const section = document.getElementById("worklog-company-section");
        if (section) section.innerHTML = worklogCompanySectionHtml(worklogProjectId);
        selectValue(form.querySelector('select[name="workType"]'), log.workType || "");
        const note = form.querySelector('textarea[name="note"]');
        if (note) note.value = log.note || "";
    }
    const hours = form.querySelector('input[name="hours"]');
    if (hours) hours.value = log.hours || 1;
    const date = form.querySelector('input[name="date"]');
    if (date) date.value = log.workDate || String(log.createdAt || "").slice(0, 10) || localInputDate();
    selectValue(form.querySelector('select[name="userId"]'), log.userId || currentUser?.id || "");
    const overtime = form.querySelector('input[name="overtime"]');
    if (overtime) overtime.checked = isOvertime(log.overtime);
    if (!createNew) {
        const submit = form.querySelector('button[type="submit"]');
        if (submit) submit.textContent = isCnc ? "CNC módosítás mentése" : "Módosítás mentése";
        if (!form.querySelector("[data-worklog-edit-cancel]")) {
            form.insertAdjacentHTML("beforeend", `<button class="small-button wide" type="button" data-action="cancel-edit-worklog" data-worklog-edit-cancel>Mégse</button>`);
        }
    }
    form.dataset.userDraft = "1";
    markFormInteraction();
    form.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function loadRequestIntoNewForm(type, item) {
    const config = {
        tool: { view: "tools", action: "add-tool", fields: ["toolName", "quantity", "userId", "description"] },
        material: { view: "materials", action: "add-material-request", fields: ["material", "size", "length", "type", "quantity", "userId", "description", "externalCompany", "prefabTaskType", "prefabDirection"] },
        fastener: { view: "fasteners", action: "add-fastener-request", fields: ["grade", "type", "size", "quantity", "userId", "description"] }
    }[type];
    if (!config || currentView !== config.view) return;
    // Load photos before replacing the form. Never reuse an uploaded file path:
    // completing/deleting the source may remove it independently of this copy.
    const originalForm = document.querySelector("#app form.form-grid");
    const interactionAtStart = lastFormInteractionAt;
    const images = [];
    if (item.attachment?.kind === "upload") {
        throw new Error("Régi feltöltött melléklet: az ismétléshez előbb mentsd Y: fájlként és linkeld. Az eredeti bejegyzés változatlan.");
    }
    if (type === "material" && item.prefabTransport) {
        for (let index = 0; index < (item.images || []).length; index += 1) {
            const response = await fetch(`/api/material-requests/${encodeURIComponent(item.id)}/images/${index}`, {
                credentials: "same-origin", cache: "no-store", headers: { Accept: "image/*" }, signal: AbortSignal.timeout(20000)
            });
            if (!response.ok) throw new Error("Nem sikerült másolni az előgyártmány képét. Az űrlap és az eredeti bejegyzés változatlan; próbáld újra.");
            const blob = await response.blob();
            if (!/^image\/(png|jpe?g|gif|webp)$/.test(blob.type)) throw new Error("Az előgyártmány képe nem olvasható; az ismétlés nem történt meg.");
            images.push({ dataUrl: await readFileAsDataUrl(blob), name: item.images[index].name || "", type: blob.type });
        }
    }
    if (currentView !== config.view || originalForm !== document.querySelector("#app form.form-grid") || lastFormInteractionAt !== interactionAtStart) {
        throw new Error("Az űrlap közben megváltozott, ezért nem írtuk felül. Az ismétléshez kattints újra a ↻ gombra.");
    }
    if (type === "tool") editingToolRequestId = "";
    if (type === "material") {
        editingMaterialRequestId = "";
        pendingMaterialPrefabImages = images;
    }
    if (type === "fastener") editingFastenerRequestId = "";
    setPendingRequestAttachment(type, item.attachment?.path ? { path: item.attachment.path, name: item.attachment.name || "" } : null);
    render();
    const form = document.querySelector(`form[data-action="${config.action}"]`);
    if (!form) return;
    // Only editable fields cross into the create form: no ID, status, old dates
    // or creator metadata. Existing POST routes allocate a new open record.
    for (const name of config.fields) {
        const field = form.elements.namedItem(name);
        const inactiveRawField = type === "material" && item.prefabTransport && ["material", "size", "length", "type", "quantity"].includes(name);
        if (field) field.value = inactiveRawField ? "" : String(item[name] ?? "");
    }
    const project = projectById(item.projectId);
    if (project) setProjectPickerValue(form.querySelector("[data-project-picker]"), project, false);
    if (type === "material") {
        form.elements.namedItem("prefabTransport").checked = Boolean(item.prefabTransport);
        syncMaterialPrefabMode(form);
    }
    form.dataset.userDraft = "1";
    markFormInteraction();
    form.querySelector('input:not([type="hidden"]):not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true });
    form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function cncImageThumbnails(task) {
    if (!task?.images?.length) return "";
    return `<div style="margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px">
      ${task.images.map((_, index) => `<button type="button" class="todo-thumb-button" data-action="open-cnc-image" data-task-id="${attr(task.id)}" data-index="${index}" title="Kép megnyitása" style="padding: 0; border: 1px solid #252a2c; border-radius: 4px; background: transparent; cursor: pointer"><img src="/api/cnc-tasks/${attr(task.id)}/images/${index}" alt="" style="height: 56px; width: 56px; object-fit: cover; display: block; border-radius: 3px"></button>`).join("")}
    </div>`;
}

function pendingCncTaskImagesMarkup() {
    if (!pendingCncTaskImages.length) return "";
    const thumbs = pendingCncTaskImages.map((img, index) => `
      <div style="position: relative; display: inline-block; margin: 4px">
        <img src="${attr(img.dataUrl)}" alt="" style="height: 64px; width: 64px; object-fit: cover; border: 1px solid #252a2c; border-radius: 4px">
        <button type="button" class="danger-button small-button" data-action="remove-pending-cnc-image" data-index="${index}" style="position: absolute; top: 0; right: 0; padding: 0 6px; line-height: 18px" title="Törlés">×</button>
      </div>
    `).join("");
    return `<div class="row-meta" style="margin-bottom: 4px">Beillesztett képek (${pendingCncTaskImages.length}):</div><div>${thumbs}</div>`;
}

function refreshPendingCncTaskImages() {
    const target = document.getElementById("cnc-task-pasted-images");
    if (target) target.innerHTML = pendingCncTaskImagesMarkup();
}

function taskImageThumbnails(task) {
    if (!task?.images?.length) return "";
    return `<div class="task-image-strip">
      ${task.images.map((_, index) => `<button type="button" class="todo-thumb-button" data-action="open-task-image" data-task-id="${attr(task.id)}" data-index="${index}" title="Kép megnyitása"><img src="/api/tasks/${attr(task.id)}/images/${index}" alt=""></button>`).join("")}
    </div>`;
}

function materialImageThumbnails(item) {
    if (!item?.images?.length) return "";
    return `<div class="task-image-strip">
      ${item.images.map((_, index) => `<button type="button" class="todo-thumb-button" data-action="open-material-image" data-request-id="${attr(item.id)}" data-index="${index}" title="Kép megnyitása"><img src="/api/material-requests/${attr(item.id)}/images/${index}" alt=""></button>`).join("")}
    </div>`;
}

function resetDrawingOcr() {
    if (drawingOcr.stream) {
        for (const track of drawingOcr.stream.getTracks()) {
            try { track.stop(); } catch { /* noop */ }
        }
    }
    drawingOcr = {
        open: false,
        phase: "camera",
        step: "project",
        stream: null,
        image: null,
        crop: null,
        activePointers: new Map(),
        view: null,
        starting: false
    };
}

function continueDrawingOcrScan() {
    drawingOcr.step = "drawing";
    drawingOcr.phase = "camera";
    drawingOcr.image = null;
    drawingOcr.crop = null;
    drawingOcr.activePointers = new Map();
    drawingOcr.view = null;
    renderModal();
}

function pendingTaskImagesMarkup() {
    if (!pendingTaskImages.length) return `<div class="row-meta">Nincs beillesztett kép.</div>`;
    const thumbs = pendingTaskImages.map((img, index) => `
      <div class="pending-image-thumb">
        <img src="${attr(img.dataUrl)}" alt="">
        <button type="button" class="danger-button small-button" data-action="remove-pending-task-image" data-index="${index}" title="Törlés">×</button>
      </div>
    `).join("");
    return `<div class="row-meta" style="margin-bottom: 4px">Beillesztett képek (${pendingTaskImages.length}):</div><div>${thumbs}</div>`;
}

function refreshPendingTaskImages() {
    const target = document.getElementById("task-pasted-images");
    if (target) target.innerHTML = pendingTaskImagesMarkup();
}

function pendingMaterialPrefabImagesMarkup() {
    if (!pendingMaterialPrefabImages.length) return `<div class="row-meta">Nincs beillesztett kép.</div>`;
    const thumbs = pendingMaterialPrefabImages.map((img, index) => `
      <div class="pending-image-thumb">
        <img src="${attr(img.dataUrl)}" alt="">
        <button type="button" class="danger-button small-button" data-action="remove-pending-material-prefab-image" data-index="${index}" title="Törlés">×</button>
      </div>
    `).join("");
    return `<div class="row-meta" style="margin-bottom: 4px">Beillesztett képek (${pendingMaterialPrefabImages.length}):</div><div>${thumbs}</div>`;
}

function refreshPendingMaterialPrefabImages() {
    const target = document.getElementById("material-prefab-pasted-images");
    if (target) target.innerHTML = pendingMaterialPrefabImagesMarkup();
}

function stopMobilePhotoCapture() {
    if (!mobilePhotoCapture.stream) return;
    for (const track of mobilePhotoCapture.stream.getTracks()) {
        try { track.stop(); } catch { /* noop */ }
    }
    mobilePhotoCapture.stream = null;
}

function resetMobilePhotoCapture() {
    stopMobilePhotoCapture();
    mobilePhotoCapture = { open: false, target: "", stream: null, starting: false };
}

function addPendingImage(target, dataUrl, name = "") {
    const image = {
        dataUrl,
        name: name || `${target || "kep"}-${Date.now()}.jpg`,
        type: "image/jpeg"
    };
    if (target === "cnc") {
        if (pendingCncTaskImages.length >= 10) throw new Error("Maximum 10 kép csatolható egy CNC feladathoz.");
        pendingCncTaskImages.push(image);
        refreshPendingCncTaskImages();
        return "Kép csatolva a CNC feladathoz.";
    }
    if (target === "material-prefab") {
        if (pendingMaterialPrefabImages.length >= 10) throw new Error("Maximum 10 kép csatolható egy előgyártmány szállításhoz.");
        pendingMaterialPrefabImages.push(image);
        refreshPendingMaterialPrefabImages();
        return "Kép csatolva az előgyártmány szállításhoz.";
    }
    if (pendingTaskImages.length >= 10) throw new Error("Maximum 10 kép csatolható egy feladathoz.");
    pendingTaskImages.push(image);
    refreshPendingTaskImages();
    return "Kép csatolva a feladathoz.";
}

function openMobilePhotoCapture(target) {
    if (!navigator.mediaDevices?.getUserMedia) {
        toastMessage("Ebben a böngészőben nem érhető el a kamera.", true);
        return;
    }
    resetMobilePhotoCapture();
    mobilePhotoCapture = { open: true, target: target || "task", stream: null, starting: false };
    renderModal();
}

function defaultMeetingTime() {
    const date = new Date();
    date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
    if (date.getMinutes() === 60) date.setHours(date.getHours() + 1, 0, 0, 0);
    return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function toastMessage(message, isError = false) {
    toast.textContent = message;
    toast.style.borderLeftColor = isError ? "var(--danger)" : "var(--teal)";
    toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
    const init = { method: options.method || "GET", headers: options.headers || {}, credentials: "same-origin" };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase()) && authCsrfToken) {
        init.headers = { ...init.headers, "X-CSRF-Token": authCsrfToken };
    }
    if (options.signal) init.signal = options.signal;
    if (options.cache) init.cache = options.cache;
    if (options.body !== undefined) {
        init.headers = { "Content-Type": "application/json", ...init.headers };
        init.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, init);
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) {
        // Build a human message safely. If payload is a JSON object without an
        // `error` field (e.g. the 401 {authRequired:true,...} body), never let
        // it stringify to "[object Object]" on the login screen.
        let message = "Sikertelen művelet.";
        if (typeof payload === "string" && payload.trim()) {
            message = payload;
        } else if (payload && typeof payload === "object") {
            if (payload.error) message = payload.error;
            else if (payload.authRequired) message = "Lejárt a munkamenet, jelentkezz be újra.";
            else if (payload.clearanceRequired) message = "Nincs jogosultságod ehhez.";
        }
        const error = new Error(message);
        if (response.status === 401 && payload?.authRequired) {
            // A 401 through Cloudflare can be a transient edge/cookie blip
            // rather than a real logout. Re-check /api/auth once; only drop
            // to the login screen if we are genuinely logged out. This stops
            // the random "kicked to login, reload fixes it" behavior.
            const stillAuthed = await isStillAuthenticated();
            if (stillAuthed) {
                error.transient = true;
                error.message = "Átmeneti kapcsolati hiba, próbáld újra.";
                throw error;
            }
            authRequired = true;
            authPasswordSet = Boolean(payload.passwordSet);
            authUsers = payload.users || [];
            authCsrfToken = "";
            if (!authUsers.length) await refreshAuthInfo();
            currentUser = null;
            state = null;
            renderLogin();
            error.authRequired = true;
        }
        if (response.status === 403 && payload?.clearanceRequired) {
            financeUnlocked = false;
            financeState = null;
            render();
            error.clearanceRequired = true;
        }
        throw error;
    }
    return payload;
}

// Returns true if /api/auth still reports us authenticated (or is itself
// unreachable — a network blip must NOT log the user out). Returns false
// only on a definitive {authenticated:false}. Uses raw fetch (not api())
// to avoid recursion. Refreshes currentUser from the truth on success.
async function isStillAuthenticated() {
    try {
        const r = await fetch("/api/auth", { credentials: "same-origin", cache: "no-store", headers: { "Cache-Control": "no-store" } });
        if (!r.ok) return true; // can't tell -> don't kick
        const j = await r.json();
        if (j && j.authenticated) {
            authRequired = false;
            currentUser = j.user || currentUser;
            authCsrfToken = j.csrf || authCsrfToken;
            if (Array.isArray(j.users) && j.users.length) authUsers = j.users;
            return true;
        }
        return false;
    } catch {
        return true; // network error reaching /api/auth -> treat as transient
    }
}

async function refreshAuthInfo() {
    const auth = await fetch("/api/auth", {
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Cache-Control": "no-store" }
    }).then((response) => response.json()).catch(() => null);
    authUsers = auth?.users || [];
    authPasswordSet = Boolean(auth?.passwordSet);
    authCsrfToken = auth?.csrf || "";
    currentUser = auth?.user || null;
    return auth;
}

function reportClientError(kind, error, extra = {}) {
    if (clientErrorReportCount >= 10) return;
    clientErrorReportCount += 1;
    const err = error instanceof Error ? error : new Error(String(error?.message || error || ""));
    const body = {
        kind,
        message: err.message || "",
        stack: err.stack || "",
        url: window.location.href,
        view: currentView,
        ...extra
    };
    try {
        const json = JSON.stringify(body);
        if (navigator.sendBeacon) {
            const blob = new Blob([json], { type: "application/json" });
            if (navigator.sendBeacon("/api/client-error", blob)) return;
        }
    } catch {
        // Fall back to fetch below.
    }
    fetch("/api/client-error", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true
    }).catch(() => {});
}

function renderStartupFailure(error) {
    closeEventStream();
    nav.innerHTML = "";
    modalRoot.innerHTML = "";
    title.textContent = "Betoltesi hiba";
    subtitle.textContent = "Az ERP nem tudott tisztan elindulni ebben a bongeszoablakban.";
    serverStatus.textContent = "Ujratoltes szukseges";
    const message = error?.name === "AbortError"
        ? "A kapcsolat tul lassan valaszolt."
        : "Lehet atmeneti halozati hiba, regi bongeszo allapot vagy megszakadt betoltes.";
    app.innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>ERP betoltesi hiba</h2></div>
      <div class="panel-body">
        <p>${esc(message)}</p>
        <p class="muted">Az ujratoltes megtartja a bejelentkezesi munkamenetet, ha a bongeszo cookie-ja meg ervenyes.</p>
        <button class="primary-button" type="button" data-action="reload-app">Ujratoltes</button>
      </div>
    </section>
  `;
}

// A full render() rebuilds app.innerHTML, which would clobber a form the
// user is filling and reset focus/scroll — so we skip live re-renders while
// "editing". But the old 120s blanket window meant a single stray click
// froze the view for two minutes, so live data (imports, others' entries)
// "only showed sometimes". Now: block only while actually focused in a
// field / a modal-picker is open, plus a short 8s grace after the last
// interaction. State is still loaded in the background either way; this
// only gates the repaint.
const EDIT_GRACE_MS = 8000;
function isEditing() {
    const active = document.activeElement;
    const activeInput = active && ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
    const unfinishedForm = app.querySelector('form.form-grid[data-user-draft="1"]');
    return Boolean(activeInput || unfinishedForm || Date.now() - lastFormInteractionAt < EDIT_GRACE_MS || linkBrowser.open || reportingCncTaskId || requestRepeatLoading);
}


// Background state fetches must not overwrite a form while somebody is
// typing, but a skipped repaint must not be lost forever either. Keep retrying
// the repaint until the existing edit guard says it is safe.
function requestBackgroundRender() {
    backgroundRenderPending = true;
    if (backgroundRenderTimer) return;
    const tryRender = () => {
        backgroundRenderTimer = null;
        if (!backgroundRenderPending) return;
        if (authRequired || !state) {
            backgroundRenderPending = false;
            return;
        }
        if (isEditing()) {
            backgroundRenderTimer = setTimeout(tryRender, 1000);
            return;
        }
        backgroundRenderPending = false;
        render();
    };
    tryRender();
}

async function refreshStateInBackground() {
    await loadState(false);
    requestBackgroundRender();
}

function markFormInteraction() {
    lastFormInteractionAt = Date.now();
}

function markInteractiveElement(event) {
    const target = event.target;
    if (!target?.closest) return;
    if (target.closest("form, input, textarea, select, [data-drop]")) {
        markFormInteraction();
    }
}

function markUserDraft(event) {
    const form = event.target?.closest?.("#app form.form-grid[data-action]");
    if (form) form.dataset.userDraft = "1";
}

async function loadState(renderAfter = true) {
    state = await api("/api/state");
    if (!state || typeof state !== "object" || !state.data) {
        throw new Error("Az ERP adatcsomag nem ertelmezheto.");
    }
    authRequired = false;
    authPasswordSet = Boolean(state.auth?.passwordSet);
    authCsrfToken = state.auth?.csrf || "";
    authUsers = users();
    currentUser = state.auth?.user || null;
    if (logoutButton) logoutButton.hidden = !Boolean(globalThis.ERP_DEMO_CONFIG && state.config?.localAuthRequired);
    refreshNotificationRuntimeStatus();
    ensurePwaSession().catch(() => {});
    financeUnlocked = hasFinanceClearance();
    if (!financeUnlocked) {
        financeState = null;
        securityState = null;
        hostStatus = null;
        archiveState = null;
    }
    updateServerStatus();
    updateProjectNotices();
    ensureRefreshTimer();
    ensureHostStatusRefreshTimer();
    ensureEventStream();
    maybeRefreshSecurity();
    maybeRefreshHostStatus();
    if (renderAfter) render();
}

async function loadFinanceState(renderAfter = true) {
    financeState = await api("/api/finance/state");
    financeUnlocked = hasFinanceClearance();
    if (renderAfter) render();
}

async function loadArchiveState(renderAfter = true) {
    if (!hasFinanceClearance()) {
        archiveState = null;
        return;
    }
    archiveState = await api("/api/archive/state");
    if (renderAfter) render();
}

async function loadSecurityState(renderAfter = true) {
    if (!hasFinanceClearance()) {
        securityState = null;
        return;
    }
    if (pendingSecurityFetch) return;
    pendingSecurityFetch = true;
    try {
        securityState = await api("/api/security/state");
    } catch (error) {
        if (error.clearanceRequired) securityState = null;
        else throw error;
    } finally {
        pendingSecurityFetch = false;
    }
    if (renderAfter) render();
}

async function loadHostStatus(renderAfter = true) {
    if (!hasFinanceClearance()) {
        hostStatus = null;
        return;
    }
    if (pendingHostStatusFetch) return;
    pendingHostStatusFetch = true;
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 7000) : null;
    try {
        hostStatus = await api(`/api/host-status?t=${Date.now()}`, {
            signal: controller?.signal,
            cache: "no-store",
            headers: { "Cache-Control": "no-store" }
        });
    } catch (error) {
        if (error.clearanceRequired) hostStatus = null;
        else if (error.name === "AbortError") {
            // Let the next 10s tick retry; never leave the host panel stuck.
        }
        else throw error;
    } finally {
        if (timeout) clearTimeout(timeout);
        pendingHostStatusFetch = false;
    }
    if (renderAfter) render();
}

function replaceHostStatusPanel() {
    const panel = document.querySelector("[data-host-status-panel]");
    if (!panel) return false;
    if (document.activeElement && panel.contains(document.activeElement)) return false;
    panel.outerHTML = renderHostStatusPanel();
    return true;
}

function maybeRefreshSecurity() {
    if (currentView === "stats" && hasFinanceClearance()) {
        loadSecurityState(!isEditing()).catch(() => { /* ignored */ });
    }
}

function maybeRefreshHostStatus() {
    const panelVisible = Boolean(document.querySelector("[data-host-status-panel]"));
    if ((currentView === "stats" || panelVisible) && hasFinanceClearance()) {
        loadHostStatus(false)
            .then(() => {
                if (!replaceHostStatusPanel() && !isEditing()) render();
            })
            .catch(() => { /* ignored */ });
    }
}

function ensureRefreshTimer() {
    if (refreshTimer) return;
    let tickCount = 0;
    refreshTimer = setInterval(() => {
        tickCount += 1;
        // When live updates are active, only poll every 60s (every 6th tick) as a safety net.
        if (liveUpdatesActive && tickCount % 6 !== 0) return;
        refreshStateInBackground().catch(() => { });
    }, 10000);
}

function ensureHostStatusRefreshTimer() {
    if (hostStatusRefreshTimer) return;
    hostStatusRefreshTimer = setInterval(() => {
        maybeRefreshHostStatus();
    }, 10000);
}

function refreshHostStatusSoon() {
    if (currentView === "stats" || document.querySelector("[data-host-status-panel]")) {
        maybeRefreshHostStatus();
    }
}

function ensureEventStream() {
    if (eventStream || typeof EventSource === "undefined") return;
    try {
        eventStream = new EventSource("/api/events", { withCredentials: true });
    } catch (error) {
        eventStream = null;
        return;
    }
    eventStream.addEventListener("ready", () => {
        liveUpdatesActive = true;
        // SSE has no replay buffer. A ready event can be a reconnect after a
        // sleeping PC/backgrounded PWA, so reconcile the full state now.
        scheduleLiveRefresh();
    });
    eventStream.addEventListener("state-changed", () => {
        liveUpdatesActive = true;
        scheduleLiveRefresh();
    });
    eventStream.onerror = () => {
        liveUpdatesActive = false;
        if (eventStream) {
            try { eventStream.close(); } catch { /* noop */ }
            eventStream = null;
        }
        if (eventStreamRetryTimer) return;
        eventStreamRetryTimer = setTimeout(() => {
            eventStreamRetryTimer = null;
            ensureEventStream();
        }, 5000);
    };
}

function closeEventStream() {
    liveUpdatesActive = false;
    if (eventStream) {
        try { eventStream.close(); } catch { /* noop */ }
        eventStream = null;
    }
    if (eventStreamRetryTimer) {
        clearTimeout(eventStreamRetryTimer);
        eventStreamRetryTimer = null;
    }
    backgroundRenderPending = false;
    if (backgroundRenderTimer) {
        clearTimeout(backgroundRenderTimer);
        backgroundRenderTimer = null;
    }
}

function scheduleLiveRefresh() {
    if (pendingLoadState) {
        queuedLoadState = true;
        return;
    }
    pendingLoadState = true;
    queuedLoadState = false;
    loadState(false)
        .then(() => requestBackgroundRender())
        .catch(() => { })
        .finally(() => {
            pendingLoadState = false;
            if (queuedLoadState) {
                queuedLoadState = false;
                scheduleLiveRefresh();
            }
        });
}


function refreshClientStateOnResume() {
    refreshHostStatusSoon();
    if (authRequired || !state) return;
    const now = Date.now();
    if (now - lastResumeRefreshAt < 1000) return;
    lastResumeRefreshAt = now;
    ensureEventStream();
    scheduleLiveRefresh();
}

function updateServerStatus() {
    if (!state) return;
    const fallback = globalThis.ERP_DEMO_CONFIG ? "helyi, ideiglenes demó" : (state.server.usingFallbackDirectory ? "tartalék mappa" : "Y: munkamappa");
    const scan = state.server.lastScan?.at ? `szkennelve: ${fmtDate(state.server.lastScan.at)}` : "szkennelés indul";
    serverStatus.textContent = `${state.server.hostname} · ${fallback} · ${scan}`;
}

function isModellingUser() {
    return currentUser?.id === "modelling" || currentUser?.name === "modelling";
}

function projectNoticeMarkup(notice) {
    const labels = {
        "folder-renamed": "Projektmappa átnevezve — ugyanaz a projekt",
        "project-restored": "Átnevezett projekt adatai visszaállítva",
        "archive-restored": "Archív bejegyzések visszaállítva meglévő projektbe",
        "folder-missing": "Projektmappa nem található — az adatok megmaradtak",
        "project-activated": "Projekt kézzel aktiválva",
        "project-deactivated": "Projekt kézzel inaktiválva"
    };
    const renamed = ["folder-renamed", "project-restored"].includes(notice.kind);
    const counts = Object.entries(notice.restoredCounts || {}).map(([key, count]) => `${count} ${({ materialRequests: "anyagigény", fastenerRequests: "kötőelem igény", workLogs: "munkaidő-bejegyzés" })[key] || key}`).join(", ");
    return `<article class="project-notice-item ${notice.read ? "" : "unread"}">
      <strong>${esc(labels[notice.kind] || "Projektváltozás")}</strong>
      <div>${renamed || notice.kind === "archive-restored" ? `${esc(notice.oldName || "")} → ` : ""}${esc(notice.projectName || "")}</div>
      ${notice.oldFolder ? `<div class="row-meta">${renamed ? "Régi mappa" : "Mappa"}: ${esc(notice.oldFolder)}</div>` : ""}
      ${notice.newFolder ? `<div class="row-meta">Új mappa: ${esc(notice.newFolder)}</div>` : ""}
      ${renamed ? `<p class="row-meta">Az ERP folytatásként azonosította; a kapcsolt bejegyzések ehhez a projekthez tartoznak. Ellenőrizd, hogy helyes-e. Eltérés esetén jelezd az adminisztrátornak.</p>` : ""}
      ${notice.kind === "folder-missing" ? `<p class="row-meta">Nem történt automatikus archiválás. Ellenőrizd az elérhetőséget és az átnevezést.${notice.candidates?.length ? ` Lehetséges, de nem egyértelmű folytatás: ${notice.candidates.map(esc).join("; ")}` : ""}</p>` : ""}
      ${counts ? `<div class="row-meta">Visszaállítva: ${esc(counts)}</div>` : ""}
      <div class="row-meta">${esc(fmtDate(notice.createdAt))}${notice.actorName ? ` · ${esc(notice.actorName)}` : " · Rendszer"}</div>
    </article>`;
}

function updateProjectNotices() {
    if (!projectNoticeRoot || !projectNoticeDialog) return;
    const visible = !authRequired && currentUser && !isModellingUser();
    projectNoticeRoot.hidden = !visible;
    if (!visible) {
        clearTimeout(projectNoticeTimer);
        projectNoticeTimer = null;
        projectNoticeRoot.innerHTML = "";
        projectNoticeDialog.close();
        projectNoticeDialog.innerHTML = "";
        projectNoticePopupIds = [];
        return;
    }
    const notices = data().projectNotices || [];
    const unread = notices.filter((notice) => !notice.read);
    const wasOpen = Boolean(projectNoticeRoot.querySelector("details")?.open);
    const scroll = projectNoticeRoot.querySelector(".project-notice-list")?.scrollTop || 0;
    projectNoticeRoot.innerHTML = `<details class="project-notices" ${wasOpen ? "open" : ""}>
      <summary class="small-button">Figyelmeztetések${unread.length ? ` <span class="project-notice-count">${unread.length}</span>` : ""} ▾</summary>
      <div class="project-notice-dropdown">
        <div class="project-notice-toolbar"><strong>Projektváltozások</strong><button class="small-button" type="button" data-action="read-project-notices" ${unread.length && !projectNoticeReadBusy ? "" : "disabled"}>Mind olvasott</button></div>
        <div class="project-notice-list">${notices.length ? notices.map(projectNoticeMarkup).join("") : `<p class="row-meta">Még nincs figyelmeztetés.</p>`}</div>
      </div>
    </details>${currentUser?.passwordReminderDue ? `<button class="small-button password-reminder-button" type="button" data-action="open-password-settings">Éves jelszócsere ajánlott</button>` : ""}`;
    projectNoticeRoot.querySelector(".project-notice-list").scrollTop = scroll;
    positionProjectNoticeDropdown();
    if (!projectNoticeTimer && !projectNoticeDialog.open && unread.some((notice) => ["folder-renamed", "project-restored"].includes(notice.kind))) {
        projectNoticeTimer = setTimeout(tryProjectNoticePopup, 1000);
    }
}

function positionProjectNoticeDropdown() {
    const dropdown = projectNoticeRoot?.querySelector("details[open] .project-notice-dropdown");
    if (!dropdown || window.innerWidth <= 700) return;
    const anchor = projectNoticeRoot.getBoundingClientRect();
    const width = dropdown.getBoundingClientRect().width;
    dropdown.style.left = `${Math.max(16, Math.min(anchor.left, window.innerWidth - width - 16)) - anchor.left}px`;
}

projectNoticeRoot?.addEventListener("toggle", positionProjectNoticeDropdown, true);
window.addEventListener("resize", positionProjectNoticeDropdown);

function tryProjectNoticePopup() {
    projectNoticeTimer = null;
    if (authRequired || !currentUser || isModellingUser() || demoModellingMode || projectNoticeDialog?.open) return;
    const notices = (data().projectNotices || []).filter((notice) => !notice.read && ["folder-renamed", "project-restored"].includes(notice.kind));
    if (!notices.length) return;
    // Separate dialog/root: never rebuild an unfinished ERP form or another modal.
    if (isEditing() || modalRoot.childElementCount || projectNoticeRoot.querySelector("details")?.open) {
        projectNoticeTimer = setTimeout(tryProjectNoticePopup, 2000);
        return;
    }
    projectNoticePopupIds = notices.map((notice) => notice.id);
    projectNoticePreviousFocus = document.activeElement;
    projectNoticeDialog.innerHTML = `<div class="project-notice-toolbar"><h2 id="project-notice-title">Projektmappa változás — ellenőrzés</h2><button class="icon-button" type="button" data-action="close-project-notices" aria-label="Bezárás" autofocus>×</button></div>
      <div class="project-notice-list">${notices.map(projectNoticeMarkup).join("")}</div>
      <p class="row-meta">Bezárás után is visszanézhető a Figyelmeztetések menüben. Az olvasottság felhasználónként megmarad.</p>`;
    projectNoticeDialog.showModal();
}

async function markProjectNoticesRead(ids) {
    if (projectNoticeReadBusy) return;
    projectNoticeReadBusy = true;
    try {
        if (ids.length) await api("/api/project-notices/read", { method: "POST", body: { ids } });
        for (const notice of data().projectNotices || []) if (ids.includes(notice.id)) notice.read = true;
        if (projectNoticeDialog.open) {
            projectNoticeDialog.close();
            projectNoticeDialog.innerHTML = "";
            projectNoticePreviousFocus?.focus?.({ preventScroll: true });
        }
        projectNoticePopupIds = [];
    } finally {
        projectNoticeReadBusy = false;
        updateProjectNotices();
    }
}

projectNoticeDialog?.addEventListener("cancel", (event) => {
    event.preventDefault();
    markProjectNoticesRead(projectNoticePopupIds).catch((error) => toastMessage(error.message, true));
});

function renderLogin() {
    updateProjectNotices();
    nav.innerHTML = "";
    modalRoot.innerHTML = "";
    title.textContent = "Bejelentkezés";
    subtitle.textContent = "Válassz felhasználót, majd add meg a személyes jelszót.";
    serverStatus.textContent = "Védett mód";
    if (logoutButton) logoutButton.hidden = true;
    if (globalThis.ERP_DEMO_CONFIG && !authPasswordSet) {
        const admin = authUsers[0];
        app.innerHTML = `<div class="login-shell"><section class="panel login-panel">
          <div class="panel-header"><h2>Helyi admin beállítása</h2></div><div class="panel-body">
            <p>Ez az egyszeri beállítás csak a helyi demó profilt védi. Külső eléréshez további telepítési és adatbiztonsági lépések szükségesek.</p>
            <form class="form-grid" data-action="setup-demo-admin">
              <input type="hidden" name="userId" value="${attr(admin?.id || "")}">
              <p class="wide">Első admin: <strong>${esc(admin?.name || "Nincs beállított admin")}</strong></p>
              <label class="wide">Új jelszó (legalább 14 karakter)<input name="password" type="password" minlength="14" maxlength="128" autocomplete="new-password" required></label>
              <label class="wide">Jelszó újra<input name="passwordAgain" type="password" minlength="14" maxlength="128" autocomplete="new-password" required></label>
              <button class="primary-button wide" type="submit" ${admin ? "" : "disabled"}>Admin beállítása</button>
            </form>
          </div></section></div>`;
        return;
    }
    app.innerHTML = `
    <div class="login-shell">
      <section class="panel login-panel">
        <div class="panel-header"><h2>Bejelentkezés</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="login">
            <label class="wide">Felhasználó${loginUserSelectHtml()}</label>
            <label class="wide">Jelszó<input name="password" type="password" ${globalThis.ERP_DEMO_CONFIG ? 'minlength="14"' : 'minlength="4"'} required autocomplete="current-password"></label>
            <p class="password-reminder-login wide" id="login-password-reminder" hidden>Éves jelszócsere ajánlott. Belépés után a Beállításokban változtasd meg a jelszavad.</p>
            <label class="wide checkbox-label"><input type="checkbox" data-action="toggle-password-visibility"><span>Jelszó megjelenítése</span></label>
            <button class="primary-button wide" type="submit">Belépés</button>
          </form>
        </div>
      </section>
    </div>
  `;
    updateLoginPasswordReminder();
}

function updateLoginPasswordReminder() {
    const form = app.querySelector('form[data-action="login"]');
    const reminder = form?.querySelector("#login-password-reminder");
    if (!reminder) return;
    const selectedId = form.elements.userId?.value || "";
    const user = (authUsers.length ? authUsers : users()).find((item) => item.id === selectedId);
    const updatedAt = Date.parse(user?.passwordUpdatedAt || user?.createdAt || "");
    reminder.hidden = !user || (Number.isFinite(updatedAt) && Date.now() - updatedAt < 365 * 24 * 60 * 60 * 1000);
}

function loginUserSelectHtml() {
    const list = authUsers.length ? authUsers : users();
    const selectedId = loginDefaultUserId(list);
    const defaultUser = list.find((user) => String(user.name || "").trim().toLowerCase() === "demouser");
    const fallbackId = defaultUser?.id || list[0]?.id || "";
    const effectiveSelectedId = selectedId || fallbackId;
    const options = list.map((user) => `<option value="${attr(user.id)}" ${user.id === effectiveSelectedId ? "selected" : ""}>${esc(user.name)}</option>`).join("");
    // The modelling photo-upload login is appended on the login page only —
    // it is not a real ERP user (server keeps it hidden from every user
    // list), so it never shows up in responsibles/worklog/settings pickers.
    return `<select name="userId" required autofocus data-action="login-user-select">${options}${globalThis.ERP_DEMO_CONFIG ? "" : `<option value="modelling" ${effectiveSelectedId === "modelling" ? "selected" : ""}>modelling</option>`}</select>`;
}

function rememberedLoginUserId() {
    try {
        return localStorage.getItem(LOGIN_USER_STORAGE_KEY) || "";
    } catch {
        return "";
    }
}

function rememberLoginUserId(userId) {
    const clean = String(userId || "").trim();
    if (!clean) return;
    try {
        localStorage.setItem(LOGIN_USER_STORAGE_KEY, clean);
    } catch {
        // Storage can be blocked in some browser modes; default selection still works.
    }
}

function loginDefaultUserId(list) {
    const saved = rememberedLoginUserId();
    if (saved === "modelling" && !globalThis.ERP_DEMO_CONFIG) return saved;
    if (saved && (list || []).some((user) => user.id === saved)) return saved;
    return "";
}

const NOTIFICATION_MENU_OPTIONS = [
    ["dashboard", "Kezdőképernyő"],
    ["project-view", "Projekt nézet"],
    ["cnc-summary", "CNC összesítő"],
    ["todos", "Feladatok"],
    ["cnc", "CNC megmunkálás"],
    ["tools", "Szerszámigények"],
    ["materials", "Anyagigények"],
    ["fasteners", "Kötőelem igények"],
    ["worklog", "Munkaidő napló"],
    ["bom", "BOM"],
    ["finance", "Pénzügy / mérnökség"]
];

const NOTIFICATION_SETTINGS_DEFAULTS = {
    enabled: true,
    menuNotifications: Object.fromEntries(NOTIFICATION_MENU_OPTIONS.map(([key]) => [key, true])),

    detailLevel: "normal"
};

function isIosLike() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent || "") || (navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1);
}

function isStandalonePwa() {
    return Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone);
}

function refreshNotificationRuntimeStatus() {
    pwaStatus.standalone = isStandalonePwa();
    pwaStatus.pushSupported = Boolean("serviceWorker" in navigator && "PushManager" in window && "Notification" in window);
    pwaStatus.notificationPermission = "Notification" in window ? Notification.permission : "unsupported";
    return pwaStatus;
}

function notificationSettings() {
    const raw = currentUser?.notificationSettings || {};
    const menuNotifications = { ...NOTIFICATION_SETTINGS_DEFAULTS.menuNotifications, ...(raw.menuNotifications || {}) };
    if (!raw.menuNotifications && Object.prototype.hasOwnProperty.call(raw, "worklogCreated")) {
        menuNotifications.worklog = raw.worklogCreated !== false;
    }
    return { ...NOTIFICATION_SETTINGS_DEFAULTS, ...raw, menuNotifications };
}

function updateCurrentUser(user) {
    if (!user) return;
    currentUser = user;
    if (state?.auth) state.auth.user = user;
}

function hasActivePushSubscription() {
    return Boolean(pwaStatus.subscribed);
}

function userPushSubscriptionCount() {
    return Math.max(Number(currentUser?.pushSubscriptionCount || 0), pwaStatus.subscribed ? 1 : 0);
}

function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - String(value || "").length % 4) % 4);
    const base64 = `${value}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
    return output;
}

async function registerServiceWorker() {
    if (globalThis.ERP_DEMO_CONFIG) return null;
    refreshNotificationRuntimeStatus();
    if (!("serviceWorker" in navigator)) return null;
    try {
        const registration = await navigator.serviceWorker.register("/sw.js");
        pwaStatus.registration = registration;
        pwaStatus.swReady = true;
        if (registration.pushManager) {
            const sub = await registration.pushManager.getSubscription().catch(() => null);
            pwaStatus.subscribed = Boolean(sub);
        }
        return registration;
    } catch (error) {
        pwaStatus.registration = null;
        pwaStatus.swReady = false;
        console.warn("PWA service worker registration failed", error);
        return null;
    } finally {
        refreshNotificationRuntimeStatus();
    }
}

async function ensurePwaSession() {
    if (!isStandalonePwa() || !currentUser?.id || pwaSessionEnsuredForUserId === currentUser.id) return;
    pwaSessionEnsuredForUserId = currentUser.id;
    try {
        const result = await api("/api/pwa/session", { method: "POST" });
        updateCurrentUser(result.user);
    } catch (error) {
        pwaSessionEnsuredForUserId = "";
        console.warn("PWA session extension failed", error);
    }
}

async function installPwa() {
    refreshNotificationRuntimeStatus();
    if (pwaStatus.standalone) {
        toastMessage("Az ERP telepített appként fut.");
        return;
    }
    if (!deferredInstallPrompt) {
        toastMessage(isIosLike() ? "iOS: Megosztás -> Hozzáadás a főképernyőhöz." : "Telepítés a böngésző menüjéből érhető el.");
        return;
    }
    const promptEvent = deferredInstallPrompt;
    deferredInstallPrompt = null;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice.catch(() => null);
    toastMessage(choice?.outcome === "accepted" ? "ERP app telepítése elindult." : "Telepítés megszakítva.", choice?.outcome !== "accepted");
    refreshNotificationRuntimeStatus();
    if (currentView === "stats") render();
}

async function enablePushNotifications() {
    if (notificationActionBusy) return;
    notificationActionBusy = true;
    try {
        refreshNotificationRuntimeStatus();
        if (!pwaStatus.standalone) throw new Error("Értesítést csak a telepített ERP appban lehet bekapcsolni.");
        if (!pwaStatus.pushSupported) throw new Error("Ez a böngésző nem támogatja az ERP értesítéseket.");
        const registration = pwaStatus.registration || await registerServiceWorker();
        if (!registration?.pushManager) throw new Error("Ez a böngésző nem támogatja az ERP értesítéseket.");
        let permission = Notification.permission;
        if (permission !== "granted") permission = await Notification.requestPermission();
        refreshNotificationRuntimeStatus();
        if (permission !== "granted") throw new Error("Az értesítés engedélyezése elmaradt.");
        const keyInfo = await api("/api/pwa/vapid-public-key");
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(keyInfo.publicKey)
            });
        }
        const result = await api("/api/push/subscribe", {
            method: "POST",
            body: { subscription: subscription.toJSON ? subscription.toJSON() : subscription }
        });
        pwaStatus.subscribed = true;
        updateCurrentUser(result.user);
        toastMessage("Értesítések bekapcsolva.");
        await loadState(true);
    } finally {
        notificationActionBusy = false;
    }
}

async function disablePushNotifications() {
    if (notificationActionBusy) return;
    notificationActionBusy = true;
    try {
        const registration = pwaStatus.registration || await registerServiceWorker();
        const subscription = registration?.pushManager ? await registration.pushManager.getSubscription().catch(() => null) : null;
        if (subscription) {
            await api("/api/push/unsubscribe", { method: "POST", body: { endpoint: subscription.endpoint } });
            await subscription.unsubscribe().catch(() => false);
        }
        pwaStatus.subscribed = false;
        toastMessage("Értesítések kikapcsolva ezen az eszközön.");
        await loadState(true);
    } finally {
        notificationActionBusy = false;
    }
}

async function sendTestNotification() {
    if (!hasActivePushSubscription()) throw new Error("Ezen az eszközön nincs bekapcsolt ERP értesítés.");
    await api("/api/push/test", { method: "POST" });
    toastMessage("Teszt értesítés elküldve.");
}

function applyRouteFromUrl() {
    const params = new URLSearchParams(window.location.search || "");
    const view = params.get("view") || "";
    if (view && VIEWS.some(([id]) => id === view)) currentView = view;
    const panel = String(params.get("panel") || "").replace(/[^a-z0-9_-]/gi, "");
    if (panel) {
        pendingSettingsPanelFocus = panel;
        if (panel === "password" || panel === "notifications") currentView = "stats";
    }
}

function focusRequestedSettingsPanel() {
    if (!pendingSettingsPanelFocus || currentView !== "stats") return;
    const panelName = pendingSettingsPanelFocus;
    const panel = document.querySelector(`[data-settings-panel="${panelName}"]`);
    if (!panel) return;
    pendingSettingsPanelFocus = "";
    window.setTimeout(() => {
        panel.scrollIntoView({ block: "start", behavior: "smooth" });
        panel.focus?.({ preventScroll: true });
    }, 50);
}

function renderClearanceDenied() {
    modalRoot.innerHTML = "";
    app.innerHTML = `<div class="empty">Nincs jogosultság ehhez a menühöz. 2-es jogosultsági szint szükséges.</div>`;
}

async function loadModellingFolders() {
    try {
        const response = await api("/api/modelling/folders");
        modellingFolders = response.folders || [];
    } catch {
        modellingFolders = [];
    }
    if (isModellingUser() || demoModellingMode) render();
}

function renderModellingPage() {
    nav.innerHTML = "";
    modalRoot.innerHTML = "";
    title.textContent = "Modelling fotók";
    subtitle.textContent = "Fotózz a telefonnal, add meg a projekt mappát, majd töltsd fel.";
    serverStatus.textContent = "Modelling mód";
    if (modellingFolders === null) {
        modellingFolders = [];
        loadModellingFolders();
    }
    const previews = modellingPhotos.map((photo, index) => `
      <div style="position: relative; display: inline-block; margin: 4px">
        <img src="${photo.dataUrl}" alt="" style="width: 110px; height: 110px; object-fit: cover; border-radius: 8px; border: 1px solid #2c3235">
        <button class="danger-button small-button" type="button" data-action="remove-modelling-photo" data-index="${index}" style="position: absolute; top: 2px; right: 2px; padding: 2px 8px" ${modellingUploadBusy ? "disabled" : ""}>×</button>
      </div>
    `).join("");
    app.innerHTML = `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Fotó feltöltés</h2>${globalThis.ERP_DEMO_CONFIG ? `<button class="small-button" type="button" data-action="exit-demo-modelling" ${modellingUploadBusy ? "disabled" : ""}>Vissza a demóba</button>` : ""}</div>
        <div class="panel-body">
          <form class="form-grid" data-action="upload-modelling-photos">
            <label class="wide">Projekt mappa neve
              <input name="folder" list="modelling-folder-list" autocomplete="off" required placeholder="pl. DEMO-050 minta" value="${attr(modellingFolderName)}" data-action="modelling-folder-input" ${modellingUploadBusy ? "disabled" : ""}>
            </label>
            ${datalist("modelling-folder-list", modellingFolders || [])}
            <label class="wide">Fotók készítése / kiválasztása
              <input type="file" accept="image/*" capture="environment" multiple data-action="modelling-photos-input" style="display: block; margin-top: 6px" ${modellingUploadBusy ? "disabled" : ""}>
            </label>
            <div class="wide">${previews || `<div class="empty">Még nincs fotó. A fenti gombbal fotózhatsz vagy választhatsz a galériából.</div>`}</div>
            <div class="wide row-meta" id="modelling-upload-status"></div>
            <button class="primary-button wide" type="submit" ${modellingPhotos.length && !modellingUploadBusy ? "" : "disabled"}>${modellingUploadBusy ? "Feltöltés folyamatban..." : `Feltöltés (${modellingPhotos.length} fotó)`}</button>
          </form>
          <p class="row-meta" style="margin-top: 12px">A fotók ide kerülnek: <span class="path-text">${globalThis.ERP_DEMO_CONFIG ? ".demo-data/modelling/&lt;mappa&gt; (csak helyi demó)" : "Y:\\WorkshopProjects\\EGYEB\\modelling\\&lt;mappa&gt;"}</span></p>
        </div>
      </section>
    </div>
  `;
}

function showLoginWarning(failureCount) {
    const severe = failureCount >= 2;
    const message = severe
        ? "Válaszd ki a megfelelő felhasználót és tudd a jelszót hozzá. Ha mégegyszer rosszat adsz meg letilt a rendszer."
        : "Hibás felhasználói jelszó. Próbáld újra.";
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-login-warning">
      <article class="modal" style="max-width: 420px">
        <header class="modal-header">
          <div><h2>${severe ? "Figyelem" : "Hibás jelszó"}</h2></div>
          <button class="icon-button" type="button" data-action="close-login-warning" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          <p>${esc(message)}</p>
          <div class="inline-actions" style="margin-top: 16px; justify-content: flex-end">
            <button class="primary-button" type="button" data-action="close-login-warning">Értem</button>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderNav() {
    const visibleViews = VIEWS;
    const beforeFinance = visibleViews.filter(([id]) => !PROTECTED_VIEWS.has(id) && ["dashboard", "project-view", "cnc-summary", "todos", "cnc", "tools", "materials", "fasteners", "worklog", "bom", "cad-models", "projects"].includes(id));
    const financeViews = visibleViews.filter(([id]) => PROTECTED_VIEWS.has(id));
    const afterFinance = visibleViews.filter(([id]) => !PROTECTED_VIEWS.has(id) && !beforeFinance.some(([beforeId]) => beforeId === id));
    const navButton = ([id, label]) => `
    <button class="nav-button ${id === currentView ? "active" : ""}" type="button" data-action="view" data-view="${id}">
      <span class="nav-icon">${ICONS[id]}</span>
      <span>${label}</span>
    </button>
  `;
    nav.innerHTML = `
      ${beforeFinance.map(navButton).join("")}
      <details class="nav-group" data-finance-menu ${financeMenuOpen ? "open" : ""}>
        <summary><span class="nav-icon">13</span><span>Pénzügy / mérnökség</span></summary>
        ${financeViews.map(navButton).join("")}
      </details>
      ${afterFinance.map(navButton).join("")}
    `;
}

// A full render() replaces app.innerHTML, which otherwise resets the page
// scroll, every internal .scroll-area list, and the caret in a focused field.
// Background SSE/state refreshes and direct action handlers both re-render, so
// a teammate's new entry (or your own action) used to snap a scrolled list back
// to the top. We only restore when the SAME view is repainted in place; a real
// navigation still starts fresh at the top.
let lastContentView = null;

function captureRenderState() {
    if (lastContentView !== currentView) return null;
    const saved = {
        winX: window.scrollX,
        winY: window.scrollY,
        scrollers: Array.from(app.querySelectorAll(".scroll-area")).map((el) => ({ top: el.scrollTop, left: el.scrollLeft })),
        focus: null
    };
    const active = document.activeElement;
    if (active && app.contains(active) && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")
        && !active.closest("[data-option-picker], [data-project-picker]")) {
        const all = Array.from(app.querySelectorAll("input, textarea"));
        saved.focus = {
            index: all.indexOf(active),
            name: active.getAttribute("name") || "",
            action: active.dataset.action || "",
            selStart: active.selectionStart,
            selEnd: active.selectionEnd
        };
    }
    return saved;
}

function restoreRenderState(saved) {
    if (!saved) return;
    try {
        const scrollers = app.querySelectorAll(".scroll-area");
        for (let i = 0; i < saved.scrollers.length; i++) {
            const el = scrollers[i];
            if (el) {
                el.scrollTop = saved.scrollers[i].top;
                el.scrollLeft = saved.scrollers[i].left;
            }
        }
        if (saved.winX || saved.winY) window.scrollTo(saved.winX, saved.winY);
        const f = saved.focus;
        if (f) {
            const all = Array.from(app.querySelectorAll("input, textarea"));
            const matches = (c) => c && ((f.name && c.getAttribute("name") === f.name) || (f.action && (c.dataset.action || "") === f.action));
            let el = (f.index >= 0 && f.index < all.length) ? all[f.index] : null;
            if (!el || ((f.name || f.action) && !matches(el))) el = all.find(matches) || el;
            if (el && !el.disabled && el.offsetParent !== null && document.activeElement !== el) {
                el.focus({ preventScroll: true });
                if (f.selStart != null && typeof el.setSelectionRange === "function") {
                    try { el.setSelectionRange(f.selStart, f.selEnd); } catch (_e) { /* ignore */ }
                }
            }
        }
    } catch (_e) {
        /* scroll/focus restore is best-effort; never let it break a render */
    }
}

function render() {
    if (authRequired) {
        lastContentView = null;
        renderLogin();
        return;
    }
    if (isModellingUser() || demoModellingMode) {
        lastContentView = null;
        renderModellingPage();
        return;
    }
    if (globalThis.ERP_DEMO_CONFIG && !DEMO_VIEWS.has(currentView)) currentView = "dashboard";
    const restoreState = captureRenderState();
    renderNav();
    const view = VIEWS.find(([id]) => id === currentView) || VIEWS[0];
    title.textContent = view[1];
    subtitle.textContent = view[2];

    if (LEVEL2_VIEWS.has(currentView) && !hasFinanceClearance()) {
        lastContentView = null;
        renderClearanceDenied();
        return;
    }
    if (FINANCE_DATA_VIEWS.has(currentView) && !financeState) {
        app.innerHTML = `<div class="empty">Védett adatok betöltése...</div>`;
        loadFinanceState(true).catch((error) => {
            if (!error.clearanceRequired) toastMessage(error.message, true);
        });
        return;
    }
    if (currentView === "archive" && !archiveState) {
        app.innerHTML = `<div class="empty">Archív adatok betöltése...</div>`;
        loadArchiveState(true).catch((error) => {
            if (!error.clearanceRequired) toastMessage(error.message, true);
        });
        return;
    }

    if (!state) {
        app.innerHTML = `<div class="empty">Adatok betöltése...</div>`;
        return;
    }

    const views = {
        dashboard: renderDashboard,
        "project-view": renderProjectView,
        "cnc-summary": renderCncSummary,
        todos: renderTodos,
        cnc: renderCnc,
        tools: renderTools,
        materials: renderMaterials,
        fasteners: renderFasteners,
        worklog: renderWorklog,
        bom: renderBom,
        "cad-models": renderCadModels,
        suppliers: renderSuppliers,
        "price-items": renderPriceItems,
        "cost-planning": renderCostPlanning,
        outsourcing: renderOutsourcing,
        "production-items": renderProductionItems,
        design: renderDesign,
        quotes: renderQuotes,
        "engineering-notes": renderEngineeringNotes,
        "finance-reports": renderFinanceReports,
        production: renderProduction,
        projects: renderProjects,
        parameters: renderParameters,
        users: renderUsers,
        catalog: renderCatalog,
        stats: renderSettings,
        archive: renderArchive
    };

    projectPickerSeq = 0;
    app.innerHTML = (views[currentView] || renderDashboard)();
    renderModal();
    applyDeleteButtonPermissions(document);
    restoreRenderState(restoreState);
    focusRequestedSettingsPanel();
    lastContentView = currentView;
}

function data() {
    return state?.data || {};
}

function projects(includeInactive = true) {
    const list = state?.orderedProjects || Object.values(data().projects || {});
    return includeInactive ? list : list.filter((project) => project.active);
}

function projectById(projectId) {
    return data().projects?.[projectId] || null;
}

function isActiveProjectId(projectId) {
    return Boolean(projectById(projectId)?.active);
}

function users() {
    return data().users || [];
}

function hasFinanceClearance() {
    return Number(currentUser?.clearanceLevel || 0) >= 2;
}

function itemCreatedByCurrentUser(item) {
    if (!item || !currentUser) return false;
    if (item.createdByUserId) return item.createdByUserId === currentUser.id;
    if (item.createdByName) return normalizeSearch(item.createdByName) === normalizeSearch(currentUser.name);
    return false;
}

function canDeleteEntry(item) {
    return hasFinanceClearance() || itemCreatedByCurrentUser(item);
}

function canDeleteFileEntry(file) {
    if (canDeleteEntry(file)) return true;
    const d = data();
    if (file?.taskId && canDeleteEntry((d.tasks || []).find((item) => item.id === file.taskId))) return true;
    if (file?.cncTaskId && canDeleteEntry((d.cncTasks || []).find((item) => item.id === file.cncTaskId))) return true;
    return false;
}

function itemForOwnerDeleteAction(action, id) {
    const d = data();
    if (action === "delete-task") return (d.tasks || []).find((item) => item.id === id);
    if (action === "delete-cnc-task") return (d.cncTasks || []).find((item) => item.id === id);
    if (action === "delete-tool") return (d.toolRequests || []).find((item) => item.id === id);
    if (action === "delete-material") return (d.materialRequests || []).find((item) => item.id === id);
    if (action === "delete-fastener") return (d.fastenerRequests || []).find((item) => item.id === id);
    if (action === "delete-worklog") return (d.workLogs || []).find((item) => item.id === id);
    if (action === "delete-bom") return (d.boms || []).find((item) => item.id === id);
    if (action === "delete-file") return (d.files || []).find((item) => item.id === id);
    return null;
}

function applyDeleteButtonPermissions(root = document) {
    if (!root?.querySelectorAll) return;
    const actions = "delete-task,delete-cnc-task,delete-tool,delete-material,delete-fastener,delete-worklog,delete-bom,delete-file";
    root.querySelectorAll("button[data-action]").forEach((button) => {
        const action = button.dataset.action || "";
        if (!actions.split(",").includes(action)) return;
        const item = itemForOwnerDeleteAction(action, button.dataset.id || "");
        button.hidden = action === "delete-file" ? !canDeleteFileEntry(item) : !canDeleteEntry(item);
    });
}

function financeData() {
    return financeState || {
        suppliers: [],
        priceItems: [],
        costItems: [],
        outsourceItems: [],
        productionItems: [],
        designItems: [],
        quotes: [],
        engineeringNotes: [],
        settings: { categories: [], currencies: [], statuses: [] }
    };
}

function financeSettings() {
    const settings = financeData().settings || {};
    const demoDefaults = globalThis.ERP_DEMO_CONFIG ? {
        categories: ["Material", "Tool", "CNC", "Outsourcing", "Shipping", "Other"],
        currencies: ["HUF", "EUR"],
        statuses: ["Planned", "Ordered", "Received", "Invoiced"],
        quoteStatuses: ["Requested", "Received", "Accepted", "Rejected", "Expired"],
        noteTypes: ["Decision", "Change", "Risk", "Question", "Review"],
        noteStatuses: ["Open", "In progress", "Closed"],
        outsourceOperations: ["Sawing", "Wire EDM", "Heat treatment", "Surface treatment", "Grinding", "Waterjet cutting"],
        outsourceStatuses: ["New", "Issued", "In progress", "Returned", "Done"],
        productionOperations: ["Sawing", "CNC milling", "CNC turning", "Wire EDM", "Assembly", "Fabrication"],
        productionWorkplaces: ["CNC-01", "CNC-02", "External"],
        productionTypes: ["Internal", "External"],
        productionPriorities: ["High", "Normal", "Low"],
        productionStatuses: ["New", "In progress", "Issued", "Done"],
        costCategories: ["Material", "Outsourcing", "Tool", "CNC", "Engineering", "Shipping", "Other"],
        designAreas: ["Mechanical CAD", "CAD/CAM", "Electrical design", "PLC", "Documentation"],
        designStatuses: ["New", "Awaiting approval", "NC issued", "EPLAN ready", "Issued", "Done"]
    } : {};
    const fallback = (key, original) => settings[key]?.length ? settings[key] : (demoDefaults[key] || original);
    return {
        categories: fallback("categories", ["Anyag", "Szerszám", "CNC", "Alvállalkozó", "Szállítás", "Egyéb"]),
        currencies: fallback("currencies", ["HUF", "EUR"]),
        statuses: fallback("statuses", ["Tervezett", "Rendelve", "Beérkezett", "Számlázva"]),
        quoteStatuses: fallback("quoteStatuses", ["Bekérve", "Beérkezett", "Elfogadva", "Elutasítva", "Lejárt"]),
        noteTypes: fallback("noteTypes", ["Döntés", "Változás", "Kockázat", "Kérdés", "Ellenőrzés"]),
        noteStatuses: fallback("noteStatuses", ["Nyitott", "Folyamatban", "Lezárva"]),
        outsourceOperations: fallback("outsourceOperations", ["Fűrészelés", "Huzalszikra", "Hőkezelés", "Felületkezelés", "Köszörülés", "Vízvágás"]),
        outsourceStatuses: fallback("outsourceStatuses", ["Új", "Kiadva", "Folyamatban", "Visszaérkezett", "Kész"]),
        productionOperations: fallback("productionOperations", ["Fűrészelés", "CNC marás", "CNC eszterga", "Huzalszikra", "Szerelés", "Lakatos munka"]),
        productionWorkplaces: fallback("productionWorkplaces", ["CNC-01", "CNC-02", "Külső"]),
        productionTypes: fallback("productionTypes", ["Belső", "Külső"]),
        productionPriorities: fallback("productionPriorities", ["Magas", "Normál", "Alacsony"]),
        productionStatuses: fallback("productionStatuses", ["Új", "Folyamatban", "Kiadva", "Kész"]),
        costCategories: fallback("costCategories", ["Anyag", "Bérmunka", "Szerszám", "CNC", "Mérnöki", "Szállítás", "Egyéb"]),
        designAreas: fallback("designAreas", ["Mechanika CAD", "CAD/CAM", "Villamos tervezés", "PLC", "Dokumentáció"]),
        designStatuses: fallback("designStatuses", ["Új", "Jóváhagyásra vár", "NC kiadva", "EPLAN kész", "Kiadva", "Kész"])
    };
}

function supplierOptions(selectedId = "") {
    const suppliers = financeData().suppliers || [];
    return [`<option value="">Nincs / később</option>`]
        .concat(suppliers.map((supplier) => `<option value="${attr(supplier.id)}" ${supplier.id === selectedId ? "selected" : ""}>${esc(supplier.name)}</option>`))
        .join("");
}

function optionList(items, selected = "") {
    return (items || []).map((item) => `<option value="${attr(item)}" ${item === selected ? "selected" : ""}>${esc(item)}</option>`).join("");
}

function supplierName(supplierId, fallback = "") {
    return (financeData().suppliers || []).find((supplier) => supplier.id === supplierId)?.name || fallback || "";
}

function itemTotal(item) {
    return Number(item.quantity || 0) * Number(item.unitPrice || 0);
}

function money(value, currency = "HUF") {
    const number = Number(value || 0);
    return `${new Intl.NumberFormat(globalThis.ERP_DEMO_CONFIG ? "en-GB" : "hu-HU", { maximumFractionDigits: 2 }).format(number)} ${currency || ""}`.trim();
}

function formatHours(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat(globalThis.ERP_DEMO_CONFIG ? "en-GB" : "hu-HU", {
        minimumFractionDigits: 0,
        maximumFractionDigits: 1
    }).format(Math.round(number * 10) / 10);
}

function moneyTotals(items) {
    const totals = {};
    for (const item of items || []) {
        const currency = item.currency || "HUF";
        totals[currency] = (totals[currency] || 0) + itemTotal(item);
    }
    return Object.entries(totals).map(([currency, value]) => money(value, currency)).join(" + ") || "0";
}

function amountTotals(items) {
    const totals = {};
    for (const item of items || []) {
        const currency = item.currency || "HUF";
        totals[currency] = (totals[currency] || 0) + Number(item.amount || 0);
    }
    return Object.entries(totals).map(([currency, value]) => money(value, currency)).join(" + ") || "0";
}

function sumField(items, field) {
    return (items || []).reduce((sum, item) => sum + Number(item[field] || 0), 0);
}

function statusBadge(text, extra = "") {
    return `<span class="state-badge ${attr(extra)}">${esc(text || "-")}</span>`;
}

function allWorkplaces() {
    const settings = financeSettings();
    const machineNames = (data().cncMachines || []).map((machine) => machine.name).filter(Boolean);
    return Array.from(new Set([...machineNames, ...settings.productionWorkplaces]));
}

function pathButton(label, filePath) {
    if (!filePath) return "";
    const pdf = /\.pdf$/i.test(filePath);
    return `
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="open-file" data-path="${attr(filePath)}">${esc(label)}</button>
        <button class="small-button" type="button" data-action="reveal-file" data-path="${attr(filePath)}">Mappa</button>
        ${pdf ? `<button class="small-button" type="button" data-action="open-file" data-path="${attr(filePath)}">${esc(label)} PDF</button>` : ""}
      </span>
    `;
}

function userById(userId) {
    return users().find((user) => user.id === userId) || null;
}

function projectResponsibleIds(project) {
    return Array.isArray(project?.responsibleUserIds) ? project.responsibleUserIds : [];
}

function projectResponsibleNames(project) {
    return projectResponsibleIds(project)
        .map((userId) => userById(userId)?.name)
        .filter(Boolean);
}

function projectResponsibleText(project) {
    const names = projectResponsibleNames(project);
    return names.length ? names.join(", ") : "Nincs felelős";
}

function projectMatchesOwner(project, userId) {
    return !userId || projectResponsibleIds(project).includes(userId);
}

function activeProjectOptions(selectedId = "") {
    return [`<option value="" disabled ${selectedId ? "" : "selected"}>Projekt választás</option>`]
        .concat(projects(false).map((project) => `<option value="${attr(project.id)}" ${project.id === selectedId ? "selected" : ""}>${esc(project.name)}</option>`))
        .join("");
}

function projectPicker(selectedId = "", { action = "", required = true } = {}) {
    const id = `project-picker-${++projectPickerSeq}`;
    const selected = projectById(selectedId);
    const actionAttr = action ? ` data-action="${attr(action)}"` : "";
    const requiredAttr = required ? " required" : "";
    return `
      <span class="project-picker" data-project-picker data-picker-id="${attr(id)}">
        <input type="hidden" name="projectId" value="${attr(selected?.id || "")}" data-project-id>
        <span class="project-picker-field">
          <input type="text" value="${attr(selected?.name || "")}" placeholder="Projekt v&aacute;laszt&aacute;s" autocomplete="off" data-project-picker-input${actionAttr}${requiredAttr}>
          <button class="project-picker-arrow" type="button" data-action="project-picker-toggle" aria-label="Akt&iacute;v projektek list&aacute;ja">v</button>
        </span>
        <div class="project-picker-menu" data-project-picker-menu hidden>${projectPickerMenuOptions(projects(false))}</div>
      </span>
    `;
}

function projectPickerMenuOptions(list) {
    const items = list || [];
    if (!items.length) return `<div class="project-picker-empty">Nincs akt&iacute;v projekt.</div>`;
    return items.map((project) => `
      <button class="project-picker-option" type="button" data-action="project-picker-select" data-project-id="${attr(project.id)}">
        <span>${esc(project.name)}</span>
        ${project.primaryFolder ? `<small>${esc(project.primaryFolder)}</small>` : ""}
      </button>
    `).join("");
}

function projectPickerMatches(project, query) {
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const haystack = normalizeSearch(`${project.name} ${project.primaryFolder || ""} ${project.source || ""} ${projectResponsibleText(project)} ${project.deadline || ""}`);
    return terms.every((term) => haystack.includes(term));
}

function projectPickerExactProject(value) {
    const q = normalizeSearch(value);
    if (!q) return null;
    return projects(false).find((project) => normalizeSearch(project.name) === q) || null;
}

function normalizeOcrProjectText(value) {
    return String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toUpperCase()
        .replace(/[\\/_:;,.()[\]{}+]+/g, " ")
        .replace(/[^A-Z0-9 ]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function ocrProjectTokens(value) {
    return normalizeOcrProjectText(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 2);
}

function ocrCodeDigits(value) {
    return String(value || "")
        .toUpperCase()
        .replace(/[OQ]/g, "0")
        .replace(/[IL]/g, "1")
        .replace(/[^0-9]/g, "");
}

function addOcrProjectCode(codes, yearValue, numberValue) {
    const year = ocrCodeDigits(yearValue);
    const number = ocrCodeDigits(numberValue);
    if (year.length !== 2 || number.length < 2 || number.length > 3) return;
    codes.add(`SZT-${year}-${number.padStart(3, "0")}`);
}

function isOcrProjectCodePrefix(token) {
    return /^(?:S[Z27](?:T|1|I)?|[Z27](?:T|1|I))$/.test(String(token || ""));
}

function ocrProjectCodes(value) {
    const normalized = normalizeOcrProjectText(value);
    const codes = new Set();
    if (!normalized) return codes;

    const compact = normalized.replace(/\s+/g, "");
    const compactPattern = /S[Z27](?:T|1|I)([0-9OQIL]{2})([0-9OQIL]{2,3})(?![0-9OQIL])/g;
    for (const match of compact.matchAll(compactPattern)) {
        addOcrProjectCode(codes, match[1], match[2]);
    }

    const tokens = normalized.split(/\s+/).filter(Boolean);
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const inline = token.match(/^S[Z27](?:T|1|I)([0-9OQIL]{2})([0-9OQIL]{2,3})$/);
        if (inline) {
            addOcrProjectCode(codes, inline[1], inline[2]);
            continue;
        }
        if (isOcrProjectCodePrefix(token)) {
            addOcrProjectCode(codes, tokens[i + 1], tokens[i + 2]);
        }
    }
    return codes;
}

function projectOcrTexts(project) {
    return [project?.name, project?.primaryFolder, ...(Array.isArray(project?.folderPaths) ? project.folderPaths : [])].filter(Boolean);
}

function ocrProjectRootKey(value) {
    const compact = normalizeOcrProjectText(value).replace(/\s+/g, "");
    if (!compact) return "";
    if (
        compact.includes("WORKSHOPPROJECTS")
        || compact.includes("WORKSHOPTOOLS")
        || compact.includes("WORKSHOPOOLSPROJECTS")
        || compact.includes("WORKSHOPOOLSFROJECTS")
        || compact.includes("WORKSHOPOOLPROJECTS")
        || compact.includes("WORKSHOPOOKPROJECTS")
    ) return "tools";
    if (compact.includes("COMPANYPROJECTS") || compact.includes("WORKSHOPFROJECTS")) return "workshop";
    const toolsScore = Math.max(
        approxCompactWindowScore("WORKSHOPPROJECTS", compact, 7),
        approxCompactWindowScore("WORKSHOPTOOLS", compact, 4),
        approxCompactWindowScore("TOOLSPROJECTS", compact, 5)
    );
    const projectsScore = approxCompactWindowScore("COMPANYPROJECTS", compact, 6);
    if (toolsScore >= 0.72 && toolsScore >= projectsScore) return "tools";
    if (projectsScore >= 0.78) return "workshop";
    return "";
}

function projectRootKey(project) {
    return ocrProjectRootKey(projectOcrTexts(project).join(" "));
}

const OCR_PROJECT_STOP_TOKENS = new Set([
    "WORKSHOP",
    "TOOLS",
    "PROJECTS",
    "COMPANYPROJECTS",
    "WORKSHOPPROJECTS",
    "TERVEK",
    "RAJZOK",
    "MODELLEK",
    "MODELLING",
    "JAVITAS"
]);

function ocrProjectDescriptorTokens(value) {
    return ocrProjectTokens(value).filter((token) => (
        token.length >= 4
        && !/^\d+$/.test(token)
        && !isOcrProjectCodePrefix(token)
        && !OCR_PROJECT_STOP_TOKENS.has(token)
    ));
}

function projectDescriptorTokens(project) {
    const values = [
        project?.name,
        pathFileName(project?.primaryFolder || ""),
        ...(Array.isArray(project?.folderPaths) ? project.folderPaths.map(pathFileName) : [])
    ].filter(Boolean);
    return Array.from(new Set(values.flatMap((value) => ocrProjectDescriptorTokens(value))));
}

function compactOcrProjectText(value) {
    return normalizeOcrProjectText(value).replace(/\s+/g, "");
}

function projectFolderNameValues(project) {
    return Array.from(new Set([
        project?.name,
        pathFileName(project?.primaryFolder || ""),
        ...(Array.isArray(project?.folderPaths) ? project.folderPaths.map(pathFileName) : [])
    ].filter(Boolean)));
}

function approxCompactWindowScore(needleValue, haystackValue, margin = 5) {
    const needle = compactOcrProjectText(needleValue);
    const haystack = compactOcrProjectText(haystackValue);
    if (!needle || !haystack) return 0;
    if (haystack.includes(needle)) return 1;
    if (needle.length < 12 || haystack.length < Math.max(6, needle.length - margin)) return 0;
    const minLen = Math.max(6, needle.length - margin);
    const maxLen = Math.min(haystack.length, needle.length + margin);
    let best = 0;
    const step = needle.length > 45 ? 2 : 1;
    for (let start = 0; start <= haystack.length - minLen; start += step) {
        for (let len = minLen; len <= maxLen && start + len <= haystack.length; len++) {
            const part = haystack.slice(start, start + len);
            const distance = levenshteinDistance(needle, part);
            const ratio = 1 - distance / Math.max(needle.length, part.length);
            if (ratio > best) best = ratio;
            if (best >= 0.94) return best;
        }
    }
    return best;
}

function levenshteinDistance(a, b) {
    const left = String(a || "");
    const right = String(b || "");
    if (left === right) return 0;
    if (!left) return right.length;
    if (!right) return left.length;
    let prev = Array.from({ length: right.length + 1 }, (_, i) => i);
    let curr = new Array(right.length + 1);
    for (let i = 1; i <= left.length; i++) {
        curr[0] = i;
        for (let j = 1; j <= right.length; j++) {
            const cost = left[i - 1] === right[j - 1] ? 0 : 1;
            curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
        }
        [prev, curr] = [curr, prev];
    }
    return prev[right.length];
}

function fuzzyTokenHit(token, scannedTokens, scannedText) {
    if (!token) return 0;
    if (scannedTokens.includes(token)) return 1;
    if (token.length >= 4 && scannedText.includes(token)) return 0.9;
    let best = 0;
    for (const scanned of scannedTokens) {
        if (scanned.length < 2) continue;
        if (token.length >= 4 && (scanned.includes(token) || token.includes(scanned))) best = Math.max(best, 0.72);
        const distance = levenshteinDistance(token, scanned);
        const maxLen = Math.max(token.length, scanned.length);
        const ratio = maxLen ? 1 - distance / maxLen : 0;
        if (distance <= Math.max(1, Math.floor(maxLen * 0.24))) best = Math.max(best, ratio);
    }
    return best;
}

function matchScannedProject(text) {
    const scannedText = normalizeOcrProjectText(text);
    const scannedTokens = ocrProjectTokens(text);
    if (!scannedText || !scannedTokens.length) return null;
    const scannedCodes = ocrProjectCodes(text);
    const scannedRoot = ocrProjectRootKey(text);
    const scannedDescriptorTokens = ocrProjectDescriptorTokens(text);
    const candidates = projects(false).map((project) => {
        const nameText = normalizeOcrProjectText(project.name || "");
        const allProjectTexts = projectOcrTexts(project);
        const folderTexts = allProjectTexts.map((value) => normalizeOcrProjectText(value));
        const nameTokens = ocrProjectTokens(project.name || "");
        const importantTokens = nameTokens.filter((token) => !/^\d{4}$/.test(token));
        const tokenHits = importantTokens.reduce((sum, token) => sum + fuzzyTokenHit(token, scannedTokens, scannedText), 0);
        const tokenRatio = importantTokens.length ? tokenHits / importantTokens.length : 0;
        const descriptorTokens = projectDescriptorTokens(project);
        const descriptorHits = descriptorTokens.reduce((sum, token) => sum + fuzzyTokenHit(token, scannedDescriptorTokens, scannedText), 0);
        const descriptorRatio = descriptorTokens.length ? descriptorHits / descriptorTokens.length : 0;
        const codeTokens = importantTokens.filter((token) => /^(?:SZT?|P|PF)?\d{2,}|SZT?$/.test(token));
        const codeScore = codeTokens.reduce((sum, token) => sum + fuzzyTokenHit(token, scannedTokens, scannedText), 0);
        const projectCodes = ocrProjectCodes(allProjectTexts.join(" "));
        const codeHit = [...projectCodes].some((code) => scannedCodes.has(code));
        const root = projectRootKey(project);
        const rootHit = Boolean(scannedRoot && root && scannedRoot === root);
        const rootMismatch = Boolean(scannedRoot && root && scannedRoot !== root);
        const folderApproxScore = projectFolderNameValues(project).reduce((best, value) => {
            const score = approxCompactWindowScore(value, text, 5);
            return Math.max(best, score);
        }, 0);
        let score = tokenRatio * 70 + descriptorRatio * 95 + Math.min(24, codeScore * 8);
        if (codeHit) score += 260;
        if (scannedCodes.size && !codeHit) score -= 35;
        if (rootHit) score += 42;
        if (rootMismatch) score -= 80;
        if (folderApproxScore >= 0.9) score += 130;
        else if (folderApproxScore >= 0.82) score += 85;
        else if (folderApproxScore >= 0.74) score += 35;
        if (nameText && scannedText.includes(nameText)) score += 70;
        if (folderTexts.some((pathText) => pathText && scannedText.includes(pathText))) score += 90;
        for (const folderPath of allProjectTexts) {
            const folderName = normalizeOcrProjectText(pathFileName(folderPath));
            if (folderName && scannedText.includes(folderName)) score += 55;
        }
        return { project, score, tokenRatio, descriptorRatio, folderApproxScore, codeHit, rootHit, rootMismatch };
    }).sort((a, b) => b.score - a.score);
    if (scannedCodes.size) {
        const codeMatches = candidates.filter((candidate) => candidate.codeHit);
        const eligibleCodeMatches = scannedRoot ? codeMatches.filter((candidate) => !candidate.rootMismatch) : codeMatches;
        const bestCode = eligibleCodeMatches[0];
        const secondCode = eligibleCodeMatches[1];
        if (bestCode) {
            if (secondCode && bestCode.score - secondCode.score < 8) return null;
            return bestCode;
        }
        if (codeMatches.length) return null;
    }
    const best = candidates[0];
    const second = candidates[1];
    if (!best || best.score < 92) return null;
    if (best.rootMismatch) return null;
    const hasNameEvidence = best.descriptorRatio >= 0.44 || best.folderApproxScore >= 0.74;
    if (!hasNameEvidence) return null;
    if (second && best.score - second.score < 12) return null;
    return best;
}

function refreshProjectPickerMenu(picker, query = "", forceAll = false) {
    const menu = picker?.querySelector?.("[data-project-picker-menu]");
    if (!menu) return;
    const list = forceAll ? projects(false) : projects(false).filter((project) => projectPickerMatches(project, query));
    menu.innerHTML = projectPickerMenuOptions(list);
}

function openProjectPicker(picker, forceAll = false) {
    if (!picker) return;
    closeProjectPickers(picker);
    const input = picker.querySelector("[data-project-picker-input]");
    refreshProjectPickerMenu(picker, forceAll ? "" : (input?.value || ""), forceAll);
    const menu = picker.querySelector("[data-project-picker-menu]");
    if (menu) menu.hidden = false;
}

function closeProjectPickers(except = null) {
    document.querySelectorAll("[data-project-picker]").forEach((picker) => {
        if (except && picker === except) return;
        const menu = picker.querySelector("[data-project-picker-menu]");
        if (menu) menu.hidden = true;
    });
}

function optionPickerItems(source) {
    if (source === "projects-active") {
        return projects(false).map((project) => ({
            value: project.id,
            label: project.name,
            meta: project.primaryFolder || ""
        }));
    }
    if (source === "projects-all") {
        return projects(true).map((project) => ({
            value: project.id,
            label: project.name,
            meta: project.primaryFolder || ""
        }));
    }
    if (source === "users") {
        return users().map((user) => ({
            value: user.id,
            label: user.name,
            meta: Number(user.clearanceLevel || 1) >= 2 ? "2-es jogosultság" : ""
        }));
    }
    return [];
}

function optionPickerMenuOptions(items, allLabel = "") {
    const allRow = allLabel
        ? `<button class="project-picker-option" type="button" data-action="option-picker-select" data-value=""><span>${esc(allLabel)}</span></button>`
        : "";
    const rows = (items || []).map((item) => `
      <button class="project-picker-option" type="button" data-action="option-picker-select" data-value="${attr(item.value)}">
        <span>${esc(item.label)}</span>
        ${item.meta ? `<small>${esc(item.meta)}</small>` : ""}
      </button>
    `).join("");
    return allRow + rows || `<div class="project-picker-empty">Nincs választható érték.</div>`;
}

function optionPicker(source, selectedId = "", { action = "", allLabel = "", placeholder = "" } = {}) {
    const id = `option-picker-${++optionPickerSeq}`;
    const items = optionPickerItems(source);
    const selected = items.find((item) => item.value === selectedId);
    // When nothing is selected, leave the field EMPTY and let the placeholder
    // carry the "all" label (e.g. "Minden felelős" / "Összes projekt"). Baking
    // the all-label in as a real value meant the user had to delete it before
    // they could browse or search the full list.
    return `
      <span class="project-picker option-picker" data-option-picker data-option-source="${attr(source)}" data-all-label="${attr(allLabel)}" data-picker-id="${attr(id)}">
        <input type="hidden" value="${attr(selected?.value || "")}" data-option-value${action ? ` data-action="${attr(action)}"` : ""}>
        <span class="project-picker-field">
          <input type="text" value="${attr(selected?.label || "")}" placeholder="${attr(allLabel || placeholder || "Választás")}" autocomplete="off" data-option-picker-input>
          <button class="project-picker-arrow" type="button" data-action="option-picker-toggle" aria-label="Lista megnyitása">v</button>
        </span>
        <div class="project-picker-menu" data-option-picker-menu hidden>${optionPickerMenuOptions(items, allLabel)}</div>
      </span>
    `;
}

function optionPickerMatches(item, query) {
    const q = normalizeSearch(query);
    if (q.length < 2) return true;
    const terms = q.split(/\s+/).filter(Boolean);
    const haystack = normalizeSearch(`${item.label || ""} ${item.meta || ""}`);
    return terms.every((term) => haystack.includes(term));
}

function refreshOptionPickerMenu(picker, query = "", forceAll = false) {
    const menu = picker?.querySelector?.("[data-option-picker-menu]");
    if (!menu) return;
    const source = picker.dataset.optionSource || "";
    const allLabel = picker.dataset.allLabel || "";
    const q = String(query || "");
    const items = optionPickerItems(source);
    const list = (!forceAll && normalizeSearch(q).length >= 2)
        ? items.filter((item) => optionPickerMatches(item, q))
        : items;
    menu.innerHTML = optionPickerMenuOptions(list, allLabel);
}

function openOptionPicker(picker, forceAll = false) {
    if (!picker) return;
    closeOptionPickers(picker);
    const input = picker.querySelector("[data-option-picker-input]");
    refreshOptionPickerMenu(picker, forceAll ? "" : (input?.value || ""), forceAll);
    const menu = picker.querySelector("[data-option-picker-menu]");
    if (menu) menu.hidden = false;
}

function closeOptionPickers(except = null) {
    document.querySelectorAll("[data-option-picker]").forEach((picker) => {
        if (except && picker === except) return;
        const menu = picker.querySelector("[data-option-picker-menu]");
        if (menu) menu.hidden = true;
    });
}

function setOptionPickerValue(picker, value, dispatchChange = true) {
    const source = picker?.dataset?.optionSource || "";
    const input = picker?.querySelector?.("[data-option-picker-input]");
    const hidden = picker?.querySelector?.("[data-option-value]");
    if (!input || !hidden) return;
    const selected = optionPickerItems(source).find((item) => item.value === value);
    // Empty selection -> empty field so the all-label placeholder shows through
    // (kept consistent with optionPicker()); the picker still filters by "all".
    input.value = selected?.label || "";
    hidden.value = selected?.value || "";
    const menu = picker.querySelector("[data-option-picker-menu]");
    if (menu) menu.hidden = true;
    if (dispatchChange) hidden.dispatchEvent(new Event("change", { bubbles: true }));
}

function filterProjectPicker(action, selectedId = "", allLabel = "Összes projekt", activeOnly = false) {
    return optionPicker(activeOnly ? "projects-active" : "projects-all", selectedId, {
        action,
        allLabel,
        placeholder: "Projekt keresés"
    });
}

function filterUserPicker(action, selectedId = "", allLabel = "Minden felelős / rögzítő") {
    return optionPicker("users", selectedId, {
        action,
        allLabel,
        placeholder: "Felelős keresés"
    });
}

function setProjectPickerValue(picker, project, dispatchChange = true) {
    const input = picker?.querySelector?.("[data-project-picker-input]");
    const hidden = picker?.querySelector?.("[data-project-id]");
    if (!input || !hidden || !project) return;
    input.value = project.name || "";
    input.setCustomValidity("");
    hidden.value = project.id || "";
    const menu = picker.querySelector("[data-project-picker-menu]");
    if (menu) menu.hidden = true;
    if (dispatchChange) input.dispatchEvent(new Event("change", { bubbles: true }));
}

function syncProjectPickerInput(input, requireValid = false) {
    const picker = input?.closest?.("[data-project-picker]");
    const hidden = picker?.querySelector?.("[data-project-id]");
    if (!picker || !hidden) return "";
    const q = normalizeSearch(input.value);
    const currentProject = projectById(hidden.value);
    const project = currentProject && normalizeSearch(currentProject.name) === q
        ? currentProject
        : projectPickerExactProject(input.value);
    hidden.value = project?.id || "";
    if (project || !input.value.trim()) {
        input.setCustomValidity("");
    } else {
        input.setCustomValidity("V\u00e1lassz projektet a list\u00e1b\u00f3l.");
    }
    if (requireValid && input.hasAttribute("required") && !hidden.value) {
        input.setCustomValidity("V\u00e1lassz projektet a list\u00e1b\u00f3l.");
        input.reportValidity();
        throw new Error("V\u00e1lassz projektet a list\u00e1b\u00f3l.");
    }
    return hidden.value;
}

function syncProjectPickers(root, requireValid = false) {
    root.querySelectorAll?.("[data-project-picker-input]").forEach((input) => syncProjectPickerInput(input, requireValid));
}

function projectPickerValue(target) {
    if (target?.matches?.("[data-project-picker-input]")) {
        return syncProjectPickerInput(target, false);
    }
    return target?.value || "";
}

function matchesProjectSearch(project, query) {
    const q = normalizeSearch(query);
    if (!q) return true;
    return normalizeSearch(`${project.name} ${project.primaryFolder || ""} ${project.source || ""} ${projectResponsibleText(project)} ${project.deadline || ""}`).includes(q);
}

function normalizeSearch(value) {
    return String(value || "").trim().toLocaleLowerCase("hu-HU");
}

function allProjectOptions(selectedId = "") {
    return [`<option value="" disabled ${selectedId ? "" : "selected"}>Projekt választás</option>`]
        .concat(projects(true).map((project) => `<option value="${attr(project.id)}" ${project.id === selectedId ? "selected" : ""}>${esc(project.name)}</option>`))
        .join("");
}

function projectFilterOptions(selectedId = "") {
    return [`<option value="" ${selectedId ? "" : "selected"}>Összes projekt</option>`]
        .concat(projects(true).map((project) => `<option value="${attr(project.id)}" ${project.id === selectedId ? "selected" : ""}>${esc(project.name)}</option>`))
        .join("");
}

function projectFilterPanel(action, selectedId, text = "Projekt kiválasztásakor csak a hozzá tartozó sorok látszanak.") {
    return `
      <section class="panel">
        <div class="panel-body">
          <label class="inline-filter">Projekt szűrő
            ${filterProjectPicker(action, selectedId)}
          </label>
          <span class="row-meta">${esc(text)}</span>
        </div>
      </section>
    `;
}

function filterByProject(items, projectId) {
    return projectId ? (items || []).filter((item) => item.projectId === projectId) : (items || []);
}

function userFilterOptions(selectedId = "") {
    return [`<option value="" ${selectedId ? "" : "selected"}>Minden felelős / rögzítő</option>`]
        .concat(users().map((user) => `<option value="${attr(user.id)}" ${user.id === selectedId ? "selected" : ""}>${esc(user.name)}</option>`))
        .join("");
}

function assigneeFilterOptions(selectedId = "") {
    return [`<option value="" ${selectedId ? "" : "selected"}>Minden felelős</option>`]
        .concat(users().map((user) => `<option value="${attr(user.id)}" ${user.id === selectedId ? "selected" : ""}>${esc(user.name)}</option>`))
        .join("");
}

function userProjectFilterPanel(userAction, userSelectedId, projectAction, projectSelectedId, text = "Projekt vagy felhasználó kiválasztásakor csak a hozzá tartozó sorok látszanak.") {
    return `
      <section class="panel">
        <div class="panel-body">
          <label class="inline-filter">Felelős / rögzítő szűrő
            ${filterUserPicker(userAction, userSelectedId)}
          </label>
          <label class="inline-filter">Projekt szűrő
            ${filterProjectPicker(projectAction, projectSelectedId)}
          </label>
          <span class="row-meta">${esc(text)}</span>
        </div>
      </section>
    `;
}

function entryUserIds(item) {
    return [item?.userId, item?.createdByUserId, item?.responsibleUserId, item?.ownerUserId]
        .map((value) => String(value || ""))
        .filter(Boolean);
}

function filterByEntryUser(items, userId) {
    return userId ? (items || []).filter((item) => entryUserIds(item).includes(userId)) : (items || []);
}

// Worklog list filters by FELELŐS only (the `userId` chosen in the entry),
// never by the recorder/rögzítő. Shared workshop accounts record entries
// for several people, so the rögzítő is meaningless for filtering — only who is
// set as responsible on the entry matters.
function filterByResponsible(items, userId) {
    return userId ? (items || []).filter((item) => String(item?.userId || "") === userId) : (items || []);
}

function userOptions(selectedId = "") {
    const placeholder = users().length ? "Felelős választása" : "Előbb adj hozzá felhasználót";
    const effectiveSelectedId = selectedId || currentUser?.id || "";
    return [`<option value="" disabled ${effectiveSelectedId ? "" : "selected"}>${placeholder}</option>`]
        .concat(users().map((user) => `<option value="${attr(user.id)}" ${user.id === effectiveSelectedId ? "selected" : ""}>${esc(user.name)}</option>`))
        .join("");
}

function cncMachineOptions(selectedId = "") {
    const machines = data().cncMachines || [];
    const placeholder = machines.length ? "CNC gép választása" : "Előbb adj hozzá CNC gépet";
    return [`<option value="" disabled ${selectedId ? "" : "selected"}>${placeholder}</option>`]
        .concat(machines.map((machine) => `<option value="${attr(machine.id)}" ${machine.id === selectedId ? "selected" : ""}>${esc(machine.name)}</option>`))
        .join("");
}

function ownerFilterOptions(selectedId = "") {
    return [`<option value="">Minden felelős</option>`]
        .concat(users().map((user) => `<option value="${attr(user.id)}" ${user.id === selectedId ? "selected" : ""}>${esc(user.name)}</option>`))
        .join("");
}

function hoursOptions() {
    return Array.from({ length: 24 }, (_, index) => {
        const hour = index + 1;
        return `<option value="${hour}">${hour} óra</option>`;
    }).join("");
}

function projectCounts(projectId) {
    const d = data();
    const openTasks = (d.tasks || []).filter((item) => item.projectId === projectId && item.status !== "done");
    const openCnc = (d.cncTasks || []).filter((item) => item.projectId === projectId && item.status !== "done");
    const openTools = (d.toolRequests || []).filter((item) => item.projectId === projectId && item.status !== "done");
    const openMaterials = (d.materialRequests || []).filter((item) => item.projectId === projectId && item.status !== "done");
    const openFasteners = (d.fastenerRequests || []).filter((item) => item.projectId === projectId && item.status !== "done");
    const hours = (d.workLogs || [])
        .filter((item) => item.projectId === projectId)
        .reduce((sum, item) => sum + logTotalHours(item), 0);
    return { openTasks, openCnc, openTools, openMaterials, openFasteners, hours };
}

function doneLast(items) {
    return items.slice().sort((a, b) => {
        const ad = a.status === "done" ? 1 : 0;
        const bd = b.status === "done" ? 1 : 0;
        if (ad !== bd) return ad - bd;
        return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    });
}

function taskPriorityValue(item) {
    const value = Number(item?.priority || 0);
    return Number.isInteger(value) && value >= 1 && value <= 10 ? value : 0;
}

function sortTasksForDisplay(items) {
    return (items || []).slice().sort((a, b) => {
        const ad = a.status === "done" ? 1 : 0;
        const bd = b.status === "done" ? 1 : 0;
        if (ad !== bd) return ad - bd;
        const ap = taskPriorityValue(a);
        const bp = taskPriorityValue(b);
        if (ap && bp && ap !== bp) return ap - bp;
        if (ap && !bp) return -1;
        if (!ap && bp) return 1;
        return Date.parse(b.createdAt || "") - Date.parse(a.createdAt || "");
    });
}

function taskPriorityOptions(selected = "") {
    const value = taskPriorityValue({ priority: selected });
    return [`<option value="" ${value ? "" : "selected"}>-</option>`]
        .concat(Array.from({ length: 10 }, (_, index) => {
            const prio = index + 1;
            return `<option value="${prio}" ${prio === value ? "selected" : ""}>${prio}</option>`;
        }))
        .join("");
}

function activeProjectItems(items) {
    return doneLast((items || []).filter((item) => isActiveProjectId(item.projectId)));
}

function normalizeRequestSearch(value) {
    return normalizeSearch(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function requestSearchScalars(value, key = "") {
    if (value === null || value === undefined) return [];
    if (/^(?:images?|imageData|dataUrl|base64|content)$/i.test(key)) return [];
    if (Array.isArray(value)) return value.flatMap((entry) => requestSearchScalars(entry, key));
    if (typeof value === "object") {
        return Object.entries(value).flatMap(([childKey, childValue]) => requestSearchScalars(childValue, childKey));
    }
    if (!["string", "number", "boolean"].includes(typeof value)) return [];
    const text = String(value);
    return text.startsWith("data:image/") ? [] : [text];
}

function requestSearchHaystack(item) {
    const project = projectById(item.projectId);
    return normalizeRequestSearch([
        ...requestSearchScalars(item),
        formatMaterialLength(item.length),
        project?.name || "",
        project?.primaryFolder || "",
        userName(item.userId),
        userName(item.createdByUserId),
        item.status === "done" ? "kész" : "folyamatban",
        fmtDate(item.createdAt),
        fmtDate(item.doneAt)
    ].join(" "));
}

function requestHistoryResult(items, projectId, query) {
    const terms = normalizeRequestSearch(query).split(/\s+/).filter(Boolean);
    const matches = filterByProject(items || [], projectId).filter((item) => {
        if (!terms.length) return true;
        const haystack = requestSearchHaystack(item);
        return terms.every((term) => haystack.includes(term));
    });
    const sorted = doneLast(matches);
    return {
        items: sorted.slice(0, REQUEST_HISTORY_LIMIT),
        total: sorted.length
    };
}

function requestHistoryControls(searchAction, searchValue, projectAction, projectId, result) {
    const shown = result.items.length;
    const countText = result.total > shown
        ? `${shown} / ${result.total} találat látható; a szűrés a teljes megőrzött előzményen fut.`
        : `${result.total} találat`;
    return `
      <div class="form-grid" style="margin-bottom: 8px">
        <label>Keresés
          <input type="search" data-action="${attr(searchAction)}" value="${attr(searchValue)}" autocomplete="off" placeholder="Projekt vagy bármely szöveg">
        </label>
        <label>Projekt szűrő
          ${filterProjectPicker(projectAction, projectId, "Összes projekt")}
        </label>
      </div>
      <div class="row-meta" style="margin-bottom: 12px">${esc(countText)}</div>
    `;
}

function requestHistoryEmptyText(searchValue, projectId, noun) {
    return searchValue.trim() || projectId
        ? "Nincs találat a megadott keresésre vagy projektszűrőre."
        : `Nincs rögzített ${noun}.`;
}

function projectMetaMarkup(project, compact = false) {
    const deadline = project.deadline ? fmtDate(project.deadline, false) : "Nincs határidő";
    const owners = projectResponsibleText(project);
    return `
      <div class="project-meta ${compact ? "compact" : ""}">
        <span title="Felelősök">Felelős: ${esc(owners)}</span>
        <span title="Határidő">Határidő: ${esc(deadline)}</span>
      </div>
    `;
}

function projectDeadlineTime(project) {
    const time = Date.parse(project?.deadline || "");
    return Number.isFinite(time) ? time : Infinity;
}

function projectPriorityRank(project) {
    if (project?.priority === null || project?.priority === undefined || project?.priority === "") return 9999;
    const priority = Number(project.priority);
    return Number.isFinite(priority) && priority >= 1 && priority <= 10 ? priority : 9999;
}

function projectFolderTime(project) {
    const time = Date.parse(project?.folderAddedAt || project?.createdAt || "");
    return Number.isFinite(time) ? time : 0;
}

function sortProjectsForDisplay(list) {
    // Defer to the server's canonical order (state.orderedProjects). This way the
    // client never disagrees with the server about how projects are ranked — any
    // change to the server-side rule (priority → deadline → latest open task → folderAddedAt)
    // automatically applies here. Falls back to the local rule if state isn't loaded yet.
    const ordered = state?.orderedProjects;
    if (Array.isArray(ordered) && ordered.length) {
        const indexById = new Map();
        ordered.forEach((p, i) => { if (p?.id) indexById.set(p.id, i); });
        return list.slice().sort((a, b) => {
            const ai = indexById.has(a.id) ? indexById.get(a.id) : Infinity;
            const bi = indexById.has(b.id) ? indexById.get(b.id) : Infinity;
            return ai - bi;
        });
    }
    return list.slice().sort((a, b) => {
        const pa = projectPriorityRank(a);
        const pb = projectPriorityRank(b);
        if (pa !== pb) return pa - pb;
        const da = projectDeadlineTime(a);
        const db = projectDeadlineTime(b);
        if (da !== db) return da - db;
        return projectFolderTime(b) - projectFolderTime(a);
    });
}

function projectCard(project) {
    if (!project) return `<div class="empty">Nincs aktív projekt.</div>`;
    const counts = projectCounts(project.id);
    const priority = project.priority ? `P${project.priority}` : "friss";
    return `
    <button class="project-card" type="button" data-action="open-project" data-id="${attr(project.id)}">
      <div class="project-card-header">
        <div>
          <div class="project-name">${esc(project.name)}</div>
          <div class="row-meta">${esc(project.primaryFolder || "ERP-ben létrehozott projekt")}</div>
        </div>
        <span class="priority-badge">${priority}</span>
      </div>
      ${projectMetaMarkup(project)}
      <div class="metric-grid">
        <div class="metric"><strong>${counts.openTasks.length}</strong><span>feladat</span></div>
        <div class="metric"><strong>${counts.openCnc.length}</strong><span>CNC</span></div>
        <div class="metric"><strong>${counts.openTools.length}</strong><span>szerszám</span></div>
        <div class="metric"><strong>${counts.openMaterials.length}</strong><span>anyag</span></div>
        <div class="metric"><strong>${counts.openFasteners.length}</strong><span>csavar</span></div>
        <div class="metric"><strong>${formatHours(counts.hours)}</strong><span>óra</span></div>
      </div>
      <div class="compact-list">
        ${compactLines(counts.openTasks.slice(0, 2), "title")}
        ${compactLines(counts.openCnc.slice(0, 2), "cnc")}
        ${compactLines(counts.openTools.slice(0, 1), "toolName")}
        ${compactLines(counts.openMaterials.slice(0, 1), "material")}
        ${compactLines(counts.openFasteners.slice(0, 1), "fastener")}
      </div>
    </button>
  `;
}

function compactLines(items, key) {
    if (!items.length) return "";
    return items.map((item) => `
    <div class="list-row">
      <span class="source-badge">${key === "title" ? "Feladat" : key === "cnc" ? "CNC" : key === "toolName" ? "Szerszám" : key === "fastener" ? "Csavar" : "Anyag"}</span>
      <span class="row-title">${key === "cnc" ? esc(`${item.machineName || machineName(item.machineId)} · ${fmtDate(item.plannedStart)}`) : key === "fastener" ? esc(fastenerTitle(item)) : key === "material" ? esc(materialRequestTitle(item)) : esc(item[key])}</span>
      <span class="row-meta">${fmtDate(item.createdAt, false)}</span>
    </div>
  `).join("");
}

function renderDashboard() {
    const d = data();
    return `
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-header"><h2>Általános teendők</h2></div>
        <div class="panel-body scroll-area">
          <form class="form-line dashboard-todo-form" data-action="add-dashboard-todo">
            <input name="text" autocomplete="off" placeholder="Új teendő vagy kép leírása" data-dashboard-todo-input>
            <button class="primary-button" type="submit">Hozzáadás</button>
          </form>
          <div id="dashboard-todo-image-preview">${dashboardTodoPendingImageMarkup()}</div>
          <div class="todo-list">
            ${(d.dashboardTodos || []).length ? d.dashboardTodos.map(dashboardTodoRow).join("") : `<div class="empty">Nincs nyitott teendő.</div>`}
          </div>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Megbeszélések</h2></div>
        <div class="panel-body scroll-area">
          <form class="form-grid" data-action="add-meeting">
            <label>Név<input name="title" autocomplete="off" placeholder="Megbeszélés"></label>
            <label>Dátum<input name="meetingDate" type="date" value="${localInputDate()}"></label>
            <label>Idő<input name="meetingTime" type="time" value="${defaultMeetingTime()}"></label>
            <button class="primary-button wide" type="submit">Hozzáadás</button>
          </form>
          <div class="compact-list" style="margin-top: 12px">
            ${(d.meetings || []).length ? d.meetings.slice().sort((a, b) => Date.parse(a.time) - Date.parse(b.time)).map((meeting) => `
              <div class="list-row">
                <div>
                  <div class="row-title">${esc(meeting.title)}</div>
                  <div class="row-meta">${fmtDate(meeting.time)}</div>
                </div>
                <span></span>
                <button class="small-button" type="button" data-action="delete-meeting" data-id="${attr(meeting.id)}">Törlés</button>
              </div>
            `).join("") : `<div class="empty">Nincs rögzített megbeszélés.</div>`}
          </div>
        </div>
      </section>
      ${renderDayOffPanel()}
    </div>
  `;
}

function formatDayKey(key) {
    const s = String(key || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, ".") : s;
}

function dayOffRangeText(entry) {
    const start = formatDayKey(entry.startDate);
    const end = formatDayKey(entry.endDate || entry.startDate);
    return start === end ? start : `${start} – ${end}`;
}

function renderDayOffPanel() {
    const list = (data().dayOffs || []).slice().sort((a, b) =>
        String(a.startDate || "").localeCompare(String(b.startDate || "")) ||
        String(a.userName || "").localeCompare(String(b.userName || ""), "hu")
    );
    const rows = list.length ? list.map((entry) => `
        <div class="list-row">
          <div>
            <div class="row-title">${esc(entry.userName || "")}</div>
            <div class="row-meta">${esc(dayOffRangeText(entry))}</div>
          </div>
          <span></span>
          <button class="small-button" type="button" data-action="delete-dayoff" data-id="${attr(entry.id)}">Törlés</button>
        </div>
    `).join("") : `<div class="empty">Nincs rögzített szabadnap.</div>`;
    return `
      <section class="panel dashboard-dayoff">
        <div class="panel-header"><h2>Szabadnap</h2></div>
        <div class="panel-body scroll-area">
          <form class="form-grid" data-action="add-dayoff">
            <label>Ki<select name="userId" required>${userOptions(currentUser?.id || "")}</select></label>
            <label>Kezdő nap<input name="startDate" type="date" required value="${attr(localInputDate())}"></label>
            <label>Utolsó nap<input name="endDate" type="date" placeholder="üresen: egy nap"></label>
            <button class="primary-button wide" type="submit">Hozzáadás</button>
          </form>
          <p class="row-meta" style="margin-top: 6px">Az "Utolsó nap" üresen hagyva egynapos szabadság. A bejegyzés a dátum elteltével automatikusan törlődik.</p>
          <div class="compact-list" style="margin-top: 12px">
            ${rows}
          </div>
        </div>
      </section>
    `;
}

function dashboardTodoPendingImageMarkup() {
    if (!pendingDashboardTodoImage) return "";
    return `
      <div class="pending-dashboard-image">
        <img src="${attr(pendingDashboardTodoImage.dataUrl)}" alt="">
        <div>
          <div class="row-title">Beillesztett kép</div>
          <div class="row-meta">${esc(pendingDashboardTodoImage.name || "clipboard kép")}</div>
        </div>
        <button class="small-button" type="button" data-action="clear-dashboard-image">Eltávolítás</button>
      </div>
    `;
}

function refreshDashboardTodoImagePreview() {
    const target = document.getElementById("dashboard-todo-image-preview");
    if (target) target.innerHTML = dashboardTodoPendingImageMarkup();
}

function dashboardTodoRow(todo) {
    const hasImage = Boolean(todo.image);
    const text = todo.text || (hasImage ? "Kép" : "");
    return `
      <div class="todo-row ${todo.checkedAt ? "done" : ""}">
        <input type="checkbox" ${todo.checkedAt ? "checked" : ""} data-action="toggle-dashboard-todo" data-id="${attr(todo.id)}">
        ${hasImage ? `
          <button class="todo-thumb-button" type="button" data-action="open-dashboard-image" data-id="${attr(todo.id)}" title="Kép megnyitása">
            <img src="/api/dashboard/todos/${attr(todo.id)}/image" alt="">
          </button>
        ` : `<span class="todo-thumb-spacer"></span>`}
        <div>
          <div class="row-title">${esc(text)}</div>
          <div class="row-meta">${todo.checkedAt ? `kipipálva: ${fmtDate(todo.checkedAt)}` : fmtDate(todo.createdAt)}</div>
        </div>
        <button class="small-button" type="button" data-action="delete-dashboard-todo" data-id="${attr(todo.id)}">Törlés</button>
      </div>
    `;
}

function renderProjectView() {
    const active = sortProjectsForDisplay(
        projects(false)
            .filter((project) => projectMatchesOwner(project, projectViewOwnerId))
            .filter((project) => matchesProjectSearch(project, projectViewSearch))
    );
    return `
    <section class="panel project-browser-strip">
      <div class="panel-body project-browser-strip-body">
        <div>
          <h2>Projekt böngésző</h2>
          <p class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "Rajzok, összeállítások és PDF-ek a helyi demó projektmappából." : "Rajzok, összeállítások és PDF-ek élő listája a projektmappából."}</p>
        </div>
        <label>Projekt${projectPicker(projectBrowserProjectId, { action: "project-browser-project", required: false })}</label>
      </div>
    </section>
    <div class="project-view-grid">
      <div class="project-card-grid scroll-area">
        ${active.map((project) => projectCard(project)).join("")}
      </div>
      <section class="panel">
        <div class="panel-header"><h2>Aktív projektek</h2></div>
        <div class="panel-body scroll-area">
          <label style="margin-bottom: 12px">Felelős keresés${filterUserPicker("project-view-owner", projectViewOwnerId, "Minden felelős")}</label>
          <label style="margin-bottom: 12px">Keresés<input data-action="project-view-search" value="${attr(projectViewSearch)}" autocomplete="off" placeholder="Projekt név vagy útvonal"></label>
          <div class="compact-list">
            ${active.length ? active.map((project) => `
              <button class="project-list-button" type="button" data-action="open-project" data-id="${attr(project.id)}">
                <div>
                  <strong>${esc(project.name)}</strong>
                  <span class="row-meta">${project.primaryFolder ? esc(project.primaryFolder) : "kézi projekt"}</span>
                  ${projectMetaMarkup(project, true)}
                </div>
                <span class="priority-badge">${project.priority ? `P${project.priority}` : "-"}</span>
              </button>
            `).join("") : `<div class="empty">Nincs aktív projekt.</div>`}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderCncSummary() {
    const machines = data().cncMachines || [];
    return `
    <div class="single-view">
      <section class="cnc-summary-grid">
        ${machines.length ? machines.map(cncSummaryMachine).join("") : `<div class="empty">Még nincs CNC gép. A gépeket a védett Pénzügy / mérnökség > Gyártás ütemezés menüben lehet felvenni.</div>`}
      </section>
    </div>
  `;
}

function cncSummaryMachine(machine) {
    const tasks = cncTasksForMachine(machine.id);
    const current = tasks[0] || null;
    const queued = current ? tasks.filter((task) => task.id !== current.id) : tasks;
    return `
      <section class="panel cnc-machine-summary">
        <div class="panel-header"><h2>${esc(machine.name)}</h2></div>
        <div class="panel-body">
          ${current ? cncCurrentCard(current) : `<div class="cnc-status-card empty-current"><div class="row-meta">Most a gépen</div><div class="row-title">Nincs aktuális nyitott CNC feladat.</div></div>`}
          <div class="cnc-task-scroll">
            ${queued.length ? queued.map(cncSummaryTaskRow).join("") : `<div class="empty">Nincs további nyitott feladat ezen a gépen.</div>`}
          </div>
        </div>
      </section>
    `;
}

function cncTasksForMachine(machineId) {
    return (data().cncTasks || [])
        .filter((task) => task.machineId === machineId && task.status !== "done" && isActiveProjectId(task.projectId))
        .sort(cncScheduleSort);
}

function cncScheduleSort(a, b) {
    const ar = cncTaskState(a).rank;
    const br = cncTaskState(b).rank;
    if (ar !== br) return ar - br;
    const as = Date.parse(a.plannedStart || "");
    const bs = Date.parse(b.plannedStart || "");
    if (Number.isFinite(as) && Number.isFinite(bs) && as !== bs) return as - bs;
    if (Number.isFinite(as)) return -1;
    if (Number.isFinite(bs)) return 1;
    return Date.parse(a.createdAt || "") - Date.parse(b.createdAt || "");
}

function cncTaskState(task) {
    const now = Date.now();
    const start = Date.parse(task.plannedStart || "");
    const end = Date.parse(task.plannedEnd || "");
    if (Number.isFinite(end) && end < now) return { label: "késés", className: "late", rank: 0 };
    if (Number.isFinite(start) && Number.isFinite(end) && start <= now && end >= now) return { label: "most", className: "now", rank: 1 };
    if (Number.isFinite(start) && start > now) return { label: "következő", className: "next", rank: 2 };
    return { label: "nyitott", className: "open", rank: 3 };
}

function cncCurrentCard(task) {
    const state = cncTaskState(task);
    const files = filesForCncTask(task.id);
    return `
      <article class="cnc-status-card cnc-current-card">
        <div class="cnc-current-head">
          <span class="task-state-badge ${state.className}">${esc(state.label)}</span>
          <span class="inline-actions">
            <label class="checkbox-label">
              <input type="checkbox" data-action="open-cnc-report" data-id="${attr(task.id)}">
              <span></span>
            </label>
            <button class="primary-button small-button" type="button" data-action="open-cnc-report" data-id="${attr(task.id)}">Lejelentés</button>
          </span>
        </div>
        <div class="cnc-current-project">${esc(task.projectName || "")}</div>
        <div class="cnc-current-times">
          <div><span>Tervezett kezdés</span><strong>${fmtDate(task.plannedStart)}</strong></div>
          <div><span>Tervezett befejezés</span><strong>${fmtDate(task.plannedEnd)}</strong></div>
          ${task.actualStart ? `<div><span>Valós kezdés</span><strong>${fmtDate(task.actualStart)}</strong></div>` : ""}
          ${task.actualEnd ? `<div><span>Valós befejezés</span><strong>${fmtDate(task.actualEnd)}</strong></div>` : ""}
        </div>
        <div class="cnc-current-desc">
          <span>Leírás</span>
          <strong>${task.note ? esc(task.note) : "Nincs megjegyzés."}</strong>
          ${cncImageThumbnails(task)}
        </div>
        <div class="row-meta">Felelős: ${esc(userName(task.userId)) || "Nincs felelős"}</div>
        ${files.length ? `<div class="cnc-file-actions compact">${files.map(cncFileActions).join("")}</div>` : ""}
        <div class="inline-actions">
          <button class="small-button" type="button" data-action="open-project" data-id="${attr(task.projectId || "")}">Projekt</button>
        </div>
      </article>
    `;
}

function cncSummaryTaskRow(task) {
    const state = cncTaskState(task);
    const files = filesForCncTask(task.id);
    const actualLine = (task.actualStart || task.actualEnd)
        ? `<div class="row-meta" style="color: var(--teal)">Valós: ${fmtDate(task.actualStart)} - ${fmtDate(task.actualEnd)}</div>`
        : "";
    return `
      <article class="cnc-summary-row">
        <div class="cnc-summary-row-head">
          <label class="checkbox-label">
            <input type="checkbox" data-action="open-cnc-report" data-id="${attr(task.id)}">
            <span></span>
          </label>
          <span class="task-state-badge ${state.className}">${esc(state.label)}</span>
          <div>
            <div class="row-title">${esc(task.projectName || "")}</div>
            <div class="row-meta">Tervezett: ${fmtDate(task.plannedStart)} - ${fmtDate(task.plannedEnd)} · ${esc(userName(task.userId))}</div>
            ${actualLine}
          </div>
        </div>
        ${task.note ? `<div class="muted">${esc(task.note)}</div>` : ""}
        ${cncImageThumbnails(task)}
        ${files.length ? `<div class="cnc-file-actions">${files.map(cncFileActions).join("")}</div>` : ""}
        <div class="inline-actions">
          <button class="primary-button small-button" type="button" data-action="open-cnc-report" data-id="${attr(task.id)}">Lejelentés</button>
          <button class="small-button" type="button" data-action="open-project" data-id="${attr(task.projectId || "")}">Projekt</button>
        </div>
      </article>
    `;
}

function filesForCncTask(cncTaskId) {
    return (data().files || []).filter((file) => file.cncTaskId === cncTaskId);
}

function filesForTask(taskId) {
    return (data().files || []).filter((file) => file.taskId === taskId);
}

function isPdfFile(file) {
    return /\.pdf$/i.test(file?.name || file?.path || "");
}

function cncFileActions(file) {
    return `
      <div class="cnc-file-row">
        <div>
          <div class="row-title">${esc(file.name || "Fájl")}</div>
          <div class="path-text">${esc(file.path || "")}</div>
        </div>
        <span class="inline-actions">
          <button class="small-button" type="button" data-action="open-file" data-id="${attr(file.id)}" data-path="${attr(file.path)}">Megnyitás</button>
          <button class="small-button" type="button" data-action="reveal-file" data-path="${attr(file.path)}">Mappa</button>
          ${isPdfFile(file) ? `<a class="small-button" href="/api/files/${attr(file.id)}/preview" target="_blank" rel="noopener">PDF böngészőben</a>` : ""}
        </span>
      </div>
    `;
}

function taskFileActions(file) {
    return `
      <div class="cnc-file-row">
        <div>
          <div class="row-title">${esc(file.name || "Fájl")}</div>
          <div class="path-text">${esc(file.path || "")}</div>
        </div>
        <span class="inline-actions">
          <button class="small-button" type="button" data-action="open-file" data-id="${attr(file.id)}" data-path="${attr(file.path)}">Megnyitás</button>
          <button class="small-button" type="button" data-action="reveal-file" data-path="${attr(file.path)}">Mappa</button>
          ${isPdfFile(file) ? `<a class="small-button" href="/api/files/${attr(file.id)}/preview" target="_blank" rel="noopener">PDF böngészőben</a>` : ""}
          <a class="small-button" href="/api/files/${attr(file.id)}/download" target="_blank" rel="noopener">Letöltés</a>
          <button class="small-button" type="button" data-action="copy-path" data-path="${attr(file.path)}">Másolás</button>
        </span>
      </div>
    `;
}

function renderTodos() {
    const d = data();
    if (taskUserFilter && !users().some((user) => user.id === taskUserFilter)) taskUserFilter = "";
    const tasks = sortTasksForDisplay((d.tasks || [])
        .filter((item) => isActiveProjectId(item.projectId))
        .filter((item) => !taskUserFilter || item.userId === taskUserFilter));
    const editing = editingTaskId ? (d.tasks || []).find((item) => item.id === editingTaskId) : null;
    const formAction = editing ? "edit-task" : "add-task";
    const headerText = editing ? "Munkafolyamat módosítása" : "Munkafolyamat hozzáadása";
    const submitText = editing ? "Módosítás mentése" : "Munkafolyamat mentése";
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>${headerText}</h2></div>
        <div class="panel-body">
            <form class="form-grid" data-action="${formAction}">
              ${editing ? `<input type="hidden" name="id" value="${attr(editing.id)}">` : ""}
              <label>Név<input name="title" required autocomplete="off" placeholder="Munkafolyamat" value="${attr(editing?.title || "")}"></label>
              <label>Darabszám<input name="quantity" type="number" min="0" step="1" autocomplete="off" placeholder="db" value="${attr(editing?.quantity ? String(editing.quantity) : "")}"></label>
              <label>Projekt${projectPicker(editing?.projectId || "")}</label>
              <label class="wide">Felelős<select name="userId" required>${userOptions(editing?.userId || "")}</select></label>
            <label class="wide">Leírás<textarea name="description" placeholder="Leírás" ${editing ? "" : "data-task-input"}>${esc(editing?.description || "")}</textarea></label>
            ${editing ? "" : `<div class="wide inline-actions"><button class="small-button" type="button" data-action="open-mobile-photo" data-target="task">Mobil fotó</button></div>`}
            ${editing ? "" : `<div class="wide" id="task-pasted-images">${pendingTaskImagesMarkup()}</div>`}
            ${editing ? "" : `<div class="wide">
              <div class="drop-grid">
                <div class="drop-zone link" data-drop="task-link">
                  <div class="drop-title">SZERVER LINK</div>
                  <div class="row-meta">Y: tallózás a host gépen. Interneten is használható, ha a host látja a fájlt.</div>
                  <button class="small-button" type="button" data-action="choose-link">Tallózás</button>
                </div>
                <div class="drop-zone link" data-drop="task-helper-drop">
                  <div class="drop-title">HELYI LINK</div>
                  <div class="row-meta">A PC-n futó helperrel fájl kiválasztás vagy natív drag-and-drop.</div>
                  <div class="inline-actions">
                    <button class="small-button" type="button" data-action="helper-pick-link">Tallózás</button>
                    <button class="small-button" type="button" data-action="helper-drop-link">Drop ablak</button>
                  </div>
                </div>
              </div>
              <div id="pending-attachments" style="margin-top: 12px">${pendingAttachmentsMarkup()}</div>
            </div>`}
            <div class="wide inline-actions">
              <button class="primary-button" type="submit">${submitText}</button>
              ${editing ? `<button class="small-button" type="button" data-action="cancel-edit-task">Mégse</button>` : ""}
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Feladatok</h2></div>
        <div class="panel-body scroll-area">
          <label class="inline-filter" style="margin-bottom: 12px">Felelős szűrő
            ${filterUserPicker("task-user-filter", taskUserFilter, "Minden felelős")}
          </label>
          ${tasks.length ? `<div class="compact-list">${tasks.map(taskRow).join("")}</div>` : `<div class="empty">Nincs aktív projekthez tartozó feladat.</div>`}
        </div>
      </section>
    </div>
  `;
}

function taskRow(item) {
    const done = item.status === "done";
    const qty = Number(item.quantity || 0);
    const titleSuffix = qty > 0 ? ` · ${qty} db` : "";
    const creator = ` · létrehozta: ${esc(item.createdByName || "nincs adat")}`;
    const canDelete = canDeleteEntry(item);
    const assignee = userName(item.userId);
    return `
      <div class="request-row task-list-row ${done ? "done-item" : ""}" data-task-open="${attr(item.id)}">
        <div class="task-state-cell">
          <label class="checkbox-label task-check">
            <input type="checkbox" ${done ? "checked" : ""} data-action="done-task" data-id="${attr(item.id)}">
            <span></span>
          </label>
          <label class="task-priority-control">PRIO:<select data-action="task-priority" data-id="${attr(item.id)}">${taskPriorityOptions(item.priority || "")}</select></label>
        </div>
        <div>
          <div class="row-title">${esc(item.title)}${esc(titleSuffix)}</div>
          <div class="row-meta"><strong class="task-project-name">${esc(item.projectName || "")}</strong> · felelős: <strong class="task-assignee">${esc(assignee || "nincs felelős")}</strong>${creator} · ${done ? `kész: ${fmtDate(item.doneAt)}` : fmtDate(item.createdAt)}</div>
          ${taskAttachmentSummary(item.id)}
          ${taskImageThumbnails(item)}
          ${item.description ? `<div class="muted">${esc(item.description)}</div>` : ""}
        </div>
        <span class="inline-actions">
          <button class="small-button" type="button" data-action="edit-task" data-id="${attr(item.id)}">Módosítás</button>
          <button class="small-button" type="button" data-action="open-project" data-id="${attr(item.projectId || "")}">Projekt</button>
          ${canDelete ? `<button class="danger-button small-button" type="button" data-action="delete-task" data-id="${attr(item.id)}" data-label="${attr(item.title)}">Törlés</button>` : ""}
        </span>
      </div>
    `;
}

function pendingAttachmentsMarkup() {
    const rows = [
        ...pendingTaskLinks.map((item, index) => `
      <div class="list-row">
        <span class="source-badge">LINK</span>
        <div><div class="row-title">${esc(item.name || item.path)}</div><div class="path-text">${esc(item.path)}</div></div>
        <button class="small-button" type="button" data-action="remove-pending-link" data-index="${index}">Törlés</button>
      </div>
    `)
    ];
    return rows.length ? `<div class="compact-list">${rows.join("")}</div>` : `<div class="empty">Nincs csatolmány kiválasztva.</div>`;
}

function refreshPendingAttachments() {
    const target = document.getElementById("pending-attachments");
    if (target) target.innerHTML = pendingAttachmentsMarkup();
}

function bomLinkPreviewMarkup() {
    return bomLinkPath
        ? `<div class="list-row"><span class="source-badge">LINK</span><div><div class="row-title">${esc(bomLinkName || bomLinkPath)}</div><div class="path-text">${esc(bomLinkPath)}</div></div><button class="small-button" type="button" data-action="clear-bom-link">Törlés</button></div>`
        : `<div class="empty">Nincs BOM link kiválasztva.</div>`;
}

function refreshBomLinkUI() {
    const input = document.querySelector('form[data-action="add-bom"] input[name="filePath"]');
    if (input) input.value = bomLinkPath;
    const preview = document.getElementById("bom-link-preview");
    if (preview) preview.innerHTML = bomLinkPreviewMarkup();
}

function taskAttachmentSummary(taskId) {
    const files = (data().files || []).filter((file) => file.taskId === taskId);
    if (!files.length) return "";
    return files.map((file) => `<div class="row-meta">${esc(file.kind === "link" ? "LINK" : "FELTÖLTÉS")}: ${esc(file.name)}</div>`).join("");
}

function projectRequestFields() {
    return `
    <label>Projekt${projectPicker()}</label>
  `;
}

function renderCnc() {
    const allTasks = activeProjectItems(data().cncTasks || []);
    const activeProjs = projects(false);
    if (cncFilterProjectId && !activeProjs.some((p) => p.id === cncFilterProjectId)) cncFilterProjectId = "";
    const tasks = cncFilterProjectId
        ? allTasks.filter((item) => item.projectId === cncFilterProjectId)
        : allTasks;
    const editing = editingCncTaskId ? allTasks.find((item) => item.id === editingCncTaskId) : null;
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>CNC megmunkálás hozzáadása</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-cnc-task">
            <label>Projekt${projectPicker()}</label>
            <label>Felelős<select name="userId" required>${userOptions()}</select></label>
            <label>CNC gép<select name="machineId" required>${cncMachineOptions()}</select></label>
            <label>Kezdés<input name="plannedStart" type="datetime-local" required value="${localInputDateTime()}"></label>
            <label>Befejezés<input name="plannedEnd" type="datetime-local" required value="${defaultCncEnd()}"></label>
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális — képeket is beilleszthetsz (Ctrl+V)" data-cnc-task-input></textarea></label>
            <div class="wide inline-actions"><button class="small-button" type="button" data-action="open-mobile-photo" data-target="cnc">Mobil fotó</button></div>
            <div class="wide" id="cnc-task-pasted-images">${pendingCncTaskImagesMarkup()}</div>
            <div class="wide">
              <div class="drop-grid">
                <div class="drop-zone link" data-drop="task-link">
                  <div class="drop-title">SZERVER LINK</div>
                  <div class="row-meta">Y: tallózás a host gépen.</div>
                  <button class="small-button" type="button" data-action="choose-link">Tallózás</button>
                </div>
                <div class="drop-zone link" data-drop="task-helper-drop">
                  <div class="drop-title">HELYI LINK</div>
                  <div class="row-meta">Helper app: fájl kiválasztás vagy natív drop.</div>
                  <div class="inline-actions">
                    <button class="small-button" type="button" data-action="helper-pick-link">Tallózás</button>
                    <button class="small-button" type="button" data-action="helper-drop-link">Drop ablak</button>
                  </div>
                </div>
              </div>
              <div id="pending-attachments" style="margin-top: 12px">${pendingAttachmentsMarkup()}</div>
            </div>
            <button class="primary-button wide" type="submit">CNC feladat mentése</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h2>CNC feladatok</h2>
          <span style="width:min(300px, 100%)">${filterProjectPicker("cnc-filter-project", cncFilterProjectId, "Összes projekt", true)}</span>
        </div>
        <div class="panel-body scroll-area">
          ${editing ? cncEditForm(editing) : ""}
          ${tasks.length ? `<div class="compact-list">${tasks.map(cncTaskRow).join("")}</div>` : `<div class="empty">${cncFilterProjectId ? "Ehhez a projekthez nincs CNC feladat." : "Nincs aktív projekthez tartozó CNC feladat."}</div>`}
        </div>
      </section>
    </div>
  `;
}

function cncEditForm(item) {
    return `
      <form class="form-grid" data-action="edit-cnc-task" style="margin-bottom: 12px">
        <input type="hidden" name="id" value="${attr(item.id)}">
        <label>Projekt${projectPicker(item.projectId || "")}</label>
        <label>Felelős<select name="userId" required>${userOptions(item.userId || "")}</select></label>
        <label>CNC gép<select name="machineId" required>${cncMachineOptions(item.machineId || "")}</select></label>
        <label>Kezdés<input name="plannedStart" type="datetime-local" required value="${attr(localInputDateTime(item.plannedStart))}"></label>
        <label>Befejezés<input name="plannedEnd" type="datetime-local" required value="${attr(localInputDateTime(item.plannedEnd))}"></label>
        <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális">${esc(item.note || "")}</textarea></label>
        <div class="wide inline-actions">
          <button class="primary-button" type="submit">Módosítás mentése</button>
          <button class="small-button" type="button" data-action="cancel-cnc-edit">Mégse</button>
        </div>
      </form>
    `;
}

function cncTaskRow(item) {
    const done = item.status === "done";
    const creator = ` · létrehozta: ${esc(item.createdByName || "nincs adat")}`;
    const canDelete = canDeleteEntry(item);
    const actualLine = (item.actualStart || item.actualEnd)
        ? `<div class="row-meta" style="color: var(--teal)">Valós: ${fmtDate(item.actualStart)} - ${fmtDate(item.actualEnd)}</div>`
        : "";
    return `
      <div class="request-row ${done ? "done-item" : ""}">
        <label class="checkbox-label">
          <input type="checkbox" ${done ? "checked" : ""} data-action="open-cnc-report" data-id="${attr(item.id)}">
          <span></span>
        </label>
        <div>
          <div class="row-title">${esc(item.machineName || machineName(item.machineId))}</div>
          <div class="row-meta">${esc(item.projectName)} · felelős: ${esc(userName(item.userId))}${creator} · Tervezett: ${fmtDate(item.plannedStart)} - ${fmtDate(item.plannedEnd)}</div>
          ${actualLine}
          ${cncAttachmentSummary(item.id)}
          ${cncImageThumbnails(item)}
          ${item.note ? `<div class="muted">${esc(item.note)}</div>` : ""}
        </div>
        <span class="inline-actions">
          <button class="primary-button small-button" type="button" data-action="open-cnc-report" data-id="${attr(item.id)}" ${done ? "disabled" : ""}>Lejelentés</button>
          <button class="small-button" type="button" data-action="edit-cnc" data-id="${attr(item.id)}">Módosítás</button>
          <button class="small-button" type="button" data-action="open-project" data-id="${attr(item.projectId || "")}">Projekt</button>
          ${canDelete ? `<button class="danger-button small-button" type="button" data-action="delete-cnc-task" data-id="${attr(item.id)}" data-label="${attr(item.machineName || machineName(item.machineId))}">Törlés</button>` : ""}
        </span>
      </div>
    `;
}

function cncAttachmentSummary(cncTaskId) {
    const files = filesForCncTask(cncTaskId);
    if (!files.length) return "";
    return `<div class="cnc-file-actions compact">${files.map(cncFileActions).join("")}</div>`;
}

function renderTools() {
    const d = data();
    const allTools = d.toolRequests || [];
    const result = requestHistoryResult(allTools, toolRequestProjectFilter, toolRequestSearch);
    const items = result.items;
    const editing = editingToolRequestId ? allTools.find((item) => item.id === editingToolRequestId) : null;
    const formAction = editing ? "edit-tool" : "add-tool";
    const headerText = editing ? "Szerszámigény módosítása" : "Új szerszámigény";
    const submitText = editing ? "Módosítás mentése" : "Igény mentése";
    return `
    ${datalist("tool-name-list", d.toolNames || [])}
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>${headerText}</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="${formAction}">
            ${editing ? `<input type="hidden" name="id" value="${attr(editing.id)}">` : ""}
            <label class="wide">Szerszám neve
              <span style="display:flex; gap:6px; align-items:stretch">
                <input name="toolName" list="tool-name-list" autocomplete="off" placeholder="8R1 50mm teljes hossz keményfém" value="${attr(editing?.toolName || "")}" style="flex:1; min-width:0">
                <button type="button" class="small-button" data-action="insert-diameter" data-target="toolName" title="Átmérő jel (Ø) beszúrása" style="padding:0 12px">Ø</button>
              </span>
            </label>
            <label>Darabszám<input name="quantity" type="number" min="0" step="1" autocomplete="off" placeholder="db" value="${attr(editing?.quantity ? String(editing.quantity) : "")}"></label>
            <label>Projekt${projectPicker(editing?.projectId || "")}</label>
            <label>Felelős<select name="userId" required>${userOptions(editing?.userId || "")}</select></label>
            <label class="wide">Leírás<textarea name="description" placeholder="Opcionális">${esc(editing?.description || "")}</textarea></label>
            ${editing ? "" : requestAttachmentFormBlock("tool")}
            <div class="wide inline-actions">
              <button class="primary-button" type="submit">${submitText}</button>
              ${editing ? `<button class="small-button" type="button" data-action="cancel-edit-tool">Mégse</button>` : ""}
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Szerszámigények</h2></div>
        <div class="panel-body scroll-area">
          ${requestHistoryControls("tool-request-search", toolRequestSearch, "tool-request-project-filter", toolRequestProjectFilter, result)}
          ${items.length ? items.map((item) => requestRow(item, item.toolName || "Szerszámigény", "done-tool", "edit-tool", "delete-tool", requestAttachmentActions(item, "tool"))).join("") : `<div class="empty">${requestHistoryEmptyText(toolRequestSearch, toolRequestProjectFilter, "szerszámigény")}</div>`}
        </div>
      </section>
    </div>
  `;
}

function datalist(idName, items) {
    return `<datalist id="${idName}">${items.map((item) => `<option value="${esc(item)}"></option>`).join("")}</datalist>`;
}

function materialPrefabDirection(value) {
    return value === "elvinni" ? "elvinni" : "elhozni";
}

function materialPrefabDirectionColor(value) {
    return materialPrefabDirection(value) === "elvinni" ? "#0b66d8" : "#c51f1a";
}

function materialPrefabDirectionMarkup(value, prefix = "") {
    const direction = materialPrefabDirection(value);
    return `${prefix ? `${esc(prefix)} ` : ""}<span style="color:${materialPrefabDirectionColor(direction)}; font-weight:700">${esc(direction)}</span>`;
}

function materialRequestTitle(item) {
    if (item?.prefabTransport) {
        return ["Előgyártmány szállítás", materialPrefabDirection(item.prefabDirection), item.externalCompany, item.prefabTaskType].filter(Boolean).join(" · ") || "Előgyártmány szállítás";
    }
    return [item?.material, item?.type, item?.size, formatMaterialLength(item?.length)].filter(Boolean).join(" · ") || "Anyagigény";
}

function formatMaterialLength(value) {
    const text = String(value ?? "").trim();
    return /^[+]?\d+(?:[.,]\d+)?$/.test(text) ? `${text} mm` : text;
}

function syncMaterialPrefabMode(form) {
    if (!form) return;
    const prefab = Boolean(form.querySelector('input[name="prefabTransport"]')?.checked);
    form.querySelectorAll("[data-material-raw-field]").forEach((field) => {
        field.style.display = prefab ? "none" : "";
        field.querySelectorAll("input, select, textarea").forEach((input) => {
            input.disabled = prefab;
            if (input.name === "material") input.required = false;
        });
    });
    form.querySelectorAll("[data-material-prefab-field]").forEach((field) => {
        field.style.display = prefab ? "" : "none";
        field.querySelectorAll("input, select, textarea").forEach((input) => {
            input.disabled = !prefab;
            if (input.name === "externalCompany") input.required = false;
        });
    });
    const directionButton = form.querySelector("[data-material-prefab-direction-button]");
    const directionStatus = form.querySelector("[data-material-prefab-direction-status]");
    const directionInput = form.querySelector('input[name="prefabDirection"]');
    if (directionInput && !directionInput.value) directionInput.value = "elhozni";
    if (directionButton && directionInput) {
        const direction = materialPrefabDirection(directionInput.value);
        directionButton.textContent = direction;
        directionButton.style.color = materialPrefabDirectionColor(direction);
        directionButton.disabled = !prefab;
    }
    if (directionStatus && directionInput) {
        directionStatus.textContent = prefab ? "Nyomd meg a gombot, hogy válts elhozni/elvinni között." : "";
    }
}

function renderMaterials() {
    const d = data();
    const allMaterials = d.materialRequests || [];
    const result = requestHistoryResult(allMaterials, materialRequestProjectFilter, materialRequestSearch);
    const items = result.items;
    const editing = editingMaterialRequestId ? allMaterials.find((item) => item.id === editingMaterialRequestId) : null;
    const formAction = editing ? "edit-material-request" : "add-material-request";
    const headerText = editing ? "Anyagigény módosítása" : "Új anyagigény";
    const submitText = editing ? "Módosítás mentése" : "Anyagigény mentése";
    const prefabMode = Boolean(editing?.prefabTransport);
    const rawFieldStyle = prefabMode ? ` style="display:none"` : "";
    const rawDisabled = prefabMode ? "disabled" : "";
    const rawMaterialRequired = "";
    const prefabFieldStyle = prefabMode ? "" : ` style="display:none"`;
    const prefabDisabled = prefabMode ? "" : "disabled";
    const prefabRequired = "";
    const prefabDirection = materialPrefabDirection(editing?.prefabDirection);
    return `
    ${datalist("material-list", d.materialNames || [])}
    ${datalist("material-type-list", d.materialTypes || [])}
    ${datalist("material-length-list", d.materialLengths || [])}
    ${datalist("external-company-list", d.externalCompanies || [])}
    ${datalist("prefab-task-type-list", d.prefabTaskTypes || [])}
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>${headerText}</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="${formAction}">
            ${editing ? `<input type="hidden" name="id" value="${attr(editing.id)}">` : ""}
            <label class="checkbox-label wide"><input type="checkbox" name="prefabTransport" data-action="material-prefab-toggle" ${prefabMode ? "checked" : ""}><span>Előgyártmány szállítás</span></label>
            <input type="hidden" name="prefabDirection" value="${attr(prefabDirection)}">
            <label data-material-raw-field${rawFieldStyle}>Anyag<input name="material" list="material-list" ${rawMaterialRequired} ${rawDisabled} autocomplete="off" placeholder="S235" value="${attr(prefabMode ? "" : (editing?.material || ""))}"></label>
            <label data-material-raw-field${rawFieldStyle}>Méret
              <span style="display:flex; gap:6px; align-items:stretch">
                <input name="size" ${rawDisabled} autocomplete="off" placeholder="nyers és/vagy kész méret" value="${attr(prefabMode ? "" : (editing?.size || ""))}" style="flex:1; min-width:0">
                <button type="button" class="small-button" data-action="insert-diameter" data-target="size" title="Átmérő jel (Ø) beszúrása" style="padding:0 12px">Ø</button>
              </span>
            </label>
            <label data-material-raw-field${rawFieldStyle}>Hossz<input name="length" list="material-length-list" ${rawDisabled} autocomplete="off" placeholder="pl. 6000 mm" value="${attr(prefabMode ? "" : (editing?.length || ""))}"></label>
            <label data-material-raw-field${rawFieldStyle}>Darabszám<input name="quantity" type="number" min="0" step="1" ${rawDisabled} autocomplete="off" placeholder="db" value="${attr(!prefabMode && editing?.quantity ? String(editing.quantity) : "")}"></label>
            <label data-material-raw-field${rawFieldStyle}>Típus<input name="type" list="material-type-list" ${rawDisabled} autocomplete="off" placeholder="hidegen húzott rúd" value="${attr(prefabMode ? "" : (editing?.type || ""))}"></label>
            <label data-material-prefab-field${prefabFieldStyle}>Külsős cég<input name="externalCompany" list="external-company-list" ${prefabRequired} ${prefabDisabled} autocomplete="off" placeholder="Külsős cég" value="${attr(editing?.externalCompany || "")}"></label>
            <label data-material-prefab-field${prefabFieldStyle}>Feladat típus<input name="prefabTaskType" list="prefab-task-type-list" ${prefabDisabled} autocomplete="off" placeholder="Feladat típus" value="${attr(editing?.prefabTaskType || "")}"></label>
            <div class="wide" data-material-prefab-field${prefabFieldStyle}>
              <div class="inline-actions" style="align-items:center">
                <button class="small-button" type="button" data-action="material-prefab-direction" data-material-prefab-direction-button ${prefabDisabled} style="color:${materialPrefabDirectionColor(prefabDirection)}; font-weight:700">${esc(prefabDirection)}</button>
                <span class="row-meta" data-material-prefab-direction-status>${prefabMode ? "Nyomd meg a gombot, hogy válts elhozni/elvinni között." : ""}</span>
              </div>
            </div>
            <label>Felelős<select name="userId" required>${userOptions(editing?.userId || "")}</select></label>
            <label>Projekt${projectPicker(editing?.projectId || "")}</label>
            <label class="wide">Leírás<textarea name="description" placeholder="Opcionális" ${editing ? "" : "data-material-prefab-input"}>${esc(editing?.description || "")}</textarea></label>
            ${editing ? "" : requestAttachmentFormBlock("material")}
            ${editing ? "" : `<div class="wide" data-material-prefab-field${prefabFieldStyle}>
              <div class="inline-actions"><button class="small-button" type="button" data-action="open-mobile-photo" data-target="material-prefab">Mobil fotó</button></div>
              <div id="material-prefab-pasted-images">${pendingMaterialPrefabImagesMarkup()}</div>
            </div>`}
            <div class="wide inline-actions">
              <button class="primary-button" type="submit">${submitText}</button>
              ${editing ? `<button class="small-button" type="button" data-action="cancel-edit-material">Mégse</button>` : ""}
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Anyagigények</h2></div>
        <div class="panel-body scroll-area">
          ${requestHistoryControls("material-request-search", materialRequestSearch, "material-request-project-filter", materialRequestProjectFilter, result)}
          ${items.length ? items.map((item) => requestRow(item, materialRequestTitle(item), "done-material", "edit-material", "delete-material", requestAttachmentActions(item, "material"), { includeQuantity: !item.prefabTransport })).join("") : `<div class="empty">${requestHistoryEmptyText(materialRequestSearch, materialRequestProjectFilter, "anyagigény")}</div>`}
        </div>
      </section>
    </div>
  `;
}

function fastenerTitle(item) {
    const quantity = Number(item.quantity || 0);
    const quantityText = quantity > 0 ? `${quantity} db` : "";
    return [item.type, item.size, quantityText, item.grade].filter(Boolean).join(" · ") || "Kötőelem";
}

function requestAttachmentStateKey(type) {
    if (type === "tool") return "tool";
    if (type === "material") return "material";
    return "fastener";
}

function getPendingRequestAttachment(type) {
    const key = requestAttachmentStateKey(type);
    if (key === "tool") return pendingToolAttachment;
    if (key === "material") return pendingMaterialAttachment;
    return pendingFastenerAttachment;
}

function setPendingRequestAttachment(type, value) {
    const key = requestAttachmentStateKey(type);
    if (key === "tool") pendingToolAttachment = value;
    else if (key === "material") pendingMaterialAttachment = value;
    else pendingFastenerAttachment = value;
}

function requestAttachmentApiRoute(type) {
    const key = requestAttachmentStateKey(type);
    if (key === "tool") return "tool-requests";
    if (key === "material") return "material-requests";
    return "fastener-requests";
}

const REQUEST_ATTACHMENT_EXTENSIONS = new Set([
    ".pdf",
    ".doc", ".docx", ".docm", ".dot", ".dotx", ".dotm", ".rtf",
    ".xls", ".xlsx", ".xlsm", ".xlsb", ".xlt", ".xltx", ".xltm", ".csv",
    ".ppt", ".pptx", ".pptm", ".pps", ".ppsx", ".ppsm", ".pot", ".potx", ".potm",
    ".vsd", ".vsdx", ".vsdm", ".vss", ".vssx", ".vssm", ".vst", ".vstx", ".vstm",
    ".mdb", ".accdb", ".pub", ".one", ".onepkg",
    ".odt", ".ods", ".odp", ".odg"
]);

function requestAttachmentExtension(value) {
    const match = String(value || "").trim().match(/(\.[^\\/.]+)$/);
    return match ? match[1].toLowerCase() : "";
}

function isRequestAttachmentPath(value) {
    return REQUEST_ATTACHMENT_EXTENSIONS.has(requestAttachmentExtension(value));
}

function requestAttachmentBadge(value) {
    const extension = requestAttachmentExtension(value);
    return extension ? extension.slice(1).toLocaleUpperCase("hu-HU") : "FÁJL";
}

function requestAttachmentCanPreview(value) {
    return [".xlsx", ".pdf"].includes(requestAttachmentExtension(value));
}

function requestAttachmentPreviewMarkup(type) {
    const attachment = getPendingRequestAttachment(type);
    if (!attachment) return `<div class="empty">Nincs melléklet kiválasztva.</div>`;
    const label = attachment.name || pathFileName(attachment.path) || "Melléklet";
    const typeSource = attachment.path || label;
    return `
      <div class="list-row">
        <span class="source-badge">${esc(requestAttachmentBadge(typeSource))}</span>
        <div>
          <div class="row-title">${esc(label)}</div>
          <div class="path-text">${esc(attachment.path || "")}</div>
        </div>
        <span class="inline-actions">
          <button class="small-button" type="button" data-action="copy-request-attachment-path" data-path="${attr(attachment.path || "")}">Útvonal másolása</button>
          <button class="small-button" type="button" data-action="clear-request-attachment" data-target="${attr(requestAttachmentStateKey(type))}">Törlés</button>
        </span>
      </div>
    `;
}

function refreshRequestAttachmentPreview(type) {
    const key = requestAttachmentStateKey(type);
    const target = document.getElementById(`${key}-attachment-preview`);
    if (target) target.innerHTML = requestAttachmentPreviewMarkup(key);
    const pathInput = document.getElementById(`${key}-attachment-path`);
    if (pathInput) pathInput.value = getPendingRequestAttachment(key)?.path || "";
}

function requestAttachmentActions(item, type) {
    if (!item?.attachment) return "";
    const base = `/api/${requestAttachmentApiRoute(type)}/${encodeURIComponent(item.id)}/attachment`;
    const label = item.attachment.name || pathFileName(item.attachment.path) || "Melléklet";
    const preview = requestAttachmentCanPreview(item.attachment.path || label)
        ? `<a class="small-button" href="${base}/view" target="_blank" rel="noopener">Megtekintés</a>`
        : "";
    return `
      <div class="request-attachment-row">
        <span class="source-badge">${esc(requestAttachmentBadge(label))}</span>
        <span class="row-title">${esc(label)}</span>
        <span class="inline-actions">
          ${preview}
          <a class="small-button" href="${base}/download" target="_blank" rel="noopener">Letöltés</a>
        </span>
      </div>
    `;
}

function requestAttachmentTableCell(item, type) {
    if (!item?.attachment) return "";
    const base = `/api/${requestAttachmentApiRoute(type)}/${encodeURIComponent(item.id)}/attachment`;
    const label = item.attachment.name || item.attachment.path || "";
    const preview = requestAttachmentCanPreview(item.attachment.path || label)
        ? `<a class="small-button" href="${base}/view" target="_blank" rel="noopener">Megtekintés</a>`
        : "";
    return `<span class="inline-actions">${preview}<a class="small-button" href="${base}/download" target="_blank" rel="noopener">Letöltés</a></span>`;
}

function requestAttachmentFormBlock(type) {
    const key = requestAttachmentStateKey(type);
    return `
      <div class="wide">
        <div class="drop-zone link" data-drop="${key}-attachment">
          <div class="drop-title">${globalThis.ERP_DEMO_CONFIG ? "Helyi dokumentum: Office / PDF link" : "Y: Office / PDF link"}</div>
          <div class="row-meta">Word-, Excel-, PowerPoint-, Visio-, Access-, Publisher-, OneNote-, OpenDocument- vagy PDF-fájl linkelhető. ${globalThis.ERP_DEMO_CONFIG ? "A demó csak a profil documents mappáját éri el." : "A fájl nem másolódik be az ERP-be."}</div>
          <div class="inline-actions">
            <button class="small-button" type="button" data-action="choose-request-attachment-link" data-target="${attr(key)}">Szerver tallózás</button>
            ${globalThis.ERP_DEMO_CONFIG ? "" : `<button class="small-button" type="button" data-action="helper-pick-request-attachment" data-target="${attr(key)}">Helyi tallózás</button>
            <button class="small-button" type="button" data-action="helper-drop-request-attachment" data-target="${attr(key)}">Drop ablak</button>`}
          </div>
          <div class="request-attachment-path-row">
            <input id="${attr(key)}-attachment-path" type="text" value="${attr(getPendingRequestAttachment(key)?.path || "")}" autocomplete="off" spellcheck="false" placeholder="${globalThis.ERP_DEMO_CONFIG ? "documents/dokumentum.xlsx vagy .pdf" : "Y:\\...\\dokumentum.xlsx vagy .pdf"}">
            <button class="small-button" type="button" data-action="apply-request-attachment-path" data-target="${attr(key)}">Útvonal linkelése</button>
          </div>
        </div>
        <div id="${attr(key)}-attachment-preview" style="margin-top: 12px">${requestAttachmentPreviewMarkup(key)}</div>
      </div>
    `;
}

function fastenerAttachmentPreviewMarkup() {
    return requestAttachmentPreviewMarkup("fastener");
}

function refreshFastenerAttachmentPreview() {
    refreshRequestAttachmentPreview("fastener");
}

function fastenerAttachmentActions(item) {
    return requestAttachmentActions(item, "fastener");
}

function fastenerAttachmentTableCell(item) {
    return requestAttachmentTableCell(item, "fastener");
}

function renderFasteners() {
    const d = data();
    const allFasteners = d.fastenerRequests || [];
    const result = requestHistoryResult(allFasteners, fastenerRequestProjectFilter, fastenerRequestSearch);
    const items = result.items;
    const editing = editingFastenerRequestId ? allFasteners.find((item) => item.id === editingFastenerRequestId) : null;
    const formAction = editing ? "edit-fastener-request" : "add-fastener-request";
    const headerText = editing ? "Kötőelem igény módosítása" : "Új kötőelem igény";
    const submitText = editing ? "Módosítás mentése" : "Kötőelem igény mentése";
    const defaultGrade = editing ? (editing.grade || "") : "8.8";
    return `
    ${datalist("fastener-grade-list", d.fastenerGrades || [])}
    ${datalist("fastener-type-list", d.fastenerTypes || [])}
    ${datalist("fastener-size-list", d.fastenerSizes || [])}
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>${headerText}</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="${formAction}">
            ${editing ? `<input type="hidden" name="id" value="${attr(editing.id)}">` : ""}
            <label>Szilárdság / anyag<input name="grade" list="fastener-grade-list" autocomplete="off" placeholder="8.8 / A2-70" value="${attr(defaultGrade)}"></label>
            <label>Típus<input name="type" list="fastener-type-list" autocomplete="off" placeholder="imbusz csavar" value="${attr(editing?.type || "")}"></label>
            <label>Méret
              <span style="display:flex; gap:6px; align-items:stretch">
                <input name="size" list="fastener-size-list" autocomplete="off" placeholder="M8x30" value="${attr(editing?.size || "")}" style="flex:1; min-width:0">
                <button type="button" class="small-button" data-action="insert-diameter" data-target="size" title="Átmérő jel (Ø) beszúrása" style="padding:0 12px">Ø</button>
              </span>
            </label>
            <label>Darabszám<input name="quantity" type="number" min="0" step="1" autocomplete="off" placeholder="db" value="${attr(editing?.quantity ? String(editing.quantity) : "")}"></label>
            <label>Projekt${projectPicker(editing?.projectId || "")}</label>
            <label>Felelős<select name="userId" required>${userOptions(editing?.userId || "")}</select></label>
            <label class="wide">Leírás<textarea name="description" placeholder="Opcionális">${esc(editing?.description || "")}</textarea></label>
            ${editing ? "" : requestAttachmentFormBlock("fastener")}
            <div class="wide inline-actions">
              <button class="primary-button" type="submit">${submitText}</button>
              ${editing ? `<button class="small-button" type="button" data-action="cancel-edit-fastener">Mégse</button>` : ""}
            </div>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Kötőelem igények</h2></div>
        <div class="panel-body scroll-area">
          ${requestHistoryControls("fastener-request-search", fastenerRequestSearch, "fastener-request-project-filter", fastenerRequestProjectFilter, result)}
          ${items.length ? items.map((item) => requestRow(item, fastenerTitle(item), "done-fastener", "edit-fastener", "delete-fastener", fastenerAttachmentActions(item), { includeQuantity: false })).join("") : `<div class="empty">${requestHistoryEmptyText(fastenerRequestSearch, fastenerRequestProjectFilter, "kötőelem igény")}</div>`}
        </div>
      </section>
    </div>
  `;
}

function worklogSortKey(log) {
    const day = String(log.workDate || "").slice(0, 10);
    const created = String(log.createdAt || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day}T99:99:99_${created}` : created;
}

function filteredWorklogs() {
    return filterByProject(filterByResponsible(data().workLogs || [], worklogUserFilter), worklogProjectFilter)
        .slice()
        .sort((a, b) => worklogSortKey(b).localeCompare(worklogSortKey(a)));
}

function worklogRecentTableMarkup(logs) {
    if (!logs.length) return `<div class="empty">Nincs munkaidő napló.</div>`;
    return table(["Projekt", "Munka / CNC gép", "Óra", "Felelős", "Dátum", ""], logs.slice(0, 500).map((log) => {
        const logProject = projectById(log.projectId);
        const logCompany = logProject?.company || log.company || "";
        return [
            `${esc(log.projectName)}${logCompany ? `<div class="row-meta" style="font-size: 11px; line-height: 1.2; margin-top: 3px">${esc(logCompany)}</div>` : ""}`,
            `${esc(log.cncMachineName ? `CNC: ${log.cncMachineName}` : (log.workType || ""))}${log.note ? `<div class="row-meta" style="white-space: pre-wrap; line-height: 1.25; margin-top: 2px">${esc(log.note)}</div>` : ""}${log.filePath ? `<div class="row-meta" style="line-height: 1.25; margin-top: 2px"><strong>${esc(log.fileName || "")}</strong><div class="path-text">${esc(log.filePath)}</div></div>` : ""}`,
            `${esc(formatHours(log.hours))}${canShowWorklogOvertime(log) ? " (T)" : ""}`,
            esc(userName(log.userId)),
            fmtDate(log.workDate || log.createdAt, false),
            `<span class="inline-actions worklog-row-actions"><button class="small-button" type="button" data-action="edit-worklog" data-id="${attr(log.id)}">Szerkesztés</button><button class="small-button worklog-resubmit-button" type="button" data-action="resubmit-worklog" data-id="${attr(log.id)}" title="Újra, új bejegyzésként" aria-label="Újra, új bejegyzésként">↻</button><button class="danger-button small-button worklog-delete-button" type="button" data-action="delete-worklog" data-id="${attr(log.id)}" data-label="${attr(`${log.projectName || ""} · ${log.cncMachineName ? `CNC: ${log.cncMachineName}` : (log.workType || "")} · ${formatHours(log.hours)} óra · ${fmtDate(log.workDate || log.createdAt, false)}`)}">Törlés</button></span>`
        ];
    }));
}

function worklogRecentContentMarkup(logs) {
    return `
      <div class="worklog-recent-filters">
        <label class="inline-filter">Felelős szűrő
          ${filterUserPicker("worklog-user-filter", worklogUserFilter, "Minden felelős")}
        </label>
        <label class="inline-filter">Projekt szűrő
          ${filterProjectPicker("worklog-project-filter", worklogProjectFilter)}
        </label>
      </div>
      ${worklogRecentTableMarkup(logs)}
    `;
}

function renderWorklogListFullscreenModal() {
    const logs = filteredWorklogs();
    const overtimeSummary = worklogOvertimeSummary(worklogUserFilter);
    modalRoot.innerHTML = `
      <div class="modal-backdrop" data-action="close-modal-backdrop">
        <article class="modal worklog-fullscreen-modal worklog-list-panel">
          <header class="modal-header">
            <div>
              <h2>Legutóbbi naplózások</h2>
              ${overtimeSummary ? `<p class="row-meta">${overtimeSummary}</p>` : ""}
            </div>
            <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
          </header>
          <div class="modal-body worklog-fullscreen-body">
            ${worklogRecentContentMarkup(logs)}
          </div>
        </article>
      </div>
    `;
}

function renderWorklog() {
    const logs = filteredWorklogs();
    const overtimeAllowed = canUseOvertime();
    const overtimeSummary = worklogOvertimeSummary(worklogUserFilter);
    const activeProjs = projects(false);
    if (worklogProjectId && !activeProjs.some((p) => p.id === worklogProjectId)) worklogProjectId = "";
    if (cncWorklogProjectId && !activeProjs.some((p) => p.id === cncWorklogProjectId)) cncWorklogProjectId = "";
    if (worklogExportProjectId && !projects(true).some((p) => p.id === worklogExportProjectId)) worklogExportProjectId = "";
    if (worklogExportUserId && !users().some((u) => u.id === worklogExportUserId)) worklogExportUserId = "";
    const worklogExportParams = [];
    if (worklogExportProjectId) worklogExportParams.push(`projectId=${encodeURIComponent(worklogExportProjectId)}`);
    if (worklogExportUserId) worklogExportParams.push(`userId=${encodeURIComponent(worklogExportUserId)}`);
    const worklogExportQuery = worklogExportParams.length ? `?${worklogExportParams.join("&")}` : "";
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>Munkaidő rögzítése</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-worklog">
            <label class="wide">Projekt${projectPicker(worklogProjectId, { action: "worklog-project" })}</label>
            <div class="wide" id="worklog-company-section">${worklogCompanySectionHtml(worklogProjectId)}</div>
            <label>Munka típusa<select name="workType">${workTypes().map((type) => `<option>${esc(type)}</option>`).join("")}</select></label>
            <label>Idő${hoursInput()}</label>
            <label>Dátum<input name="date" type="date" value="${localInputDate()}"></label>
            <label>Felhasználó<select name="userId" required>${userOptions(currentUser?.id || "")}</select></label>
            ${overtimeAllowed ? `<label class="wide" style="display:flex; gap:8px; align-items:center; flex-direction:row"><input type="checkbox" name="overtime" style="width:auto"> Túlóra</label>` : ""}
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális" rows="2"></textarea></label>
            <button class="primary-button wide" type="submit">Naplózás</button>
          </form>
          <div class="cnc-worklog-section" style="margin-top: 14px; border-top: 1px solid #252a2c; padding-top: 12px">
            <div style="padding: 8px 0; font-weight: 600">CNC munka naplózása</div>
            <form class="form-grid" data-action="add-cnc-worklog" style="margin-top: 8px">
              <label class="wide">Projekt${projectPicker(cncWorklogProjectId, { action: "cnc-worklog-project" })}</label>
              <div class="wide" id="cnc-worklog-company-section">${cncWorklogCompanySectionHtml()}</div>
              <label>CNC gép<select name="cncMachineId" required>${cncMachineOptions()}</select></label>
              <label>Idő${hoursInput()}</label>
              <label>Dátum<input name="date" type="date" value="${localInputDate()}"></label>
              <label>Felhasználó<select name="userId" required>${userOptions(currentUser?.id || "")}</select></label>
              ${overtimeAllowed ? `<label class="wide" style="display:flex; gap:8px; align-items:center; flex-direction:row"><input type="checkbox" name="overtime" style="width:auto"> Túlóra</label>` : ""}
              <label class="wide">Megjegyzés
                <span style="display:grid; gap:6px">
                  <textarea name="note" placeholder="Opcionális" rows="2" data-cnc-worklog-note></textarea>
                  ${!globalThis.ERP_DEMO_CONFIG || state?.config?.ocrEnabled
                    ? `<button type="button" class="primary-button small-button" data-action="open-drawing-ocr" style="justify-self:start">Rajzszám szkennelése</button>`
                    : `<span class="row-meta">OCR opcionális: Tesseract telepítés és helyi konfiguráció után érhető el.</span>`}
                </span>
              </label>
              <label class="wide">${globalThis.ERP_DEMO_CONFIG ? "Fájl link (opcionális, helyi documents)" : "Fájl link (opcionális, csak Y:\\)"}
                <span style="display:flex; gap:6px; align-items:stretch; flex-wrap:wrap">
                  <input name="filePath" placeholder="${globalThis.ERP_DEMO_CONFIG ? "documents/fájl.pdf" : "Y:\\..."}" autocomplete="off" style="flex:1; min-width:160px">
                  <button type="button" class="small-button" data-action="choose-cnc-file" title="${globalThis.ERP_DEMO_CONFIG ? "Tallózás a helyi documents mappában" : "Tallózás a host gép Y: meghajtóján"}">Szerver</button>
                  ${globalThis.ERP_DEMO_CONFIG ? "" : `<button type="button" class="small-button" data-action="helper-pick-cnc-file" title="Tallózás ezen a PC-n a helperrel">Helyi</button>
                  <button type="button" class="small-button" data-action="helper-drop-cnc-file" title="Drag-and-drop ablak a helperrel">Drop</button>`}
                </span>
              </label>
              <button class="primary-button wide" type="submit">CNC naplózás</button>
            </form>
          </div>
          <div class="worklog-export-section" style="margin-top: 14px; border-top: 1px solid var(--line); padding-top: 12px">
            <div style="padding: 8px 0; font-weight: 600">Munkaidő export</div>
            <p class="row-meta">Minden naplózott munkaidő (kézi + CNC) Excelbe exportálható. Szűrhetsz projektre és/vagy felelősre — üresen hagyva mindent exportál. Mindkét szűrő kitöltve csak az adott projekt és felelős bejegyzései kerülnek bele.</p>
            <div class="form-grid" style="margin-top: 8px">
              <label class="wide">Projekt szűrő (opcionális)${filterProjectPicker("worklog-export-project", worklogExportProjectId)}</label>
              <label class="wide">Felelős szűrő (opcionális)${filterUserPicker("worklog-export-user", worklogExportUserId, "Minden felelős")}</label>
              <div class="wide inline-actions">
                <a class="primary-button" href="/api/export/worklogs${worklogExportQuery}">Munkaidő XLSX export</a>
              </div>
            </div>
          </div>
        </div>
      </section>
      <section class="panel worklog-list-panel">
        <div class="panel-header">
          <h2>Legutóbbi naplózások</h2>
          <div class="inline-actions" style="justify-content:flex-end">
            ${overtimeSummary ? `<span class="row-meta" style="font-size:12px; text-align:right">${overtimeSummary}</span>` : ""}
            <button class="small-button" type="button" data-action="open-worklog-fullscreen" title="Legutóbbi naplózások teljes képernyőn">⛶ Teljes képernyő</button>
          </div>
        </div>
        <div class="panel-body scroll-area">
          ${worklogRecentContentMarkup(logs)}
        </div>
      </section>
    </div>
  `;
}

function renderBom() {
    const boms = (data().boms || []).filter((bom) => isActiveProjectId(bom.projectId));
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>BOM hozzáadása</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-bom">
            <label>Projekt${projectPicker()}</label>
            <label>BOM név<input name="name" autocomplete="off" placeholder="Darabjegyzék"></label>
            <label>Revízió<input name="revision" autocomplete="off" placeholder="A / V1 / dátum"></label>
            <label class="wide">Linkelt Excel / CSV útvonal<input name="filePath" value="${attr(bomLinkPath)}" autocomplete="off" placeholder="${globalThis.ERP_DEMO_CONFIG ? "documents/demo-bom.csv" : "Y:\\...\\bom.xlsx"}"></label>
            <div class="wide">
              <div class="drop-grid">
                <div class="drop-zone link" data-drop="bom-link">
                  <div class="drop-title">LINK</div>
                  <div class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "A helyi profil documents mappájában lévő BOM fájl." : "Y: vagy más hálózati meghajtón lévő BOM fájl."}</div>
                  <div class="inline-actions">
                    <button class="small-button" type="button" data-action="choose-bom-link">Szerver tallózás</button>
                    ${globalThis.ERP_DEMO_CONFIG ? "" : `<button class="small-button" type="button" data-action="helper-pick-bom-link">Helyi tallózás</button>
                    <button class="small-button" type="button" data-action="helper-drop-bom-link">Drop ablak</button>`}
                  </div>
                </div>
                <div class="drop-zone">
                  <div class="drop-title">FELTÖLTÉS</div>
                  <div class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "Excel/CSV másolása a külön helyi demó feltöltések közé, importálással együtt." : "Excel/CSV másolása az ERP projektmappába, importálással együtt."}</div>
                  <input id="bom-upload-file" name="bomFile" type="file" accept=".xlsx,.csv,.txt" data-action="bom-upload-file">
                  <button class="small-button" type="button" data-action="pick-bom-upload">Fájl választása</button>
                  <div class="row-meta" id="bom-upload-name">Nincs fájl kiválasztva.</div>
                </div>
              </div>
              <div id="bom-link-preview" style="margin-top: 12px">${bomLinkPreviewMarkup()}</div>
            </div>
            <button class="primary-button wide" type="submit">BOM mentése és import</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>BOM-ok</h2></div>
        <div class="panel-body scroll-area">
          ${boms.length ? `<div class="compact-list">${boms.map(bomRow).join("")}</div>` : `<div class="empty">Nincs aktív projekthez tartozó BOM.</div>`}
        </div>
      </section>
    </div>
  `;
}

function renderCadModels() {
    const models = [...(data().cadModels || [])].sort((a, b) => String(b.exportedAt || "").localeCompare(String(a.exportedAt || "")));
    const canManage = hasFinanceClearance();
    return `
      <section class="panel">
        <div class="panel-header">
          <h2>3D modellek (${models.length})</h2>
          <span class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "Helyi minta-importok: imports/cadmodels" : "Helper exportok: Y:\\WorkshopERP\\imports\\cadmodels"}</span>
        </div>
        <div class="panel-body">
          <p class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "A kész GLB/JSON pár helyi importként jelenik meg. A minta nem hoz létre és nem rendel hozzá projektet automatikusan." : "Az export akkor jelenik meg, ha a GLB és a hozzá tartozó JSON is elkészült. A projekt automatikus hozzárendelése csak már létező ERP projektmappa pontos útvonala alapján történik."}</p>
          ${models.length ? `<div class="compact-list cad-model-list">${models.map((model) => {
              const project = model.projectId ? projectById(model.projectId) : null;
              const displayName = model.nickname || model.sourceName || model.glbFile;
              return `<article class="cad-model-row">
                <div class="cad-model-main">
                  <div class="row-title">${esc(displayName)}</div>
                  ${model.nickname ? `<div class="row-meta">Forrás: ${esc(model.sourceName || model.glbFile)}</div>` : ""}
                  <div class="row-meta">Export: ${fmtDate(model.exportedAt)} · ${formatFileSize(model.bytes)} · ${esc(model.sourceType === "part" ? "Alkatrész" : "Összeállítás")}</div>
                  <div class="row-meta">ERP projekt: ${project ? esc(project.name) : "<strong>nincs hozzárendelve</strong>"}${model.projectId && !project ? " (a korábbi projekt nem található)" : ""}</div>
                  ${model.projectLabel ? `<div class="row-meta">Helper projektneve: ${esc(model.projectLabel)}</div>` : ""}
                  <div class="path-text">${esc(model.glbFile)}</div>
                </div>
                <div class="inline-actions cad-model-actions">
                  <button class="small-button" type="button" data-action="open-cad-model" data-id="${attr(model.id)}">3D megnyitás</button>
                  <button class="small-button" type="button" data-action="edit-cad-model-nickname" data-id="${attr(model.id)}">Becenév</button>
                  ${canManage ? `<button class="small-button" type="button" data-action="assign-cad-model" data-id="${attr(model.id)}">Projekt hozzárendelése</button>
                    <button class="danger-button small-button" type="button" data-action="trash-cad-model" data-id="${attr(model.id)}">Törlés</button>` : ""}
                </div>
              </article>`;
          }).join("")}</div>` : `<div class="empty">Még nincs kész 3D modell-export.</div>`}
          <p class="row-meta" style="margin-top: 12px">A megjelenítő igény szerint töltődik be. <a href="/api/cadmodels/viewer-source" download="erp-glb-viewer-source.zip">Megjelenítő forrása és licence</a></p>
        </div>
      </section>
    `;
}

function showCadViewer(modelId) {
    const model = (data().cadModels || []).find((item) => item.id === modelId);
    if (!model || !cadViewerRoot) return;
    openCadViewerId = modelId;
    const modelUrl = `/api/cadmodels/${encodeURIComponent(modelId)}/glb`;
    const viewerUrl = `/erp-glb-viewer/index.html?v=20260926-measure-nav1&model=${encodeURIComponent(modelUrl)}`;
    cadViewerRoot.innerHTML = `<div class="modal-backdrop cad-viewer-backdrop" data-action="close-cad-viewer">
      <article class="modal cad-viewer-modal" role="dialog" aria-modal="true" aria-label="3D modell">
        <header class="modal-header"><div><h2>${esc(model.nickname || model.sourceName || model.glbFile)}</h2><p class="row-meta">${esc(projectById(model.projectId)?.name || model.projectLabel || "Projekt nélkül")}</p></div>
          <button class="icon-button" type="button" data-action="close-cad-viewer" aria-label="Bezárás">×</button></header>
        <iframe class="cad-viewer-frame" title="3D modell megjelenítő" src="${attr(viewerUrl)}" loading="eager"></iframe>
      </article>
    </div>`;
}

function closeCadViewer() {
    openCadViewerId = "";
    if (cadViewerRoot) {
        try { cadViewerRoot.querySelector("iframe")?.contentWindow?.erpGlbViewer?.destroy(); } catch (_error) { /* iframe may still be loading */ }
        cadViewerRoot.innerHTML = "";
    }
}

function bomRow(bom) {
    const itemCount = bom.items?.length || 0;
    return `
    <div class="request-row">
      <span class="source-badge">${bom.kind === "upload" ? "FÁJL" : "LINK"}</span>
      <div>
        <div class="row-title">${esc(bom.name)}${bom.revision ? ` · ${esc(bom.revision)}` : ""}</div>
        <div class="row-meta">${esc(bom.projectName)} · ${itemCount} importált sor · ${fmtDate(bom.createdAt)}</div>
        <div class="path-text">${esc(bom.path || "")}</div>
        ${bom.importError ? `<div class="muted">Import hiba: ${esc(bom.importError)}</div>` : ""}
      </div>
      <span class="inline-actions">
        <a class="small-button" href="/api/boms/${attr(bom.id)}/file" target="_blank" rel="noopener">Letöltés</a>
        <button class="small-button" type="button" data-action="open-project" data-id="${attr(bom.projectId || "")}">Projekt</button>
        <button class="danger-button small-button" type="button" data-action="delete-bom" data-id="${attr(bom.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function renderSuppliers() {
    const suppliers = financeData().suppliers || [];
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>Beszállító hozzáadása</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-supplier">
            <label class="wide">Név<input name="name" required autocomplete="off" placeholder="Beszállító neve"></label>
            <label>Kapcsolattartó<input name="contact" autocomplete="off"></label>
            <label>Email<input name="email" autocomplete="off"></label>
            <label>Telefon<input name="phone" autocomplete="off"></label>
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális"></textarea></label>
            <button class="primary-button wide" type="submit">Beszállító mentése</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Beszállítók</h2></div>
        <div class="panel-body scroll-area">
          ${suppliers.length ? `<div class="compact-list">${suppliers.map(supplierRow).join("")}</div>` : `<div class="empty">Még nincs beszállító.</div>`}
        </div>
      </section>
    </div>
  `;
}

function supplierRow(supplier) {
    return `
    <div class="list-row">
      <span class="source-badge">B</span>
      <div>
        <div class="row-title">${esc(supplier.name)}</div>
        <div class="row-meta">${esc([supplier.contact, supplier.email, supplier.phone].filter(Boolean).join(" · "))}</div>
        ${supplier.note ? `<div class="muted">${esc(supplier.note)}</div>` : ""}
      </div>
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="edit-supplier" data-id="${attr(supplier.id)}">Szerkesztés</button>
        <button class="danger-button small-button" type="button" data-action="delete-supplier" data-id="${attr(supplier.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function renderPriceItems() {
    const settings = financeSettings();
    const items = financeData().priceItems || [];
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>Projekt ár / beszerzés</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-price-item">
            <label>Projekt${projectPicker()}</label>
            <label>Beszállító<select name="supplierId">${supplierOptions()}</select></label>
            <label>Kategória<select name="category">${optionList(settings.categories)}</select></label>
            <label>Megnevezés<input name="name" required autocomplete="off" placeholder="Alkatrész, anyag, szolgáltatás"></label>
            <label>Mennyiség<input name="quantity" type="number" step="0.01" value="1"></label>
            <label>Egység<input name="unit" autocomplete="off" value="${globalThis.ERP_DEMO_CONFIG ? "pcs" : "db"}"></label>
            <label>Egységár<input name="unitPrice" type="number" step="0.01" value="0"></label>
            <label>Pénznem<select name="currency">${optionList(settings.currencies, "HUF")}</select></label>
            <label>Státusz<select name="status">${optionList(settings.statuses)}</select></label>
            <label>Dátum<input name="date" type="date" value="${localInputDate()}"></label>
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális"></textarea></label>
            <button class="primary-button wide" type="submit">Tétel mentése</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Ár tételek</h2></div>
        <div class="panel-body scroll-area">
          ${items.length ? `<div class="compact-list">${items.slice(0, 160).map(priceItemRow).join("")}</div>` : `<div class="empty">Nincs rögzített ár tétel.</div>`}
        </div>
      </section>
    </div>
  `;
}

function priceItemRow(item) {
    return `
    <div class="request-row">
      <span class="source-badge">${esc(item.currency || "HUF")}</span>
      <div>
        <div class="row-title">${esc(item.name)} · ${money(itemTotal(item), item.currency)}</div>
        <div class="row-meta">${esc(item.projectName)} · ${esc(item.supplierName || supplierName(item.supplierId, "Nincs beszállító"))} · ${esc(item.category)} · ${esc(item.status)} · ${esc(item.date || "")}</div>
        <div class="muted">${esc(item.quantity)} ${esc(item.unit)} × ${money(item.unitPrice, item.currency)}${item.note ? ` · ${esc(item.note)}` : ""}</div>
      </div>
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="edit-price-item" data-id="${attr(item.id)}">Módosítás</button>
        <button class="danger-button small-button" type="button" data-action="delete-price-item" data-id="${attr(item.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function renderCostPlanning() {
    const all = projects(true);
    if (costPlanningProjectId && !projectById(costPlanningProjectId)) costPlanningProjectId = "";
    const project = projectById(costPlanningProjectId);
    const settings = financeSettings();
    const items = project ? filterByEntryUser(filterByProject(financeData().costItems || [], costPlanningProjectId), costPlanningUserFilter) : [];
    const planned = sumField(items, "plannedAmount");
    const actual = sumField(items, "actualAmount");
    const categoryRows = settings.costCategories.map((category) => {
        const rows = items.filter((item) => item.category === category);
        const catPlanned = sumField(rows, "plannedAmount");
        const catActual = sumField(rows, "actualAmount");
        return [esc(category), money(catPlanned, "HUF"), money(catActual, "HUF"), money(catActual - catPlanned, "HUF")];
    }).filter((row) => row[1] !== money(0, "HUF") || row[2] !== money(0, "HUF"));
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Projekt költségtervezés</h2></div>
        <div class="panel-body">
          <label class="inline-filter">Felelős / rögzítő szűrő
            ${filterUserPicker("cost-planning-user-filter", costPlanningUserFilter)}
          </label>
          <label class="inline-filter">Projekt költségtervezés
            ${filterProjectPicker("cost-planning-project", costPlanningProjectId, "Válassz projektet")}
          </label>
          <span class="row-meta">Itt külön projektre bontva lehet terv és tény költségeket felvinni és követni.</span>
        </div>
      </section>
      <div class="metric-grid">
        <div class="metric"><strong>${money(planned, "HUF")}</strong><span>Költség összesítő Ft</span></div>
        <div class="metric"><strong>${money(actual, "HUF")}</strong><span>Tényleges költség Ft</span></div>
        <div class="metric"><strong>${money(actual - planned, "HUF")}</strong><span>Eltérés Ft</span></div>
      </div>
      ${project ? `
        <section class="panel">
          <div class="panel-header"><h2>Új költségtétel</h2></div>
          <div class="panel-body">
            <form class="form-grid four" data-action="add-cost-item">
              <input type="hidden" name="projectId" value="${attr(project.id)}">
              <label>Kategória<select name="category">${optionList(settings.costCategories)}</select></label>
              <label>Megnevezés<input name="name" required autocomplete="off" placeholder="Anyag, bérmunka, mérnöki óra"></label>
              <label>Terv Ft<input name="plannedAmount" type="number" step="1" value="0"></label>
              <label>Tény Ft<input name="actualAmount" type="number" step="1" value="0"></label>
              <label>Státusz<select name="status">${optionList(settings.statuses)}</select></label>
              <label>Dátum<input name="date" type="date" value="${localInputDate()}"></label>
              <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális"></textarea></label>
              <button class="primary-button wide" type="submit">Mentés</button>
            </form>
          </div>
        </section>
      ` : `<div class="empty">Válassz ki egy projektet, és utána tudsz költségtételeket felvinni hozzá.</div>`}
      <section class="panel">
        <div class="panel-header"><h2>Kategória összesítő</h2></div>
        <div class="panel-body">${categoryRows.length ? table(["Kategória", "Terv Ft", "Tény Ft", "Eltérés Ft"], categoryRows) : `<div class="empty">Nincs költségtétel.</div>`}</div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Költségtételek</h2></div>
        <div class="panel-body">${items.length ? table(["Projekt", "Kategória", "Tétel", "Terv Ft", "Tény Ft", "Státusz", "Művelet"], items.map(costItemTableRow)) : `<div class="empty">Nincs rögzített költségtétel.</div>`}</div>
      </section>
    </div>
  `;
}

function costItemTableRow(item) {
    return [
        esc(item.projectName),
        esc(item.category),
        `${esc(item.name)}${item.note ? `<div class="row-meta">${esc(item.note)}</div>` : ""}`,
        money(item.plannedAmount, "HUF"),
        money(item.actualAmount, "HUF"),
        statusBadge(item.status),
        `<button class="small-button" type="button" data-action="edit-cost-item" data-id="${attr(item.id)}">Szerkesztés</button>
         <button class="danger-button small-button" type="button" data-action="delete-cost-item" data-id="${attr(item.id)}">Törlés</button>`
    ];
}

function renderOutsourcing() {
    const settings = financeSettings();
    const items = filterByProject(filterByEntryUser(financeData().outsourceItems || [], outsourceUserFilter), outsourceProjectFilter);
    return `
    <div class="single-view">
      ${userProjectFilterPanel("outsource-user-filter", outsourceUserFilter, "outsource-project-filter", outsourceProjectFilter)}
      <section class="panel">
        <div class="panel-header"><h2>Új tétel</h2></div>
        <div class="panel-body">
          <form class="form-grid four" data-action="add-outsource-item">
            <label>Projekt${projectPicker()}</label>
            <label>Alkatrész<input name="part" required autocomplete="off"></label>
            <label>Művelet<select name="operation">${optionList(settings.outsourceOperations)}</select></label>
            <label>Beszállító<select name="supplierId">${supplierOptions()}</select></label>
            <label>Kiadva<input name="issuedAt" type="date"></label>
            <label>Vissza várható<input name="expectedBackAt" type="date"></label>
            <label>Terv Ft<input name="plannedAmount" type="number" step="1"></label>
            <label>Tény Ft<input name="actualAmount" type="number" step="1"></label>
            <label>Státusz<select name="status">${optionList(settings.outsourceStatuses)}</select></label>
            <label class="wide">Következő lépés<input name="nextStep" autocomplete="off"></label>
            <button class="primary-button wide" type="submit">Mentés</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-body">${items.length ? table(["Projekt", "Alkatrész", "Művelet", "Beszállító", "Kiadva", "Vissza várható", "Terv Ft", "Tény Ft", "Státusz", "Következő lépés", "Művelet"], items.map(outsourceTableRow)) : `<div class="empty">Nincs bérmunka / külső művelet.</div>`}</div>
      </section>
    </div>
  `;
}

function outsourceTableRow(item) {
    return [
        esc(item.projectName),
        esc(item.part),
        esc(item.operation),
        esc(item.supplierName || supplierName(item.supplierId, "")),
        esc(item.issuedAt || ""),
        esc(item.expectedBackAt || ""),
        money(item.plannedAmount, "HUF"),
        money(item.actualAmount, "HUF"),
        statusBadge(item.status),
        esc(item.nextStep || ""),
        `<button class="small-button" type="button" data-action="edit-outsource-item" data-id="${attr(item.id)}">Szerkesztés</button>
         <button class="danger-button small-button" type="button" data-action="delete-outsource-item" data-id="${attr(item.id)}">Törlés</button>`
    ];
}

function renderProductionItems() {
    const settings = financeSettings();
    const items = filterByProject(filterByEntryUser(financeData().productionItems || [], productionItemUserFilter), productionItemProjectFilter);
    return `
    <div class="single-view">
      ${userProjectFilterPanel("production-item-user-filter", productionItemUserFilter, "production-item-project-filter", productionItemProjectFilter)}
      <section class="panel">
        <div class="panel-header"><h2>Új tétel</h2></div>
        <div class="panel-body">
          <form class="form-grid four" data-action="add-production-item">
            <label>Projekt${projectPicker()}</label>
            <label>Alkatrész<input name="part" required autocomplete="off"></label>
            <label>Művelet<select name="operation">${optionList(settings.productionOperations)}</select></label>
            <label>Gép/Munkahely<select name="workplace">${optionList(allWorkplaces())}</select></label>
            <label>Terv óra<input name="plannedHours" type="number" step="0.25" value="0"></label>
            <label>Tény óra<input name="actualHours" type="number" step="0.25" value="0"></label>
            <label>Típus<select name="type">${optionList(settings.productionTypes)}</select></label>
            <label>Beszállító<select name="supplierId">${supplierOptions()}</select></label>
            <label>Határidő<input name="deadline" type="date"></label>
            <label>Prioritás<select name="priority">${optionList(settings.productionPriorities)}</select></label>
            <label>Státusz<select name="status">${optionList(settings.productionStatuses)}</select></label>
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális"></textarea></label>
            <button class="primary-button wide" type="submit">Mentés</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-body">${items.length ? table(["Projekt", "Alkatrész", "Művelet", "Gép/Munkahely", "Terv óra", "Tény óra", "Típus", "Beszállító", "Határidő", "Prioritás", "Státusz", "Művelet"], items.map(productionItemTableRow)) : `<div class="empty">Nincs gyártási feladat.</div>`}</div>
      </section>
    </div>
  `;
}

function productionItemTableRow(item) {
    return [
        esc(item.projectName),
        esc(item.part),
        esc(item.operation),
        esc(item.workplace),
        esc(item.plannedHours ?? 0),
        esc(item.actualHours ?? 0),
        esc(item.type),
        esc(item.supplierName || supplierName(item.supplierId, "")),
        esc(item.deadline || ""),
        statusBadge(item.priority, item.priority === "Magas" ? "missing" : ""),
        statusBadge(item.status),
        `<button class="small-button" type="button" data-action="edit-production-item" data-id="${attr(item.id)}">Szerkesztés</button>
         <button class="danger-button small-button" type="button" data-action="delete-production-item" data-id="${attr(item.id)}">Törlés</button>`
    ];
}

function renderDesign() {
    const settings = financeSettings();
    const items = filterByProject(filterByEntryUser(financeData().designItems || [], designUserFilter), designProjectFilter);
    const avg = items.length ? Math.round(items.reduce((sum, item) => sum + Number(item.percent || 0), 0) / items.length) : 0;
    const cadCam = items.filter((item) => ["cad/cam", "mechanika cad"].includes(normalizeSearch(item.area))).length;
    const electric = items.filter((item) => normalizeSearch(item.area).includes("villamos") || normalizeSearch(item.area).includes("plc")).length;
    return `
    <div class="single-view">
      ${userProjectFilterPanel("design-user-filter", designUserFilter, "design-project-filter", designProjectFilter)}
      <div class="metric-grid">
        <div class="metric"><strong>${avg}%</strong><span>Átlag készültség</span></div>
        <div class="metric"><strong>${cadCam}</strong><span>CAD/CAM</span></div>
        <div class="metric"><strong>${electric}</strong><span>Villamos + PLC</span></div>
      </div>
      <section class="panel">
        <div class="panel-header"><h2>Új tétel</h2></div>
        <div class="panel-body">
          <form class="form-grid four" data-action="add-design-item">
            <label>Projekt${projectPicker()}</label>
            <label>Terület<select name="area">${optionList(settings.designAreas)}</select></label>
            <label>Tétel<input name="title" required autocomplete="off"></label>
            <label>Felelős<select name="userId">${userOptions()}</select></label>
            <label>Rev<input name="revision" autocomplete="off"></label>
            <label>Státusz<select name="status">${optionList(settings.designStatuses)}</select></label>
            <label>%<input name="percent" type="number" min="0" max="100" step="1" value="0"></label>
            <label>Rajz<input name="drawingPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>STEP<input name="stepPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>CAM<input name="camPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>NC<input name="ncPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>EPLAN<input name="eplanPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>PLC<input name="plcPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>Utasítás<input name="instructionPath" autocomplete="off" placeholder="Y:\\..."></label>
            <label>Megjegyzés<input name="note" autocomplete="off"></label>
            <button class="primary-button" type="submit">Mentés</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-body">${items.length ? table(["Projekt", "Terület", "Tétel", "Felelős", "Rev", "Státusz", "%", "Dokumentumok", "Művelet"], items.map(designTableRow)) : `<div class="empty">Nincs mérnöki / tervezési tétel.</div>`}</div>
      </section>
    </div>
  `;
}

function designTableRow(item) {
    return [
        esc(item.projectName),
        esc(item.area),
        `${esc(item.title)}${item.note ? `<div class="row-meta">${esc(item.note)}</div>` : ""}`,
        esc(userName(item.userId)),
        esc(item.revision || ""),
        statusBadge(item.status),
        esc(item.percent ?? 0),
        designDocButtons(item),
        `<button class="small-button" type="button" data-action="edit-design-item" data-id="${attr(item.id)}">Szerkesztés</button>
         <button class="primary-button" type="button" data-action="issue-design-item" data-id="${attr(item.id)}">Kiadás</button>
         <button class="danger-button small-button" type="button" data-action="delete-design-item" data-id="${attr(item.id)}">Törlés</button>`
    ];
}

function designDocButtons(item) {
    const docs = [
        ["Rajz", item.drawingPath],
        ["STEP", item.stepPath],
        ["CAM", item.camPath],
        ["NC", item.ncPath],
        ["EPLAN", item.eplanPath],
        ["PLC", item.plcPath],
        ["Utasítás", item.instructionPath]
    ].filter(([, filePath]) => filePath);
    return docs.length ? `<span class="inline-actions">${docs.map(([label, filePath]) => `<button class="small-button" type="button" data-action="open-file" data-path="${attr(filePath)}">${esc(label)}</button>`).join("")}</span>` : "";
}

function renderQuotes() {
    const settings = financeSettings();
    const quotes = financeData().quotes || [];
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>Ajánlat rögzítése</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-quote">
            <label>Projekt${projectPicker()}</label>
            <label>Beszállító<select name="supplierId">${supplierOptions()}</select></label>
            <label class="wide">Tárgy<input name="title" required autocomplete="off" placeholder="Alkatrész, szolgáltatás vagy művelet"></label>
            <label>Összeg<input name="amount" type="number" step="0.01" value="0"></label>
            <label>Pénznem<select name="currency">${optionList(settings.currencies, "HUF")}</select></label>
            <label>Státusz<select name="status">${optionList(settings.quoteStatuses)}</select></label>
            <label>Érvényes eddig<input name="validUntil" type="date"></label>
            <label class="wide">Megjegyzés<textarea name="note" placeholder="Opcionális"></textarea></label>
            <button class="primary-button wide" type="submit">Ajánlat mentése</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Ajánlatok</h2></div>
        <div class="panel-body scroll-area">
          ${quotes.length ? `<div class="compact-list">${quotes.slice(0, 180).map(quoteRow).join("")}</div>` : `<div class="empty">Nincs rögzített ajánlat.</div>`}
        </div>
      </section>
    </div>
  `;
}

function quoteRow(item) {
    return `
    <div class="request-row">
      <span class="source-badge">${esc(item.currency || "HUF")}</span>
      <div>
        <div class="row-title">${esc(item.title)} · ${money(item.amount, item.currency)}</div>
        <div class="row-meta">${esc(item.projectName)} · ${esc(item.supplierName || supplierName(item.supplierId, "Nincs beszállító"))} · ${esc(item.status)}${item.validUntil ? ` · érvényes: ${esc(item.validUntil)}` : ""}</div>
        ${item.note ? `<div class="muted">${esc(item.note)}</div>` : ""}
      </div>
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="quote-status" data-id="${attr(item.id)}">Státusz</button>
        <button class="small-button" type="button" data-action="open-project" data-id="${attr(item.projectId || "")}">Projekt</button>
        <button class="danger-button small-button" type="button" data-action="delete-quote" data-id="${attr(item.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function renderEngineeringNotes() {
    const settings = financeSettings();
    const notes = financeData().engineeringNotes || [];
    return `
    <div class="split-view">
      <section class="panel">
        <div class="panel-header"><h2>Mérnöki bejegyzés</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="add-engineering-note">
            <label>Projekt${projectPicker()}</label>
            <label>Típus<select name="type">${optionList(settings.noteTypes)}</select></label>
            <label class="wide">Tárgy<input name="title" required autocomplete="off" placeholder="Döntés, kockázat, változás"></label>
            <label>Felelős<select name="userId">${userOptions()}</select></label>
            <label>Határidő<input name="dueDate" type="date"></label>
            <label>Státusz<select name="status">${optionList(settings.noteStatuses)}</select></label>
            <label class="wide">Leírás<textarea name="note" placeholder="Műszaki részlet, döntés oka, következő lépés"></textarea></label>
            <button class="primary-button wide" type="submit">Bejegyzés mentése</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Mérnöki napló</h2></div>
        <div class="panel-body scroll-area">
          ${notes.length ? `<div class="compact-list">${notes.slice(0, 180).map(engineeringNoteRow).join("")}</div>` : `<div class="empty">Nincs mérnöki bejegyzés.</div>`}
        </div>
      </section>
    </div>
  `;
}

function engineeringNoteRow(item) {
    const closed = normalizeSearch(item.status) === normalizeSearch("Lezárva");
    return `
    <div class="request-row ${closed ? "done-item" : ""}">
      <span class="source-badge">${esc(item.type || "Napló")}</span>
      <div>
        <div class="row-title">${esc(item.title)}</div>
        <div class="row-meta">${esc(item.projectName)} · ${esc(userName(item.userId)) || "Nincs felelős"} · ${esc(item.status)}${item.dueDate ? ` · határidő: ${esc(item.dueDate)}` : ""}</div>
        ${item.note ? `<div class="muted">${esc(item.note)}</div>` : ""}
      </div>
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="close-engineering-note" data-id="${attr(item.id)}" ${closed ? "disabled" : ""}>Lezárás</button>
        <button class="small-button" type="button" data-action="open-project" data-id="${attr(item.projectId || "")}">Projekt</button>
        <button class="danger-button small-button" type="button" data-action="delete-engineering-note" data-id="${attr(item.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function renderFinanceReports() {
    const all = projects(true);
    if (!financeProjectId || !projectById(financeProjectId)) financeProjectId = all[0]?.id || "";
    const project = projectById(financeProjectId);
    const items = (financeData().priceItems || []).filter((item) => item.projectId === financeProjectId);
    const costItems = (financeData().costItems || []).filter((item) => item.projectId === financeProjectId);
    const outsourceItems = (financeData().outsourceItems || []).filter((item) => item.projectId === financeProjectId);
    const productionItems = (financeData().productionItems || []).filter((item) => item.projectId === financeProjectId);
    const designItems = (financeData().designItems || []).filter((item) => item.projectId === financeProjectId);
    const quotes = (financeData().quotes || []).filter((item) => item.projectId === financeProjectId);
    const notes = (financeData().engineeringNotes || []).filter((item) => item.projectId === financeProjectId);
    const openNotes = notes.filter((item) => normalizeSearch(item.status) !== normalizeSearch("Lezárva"));
    const byCategory = groupTotals(items, (item) => item.category || "Egyéb");
    const byQuarter = groupTotals(items.filter((item) => String(item.date || "").startsWith(financeYear)), (item) => quarterLabel(item.date));
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Projekt riport</h2></div>
        <div class="panel-body">
          <div class="form-grid three">
            <label>Projekt${filterProjectPicker("finance-project", financeProjectId, "Válassz projektet")}</label>
            <label>Év<input data-action="finance-year" type="number" min="2020" max="2100" value="${attr(financeYear)}"></label>
            <div class="inline-actions" style="align-self: end">
              ${project ? `<a class="primary-button" href="/api/export/finance/project/${attr(project.id)}">Pénzügyi XLSX</a>` : ""}
            </div>
          </div>
          ${project ? `
            <div class="metric-grid" style="margin-top: 14px">
              <div class="metric"><strong>${moneyTotals(items)}</strong><span>összes rögzített nettó</span></div>
              <div class="metric"><strong>${items.length}</strong><span>ár tétel</span></div>
              <div class="metric"><strong>${new Set(items.map((item) => item.supplierId || item.supplierName).filter(Boolean)).size}</strong><span>beszállító</span></div>
              <div class="metric"><strong>${amountTotals(quotes)}</strong><span>ajánlati összeg</span></div>
              <div class="metric"><strong>${openNotes.length}</strong><span>nyitott mérnöki pont</span></div>
              <div class="metric"><strong>${money(sumField(costItems, "plannedAmount"), "HUF")}</strong><span>költség terv</span></div>
              <div class="metric"><strong>${outsourceItems.length}</strong><span>bérmunka tétel</span></div>
              <div class="metric"><strong>${productionItems.length}</strong><span>gyártási feladat</span></div>
              <div class="metric"><strong>${designItems.length}</strong><span>tervezési tétel</span></div>
            </div>
            <div class="split-view" style="margin-top: 14px">
              <section>
                <h3>Kategóriák</h3>
                ${table(["Kategória", "Összesen"], Object.entries(byCategory).map(([name, value]) => [esc(name), esc(value)]))}
              </section>
              <section>
                <h3>Negyedévek</h3>
                ${table(["Negyedév", "Összesen"], Object.entries(byQuarter).sort().map(([name, value]) => [esc(name), esc(value)]))}
              </section>
            </div>
          ` : `<div class="empty">Nincs projekt.</div>`}
        </div>
      </section>
    </div>
  `;
}

function financeParametersPanel() {
    const settings = financeSettings();
    return `
      <section class="panel">
        <div class="panel-header"><h2>FE paraméterek</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="save-finance-settings">
            <label>Kategóriák<textarea name="categories">${esc(settings.categories.join("\n"))}</textarea></label>
            <label>Pénznemek<textarea name="currencies">${esc(settings.currencies.join("\n"))}</textarea></label>
            <label>Státuszok<textarea name="statuses">${esc(settings.statuses.join("\n"))}</textarea></label>
            <label>Ajánlat státuszok<textarea name="quoteStatuses">${esc(settings.quoteStatuses.join("\n"))}</textarea></label>
            <label>Mérnöki típusok<textarea name="noteTypes">${esc(settings.noteTypes.join("\n"))}</textarea></label>
            <label>Mérnöki státuszok<textarea name="noteStatuses">${esc(settings.noteStatuses.join("\n"))}</textarea></label>
            <label>Bérmunka műveletek<textarea name="outsourceOperations">${esc(settings.outsourceOperations.join("\n"))}</textarea></label>
            <label>Bérmunka státuszok<textarea name="outsourceStatuses">${esc(settings.outsourceStatuses.join("\n"))}</textarea></label>
            <label>Gyártási műveletek<textarea name="productionOperations">${esc(settings.productionOperations.join("\n"))}</textarea></label>
            <label>Gépek / munkahelyek<textarea name="productionWorkplaces">${esc(settings.productionWorkplaces.join("\n"))}</textarea></label>
            <label>Gyártási típusok<textarea name="productionTypes">${esc(settings.productionTypes.join("\n"))}</textarea></label>
            <label>Gyártási prioritások<textarea name="productionPriorities">${esc(settings.productionPriorities.join("\n"))}</textarea></label>
            <label>Gyártási státuszok<textarea name="productionStatuses">${esc(settings.productionStatuses.join("\n"))}</textarea></label>
            <label>Költség kategóriák<textarea name="costCategories">${esc(settings.costCategories.join("\n"))}</textarea></label>
            <label>Tervezési területek<textarea name="designAreas">${esc(settings.designAreas.join("\n"))}</textarea></label>
            <label>Tervezési státuszok<textarea name="designStatuses">${esc(settings.designStatuses.join("\n"))}</textarea></label>
            <button class="primary-button wide" type="submit">Paraméterek mentése</button>
          </form>
        </div>
      </section>
    `;
}

function groupTotals(items, keyFn) {
    const result = {};
    for (const item of items) {
        const key = keyFn(item) || "Nincs megadva";
        const currency = item.currency || "HUF";
        result[key] = result[key] || {};
        result[key][currency] = (result[key][currency] || 0) + itemTotal(item);
    }
    return Object.fromEntries(Object.entries(result).map(([key, totals]) => [
        key,
        Object.entries(totals).map(([currency, value]) => money(value, currency)).join(" + ")
    ]));
}

function quarterLabel(dateValue) {
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return "Nincs dátum";
    return `${date.getFullYear()} Q${Math.floor(date.getMonth() / 3) + 1}`;
}

function renderProduction() {
    const machines = data().cncMachines || [];
    const dayStart = new Date(`${productionDate}T06:00`);
    const dayEnd = new Date(`${productionDate}T18:00`);
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>CNC gép hozzáadása</h2></div>
        <div class="panel-body">
          <form class="form-line" data-action="add-cnc-machine">
            <input name="name" autocomplete="off" placeholder="CNC gép neve">
            <button class="primary-button" type="submit">Hozzáadás</button>
          </form>
          <label style="margin-top: 12px">Nap<input type="date" data-action="production-date" value="${attr(productionDate)}"></label>
        </div>
      </section>
      <section class="machine-grid">
        ${machines.length ? machines.map((machine) => machineCard(machine, dayStart, dayEnd)).join("") : `<div class="empty">Még nincs CNC gép. Adj hozzá gépet, utána itt látszik a napi ütemezés.</div>`}
      </section>
    </div>
  `;
}

function machineCard(machine, dayStart, dayEnd) {
    const tasks = (data().cncTasks || [])
        .filter((task) => task.machineId === machine.id && task.status !== "done")
        .filter((task) => overlapsDay(task, dayStart, dayEnd))
        .sort((a, b) => Date.parse(a.plannedStart) - Date.parse(b.plannedStart));
    const slots = freeSlots(tasks, dayStart, dayEnd);
    return `
      <section class="panel machine-card">
        <div class="panel-header">
          <h2>${esc(machine.name)}</h2>
          <span class="inline-actions">
            <button class="small-button" type="button" data-action="edit-cnc-machine" data-id="${attr(machine.id)}">Név</button>
            <button class="danger-button small-button" type="button" data-action="delete-cnc-machine" data-id="${attr(machine.id)}">Törlés</button>
          </span>
        </div>
        <div class="panel-body">
          <div class="compact-list">
            ${tasks.map((task) => `
              <div class="list-row">
                <span class="source-badge">CNC</span>
                <div>
                  <div class="row-title">${esc(task.projectName)}</div>
                  <div class="row-meta">${fmtDate(task.plannedStart)} - ${fmtDate(task.plannedEnd)} · ${esc(userName(task.userId))}</div>
                </div>
                <button class="small-button" type="button" data-action="open-project" data-id="${attr(task.projectId)}">Projekt</button>
              </div>
            `).join("")}
            ${slots.map((slot) => `
              <div class="list-row free-slot">
                <span class="source-badge">Szabad</span>
                <div>
                  <div class="row-title">${fmtDate(slot.start)} - ${fmtDate(slot.end)}</div>
                  <div class="row-meta">Nem foglalt időablak</div>
                </div>
                <span></span>
              </div>
            `).join("")}
            ${!tasks.length && !slots.length ? `<div class="empty">Nincs napi adat.</div>` : ""}
          </div>
        </div>
      </section>
    `;
}

function overlapsDay(task, dayStart, dayEnd) {
    const start = Date.parse(task.plannedStart);
    const end = Date.parse(task.plannedEnd);
    return Number.isFinite(start) && Number.isFinite(end) && start < dayEnd.getTime() && end > dayStart.getTime();
}

function freeSlots(tasks, dayStart, dayEnd) {
    const slots = [];
    let cursor = dayStart.getTime();
    const endOfDay = dayEnd.getTime();
    for (const task of tasks) {
        const start = Math.max(Date.parse(task.plannedStart), dayStart.getTime());
        const end = Math.min(Date.parse(task.plannedEnd), endOfDay);
        if (start > cursor) slots.push({ start: new Date(cursor).toISOString(), end: new Date(start).toISOString() });
        cursor = Math.max(cursor, end);
    }
    if (cursor < endOfDay) slots.push({ start: new Date(cursor).toISOString(), end: new Date(endOfDay).toISOString() });
    return slots;
}

function priorityControl(project) {
    const current = project.priority ? `P${project.priority}` : "Nincs";
    if (!project.active) return `<span class="row-meta">Inaktív</span>`;
    return `
      <div class="project-action-cell">
        <button class="small-button" type="button" data-action="open-priority" data-id="${attr(project.id)}">${current}</button>
        ${priorityFlyoutProjectId === project.id ? priorityFlyout(project) : ""}
      </div>
    `;
}

function priorityFlyout(project) {
    const active = projects(false);
    return `
      <div class="project-flyout priority-flyout">
        <div class="priority-grid">
          ${Array.from({ length: 10 }, (_, index) => {
              const value = index + 1;
              const owner = active.find((item) => item.id !== project.id && Number(item.priority) === value);
              const selected = Number(project.priority) === value;
              return `<button class="priority-choice ${owner ? "taken" : "free"} ${selected ? "selected" : ""}" type="button" data-action="set-priority" data-id="${attr(project.id)}" data-priority="${value}" title="${owner ? `Foglalt: ${attr(owner.name)}` : "Szabad"}">${value}</button>`;
          }).join("")}
        </div>
        <button class="small-button" type="button" data-action="clear-priority" data-id="${attr(project.id)}">Prioritás törlése</button>
      </div>
    `;
}

function responsibleControl(project) {
    return `
      <div class="project-action-cell">
        <div class="row-meta">${esc(projectResponsibleText(project))}</div>
        <button class="small-button" type="button" data-action="open-responsibles" data-id="${attr(project.id)}">Felelősök</button>
        ${responsibleFlyoutProjectId === project.id ? responsibleFlyout(project) : ""}
      </div>
    `;
}

function responsibleFlyout(project) {
    const ids = projectResponsibleIds(project);
    return `
      <div class="project-flyout responsible-flyout">
        ${users().length ? users().map((user) => `
          <label class="checkbox-label">
            <input type="checkbox" data-action="project-responsible" data-id="${attr(project.id)}" data-user-id="${attr(user.id)}" ${ids.includes(user.id) ? "checked" : ""}>
            ${esc(user.name)}
          </label>
        `).join("") : `<div class="row-meta">Nincs felhasználó.</div>`}
      </div>
    `;
}

function deadlineControl(project) {
    return `
      <div class="project-action-cell">
        <div class="row-meta">${project.deadline ? esc(fmtDate(project.deadline, false)) : "Nincs határidő"}</div>
        <button class="small-button" type="button" data-action="open-deadline" data-id="${attr(project.id)}">Határidő</button>
        ${deadlineFlyoutProjectId === project.id ? `
          <div class="project-flyout deadline-flyout">
            <input type="date" data-action="project-deadline" data-id="${attr(project.id)}" value="${attr(project.deadline || "")}">
            <button class="small-button" type="button" data-action="clear-deadline" data-id="${attr(project.id)}">Törlés</button>
          </div>
        ` : ""}
      </div>
    `;
}

function renderProjects() {
    const filteredProjects = projects(true).filter((project) => matchesProjectSearch(project, projectManageSearch));
    const rows = filteredProjects.map((project) => [
        `<strong>${esc(project.name)}</strong><div class="row-meta">${esc(project.primaryFolder || "kézi projekt")}</div>${projectMetaMarkup(project, true)}`,
        `<span class="source-badge">${esc(project.source)}</span>`,
        `<input type="checkbox" ${project.active ? "checked" : ""} data-action="project-active" data-id="${attr(project.id)}">`,
        priorityControl(project),
        responsibleControl(project),
        deadlineControl(project),
        project.companyAuto
            ? `<span title="A cég a projekt mappájából automatikus (${attr(project.primaryFolder || "")})">${esc(project.company)}<div class="row-meta">automatikus</div></span>`
            : `<select data-action="project-company" data-id="${attr(project.id)}">${companyOptions(project.company || "")}</select>`,
        project.folderMissing ? `<span class="state-badge missing">mappa hiányzik</span>` : `<span class="state-badge active">${project.active ? "aktív" : "inaktív"}</span>`,
        fmtDate(project.folderAddedAt || project.createdAt),
        `<button class="small-button" type="button" data-action="open-project" data-id="${attr(project.id)}">Megnyitás</button>
     <button class="small-button" type="button" data-action="complete-project" data-id="${attr(project.id)}">Kész</button>
     ${hasFinanceClearance() ? `<button class="danger-button small-button" type="button" data-action="delete-project" data-id="${attr(project.id)}" data-name="${attr(project.name)}" data-source="${attr(project.source || "")}" ${project.active ? 'disabled title="Előbb tedd inaktívvá a projektet"' : ""}>Archiválás</button>` : ""}`
    ]);
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header">
          <h2>Projekt hozzáadása</h2>
          <button class="small-button" type="button" data-action="scan-now">Mappák frissítése</button>
        </div>
        <div class="panel-body">
          <form class="form-line" data-action="add-manual-project">
            <input name="name" autocomplete="off" placeholder="Projekt neve">
            <button class="primary-button" type="submit">Hozzáadás</button>
          </form>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Projektek</h2></div>
        <div class="panel-body">
          <label style="margin-bottom: 12px">Keresés<input data-action="project-manage-search" value="${attr(projectManageSearch)}" autocomplete="off" placeholder="Projekt név, útvonal vagy forrás"></label>
          <div class="table-wrap">
          ${rows.length ? table(["Projekt", "Forrás", "Aktív", "Prioritás", "Felelősök", "Határidő", "Cég", "Állapot", "Dátum", ""], rows) : `<div class="empty">Nincs projekt.</div>`}
          </div>
        </div>
      </section>
    </div>
  `;
}

function renderUsers() {
    const rows = users().map((user) => [
        esc(user.name),
        `<select data-action="user-clearance" data-id="${attr(user.id)}">
          <option value="1" ${Number(user.clearanceLevel || 1) === 1 ? "selected" : ""}>1 - FE nélkül</option>
          <option value="2" ${Number(user.clearanceLevel || 1) >= 2 ? "selected" : ""}>2 - teljes</option>
        </select>`,
        fmtDate(user.createdAt),
        `<button class="small-button" type="button" data-action="edit-user" data-id="${attr(user.id)}">Szerkesztés</button>
     <button class="small-button" type="button" data-action="reset-user-password" data-id="${attr(user.id)}">Jelszó</button>
     <button class="danger-button small-button" type="button" data-action="delete-user" data-id="${attr(user.id)}">Törlés</button>`
    ]);
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Felhasználó hozzáadása</h2></div>
        <div class="panel-body">
          <form class="form-line" data-action="add-user">
            <input name="name" autocomplete="off" placeholder="Név">
            <select name="clearanceLevel">
              <option value="1">1 - FE nélkül</option>
              <option value="2">2 - teljes</option>
            </select>
            <button class="primary-button" type="submit">Hozzáadás</button>
          </form>
          <p class="row-meta" style="margin-top: 10px">Ez a forrásmásolat nem állít be alapértelmezett jelszót.</p>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Felhasználók</h2></div>
        <div class="panel-body table-wrap">
          ${rows.length ? table(["Név", "Jogosultság", "Létrehozva", ""], rows) : `<div class="empty">Még nincs felhasználó.</div>`}
        </div>
      </section>
    </div>
  `;
}

function catalogPanel(titleText, kind, items) {
    return `
    <section class="panel">
      <div class="panel-header"><h2>${titleText}</h2></div>
      <div class="panel-body">
        <form class="form-line" data-action="add-catalog" data-kind="${kind}">
          <input name="value" autocomplete="off" placeholder="${titleText}">
          <button class="primary-button" type="submit">Hozzáadás</button>
        </form>
        <div class="compact-list">
          ${items.length ? items.map((item) => `
            <div class="list-row">
              <span class="row-title">${esc(item)}</span>
              <span></span>
              <span class="inline-actions">
                <button class="small-button" type="button" data-action="edit-catalog" data-kind="${kind}" data-value="${attr(item)}">Szerkesztés</button>
                <button class="danger-button small-button" type="button" data-action="delete-catalog" data-kind="${kind}" data-value="${attr(item)}">Törlés</button>
              </span>
            </div>
          `).join("") : `<div class="empty">Nincs elem.</div>`}
        </div>
      </div>
    </section>
  `;
}

function renderCatalog() {
    const d = data();
    return `
    <div class="split-view">
      ${catalogPanel("Anyagok", "material", d.materialNames || [])}
      ${catalogPanel("Anyagtípusok", "type", d.materialTypes || [])}
    </div>
    <div class="split-view">
      ${catalogPanel("Anyaghosszak", "materialLength", d.materialLengths || [])}
      <div></div>
    </div>
    <div class="split-view">
      ${catalogPanel("Külsős cégek", "externalCompany", d.externalCompanies || [])}
      ${catalogPanel("Előgyártmány feladat típusok", "prefabTaskType", d.prefabTaskTypes || [])}
    </div>
  `;
}

function renderParameters() {
    const d = data();
    return `
    <div class="single-view">
      <div class="split-view">
        ${catalogPanel("Anyagok", "material", d.materialNames || [])}
        ${catalogPanel("Anyagtípusok", "type", d.materialTypes || [])}
      </div>
      <div class="split-view">
        ${catalogPanel("Anyaghosszak", "materialLength", d.materialLengths || [])}
        <div></div>
      </div>
      <div class="split-view">
        ${catalogPanel("Külsős cégek", "externalCompany", d.externalCompanies || [])}
        ${catalogPanel("Előgyártmány feladat típusok", "prefabTaskType", d.prefabTaskTypes || [])}
      </div>
      <div class="split-view">
        ${catalogPanel("Kötőelem anyagok", "fastenerGrade", d.fastenerGrades || [])}
        ${catalogPanel("Kötőelem típusok", "fastenerType", d.fastenerTypes || [])}
      </div>
      <div class="split-view">
        ${catalogPanel("Kötőelem méretek", "fastenerSize", d.fastenerSizes || [])}
        ${catalogPanel("Szerszámnevek", "toolName", d.toolNames || [])}
      </div>
      <div class="split-view">
        ${catalogPanel("Munka típusok", "workType", d.workTypes || [])}
        <div></div>
      </div>
      ${financeParametersPanel()}
    </div>
  `;
}

function personalPasswordPanel() {
    return `
      <section class="panel" data-settings-panel="password" tabindex="-1">
        <div class="panel-header"><h2>Személyes jelszó</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="change-personal-password">
            <label class="wide">Jelenlegi személyes jelszó<input name="currentPassword" type="password" autocomplete="current-password" required></label>
            <label>Új személyes jelszó<input name="newPassword" type="password" minlength="${globalThis.ERP_DEMO_CONFIG ? 14 : 4}" autocomplete="new-password" required></label>
            <label>Új jelszó újra<input name="newPasswordAgain" type="password" minlength="${globalThis.ERP_DEMO_CONFIG ? 14 : 4}" autocomplete="new-password" required></label>
            <button class="primary-button wide" type="submit">Személyes jelszó mentése</button>
          </form>
        </div>
      </section>
    `;
}

function notificationPermissionText(value) {
    if (value === "granted") return "engedélyezve";
    if (value === "denied") return "tiltva";
    if (value === "unsupported") return "nem támogatott";
    return "nincs engedély";
}

function renderNotificationSettingsPanel() {
    refreshNotificationRuntimeStatus();
    const settings = notificationSettings();
    const checked = (key) => settings[key] ? "checked" : "";
    const menuChecked = (key) => settings.menuNotifications?.[key] !== false ? "checked" : "";
    const menuCheckboxes = NOTIFICATION_MENU_OPTIONS.map(([key, label], index) => {
        const prefix = index < 10 ? `${index + 1}. ` : "";
        return `<label class="checkbox-label"><input name="menu_${attr(key)}" type="checkbox" ${menuChecked(key)}> <span>${esc(prefix + label)}</span></label>`;
    }).join("");
    const hasPush = hasActivePushSubscription();
    const pushCount = userPushSubscriptionCount();
    const supported = pwaStatus.pushSupported;
    const standalone = pwaStatus.standalone;
    const denied = pwaStatus.notificationPermission === "denied";
    const busy = notificationActionBusy ? "disabled" : "";
    const enableDisabled = (!standalone || !supported || denied || hasPush || notificationActionBusy) ? "disabled" : "";
    const disableDisabled = (!hasPush || notificationActionBusy) ? "disabled" : "";
    const testDisabled = (!hasPush || notificationActionBusy) ? "disabled" : "";
    const installState = standalone ? statusBadge("telepítve", "ok") : statusBadge("böngésző", "missing");
    const installHint = isIosLike()
        ? "iOS: Megosztás menü -> Hozzáadás a főképernyőhöz."
        : "Értesítést a telepített ERP appból lehet bekapcsolni.";
    const pushState = hasPush ? statusBadge("aktív", "ok") : (pushCount ? statusBadge(`${pushCount} eszköz`, "ok") : statusBadge("kikapcsolva", "missing"));
    return `
      <section class="panel" data-settings-panel="notifications" tabindex="-1">
        <div class="panel-header">
          <h2>Értesítések</h2>
          <div class="inline-actions">
            <button class="small-button" type="button" data-action="install-pwa" ${standalone || notificationActionBusy ? "disabled" : ""}>App telepítés</button>
            <button class="primary-button small-button" type="button" data-action="enable-push" ${enableDisabled}>Bekapcsolás</button>
            <button class="small-button" type="button" data-action="test-push" ${testDisabled}>Teszt</button>
            <button class="danger-button small-button" type="button" data-action="disable-push" ${disableDisabled}>Kikapcsolás</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="metric-grid">
            <div class="metric"><strong>${installState}</strong><span>app állapot</span></div>
            <div class="metric"><strong>${pushState}</strong><span>push állapot</span></div>
            <div class="metric"><strong>${esc(notificationPermissionText(pwaStatus.notificationPermission))}</strong><span>böngésző engedély</span></div>
          </div>
          <form class="form-grid" data-action="save-notification-settings" style="margin-top: 14px">
            <label class="checkbox-label wide"><input name="enabled" type="checkbox" ${checked("enabled")}> <span>Értesítések fogadása</span></label>
            ${menuCheckboxes}

            <label class="wide">Értesítés részletessége
              <select name="detailLevel">
                <option value="brief" ${settings.detailLevel === "brief" ? "selected" : ""}>Rövid</option>
                <option value="normal" ${settings.detailLevel === "normal" ? "selected" : ""}>Normál</option>
                <option value="detailed" ${settings.detailLevel === "detailed" ? "selected" : ""}>Részletes</option>
              </select>
            </label>
            <button class="primary-button wide" type="submit">Értesítési beállítások mentése</button>
          </form>
          ${!supported ? `<p class="row-meta" style="margin-top: 10px">Ez a böngésző nem támogatja a webes push értesítést.</p>` : ""}
          ${!standalone ? `<p class="row-meta" style="margin-top: 10px">${esc(installHint)}</p>` : ""}
        </div>
      </section>
    `;
}

function hostAgeText(seconds) {
    if (seconds === null || seconds === undefined || Number.isNaN(Number(seconds))) return "nincs adat";
    const value = Number(seconds);
    if (value < 60) return `${value} mp`;
    return `${Math.round(value / 60)} perc`;
}

function hostRoleText(role) {
    if (role === "host") return "host";
    if (role === "relay") return "relay";
    if (role === "legacy") return "régi watchdog";
    return "készenlét";
}

function hostDisplayName(hostname, nickname = "") {
    const cleanNickname = String(nickname || "").trim();
    const cleanHostname = String(hostname || "").trim();
    return cleanNickname || cleanHostname || "-";
}

function hostLabelWithNickname(hostname, nickname = "") {
    const display = hostDisplayName(hostname, nickname);
    const cleanHostname = String(hostname || "").trim();
    const cleanNickname = String(nickname || "").trim();
    return cleanNickname && cleanHostname && cleanNickname !== cleanHostname
        ? `${display} (${cleanHostname})`
        : display;
}

function hostNicknameEditor(hostname, nickname = "") {
    return `
      <div class="inline-actions host-nickname-editor">
        <input data-action="host-nickname-input" data-host="${attr(hostname || "")}" value="${attr(nickname || "")}" autocomplete="off" placeholder="Becenév" style="min-width: 150px">
        <button class="small-button" type="button" data-action="save-host-nickname" data-host="${attr(hostname || "")}">Mentés</button>
      </div>
    `;
}

function renderHostStatusPanel() {
    if (!hostStatus) {
        return `
      <section class="panel" data-host-status-panel>
        <div class="panel-header">
          <h2>Host / watchdog állapot</h2>
          <div class="inline-actions">
            <button class="danger-button small-button" type="button" data-action="restart-host-server">Szerver restart</button>
            <button class="small-button" type="button" data-action="refresh-host-status">Frissítés</button>
          </div>
        </div>
        <div class="panel-body"><div class="empty">Host állapot betöltése...</div></div>
      </section>
    `;
    }
    const current = hostStatus.currentHost;
    const currentLabel = current?.hostname
        ? `${hostLabelWithNickname(current.hostname, current.nickname)} · gen ${current.generation || 0} · utolsó jel: ${hostAgeText(current.ageSeconds)}`
        : "Nincs aktív host lock.";
    const pending = hostStatus.switchRequest
        ? `<p class="row-meta">Folyamatban lévő váltási kérés: <strong>${esc(hostLabelWithNickname(hostStatus.switchRequest.targetHostname, hostStatus.switchRequest.targetNickname))}</strong> · kérte: ${esc(hostStatus.switchRequest.requestedBy || "")} · ${hostAgeText(hostStatus.switchRequest.ageSeconds)}.</p>`
        : "";
    const rows = (hostStatus.watchdogs || [])
        .slice()
        .sort((a, b) => Number(b.isCurrentHost) - Number(a.isCurrentHost) || String(a.hostname).localeCompare(String(b.hostname), "hu"))
        .map((item) => {
            const switchable = item.ready && item.switchable !== false && item.role !== "legacy";
            const state = item.role === "legacy"
                ? statusBadge("régi watchdog", "missing")
                : (item.ready ? statusBadge("kész", "ok") : statusBadge("nem friss", "missing"));
            const commandText = item.restartCommand
                ? `<div class="row-meta">watchdog restart kérve: ${esc(hostAgeText(item.restartCommand.ageSeconds))}</div>`
                : "";
            const action = switchable && !item.isCurrentHost
                ? `<button class="small-button" type="button" data-action="switch-host" data-host="${attr(item.hostname)}">Átváltás erre</button>`
                : (item.isCurrentHost ? statusBadge("aktív", "ok") : "");
            const displayName = hostDisplayName(item.hostname, item.nickname);
            const hostNameLine = item.nickname
                ? `<div class="row-meta">${esc(item.hostname || "")}</div>`
                : "";
            const activeHostText = item.activeHost
                ? `${esc(hostLabelWithNickname(item.activeHost, item.activeHostNickname))}${item.activeHostHttpOk ? " · HTTP ok" : " · HTTP hiba"}`
                : "nincs adat";
            const relayText = item.relayActive
                ? esc(hostLabelWithNickname(item.relayTargetHost || "relay", item.relayTargetNickname))
                : "-";
            return [
                `<strong>${esc(displayName)}</strong>${hostNameLine}${item.isThisServer ? `<div class="row-meta">ez a szerver válaszolt</div>` : ""}`,
                hostNicknameEditor(item.hostname, item.nickname),
                state + commandText,
                esc(hostRoleText(item.role)),
                esc(hostAgeText(item.ageSeconds)),
                activeHostText,
                relayText,
                `<div class="inline-actions">${action}${!item.isCurrentHost && !item.isThisServer ? `<button class="danger-button small-button" type="button" data-action="remove-host" data-host="${attr(item.hostname)}">Eltávolítás</button>` : ""}</div>`
            ];
        });
    return `
      <section class="panel" data-host-status-panel>
        <div class="panel-header">
          <h2>Host / watchdog állapot</h2>
          <div class="inline-actions">
            <button class="danger-button small-button" type="button" data-action="restart-host-server">Szerver restart</button>
            <button class="small-button" type="button" data-action="refresh-host-status">Frissítés</button>
          </div>
        </div>
        <div class="panel-body">
          <div class="metric-grid">
            <div class="metric"><strong>${esc(hostDisplayName(current?.hostname, current?.nickname))}</strong><span>aktuális host PC</span></div>
            <div class="metric"><strong>${esc(hostDisplayName(hostStatus.serverHostname, hostStatus.serverNickname))}</strong><span>ezt a választ adó PC</span></div>
            <div class="metric"><strong>${(hostStatus.watchdogs || []).filter((item) => item.ready).length}</strong><span>kész watchdog</span></div>
          </div>
          <p class="row-meta" style="margin-top: 12px">${esc(currentLabel)}</p>
          ${pending}
          <div class="table-wrap" style="margin-top: 12px">
            ${rows.length ? table(["PC", "Becenév", "Állapot", "Szerep", "Utolsó jel", "Látott host", "Relay", ""], rows) : `<div class="empty">Még nincs jelentkező watchdog PC.</div>`}
          </div>
          <p class="row-meta" style="margin-top: 10px">A váltás a kiválasztott PC friss watchdogját kéri meg, hogy indítsa el helyben a hostot. A "régi watchdog" sor élő logból látszik, de azon a PC-n újra kell futtatni az install-startup.bat-ot vagy újra kell indítani a gépet, hogy kézi váltásra is alkalmas legyen.</p>
          <p class="row-meta">Az eltávolított PC rejtve és letiltva marad, amíg azon az aktuális install-startup.bat sikeresen újra nem fut. Projektadatot nem töröl.</p>
        </div>
      </section>
    `;
}

function renderSettings() {
    const settings = state.config;
    if (globalThis.ERP_DEMO_CONFIG) {
        const secureDemo = Boolean(settings.localAuthRequired);
        const canManageUsers = !secureDemo || hasFinanceClearance();
        const rows = users().filter((user) => !user.hidden).map((user) => [
            esc(user.name),
            canManageUsers ? `<select data-action="user-clearance" data-id="${attr(user.id)}"><option value="1" ${Number(user.clearanceLevel) === 1 ? "selected" : ""}>1</option><option value="2" ${Number(user.clearanceLevel) >= 2 ? "selected" : ""}>2</option></select>` : esc(user.clearanceLevel),
            !canManageUsers ? "" : `${secureDemo && user.id !== currentUser?.id ? `<button class="small-button" type="button" data-action="reset-user-password" data-id="${attr(user.id)}">Jelszó</button>` : ""}${user.id === currentUser?.id ? "Aktív demó felhasználó" : `<button class="danger-button small-button" type="button" data-action="delete-user" data-id="${attr(user.id)}">Eltávolítás</button>`}`
        ]);
        return `<div class="single-view">
          <section class="panel"><div class="panel-header"><h2>Helyi demó beállítások</h2></div><div class="panel-body">
            <p>Az alkalmazás csak ezen a gépen, a <code>127.0.0.1:${esc(settings.port)}</code> címen hallgat. Nincs aktív Cloudflare tunnel vagy watchdog.${settings.scanRoots?.length ? ` Helyi projektmappa-szkennelés: ${esc(settings.scanRoots.join(", "))}.` : " A helyi projektmappa-szkennelés ki van kapcsolva."}${secureDemo ? " A helyi jelszavas mód aktív." : " Nincs jelszavas belépés."}</p>
            <p>Helyi rajzszám-/projekt OCR: ${settings.ocrEnabled ? "Tesseract engedélyezve" : "nincs beállítva"}. Az OCR nem küld képet külső szolgáltatóhoz.</p>
            ${settings.scanRoots?.length ? `<button class="small-button" type="button" data-action="scan-now">Helyi projektmappák frissítése</button>` : ""}
            <p>A név, mintaadatok, katalógusok és felhasználók kezdeti értékei a demó <code>config.json</code> fájljában állíthatók. A már létrejött adatok a külön helyi SQLite adatbázisban maradnak: <span class="path-text">${esc(state.server.dataFile)}</span>.</p>
            <p class="row-meta">Megosztott vagy internetes használat előtt külön biztonságos telepítés, mentés és megosztott tárolási védelem szükséges.${secureDemo ? " A jelszavak csak ebben a helyi demó adatbázisban vannak." : " A demó felhasználónevei csak megjelenítési adatok."}</p>
          </div></section>
          ${secureDemo ? personalPasswordPanel() : ""}
          <section class="panel"><div class="panel-header"><h2>Modelling fotók</h2></div><div class="panel-body">
            <p>Próbáld ki a külön fotófeltöltő felületet. A fájlok kizárólag ennek a demó profilnak a helyi <code>.demo-data/modelling</code> mappájába kerülnek.</p>
            <button class="small-button" type="button" data-action="open-demo-modelling">Fotófeltöltő megnyitása</button>
          </div></section>
          <section class="panel"><div class="panel-header"><h2>Demó felhasználók</h2></div><div class="panel-body">
            ${canManageUsers ? `<form class="form-line" data-action="add-user"><input name="name" autocomplete="off" placeholder="Név"><select name="clearanceLevel"><option value="1">1</option><option value="2">2</option></select><button class="primary-button" type="submit">Hozzáadás</button></form>` : ""}
            ${table(["Név", "Szint", ""], rows)}
          </div></section>
        </div>`;
    }
    if (!hasFinanceClearance()) {
        return `<div class="single-view">${personalPasswordPanel()}${renderNotificationSettingsPanel()}</div>`;
    }
    const userRows = users().map((user) => [
        esc(user.name),
        `<select data-action="user-clearance" data-id="${attr(user.id)}">
          <option value="1" ${Number(user.clearanceLevel || 1) === 1 ? "selected" : ""}>1 - FE nélkül</option>
          <option value="2" ${Number(user.clearanceLevel || 1) >= 2 ? "selected" : ""}>2 - teljes</option>
        </select>`,
        fmtDate(user.createdAt),
        `<button class="small-button" type="button" data-action="edit-user" data-id="${attr(user.id)}">Szerkesztés</button>
     <button class="small-button" type="button" data-action="reset-user-password" data-id="${attr(user.id)}">Jelszó</button>
     <button class="danger-button small-button" type="button" data-action="delete-user" data-id="${attr(user.id)}">Törlés</button>`
    ]);
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Beállítások</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="save-settings">
            <label class="wide">Munkakönyvtár<input name="workingDirectory" value="${attr(settings.workingDirectory || "")}"></label>
            <label class="wide">Projekt gyökérmappák<textarea name="scanRoots">${esc((settings.scanRoots || []).join("\n"))}</textarea></label>
            <label class="wide">Kihagyott mappák<textarea name="excludedPaths">${esc((settings.excludedPaths || []).join("\n"))}</textarea></label>
            <label>Szkennelés másodperc<input name="scanIntervalSeconds" type="number" min="3" value="${attr(settings.scanIntervalSeconds || 10)}"></label>
            <label class="checkbox-label wide"><input name="internetEnabled" type="checkbox" ${settings.internetEnabled ? "checked" : ""}> Külön internetes teszt port engedélyezése</label>
            <button class="primary-button wide" type="submit">Beállítások mentése</button>
          </form>
          <p class="row-meta" style="margin-top: 12px">Cloudflare tunnel cél: http://localhost:${esc(settings.port || 4780)} · Helper: <span class="path-text">${esc(settings.helperUrl || "")}</span></p>
          <p class="row-meta" style="margin-top: 12px">Aktív adatfájl: <span class="path-text">${esc(state.server.dataFile)}</span></p>
        </div>
      </section>
      ${personalPasswordPanel()}
      ${renderNotificationSettingsPanel()}
      ${renderHostStatusPanel()}
      <section class="panel">
        <div class="panel-header"><h2>Felhasználók</h2></div>
        <div class="panel-body">
          <form class="form-line" data-action="add-user">
            <input name="name" autocomplete="off" placeholder="Név">
            <select name="clearanceLevel">
              <option value="1">1 - FE nélkül</option>
              <option value="2">2 - teljes</option>
            </select>
            <button class="primary-button" type="submit">Hozzáadás</button>
          </form>
          <p class="row-meta" style="margin-top: 10px">Új felhasználónál adj meg ideiglenes jelszót a Jelszó gombbal, majd a felhasználó állítsa át magának.</p>
          <div class="table-wrap" style="margin-top: 12px">
            ${userRows.length ? table(["Név", "Jogosultság", "Létrehozva", ""], userRows) : `<div class="empty">Még nincs felhasználó.</div>`}
          </div>
        </div>
      </section>
      ${renderSecurityPanel()}
    </div>
  `;
}

function archiveCountsText(record) {
    const counts = record.counts || {};
    const labels = [
        ["tasks", "feladat"],
        ["cncTasks", "CNC"],
        ["toolRequests", "szerszám"],
        ["materialRequests", "anyag"],
        ["workLogs", "munkaidő"],
        ["files", "fájl"],
        ["boms", "BOM"],
        ["financeCostItems", "költség"],
        ["financeOutsourceItems", "bérmunka"],
        ["engineeringDesignItems", "tervezés"]
    ];
    return labels
        .map(([key, label]) => [Number(counts[key] || 0), label])
        .filter(([count]) => count > 0)
        .map(([count, label]) => `${count} ${label}`)
        .join(" · ") || "Nincs kapcsolt adat";
}

const ARCHIVE_TYPE_LABELS = {
    "project": "Projekt",
    "task": "Feladat",
    "cnc-task": "CNC feladat",
    "tool-request": "Szerszámigény",
    "material-request": "Anyagigény",
    "fastener-request": "Kötőelem igény",
    "work-log": "Munkaidő"
};

function archiveReasonLabel(record) {
    if (record.restoredAt) return `Visszaállítva: ${record.restoredProjectName || ""} (${fmtDate(record.restoredAt)})`;
    if (record.reason === "folder-missing-auto") return "Mappa eltűnt";
    if (record.reason === "manual-delete") return "Törölt tétel";
    return "ERP törlés";
}

function renderArchive() {
    const localDemo = !!globalThis.ERP_DEMO_CONFIG;
    const archives = (archiveState?.archives || []).slice().sort((a, b) => (b.archivedAt || "").localeCompare(a.archivedAt || ""));
    const visibleIds = new Set(archives.filter((item) => !item.restoredAt).map((item) => item.id));
    selectedArchiveIds = new Set([...selectedArchiveIds].filter((idValue) => visibleIds.has(idValue)));
    const selectedCount = selectedArchiveIds.size;
    const rows = archives.map((record) => {
        const type = record.type || "project";
        const typeLabel = ARCHIVE_TYPE_LABELS[type] || "Tétel";
        const isProject = type === "project";
        const primary = isProject
            ? (record.projectName || record.project?.name || "Archív tétel")
            : (type === "material-request" ? materialRequestTitle(record.data) : record.itemLabel || "tétel");
        const secondary = isProject
            ? (record.project?.primaryFolder || "ERP adat")
            : `${typeLabel} · ${record.projectName || "projekt nélkül"}`;
        const content = isProject ? archiveCountsText(record) : "—";
        const hasEntries = !isProject || Object.values(record.data || {}).some((items) => Array.isArray(items) && items.length);
        return [
            record.restoredAt || localDemo ? "—" : `<input type="checkbox" data-action="archive-select" data-id="${attr(record.id)}" ${selectedArchiveIds.has(record.id) ? "checked" : ""}>`,
            `<strong>${esc(primary)}</strong><div class="row-meta">${esc(secondary)}</div>`,
            esc(record.archivedByName || "Rendszer"),
            fmtDate(record.archivedAt),
            esc(archiveReasonLabel(record)),
            esc(content),
            record.restoredAt ? `<span class="row-meta">Megőrzött helyreállítási előzmény</span>` : `<div class="inline-actions">${hasEntries ? `<button class="small-button" type="button" data-action="restore-archive" data-id="${attr(record.id)}">Visszaállítás meglévő projektbe</button>` : `<span class="row-meta">Nincs kapcsolt bejegyzés</span>`}${localDemo ? "" : `<button class="danger-button small-button" type="button" data-action="purge-archive" data-id="${attr(record.id)}" data-label="${attr(primary)}">Végleges törlés</button>`}</div>`
        ];
    });
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header">
          <h2>Archivált ERP adatok</h2>
          ${localDemo ? "" : `<div class="inline-actions">
            <button class="danger-button small-button" type="button" data-action="purge-selected-archives" ${selectedCount ? "" : "disabled"}>${selectedCount ? `${selectedCount} kijelölt végleges törlése` : "Kijelölt végleges törlése"}</button>
          </div>`}
        </div>
        <div class="panel-body">
          <p class="row-meta" style="margin-bottom: 12px">${localDemo ? "A helyi demó archív bejegyzései megmaradnak; visszaállíthatók, véglegesen nem törölhetők." : "Itt csak ERP-ben archivált adatok törölhetők véglegesen. A szkennelt Y: projektmappákhoz nem nyúl a rendszer."}</p>
          <div class="table-wrap">
            ${rows.length ? table(["", "Projekt", "Archiválta", "Archiválva", "Ok", "Tartalom", ""], rows) : `<div class="empty">Nincs archivált tétel.</div>`}
          </div>
        </div>
      </section>
    </div>
  `;
}

const IP_HISTORY_MAX_DISPLAY = 500;

function renderSecurityPanel() {
    if (!hasFinanceClearance()) {
        return `
        <section class="panel">
          <div class="panel-header"><h2>Biztonság</h2></div>
          <div class="panel-body"><div class="empty">2-es jogosultsági szint szükséges.</div></div>
        </section>`;
    }
    if (!securityState) {
        return `
        <section class="panel">
          <div class="panel-header"><h2>Biztonság</h2></div>
          <div class="panel-body"><div class="empty">Biztonsági adatok betöltése...</div></div>
        </section>`;
    }
    const s = securityState;
    // Whitelist replaced the old lockdown mode. Server returns the IPs as
    // `whitelist` (fallback to lockdownAllowlist for backward compat).
    const whitelist = (s.whitelist || s.lockdownAllowlist || []).join("\n");
    const sessionRows = (s.activeSessions || []).map((row) => [
        esc(row.userName || "—"),
        `<span class="path-text">${esc(row.ip || "—")}</span>`,
        `<span title="${attr(row.userAgent || "")}">${esc(summarizeUserAgent(row.userAgent))}</span>`,
        fmtDate(row.createdAt),
        `<button class="small-button" type="button" data-action="kick-session" data-token="${attr(row.token)}">Kidobás</button>
         <button class="danger-button small-button" type="button" data-action="block-ip" data-ip="${attr(row.ip || "")}" ${row.ip ? "" : "disabled"}>IP tiltása</button>`
    ]);
    const blockedSet = new Set((s.blockedIps || []).map((entry) => entry?.ip).filter(Boolean));
    const blockedDetail = new Map((s.blockedIps || []).filter(Boolean).map((entry) => [entry.ip, entry]));
    const historySeen = new Set((s.ipHistory || []).map((row) => row?.ip).filter(Boolean));
    const combinedHistory = [...(s.ipHistory || [])];
    for (const entry of (s.blockedIps || [])) {
        if (entry?.ip && !historySeen.has(entry.ip)) {
            combinedHistory.push({
                ip: entry.ip,
                hits: 0,
                firstSeen: entry.blockedAt || "",
                lastSeen: entry.blockedAt || "",
                lastUserAgent: "",
                lastUserName: "(soha nem kapcsolódott)"
            });
        }
    }
    combinedHistory.sort((a, b) => (b.lastSeen || "").localeCompare(a.lastSeen || ""));
    const historyRows = combinedHistory.map((row) => {
        const isBlocked = blockedSet.has(row.ip);
        const blockInfo = blockedDetail.get(row.ip);
        const blockedTag = isBlocked
            ? ` <span class="row-meta" title="${attr(`Tiltva: ${blockInfo?.blockedAt || ""} · ${blockInfo?.blockedBy || ""} · ${blockInfo?.reason || ""}`)}">(tiltva)</span>`
            : "";
        const action = isBlocked
            ? `<button class="small-button" type="button" data-action="unblock-ip" data-ip="${attr(row.ip || "")}">Feloldás</button>`
            : `<button class="danger-button small-button" type="button" data-action="block-ip" data-ip="${attr(row.ip || "")}">Tiltás</button>`;
        return [
            `<span class="path-text">${esc(row.ip || "")}</span>${blockedTag}`,
            `<span title="${attr(row.lastUserAgent || "")}">${esc(summarizeUserAgent(row.lastUserAgent))}</span>`,
            esc(row.lastUserName || "—"),
            esc(String(row.hits || 0)),
            fmtDate(row.firstSeen),
            fmtDate(row.lastSeen),
            action
        ];
    });
    const attemptRows = (s.recentAttempts || []).map((row) => [
        fmtDate(row.at),
        `<span class="path-text">${esc(row.ip || "")}</span>`,
        esc(row.userName || "—"),
        esc(row.outcome || "")
    ]);
    return `
    <section class="panel">
      <div class="panel-header"><h2>Biztonság</h2></div>
      <div class="panel-body">
        <form class="form-grid" data-action="save-whitelist">
          <label class="wide">Megbízható IP-k (whitelist) — soronként egy
            <textarea name="whitelist" rows="3" placeholder="pl. 203.0.113.10">${esc(whitelist)}</textarea>
          </label>
          <p class="row-meta wide">A whitelistre tett IP-k mentesülnek az automatikus 3-hibás-jelszó letiltás alól. Saját IP-d most: <span class="path-text">${esc(s.currentClientIp || "ismeretlen")}</span></p>
          <button class="primary-button wide" type="submit">Whitelist mentése</button>
        </form>

        <h3 style="margin-top: 20px">Aktív kapcsolatok (${(s.activeSessions || []).length})</h3>
        <div class="table-wrap">
          ${sessionRows.length ? table(["Felhasználó", "IP", "Eszköz", "Belépés", ""], sessionRows) : `<div class="empty">Nincs aktív munkamenet.</div>`}
        </div>

        <h3 style="margin-top: 20px">IP-előzmények (${(s.ipHistory || []).length})</h3>
        <p class="row-meta">Minden IP, amely valaha kapcsolódott. ${(s.blockedIps || []).length} jelenleg tiltva. 3 hibás jelszó esetén az IP automatikusan a tiltottak közé kerül.</p>
        <form class="form-line" data-action="block-ip-form" style="margin: 8px 0">
          <input name="ip" placeholder="IP cím (pl. 203.0.113.10) — előre is letilthatod" autocomplete="off">
          <input name="reason" placeholder="Indok (opcionális)" autocomplete="off">
          <button class="danger-button" type="submit">IP tiltása</button>
        </form>
        <div class="table-wrap">
          ${historyRows.length ? table(["IP", "Eszköz", "Felhasználó", "Találatok", "Először", "Utoljára", ""], historyRows) : `<div class="empty">Még nincs IP-előzmény.</div>`}
        </div>

        <h3 style="margin-top: 20px">Legutóbbi belépési kísérletek</h3>
        <div class="table-wrap">
          ${attemptRows.length ? table(["Idő", "IP", "Felhasználó", "Eredmény"], attemptRows) : `<div class="empty">Nincs adat.</div>`}
        </div>
      </div>
    </section>`;
}

function renderStats() {
    const all = projects(true);
    if (!statsProjectId || !projectById(statsProjectId)) statsProjectId = all[0]?.id || "";
    const project = projectById(statsProjectId);
    const d = data();
    const counts = project ? projectCounts(project.id) : null;
    const logs = project ? (d.workLogs || []).filter((item) => item.projectId === project.id) : [];
    const boms = project ? (d.boms || []).filter((item) => item.projectId === project.id) : [];
    const byUser = {};
    for (const log of logs) {
        const key = userName(log.userId) || "Nincs megadva";
        byUser[key] = (byUser[key] || 0) + logTotalHours(log);
    }
    const settings = state.config;
    return `
    <div class="single-view">
      <section class="panel">
        <div class="panel-header"><h2>Projekt statisztika</h2></div>
        <div class="panel-body">
          <div class="form-grid three">
            <label>Projekt${filterProjectPicker("stats-project", statsProjectId, "Válassz projektet")}</label>
            <div class="inline-actions" style="align-self: end">
              ${project ? `<a class="primary-button" href="/api/export/project/${attr(project.id)}">XLSX export</a>` : ""}
            </div>
          </div>
          ${project ? `
            <div class="metric-grid" style="margin-top: 14px">
              <div class="metric"><strong>${formatHours(counts.hours)}</strong><span>munkaóra</span></div>
              <div class="metric"><strong>${counts.openTasks.length}</strong><span>nyitott feladat</span></div>
              <div class="metric"><strong>${counts.openTools.length}</strong><span>nyitott szerszám</span></div>
              <div class="metric"><strong>${counts.openMaterials.length}</strong><span>nyitott anyag</span></div>
              <div class="metric"><strong>${counts.openFasteners.length}</strong><span>nyitott csavar</span></div>
              <div class="metric"><strong>${boms.length}</strong><span>BOM</span></div>
            </div>
            <div class="split-view" style="margin-top: 14px">
              <div>
                <h3>Dolgozói órák</h3>
                ${Object.keys(byUser).length ? table(["Felelős", "Óra"], Object.entries(byUser).map(([name, hours]) => [esc(name), formatHours(hours)])) : `<div class="empty">Nincs naplózott óra.</div>`}
              </div>
              <div>
                <h3>Projekt adatok</h3>
                ${table(["Mező", "Érték"], [
                  ["Állapot", project.active ? "Aktív" : "Inaktív / kész"],
                  ["Prioritás", project.priority || ""],
                  ["Felelősök", esc(projectResponsibleText(project))],
                  ["Határidő", project.deadline ? esc(fmtDate(project.deadline, false)) : ""],
                  ["Létrehozva", fmtDate(project.folderAddedAt || project.createdAt)],
        ["Befejezve", fmtDate(project.completedAt)],
        ["Mappa", `<span class="path-text">${esc(project.primaryFolder || "")}</span>`]
    ])}
              </div>
            </div>
          ` : `<div class="empty">Nincs projekt.</div>`}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Beállítások</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-action="save-settings">
            <label class="wide">Munkakönyvtár<input name="workingDirectory" value="${attr(settings.workingDirectory || "")}"></label>
            <label class="wide">Projekt gyökérmappák<textarea name="scanRoots">${esc((settings.scanRoots || []).join("\n"))}</textarea></label>
            <label class="wide">Kihagyott mappák<textarea name="excludedPaths">${esc((settings.excludedPaths || []).join("\n"))}</textarea></label>
            <label>Szkennelés másodperc<input name="scanIntervalSeconds" type="number" min="3" value="${attr(settings.scanIntervalSeconds || 10)}"></label>
            <label class="checkbox-label wide"><input name="localAuthRequired" type="checkbox" ${settings.localAuthRequired === false ? "" : "checked"}> Bejelentkezés kérése a helyi/LAN porton</label>
            <label class="checkbox-label wide"><input name="internetEnabled" type="checkbox" ${settings.internetEnabled ? "checked" : ""}> Külön internetes teszt port engedélyezése</label>
            <button class="primary-button wide" type="submit">Beállítások mentése</button>
          </form>
          <form class="form-grid" data-action="change-personal-password" style="margin-top: 16px">
            <label class="wide">Jelenlegi személyes jelszó<input name="currentPassword" type="password" autocomplete="current-password" required></label>
            <label>Új személyes jelszó<input name="newPassword" type="password" minlength="4" autocomplete="new-password" required></label>
            <label>Új jelszó újra<input name="newPasswordAgain" type="password" minlength="4" autocomplete="new-password" required></label>
            <button class="primary-button wide" type="submit">Személyes jelszó mentése</button>
          </form>
          <p class="row-meta" style="margin-top: 12px">Cloudflare tunnel cél: http://localhost:${esc(settings.port || 4780)} · Helper: <span class="path-text">${esc(settings.helperUrl || "")}</span></p>
          <p class="row-meta" style="margin-top: 12px">Aktív adatfájl: <span class="path-text">${esc(state.server.dataFile)}</span></p>
        </div>
      </section>
    </div>
  `;
}

function requestRow(item, titleText, doneAction, editAction = "", deleteAction = "", extraHtml = "", options = {}) {
    const project = item.projectName || "";
    const done = item.status === "done";
    const qty = Number(item.quantity || 0);
    const fullTitle = `${titleText}${options.includeQuantity === false || qty <= 0 ? "" : ` · ${qty} db`}`;
    const creator = ` · létrehozta: ${esc(item.createdByName || "nincs adat")}`;
    const editButton = editAction
        ? `<button class="small-button" type="button" data-action="${editAction}" data-id="${attr(item.id)}">Módosítás</button>`
        : "";
    const repeatType = { "edit-tool": "tool", "edit-material": "material", "edit-fastener": "fastener" }[editAction];
    const repeatButton = repeatType
        ? `<button class="small-button" type="button" data-action="repeat-request" data-target="${repeatType}" data-id="${attr(item.id)}" title="Újra, új bejegyzésként" aria-label="Újra, új bejegyzésként">↻</button>`
        : "";
    const deleteButton = deleteAction && canDeleteEntry(item)
        ? `<button class="danger-button small-button" type="button" data-action="${deleteAction}" data-id="${attr(item.id)}" data-label="${attr(titleText)}">Törlés</button>`
        : "";
    return `
    <div class="request-row ${done ? "done-item" : ""}">
      <label class="checkbox-label">
        <input type="checkbox" ${done ? "checked" : ""} data-action="${doneAction}" data-id="${attr(item.id)}">
        <span></span>
      </label>
      <div>
        <div class="row-title">${item.prefabTransport ? `${esc("Előgyártmány szállítás")} · ${materialPrefabDirectionMarkup(item.prefabDirection)}${item.externalCompany ? ` · ${esc(item.externalCompany)}` : ""}${item.prefabTaskType ? ` · ${esc(item.prefabTaskType)}` : ""}` : esc(fullTitle)}</div>
        <div class="row-meta">${esc(project)} · felelős: ${esc(userName(item.userId))}${creator} · ${done ? `kész: ${fmtDate(item.doneAt)}` : fmtDate(item.createdAt)}</div>
        ${item.description ? `<div class="${item.prefabTransport ? "prefab-description" : "muted"}">${esc(item.description)}</div>` : ""}
        ${item.prefabTransport ? materialImageThumbnails(item) : ""}
        ${extraHtml}
      </div>
      <span class="inline-actions">
        ${editButton}
        ${repeatButton}
        <button class="small-button" type="button" data-action="open-project" data-id="${attr(item.projectId || "")}">Projekt</button>
        ${deleteButton}
      </span>
    </div>
  `;
}

function fileRow(file) {
    const isLink = file.kind === "link";
    return `
    <div class="file-row">
      <span class="source-badge">${isLink ? "LINK" : "RÉGI"}</span>
      <div>
        <div class="row-title">${esc(file.name)}</div>
        <div class="path-text">${esc(file.path)}</div>
        <div class="row-meta">${esc(file.projectName)}${file.taskTitle ? ` · ${esc(file.taskTitle)}` : ""} · ${fmtDate(file.createdAt)}</div>
      </div>
      <span class="inline-actions">
        <button class="small-button" type="button" data-action="open-file" data-id="${attr(file.id)}" data-path="${attr(file.path)}">Megnyitás</button>
        <button class="small-button" type="button" data-action="reveal-file" data-path="${attr(file.path)}">Mappa</button>
        <a class="small-button" href="/api/files/${attr(file.id)}/download" target="_blank" rel="noopener">Letöltés</a>
        <button class="small-button" type="button" data-action="copy-path" data-path="${attr(file.path)}">Másolás</button>
        <button class="danger-button small-button" type="button" data-action="delete-file" data-id="${attr(file.id)}">Törlés</button>
      </span>
    </div>
  `;
}

function userName(userId) {
    return users().find((user) => user.id === userId)?.name || "";
}

function machineName(machineId) {
    return (data().cncMachines || []).find((machine) => machine.id === machineId)?.name || "";
}

function table(headers, rows) {
    return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map((head) => `<th>${esc(head)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
      </table>
    </div>
  `;
}

function renderTaskDetailModal() {
    const task = (data().tasks || []).find((item) => item.id === taskDetailId);
    if (!task) {
        taskDetailId = "";
        modalRoot.innerHTML = "";
        return;
    }
    const done = task.status === "done";
    const files = filesForTask(task.id);
    const priority = taskPriorityValue(task);
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal task-detail-modal">
        <header class="modal-header">
          <div>
            <h2>${esc(task.title)}${Number(task.quantity || 0) > 0 ? ` · ${Number(task.quantity || 0)} db` : ""}</h2>
            <p class="row-meta"><strong class="task-project-name">${esc(task.projectName || "")}</strong> · felelős: <strong class="task-assignee">${esc(userName(task.userId) || "nincs felelős")}</strong> · létrehozta: ${esc(task.createdByName || "nincs adat")}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          <div class="task-detail-grid">
            <div><span class="row-meta">Állapot</span><strong>${done ? "Kész" : "Nyitott"}</strong></div>
            <div><span class="row-meta">Prioritás</span><strong>${priority || "-"}</strong></div>
            <div><span class="row-meta">Létrehozva</span><strong>${fmtDate(task.createdAt)}</strong></div>
            <div><span class="row-meta">${done ? "Kész dátum" : "Projekt"}</span><strong>${done ? fmtDate(task.doneAt) : esc(task.projectName || "")}</strong></div>
          </div>
          <section class="panel" style="margin-top: 14px">
            <div class="panel-header"><h2>Leírás</h2></div>
            <div class="panel-body task-detail-description">${task.description ? esc(task.description) : `<span class="row-meta">Nincs leírás.</span>`}</div>
          </section>
          <section class="panel" style="margin-top: 14px">
            <div class="panel-header"><h2>Képek</h2></div>
            <div class="panel-body">
              <textarea class="task-image-paste-box" data-task-detail-image-input data-task-id="${attr(task.id)}" rows="2" placeholder="Kép beillesztése Ctrl+V"></textarea>
              ${task.images?.length ? taskImageThumbnails(task) : `<div class="empty">Nincs kép csatolva.</div>`}
            </div>
          </section>
          <section class="panel" style="margin-top: 14px">
            <div class="panel-header"><h2>Linkelt fájlok</h2></div>
            <div class="panel-body">${files.length ? `<div class="cnc-file-actions">${files.map(taskFileActions).join("")}</div>` : `<div class="empty">Nincs linkelt fájl.</div>`}</div>
          </section>
        </div>
      </article>
    </div>
  `;
}

function personalTodoItems() {
    const userId = currentUser?.id || "";
    if (!userId) return [];
    const d = data();
    const activeOpen = (item) => item?.userId === userId && item.status !== "done" && isActiveProjectId(item.projectId);
    const rows = [];
    for (const item of (d.tasks || []).filter(activeOpen)) {
        rows.push({
            id: item.id,
            view: "todos",
            type: "Feladat",
            title: item.title || "Feladat",
            projectName: item.projectName || "",
            description: item.description || "",
            priority: taskPriorityValue(item),
            sortDate: item.createdAt || "",
            dateText: fmtDate(item.createdAt)
        });
    }
    for (const item of (d.cncTasks || []).filter(activeOpen)) {
        rows.push({
            id: item.id,
            view: "cnc",
            type: "CNC",
            title: item.machineName || machineName(item.machineId) || "CNC feladat",
            projectName: item.projectName || "",
            description: [item.note || "", item.plannedStart || item.plannedEnd ? `Tervezett: ${fmtDate(item.plannedStart)} - ${fmtDate(item.plannedEnd)}` : ""].filter(Boolean).join("\n"),
            priority: 0,
            sortDate: item.plannedStart || item.createdAt || "",
            dateText: item.plannedStart || item.plannedEnd ? `${fmtDate(item.plannedStart)} - ${fmtDate(item.plannedEnd)}` : fmtDate(item.createdAt)
        });
    }
    for (const item of (d.toolRequests || []).filter(activeOpen)) {
        rows.push({
            id: item.id,
            view: "tools",
            type: "Szerszám",
            title: item.toolName || "Szerszámigény",
            projectName: item.projectName || "",
            description: item.description || "",
            priority: 0,
            sortDate: item.createdAt || "",
            dateText: fmtDate(item.createdAt)
        });
    }
    for (const item of (d.materialRequests || []).filter(activeOpen)) {
        const title = item.prefabTransport
            ? materialRequestTitle(item)
            : [materialRequestTitle(item), Number(item.quantity || 0) > 0 ? `${Number(item.quantity || 0)} db` : ""].filter(Boolean).join(" · ");
        rows.push({
            id: item.id,
            view: "materials",
            type: "Anyag",
            title,
            projectName: item.projectName || "",
            description: item.description || "",
            priority: 0,
            sortDate: item.createdAt || "",
            dateText: fmtDate(item.createdAt)
        });
    }
    for (const item of (d.fastenerRequests || []).filter(activeOpen)) {
        rows.push({
            id: item.id,
            view: "fasteners",
            type: "Kötőelem",
            title: fastenerTitle(item),
            projectName: item.projectName || "",
            description: item.description || "",
            priority: 0,
            sortDate: item.createdAt || "",
            dateText: fmtDate(item.createdAt)
        });
    }
    return rows.sort((a, b) => {
        if (a.priority && b.priority && a.priority !== b.priority) return a.priority - b.priority;
        if (a.priority && !b.priority) return -1;
        if (!a.priority && b.priority) return 1;
        return Date.parse(a.sortDate || "") - Date.parse(b.sortDate || "");
    });
}

function renderPersonalTasksModal() {
    const rows = personalTodoItems();
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal personal-todos-modal">
        <header class="modal-header">
          <div>
            <h2>Személyes teendők</h2>
            <p class="row-meta">${esc(currentUser?.name || "")} nyitott felelősségi tételei.</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          ${rows.length ? `<div class="personal-todo-list">${rows.map((item) => `
            <div class="personal-todo-row">
              <span class="source-badge">${esc(item.type)}</span>
              <div>
                <div class="row-title">${esc(item.title)}${item.priority ? ` <span class="task-priority-control" style="display:inline; margin-left:8px">PRIO:${item.priority}</span>` : ""}</div>
                <div class="row-meta"><strong class="task-project-name">${esc(item.projectName)}</strong> · ${esc(item.dateText || "")}</div>
                ${item.description ? `<div class="muted" style="white-space: pre-wrap; margin-top: 4px">${esc(item.description)}</div>` : ""}
              </div>
              <button class="primary-button small-button" type="button" data-action="open-personal-task-view" data-view="${attr(item.view)}" data-id="${attr(item.id)}">Megnyitás</button>
            </div>
          `).join("")}</div>` : `<div class="empty">Nincs nyitott személyes teendőd.</div>`}
        </div>
      </article>
    </div>
  `;
}

function renderDrawingOcrModal() {
    const isCamera = drawingOcr.phase === "camera";
    const isProjectStep = drawingOcr.step === "project";
    const title = isProjectStep ? "Projekt szkennelése" : "Rajzszám szkennelése";
    const cameraText = isProjectStep
        ? "Fotózd le a rajz adatai fölötti hosszú projekt útvonalat."
        : "Fotózd le a rajzszámot.";
    const cropText = isProjectStep
        ? "Húzd a két narancs sarkot a hosszú útvonal sor köré, majd indítsd az OCR-t."
        : "Húzd a két narancs sarkot a rajzszám köré, majd indítsd az OCR-t.";
    const recognizeText = isProjectStep ? "Projekt felismerése" : "Rajzszám felismerése";
    const skipProjectButton = isProjectStep
        ? `<button class="small-button" type="button" data-action="skip-project-ocr">Projekt kihagyása</button>`
        : "";
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal drawing-ocr-modal">
        <header class="modal-header">
          <div>
            <h2>${title}</h2>
            <p class="row-meta">${isCamera ? cameraText : cropText}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body drawing-ocr-stage">
          ${isCamera ? `
            <video id="drawing-ocr-video" class="drawing-ocr-video" autoplay playsinline muted></video>
            <div class="drawing-ocr-status" id="drawing-ocr-status">Kamera indítása...</div>
            <div class="inline-actions" style="justify-content:flex-end">
              ${skipProjectButton}
              <button class="primary-button" type="button" data-action="capture-drawing-ocr">Fotó készítése</button>
            </div>
          ` : `
            <canvas id="drawing-ocr-canvas" class="drawing-ocr-canvas"></canvas>
            <div class="drawing-ocr-status" id="drawing-ocr-status">A kijelölt téglalap kerül felismerésre.</div>
            <div class="inline-actions" style="justify-content:flex-end">
              ${skipProjectButton}
              <button class="small-button" type="button" data-action="retake-drawing-ocr">Új fotó</button>
              <button class="primary-button" type="button" data-action="recognize-drawing-ocr">${recognizeText}</button>
            </div>
          `}
        </div>
      </article>
    </div>
  `;
    window.setTimeout(() => {
        if (drawingOcr.open && drawingOcr.phase === "camera") startDrawingOcrCamera();
        if (drawingOcr.open && drawingOcr.phase === "crop") drawDrawingOcrCanvas();
    }, 0);
}

function formatFileSize(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return "";
    if (value < 1024) return `${value} B`;
    const units = ["KB", "MB", "GB"];
    let size = value / 1024;
    let unit = units[0];
    for (let i = 1; i < units.length && size >= 1024; i++) {
        size /= 1024;
        unit = units[i];
    }
    return `${size >= 10 ? size.toFixed(0) : size.toFixed(1)} ${unit}`;
}

function projectBrowserKindLabel(kind) {
    if (kind === "drawing") return "Rajz";
    if (kind === "assembly") return "Összeállítás";
    if (kind === "pdf") return "PDF";
    return "Fájl";
}

function projectBrowserFileRow(file) {
    const size = formatFileSize(file.size);
    const browserPdfUrl = file.kind === "pdf" && projectBrowser.projectId && file.path
        ? `/api/projects/${encodeURIComponent(projectBrowser.projectId)}/browser/pdf?path=${encodeURIComponent(file.path)}`
        : "";
    const demoFileUrl = globalThis.ERP_DEMO_CONFIG && projectBrowser.projectId && file.path
        ? `/api/projects/${encodeURIComponent(projectBrowser.projectId)}/browser/file?path=${encodeURIComponent(file.path)}`
        : "";
    return `
      <div class="project-browser-file-row">
        <div class="project-browser-file-main">
          <div class="project-browser-file-name" title="${attr(file.name || "Fájl")}">${esc(file.name || "Fájl")}</div>
          <div class="path-text project-browser-file-path">${esc(file.relativePath || file.path || "")}</div>
          <div class="row-meta">${[size, file.modifiedAt ? fmtDate(file.modifiedAt) : ""].filter(Boolean).map(esc).join(" · ")}</div>
        </div>
        <div class="inline-actions project-browser-file-actions">
          ${browserPdfUrl ? `<a class="small-button" href="${attr(browserPdfUrl)}" target="_blank" rel="noopener">Böngésző</a>` : ""}
          ${demoFileUrl ? `<a class="small-button" href="${attr(demoFileUrl)}">Letöltés</a>` : `<button class="small-button" type="button" data-action="open-file" data-path="${attr(file.path || "")}">Megnyitás</button>`}
          ${demoFileUrl ? `<button class="small-button" type="button" data-action="copy-path" data-path="${attr(file.folder || "")}">Mappa útvonal</button>` : `<button class="small-button" type="button" data-action="open-project-folder" data-path="${attr(file.folder || "")}">Mappa</button>`}
          <button class="small-button" type="button" data-action="copy-path" data-path="${attr(file.path || "")}">Útvonal</button>
        </div>
      </div>
    `;
}

function projectBrowserGroup(title, files) {
    return `
      <section class="panel project-browser-group">
        <div class="panel-header">
          <h2>${esc(title)}</h2>
          <span class="row-meta">${files.length} db</span>
        </div>
        <div class="panel-body project-browser-file-list">
          ${files.length ? files.map(projectBrowserFileRow).join("") : `<div class="empty">Nincs találat.</div>`}
        </div>
      </section>
    `;
}

function renderProjectBrowserModal() {
    const project = projectById(projectBrowser.projectId);
    if (!project) {
        projectBrowser = { open: false, projectId: "", loading: false, error: "", files: [], roots: [], missingRoots: [], truncated: false, scannedAt: "" };
        modalRoot.innerHTML = "";
        return;
    }
    const files = projectBrowser.files || [];
    const drawings = files.filter((file) => file.kind === "drawing");
    const assemblies = files.filter((file) => file.kind === "assembly");
    const pdfs = files.filter((file) => file.kind === "pdf");
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal project-browser-modal">
        <header class="modal-header">
          <div>
            <h2>Projekt böngésző · ${esc(project.name)}</h2>
            <p class="row-meta">${esc(project.primaryFolder || "kézi projekt")}</p>
            ${projectBrowser.scannedAt ? `<p class="row-meta">Élő beolvasás: ${fmtDate(projectBrowser.scannedAt)}</p>` : ""}
          </div>
          <div class="inline-actions">
            <button class="small-button" type="button" data-action="project-browser-refresh">Frissítés</button>
            <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
          </div>
        </header>
        <div class="modal-body">
          ${projectBrowser.loading ? `<div class="empty">Projektmappa beolvasása...</div>` : ""}
          ${projectBrowser.error ? `<div class="empty error-text">${esc(projectBrowser.error)}</div>` : ""}
          ${(projectBrowser.roots || []).length ? `<div class="project-browser-roots">${(projectBrowser.roots || []).map((root) => `<div class="path-text">${esc(root)}</div>`).join("")}</div>` : ""}
          ${(projectBrowser.missingRoots || []).length ? `<div class="empty error-text">Nem elérhető mappa: ${(projectBrowser.missingRoots || []).map(esc).join(", ")}</div>` : ""}
          ${projectBrowser.truncated ? `<div class="empty">A lista túl nagy, az első ${files.length} találat látható.</div>` : ""}
          ${!projectBrowser.loading && !projectBrowser.error ? `
            <div class="metric-grid project-browser-metrics">
              <div class="metric"><strong>${files.length}</strong><span>összes fájl</span></div>
              <div class="metric"><strong>${drawings.length}</strong><span>rajz</span></div>
              <div class="metric"><strong>${assemblies.length}</strong><span>összeállítás</span></div>
              <div class="metric"><strong>${pdfs.length}</strong><span>PDF</span></div>
            </div>
            <div class="project-browser-sections">
              ${projectBrowserGroup("Rajzok", drawings)}
              ${projectBrowserGroup("Összeállítások", assemblies)}
              ${projectBrowserGroup("PDF-ek", pdfs)}
            </div>
          ` : ""}
        </div>
      </article>
    </div>
  `;
}

function renderArchiveRestoreModal() {
    const record = (archiveState?.archives || []).find((item) => item.id === restoringArchiveId);
    if (!record || record.restoredAt) { restoringArchiveId = ""; modalRoot.innerHTML = ""; return; }
    const label = record.type === "project" ? record.projectName : record.itemLabel || record.projectName;
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal-backdrop"><article class="modal">
      <header class="modal-header"><h2>Visszaállítás meglévő projektbe</h2><button class="icon-button" type="button" data-action="close-modal" aria-label="Bezárás">×</button></header>
      <div class="modal-body">
        <p><strong>${esc(label || "Archív tétel")}</strong></p>
        <p class="row-meta" style="margin: 12px 0">Az eredeti dátumok, felelősök és kész állapotok megmaradnak. A bejegyzések az eredeti időrendjükbe kerülnek, nem a lista elejére. A célprojekt beállításai és mappái nem változnak; az archív másolat megmarad.</p>
        <label>Célprojekt${optionPicker("projects-all", archiveRestoreProjectId, { action: "archive-restore-project", placeholder: "Válassz meglévő projektet" })}</label>
        <p class="row-meta" style="margin: 10px 0">A korábban törölt képfájlokat az archívum nem tudja újra létrehozni. A meglévő fájlhivatkozások változatlanul megmaradnak.</p>
        <button class="primary-button" type="button" data-action="confirm-archive-restore" ${archiveRestoreProjectId ? "" : "disabled"}>Bejegyzések visszaállítása</button>
      </div>
    </article></div>`;
}

function renderCadAssignModal() {
    const model = (data().cadModels || []).find((item) => item.id === assigningCadModelId);
    if (!model) {
        assigningCadModelId = "";
        modalRoot.innerHTML = "";
        return;
    }
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal-backdrop"><article class="modal" style="max-width: 700px">
      <header class="modal-header"><h2>3D modell projekthez rendelése</h2><button class="icon-button" type="button" data-action="close-modal" aria-label="Bezárás">×</button></header>
      <div class="modal-body">
        <p><strong>${esc(model.sourceName || model.glbFile)}</strong></p>
        <p class="row-meta">Helper projektneve: ${esc(model.projectLabel || "—")}. Ez csak címke; nem hoz létre ERP projektet.</p>
        <label>Meglévő ERP projekt${optionPicker("projects-all", cadAssignProjectId, { action: "cad-assign-project", allLabel: "Nincs hozzárendelés" })}</label>
        <p class="row-meta" style="margin: 10px 0">Üres választással a modell projekt nélkül marad. A GLB és a forrásprojekt nem változik.</p>
        <button class="primary-button" type="button" data-action="save-cad-assignment">Hozzárendelés mentése</button>
      </div>
    </article></div>`;
}

function renderCadNicknameModal() {
    const model = (data().cadModels || []).find((item) => item.id === editingCadModelNicknameId);
    if (!model) {
        editingCadModelNicknameId = "";
        modalRoot.innerHTML = "";
        return;
    }
    modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal-backdrop"><article class="modal" style="max-width: 600px">
      <header class="modal-header"><h2>Modell beceneve</h2><button class="icon-button" type="button" data-action="close-modal" aria-label="Bezárás">×</button></header>
      <div class="modal-body">
        <p class="row-meta">Forrás: ${esc(model.sourceName || model.glbFile)}</p>
        <label>Becenév<input type="text" maxlength="120" value="${attr(model.nickname || "")}" data-cad-nickname-input placeholder="Opcionális becenév"></label>
        <p class="row-meta" style="margin: 10px 0">Csak az ERP-ben látható címke. A GLB, a JSON és az exportált fájlnév nem változik. Üresen mentve a forrásnév jelenik meg.</p>
        <button class="primary-button" type="button" data-action="save-cad-model-nickname">Becenév mentése</button>
      </div>
    </article></div>`;
}

function renderModal() {
    if (restoringArchiveId) { renderArchiveRestoreModal(); return; }
    if (assigningCadModelId) { renderCadAssignModal(); return; }
    if (editingCadModelNicknameId) { renderCadNicknameModal(); return; }
    if (dashboardImageTodoId) {
        renderDashboardImageModal();
        return;
    }
    if (cncImageView.taskId) {
        renderCncImageModal();
        return;
    }
    if (taskImageView.taskId) {
        renderTaskImageModal();
        return;
    }
    if (materialImageView.requestId) {
        renderMaterialImageModal();
        return;
    }
    if (mobilePhotoCapture.open) {
        renderMobilePhotoModal();
        return;
    }
    if (reportingCncTaskId) {
        renderCncReportModal();
        return;
    }
    if (worklogListFullscreen) {
        renderWorklogListFullscreenModal();
        return;
    }
    if (linkBrowser.open) {
        renderLinkBrowser();
        return;
    }
    if (taskDetailId) {
        renderTaskDetailModal();
        return;
    }
    if (personalTasksOpen) {
        renderPersonalTasksModal();
        return;
    }
    if (drawingOcr.open) {
        renderDrawingOcrModal();
        return;
    }
    if (projectBrowser.open) {
        renderProjectBrowserModal();
        return;
    }
    if (!modalProjectId) {
        modalRoot.innerHTML = "";
        return;
    }
    const project = projectById(modalProjectId);
    if (!project) {
        modalRoot.innerHTML = "";
        modalProjectId = null;
        return;
    }
    const d = data();
    const tasks = (d.tasks || []).filter((item) => item.projectId === project.id);
    const cncTasks = (d.cncTasks || []).filter((item) => item.projectId === project.id);
    const boms = (d.boms || []).filter((item) => item.projectId === project.id);
    const tools = (d.toolRequests || []).filter((item) => item.projectId === project.id);
    const materials = (d.materialRequests || []).filter((item) => item.projectId === project.id);
    const fasteners = (d.fastenerRequests || []).filter((item) => item.projectId === project.id);
    const logs = (d.workLogs || []).filter((item) => item.projectId === project.id);
    const files = (d.files || []).filter((item) => item.projectId === project.id);
    const counts = projectCounts(project.id);

    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal">
        <header class="modal-header">
          <div>
            <h2>${esc(project.name)}</h2>
            <p class="row-meta">${esc(project.primaryFolder || "kézi projekt")}</p>
            ${projectMetaMarkup(project, true)}
            ${project.primaryFolder ? `
              <div class="inline-actions" style="margin-top: 8px">
                 ${globalThis.ERP_DEMO_CONFIG
                   ? `<button class="small-button" type="button" data-action="open-demo-project-browser" data-id="${attr(project.id)}">Mappa böngészése</button>`
                   : `<button class="small-button" type="button" data-action="open-project-folder" data-path="${attr(project.primaryFolder)}">Mappa megnyitása</button>
                      <button class="small-button" type="button" data-action="reveal-project-folder" data-path="${attr(project.primaryFolder)}">Hely mutatása</button>`}
                <button class="small-button" type="button" data-action="copy-path" data-path="${attr(project.primaryFolder)}">Útvonal másolása</button>
              </div>
            ` : ""}
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          <div class="metric-grid">
            <div class="metric"><strong>${formatHours(counts.hours)}</strong><span>munkaóra</span></div>
            <div class="metric"><strong>${counts.openTasks.length}</strong><span>nyitott feladat</span></div>
            <div class="metric"><strong>${counts.openCnc.length}</strong><span>nyitott CNC</span></div>
            <div class="metric"><strong>${counts.openTools.length}</strong><span>nyitott szerszám</span></div>
            <div class="metric"><strong>${counts.openMaterials.length}</strong><span>nyitott anyag</span></div>
            <div class="metric"><strong>${counts.openFasteners.length}</strong><span>nyitott csavar</span></div>
          </div>
          <div class="modal-sections" style="margin-top: 14px">
            <section class="panel">
              <div class="panel-header"><h2>Feladatok</h2></div>
              <div class="panel-body">${tasks.length ? table(["Név", "Leírás", "Felelős", "Állapot"], tasks.map((item) => [esc(item.title), esc(item.description), esc(userName(item.userId)), esc(item.status)])) : `<div class="empty">Nincs feladat.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>CNC megmunkálás</h2></div>
              <div class="panel-body">${cncTasks.length ? table(["CNC gép", "Felelős", "Időablak", "Megjegyzés", "Állapot"], cncTasks.map((item) => [esc(item.machineName || machineName(item.machineId)), esc(userName(item.userId)), `${fmtDate(item.plannedStart)} - ${fmtDate(item.plannedEnd)}`, esc(item.note), esc(item.status)])) : `<div class="empty">Nincs CNC feladat.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>BOM</h2></div>
              <div class="panel-body">${boms.length ? table(["Név", "Revízió", "Fájl", "Sor", "Import"], boms.map((item) => [esc(item.name), esc(item.revision), esc(item.fileName), String(item.items?.length || 0), esc(item.importError || "OK")])) : `<div class="empty">Nincs BOM.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>Szerszámigények</h2></div>
              <div class="panel-body">${tools.length ? table(["Szerszám", "Leírás", "Állapot", "Melléklet"], tools.map((item) => [esc(item.toolName), esc(item.description), esc(item.status), requestAttachmentTableCell(item, "tool")])) : `<div class="empty">Nincs szerszámigény.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>Anyagigények</h2></div>
              <div class="panel-body">${materials.length ? table(["Igény", "Méret", "Hossz", "Típus / cég", "Állapot", "Melléklet"], materials.map((item) => item.prefabTransport
                  ? [`${esc("Előgyártmány szállítás")} · ${materialPrefabDirectionMarkup(item.prefabDirection)}${item.externalCompany ? ` · ${esc(item.externalCompany)}` : ""}${item.prefabTaskType ? ` · ${esc(item.prefabTaskType)}` : ""}`, "", "", esc(item.externalCompany || ""), esc(item.status), requestAttachmentTableCell(item, "material")]
                  : [esc(item.material), esc(item.size), esc(formatMaterialLength(item.length)), esc(item.type), esc(item.status), requestAttachmentTableCell(item, "material")])) : `<div class="empty">Nincs anyagigény.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>Csavarigények</h2></div>
              <div class="panel-body">${fasteners.length ? table(["Típus", "Méret", "Darab", "Szilárdság / anyag", "Állapot", "Melléklet"], fasteners.map((item) => [esc(item.type), esc(item.size), String(item.quantity || ""), esc(item.grade), esc(item.status), fastenerAttachmentTableCell(item)])) : `<div class="empty">Nincs csavarigény.</div>`}</div>
            </section>
            <section class="panel">
              <div class="panel-header"><h2>Munkaidő</h2></div>
              <div class="panel-body">${logs.length ? table(["Munka", "Óra", "Felelős", "Dátum"], logs.map((item) => [esc(item.workType), formatHours(item.hours), esc(userName(item.userId)), fmtDate(item.createdAt)])) : `<div class="empty">Nincs naplózott munkaidő.</div>`}</div>
            </section>
            <section class="panel wide">
              <div class="panel-header"><h2>Fájlok</h2></div>
              <div class="panel-body">${files.length ? files.map(fileRow).join("") : `<div class="empty">Nincs fájl.</div>`}</div>
            </section>
          </div>
        </div>
      </article>
    </div>
  `;
}

function renderDashboardImageModal() {
    const todo = (data().dashboardTodos || []).find((item) => item.id === dashboardImageTodoId);
    if (!todo?.image) {
        dashboardImageTodoId = "";
        modalRoot.innerHTML = "";
        return;
    }
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal image-modal">
        <header class="modal-header">
          <div>
            <h2>${esc(todo.text || "Kép")}</h2>
            <p class="row-meta">${fmtDate(todo.createdAt)}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body image-modal-body">
          <img src="/api/dashboard/todos/${attr(todo.id)}/image" alt="">
        </div>
      </article>
    </div>
  `;
}

function renderCncImageModal() {
    const task = (data().cncTasks || []).find((item) => item.id === cncImageView.taskId);
    const images = task?.images || [];
    if (!task || !images.length) {
        cncImageView = { taskId: "", index: 0 };
        modalRoot.innerHTML = "";
        return;
    }
    let index = Number(cncImageView.index) || 0;
    if (index < 0) index = 0;
    if (index >= images.length) index = images.length - 1;
    cncImageView.index = index;
    const nav = images.length > 1
        ? `<div class="inline-actions" style="justify-content: space-between; margin-top: 8px">
             <button class="small-button" type="button" data-action="cnc-image-prev" ${index === 0 ? "disabled" : ""}>← Előző</button>
             <span class="row-meta">${index + 1} / ${images.length}</span>
             <button class="small-button" type="button" data-action="cnc-image-next" ${index === images.length - 1 ? "disabled" : ""}>Következő →</button>
           </div>`
        : "";
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal image-modal">
        <header class="modal-header">
          <div>
            <h2>CNC feladat — kép</h2>
            <p class="row-meta">${esc(task.machineName || machineName(task.machineId) || "")} · ${esc(task.projectName || "")}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body image-modal-body">
          <img src="/api/cnc-tasks/${attr(task.id)}/images/${index}" alt="">
          ${nav}
        </div>
      </article>
    </div>
  `;
}

function imageModalNav(images, index, prevAction, nextAction) {
    if (!images || images.length <= 1) return "";
    return `<div class="inline-actions" style="justify-content: space-between; margin-top: 8px; width: 100%">
             <button class="small-button" type="button" data-action="${prevAction}" ${index === 0 ? "disabled" : ""}>← Előző</button>
             <span class="row-meta">${index + 1} / ${images.length}</span>
             <button class="small-button" type="button" data-action="${nextAction}" ${index === images.length - 1 ? "disabled" : ""}>Következő →</button>
           </div>`;
}

function renderTaskImageModal() {
    const task = (data().tasks || []).find((item) => item.id === taskImageView.taskId);
    const images = task?.images || [];
    if (!task || !images.length) {
        taskImageView = { taskId: "", index: 0 };
        modalRoot.innerHTML = "";
        return;
    }
    let index = Number(taskImageView.index) || 0;
    if (index < 0) index = 0;
    if (index >= images.length) index = images.length - 1;
    taskImageView.index = index;
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal image-modal">
        <header class="modal-header">
          <div>
            <h2>Feladat — kép</h2>
            <p class="row-meta">${esc(task.title || "")} · ${esc(task.projectName || "")}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body image-modal-body">
          <img src="/api/tasks/${attr(task.id)}/images/${index}" alt="">
          ${imageModalNav(images, index, "task-image-prev", "task-image-next")}
        </div>
      </article>
    </div>
  `;
}

function renderMaterialImageModal() {
    const item = (data().materialRequests || []).find((entry) => entry.id === materialImageView.requestId);
    const images = item?.images || [];
    if (!item || !images.length) {
        materialImageView = { requestId: "", index: 0 };
        modalRoot.innerHTML = "";
        return;
    }
    let index = Number(materialImageView.index) || 0;
    if (index < 0) index = 0;
    if (index >= images.length) index = images.length - 1;
    materialImageView.index = index;
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal image-modal">
        <header class="modal-header">
          <div>
            <h2>Anyagigény — kép</h2>
            <p class="row-meta">${esc(materialRequestTitle(item))} · ${esc(item.projectName || "")}</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body image-modal-body">
          <img src="/api/material-requests/${attr(item.id)}/images/${index}" alt="">
          ${imageModalNav(images, index, "material-image-prev", "material-image-next")}
        </div>
      </article>
    </div>
  `;
}

function setMobilePhotoStatus(message, isError = false) {
    const status = document.getElementById("mobile-photo-status");
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function renderMobilePhotoModal() {
    const labels = {
        task: "Feladat fotó",
        cnc: "CNC fotó",
        "material-prefab": "Előgyártmány szállítás fotó"
    };
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="cancel-mobile-photo">
      <article class="modal mobile-photo-modal">
        <header class="modal-header">
          <div>
            <h2>${esc(labels[mobilePhotoCapture.target] || "Mobil fotó")}</h2>
            <p class="row-meta">Kamera fotó csatolása az űrlaphoz.</p>
          </div>
          <button class="icon-button" type="button" data-action="cancel-mobile-photo" title="Bezárás">×</button>
        </header>
        <div class="modal-body mobile-photo-body">
          <video id="mobile-photo-video" class="mobile-photo-video" autoplay playsinline muted></video>
          <div class="drawing-ocr-status" id="mobile-photo-status">Kamera indítása...</div>
          <div class="inline-actions" style="justify-content:flex-end">
            <button class="small-button" type="button" data-action="cancel-mobile-photo">Mégse</button>
            <button class="primary-button" type="button" data-action="capture-mobile-photo">Fotó készítése</button>
          </div>
        </div>
      </article>
    </div>
  `;
    window.setTimeout(() => {
        if (mobilePhotoCapture.open) startMobilePhotoCamera();
    }, 0);
}

async function startMobilePhotoCamera() {
    const video = document.getElementById("mobile-photo-video");
    if (!video || mobilePhotoCapture.stream || mobilePhotoCapture.starting) return;
    mobilePhotoCapture.starting = true;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });
        if (!mobilePhotoCapture.open) {
            for (const track of stream.getTracks()) track.stop();
            return;
        }
        mobilePhotoCapture.stream = stream;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setMobilePhotoStatus("Kamera kész.");
    } catch (error) {
        setMobilePhotoStatus("Nem sikerült elindítani a kamerát.", true);
        toastMessage(error.message || "Nem sikerült elindítani a kamerát.", true);
    } finally {
        mobilePhotoCapture.starting = false;
    }
}

async function captureMobilePhoto() {
    const video = document.getElementById("mobile-photo-video");
    if (!video || !video.videoWidth || !video.videoHeight) {
        toastMessage("A kamera képe még nem áll készen.", true);
        return;
    }
    try {
        const longest = Math.max(video.videoWidth, video.videoHeight);
        const scale = Math.min(1, 1800 / longest);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
        canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.86);
        const message = addPendingImage(mobilePhotoCapture.target, dataUrl, `mobil-foto-${Date.now()}.jpg`);
        resetMobilePhotoCapture();
        renderModal();
        toastMessage(message);
    } catch (error) {
        toastMessage(error.message || "Nem sikerült menteni a fotót.", true);
    }
}

function renderCncReportModal() {
    const task = (data().cncTasks || []).find((item) => item.id === reportingCncTaskId);
    if (!task) {
        reportingCncTaskId = "";
        modalRoot.innerHTML = "";
        return;
    }
    const defaultStart = currentHourRoundedUp();
    const defaultUserId = task.userId || currentUser?.id || "";
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="cancel-cnc-report">
      <article class="modal small-modal">
        <header class="modal-header">
          <div>
            <h2>CNC lejelentés</h2>
            <p class="row-meta">${esc(task.machineName || machineName(task.machineId))} · ${esc(task.projectName || "")}</p>
          </div>
          <button class="icon-button" type="button" data-action="cancel-cnc-report" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          <form class="form-grid" data-action="report-cnc-task">
            <input type="hidden" name="id" value="${attr(task.id)}">
            <label class="wide">Valós kezdési idő<input name="actualStart" type="datetime-local" required value="${attr(defaultStart)}"></label>
            <label class="wide">Idő${hoursInput()}</label>
            <label class="wide">Aki ténylegesen elvégezte<select name="userId" required>${userOptions(defaultUserId)}</select></label>
            <label class="wide">Megjegyzés<textarea name="reportNote" placeholder="Opcionális" rows="2">${esc(task.reportNote || "")}</textarea></label>
            <button class="primary-button wide" type="submit">Lejelentés mentése</button>
          </form>
        </div>
      </article>
    </div>
  `;
}

function renderLinkBrowser() {
    const isBom = linkBrowser.target === "bom";
    const isCncWorklog = linkBrowser.target === "cnc-worklog";
    const attachmentType = String(linkBrowser.target || "").endsWith("-attachment") ? String(linkBrowser.target).replace(/-attachment$/, "") : "";
    const attachmentSubtitles = {
        tool: "a szerszámigény Office/PDF mellékletéhez (csak Y: meghajtó)",
        material: "az anyagigény Office/PDF mellékletéhez (csak Y: meghajtó)",
        fastener: "a kötőelem igény Office/PDF mellékletéhez (csak Y: meghajtó)"
    };
    const subtitle = isBom
        ? "a BOM importhoz"
        : isCncWorklog
            ? "a CNC naplózáshoz (csak Y: meghajtó)"
            : attachmentType
                ? attachmentSubtitles[requestAttachmentStateKey(attachmentType)]
                : "a munkafolyamat csatolmányához";
    modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal-backdrop">
      <article class="modal">
        <header class="modal-header">
          <div>
            <h2>LINK tallózás</h2>
            <p class="row-meta">${globalThis.ERP_DEMO_CONFIG ? "Válassz fájlt a helyi documents mappából" : `Válassz hálózati fájlt ${subtitle}`}.</p>
          </div>
          <button class="icon-button" type="button" data-action="close-modal" title="Bezárás">×</button>
        </header>
        <div class="modal-body">
          <div class="inline-actions" style="margin-bottom: 12px">
            <button class="small-button" type="button" data-action="browse-link-root">Meghajtók</button>
            ${linkBrowser.parent ? `<button class="small-button" type="button" data-action="browse-link-folder" data-path="${attr(linkBrowser.parent)}">Fel</button>` : ""}
          </div>
          <div class="link-browser-path-row">
            <input id="link-browser-path-input" type="text" value="${attr(linkBrowser.current || "")}" autocomplete="off" spellcheck="false" placeholder="${globalThis.ERP_DEMO_CONFIG ? "documents/.../fájl" : "Y:\\...\\mappa vagy fájl"}">
            <button class="small-button" type="button" data-action="browse-link-entered-path">Mappa megnyitása</button>
            ${attachmentType ? `<button class="primary-button" type="button" data-action="select-link-entered-path" data-target="${attr(requestAttachmentStateKey(attachmentType))}">Fájl linkelése</button>` : ""}
            <button class="small-button" type="button" data-action="copy-link-entered-path">Másolás</button>
          </div>
          <div class="path-text" style="margin-bottom: 12px">${esc(linkBrowser.current || "Elérhető hálózati meghajtók")}</div>
          ${linkBrowser.loading ? `<div class="empty">Tallózás...</div>` : ""}
          ${linkBrowser.error ? `<div class="empty">${esc(linkBrowser.error)}</div>` : ""}
          ${!linkBrowser.loading && !linkBrowser.error ? `
            <div class="compact-list">
              ${linkBrowser.entries.length ? linkBrowser.entries.map((entry) => `
                <div class="list-row">
                  <span class="source-badge">${entry.kind === "folder" ? "MAPPA" : "FÁJL"}</span>
                  <div>
                    <div class="row-title">${esc(entry.name)}</div>
                    <div class="path-text">${esc(entry.path)}</div>
                  </div>
                  ${entry.kind === "folder"
            ? `<button class="small-button" type="button" data-action="browse-link-folder" data-path="${attr(entry.path)}">Megnyitás</button>`
            : `<button class="primary-button" type="button" data-action="select-link-file" data-path="${attr(entry.path)}" data-name="${attr(entry.name)}">Link</button>`}
                </div>
              `).join("") : `<div class="empty">Nincs megjeleníthető elem.</div>`}
            </div>
          ` : ""}
        </div>
      </article>
    </div>
  `;
}

function formData(form) {
    syncProjectPickers(form, true);
    const fd = new FormData(form);
    const body = {};
    for (const [key, value] of fd.entries()) body[key] = value;
    for (const checkbox of form.querySelectorAll('input[type="checkbox"]')) {
        body[checkbox.name] = checkbox.checked;
    }
    return body;
}

async function submitForm(form) {
    const action = form.dataset.action;
    const body = formData(form);
    let finalToastMessage = "Mentve.";
    let finalToastIsError = false;

    if (action === "setup-demo-admin") {
        if (body.password !== body.passwordAgain) throw new Error("A két jelszó nem egyezik.");
        const result = await api("/api/setup-admin", { method: "POST", body: { userId: body.userId, password: body.password } });
        authCsrfToken = result.csrf || "";
        authRequired = false;
        authPasswordSet = true;
        await loadState(true);
        toastMessage("A helyi admin beállítva.");
        return;
    }
    if (action === "login") {
        let loginError = null;
        try {
            const result = await api("/api/login", { method: "POST", body: { userId: body.userId, password: body.password, pwa: isStandalonePwa() } });
            authCsrfToken = result.csrf || "";
        } catch (error) {
            loginError = error;
        }
        if (loginError) {
            if (loginError.message === "Hibás felhasználói jelszó.") {
                loginFailureCount += 1;
                showLoginWarning(loginFailureCount);
                return; // popup handles user feedback — don't double up with toast
            }
            throw loginError;
        }
        loginFailureCount = 0;
        rememberLoginUserId(body.userId);
        authRequired = false;
        toastMessage("Belépve.");
        await loadState(true);
        return;
    }
    if (action === "change-personal-password") {
        if (body.newPassword !== body.newPasswordAgain) throw new Error("A két új jelszó nem egyezik.");
        await api("/api/me/password", {
            method: "POST",
            body: { currentPassword: body.currentPassword || "", newPassword: body.newPassword || "" }
        });
        form.reset();
        toastMessage("Személyes jelszó frissítve.");
        await loadState(true);
        return;
    }
    if (action === "save-notification-settings") {
        const menuNotifications = Object.fromEntries(NOTIFICATION_MENU_OPTIONS.map(([key]) => [key, Boolean(body[`menu_${key}`])]));
        const result = await api("/api/notifications/settings", {
            method: "POST",
            body: {
                enabled: Boolean(body.enabled),
                menuNotifications,
                detailLevel: body.detailLevel || "normal"
            }
        });
        updateCurrentUser(result.user);
        toastMessage("Értesítési beállítások mentve.");
        await loadState(true);
        return;
    }

    if (action === "upload-modelling-photos") {
        if (!modellingPhotos.length) throw new Error("Nincs feltöltendő fotó.");
        const folder = String(body.folder || "").trim();
        if (!folder) throw new Error("Adj meg projekt mappa nevet.");
        modellingFolderName = folder;
        modellingUploadBusy = true;
        render();
        const status = () => document.getElementById("modelling-upload-status");
        let uploaded = 0;
        try {
            for (const photo of modellingPhotos) {
                const el = status();
                if (el) el.textContent = `Feltöltés: ${uploaded + 1} / ${modellingPhotos.length}...`;
                await api("/api/modelling/photos", {
                    method: "POST",
                    body: { folder, imageDataUrl: photo.dataUrl }
                });
                uploaded += 1;
            }
            modellingPhotos = [];
            toastMessage(`${uploaded} fotó feltöltve ide: ${globalThis.ERP_DEMO_CONFIG ? ".demo-data/modelling" : "modelling"}\\${folder}`);
            modellingFolders = null;
        } catch (error) {
            toastMessage(`${uploaded} fotó feltöltve, utána hiba: ${error.message}`, true);
        } finally {
            modellingUploadBusy = false;
            render();
        }
        return;
    }
    if (action === "add-dashboard-todo") {
        body.imageDataUrl = pendingDashboardTodoImage?.dataUrl || "";
        body.imageName = pendingDashboardTodoImage?.name || "";
        await api("/api/dashboard/todos", { method: "POST", body });
        pendingDashboardTodoImage = null;
    }
    if (action === "add-meeting") {
        body.time = `${body.meetingDate || localInputDate()}T${body.meetingTime || defaultMeetingTime()}`;
        await api("/api/meetings", { method: "POST", body });
    }
    if (action === "add-dayoff") {
        if (!body.startDate) throw new Error("Add meg a kezdő napot.");
        await api("/api/dayoffs", {
            method: "POST",
            body: { userId: body.userId, startDate: body.startDate, endDate: body.endDate || "" }
        });
        toastMessage("Szabadnap rögzítve.");
        await loadState(true);
        return;
    }
    if (action === "add-task") {
        body.imageDataUrls = pendingTaskImages.map((img) => img.dataUrl);
        const task = await api("/api/tasks", { method: "POST", body });
        await attachPendingToTask(task);
        pendingTaskLinks = [];
        pendingTaskImages = [];
    }
    if (action === "add-bom") {
        await submitBom(form, body);
        bomLinkPath = "";
        bomLinkName = "";
    }
    if (action === "add-cnc-task") {
        body.imageDataUrls = pendingCncTaskImages.map((img) => img.dataUrl);
        const task = await api("/api/cnc-tasks", { method: "POST", body });
        await attachPendingToCncTask(task);
        pendingTaskLinks = [];
        pendingCncTaskImages = [];
    }
    if (action === "edit-cnc-task") {
        await api(`/api/cnc-tasks/${body.id}`, {
            method: "PATCH",
            body: {
                projectId: body.projectId,
                userId: body.userId,
                machineId: body.machineId,
                plannedStart: body.plannedStart,
                plannedEnd: body.plannedEnd,
                note: body.note || ""
            }
        });
        editingCncTaskId = "";
    }
    if (action === "report-cnc-task") {
        if (!body.actualStart) throw new Error("Add meg a valós kezdési időt.");
        const hours = Number(body.hours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > 24) throw new Error("Az idő 0-nál nagyobb és legfeljebb 24 óra lehet.");
        if (!body.userId) throw new Error("Válaszd ki, aki ténylegesen elvégezte.");
        await api(`/api/cnc-tasks/${body.id}`, {
            method: "PATCH",
            body: {
                done: true,
                actualStart: body.actualStart,
                hours,
                userId: body.userId,
                reportNote: body.reportNote || ""
            }
        });
        reportingCncTaskId = "";
        modalRoot.innerHTML = "";
    }
    if (action === "add-tool") {
        if (pendingToolAttachment) {
            body.attachmentPath = pendingToolAttachment.path;
            body.attachmentName = pendingToolAttachment.name || "";
        }
        await api("/api/tool-requests", { method: "POST", body });
        pendingToolAttachment = null;
    }
    if (action === "add-material-request") {
        if (pendingMaterialAttachment) {
            body.attachmentPath = pendingMaterialAttachment.path;
            body.attachmentName = pendingMaterialAttachment.name || "";
        }
        body.imageDataUrls = Boolean(body.prefabTransport) ? pendingMaterialPrefabImages.map((img) => img.dataUrl) : [];
        await api("/api/material-requests", { method: "POST", body });
        pendingMaterialAttachment = null;
        pendingMaterialPrefabImages = [];
    }
    if (action === "add-fastener-request") {
        if (pendingFastenerAttachment) {
            body.attachmentPath = pendingFastenerAttachment.path;
            body.attachmentName = pendingFastenerAttachment.name || "";
        }
        await api("/api/fastener-requests", { method: "POST", body });
        pendingFastenerAttachment = null;
    }
    if (action === "edit-task") {
        await api(`/api/tasks/${body.id}`, {
            method: "PATCH",
            body: {
                title: body.title,
                quantity: Number(body.quantity || 0),
                projectId: body.projectId,
                userId: body.userId,
                description: body.description || ""
            }
        });
        editingTaskId = "";
    }
    if (action === "edit-tool") {
        await api(`/api/tool-requests/${body.id}`, {
            method: "PATCH",
            body: {
                toolName: body.toolName,
                quantity: Number(body.quantity || 0),
                projectId: body.projectId,
                userId: body.userId,
                description: body.description || ""
            }
        });
        editingToolRequestId = "";
    }
    if (action === "edit-material-request") {
        await api(`/api/material-requests/${body.id}`, {
            method: "PATCH",
            body: {
                prefabTransport: Boolean(body.prefabTransport),
                prefabDirection: body.prefabDirection || "elhozni",
                externalCompany: body.externalCompany || "",
                prefabTaskType: body.prefabTaskType || "",
                material: body.material || "",
                size: body.size || "",
                length: body.length || "",
                type: body.type || "",
                quantity: Number(body.quantity || 0),
                projectId: body.projectId,
                userId: body.userId,
                description: body.description || ""
            }
        });
        editingMaterialRequestId = "";
    }
    if (action === "edit-fastener-request") {
        await api(`/api/fastener-requests/${body.id}`, {
            method: "PATCH",
            body: {
                grade: body.grade,
                type: body.type || "",
                size: body.size || "",
                quantity: Number(body.quantity || 0),
                projectId: body.projectId,
                userId: body.userId,
                description: body.description || ""
            }
        });
        editingFastenerRequestId = "";
    }
    if (action === "add-worklog") {
        if (body.company && body.projectId) {
            const project = (data().projects || {})[body.projectId];
            if (project && !project.company) {
                await api(`/api/projects/${body.projectId}`, { method: "PATCH", body: { company: body.company } });
            }
        }
        delete body.company;
        if (!canUseOvertime()) delete body.overtime;
        await api("/api/worklogs", { method: "POST", body });
        worklogProjectId = "";
    }
    if (action === "add-cnc-worklog") {
        if (body.company && body.projectId) {
            const project = (data().projects || {})[body.projectId];
            if (project && !project.company) {
                await api(`/api/projects/${body.projectId}`, { method: "PATCH", body: { company: body.company } });
            }
        }
        delete body.company;
        if (!canUseOvertime()) delete body.overtime;
        const created = await api("/api/worklogs", { method: "POST", body });
        await logPendingProjectCorrection(created);
        await logPendingDrawingCorrection(created, body.note || "");
        pendingProjectOcrCorrection = null;
        pendingDrawingOcrCorrection = null;
        cncWorklogProjectId = "";
    }
    if (action === "edit-worklog") {
        const targetId = body.id || editingWorklogId;
        if (body.company && body.projectId) {
            const project = (data().projects || {})[body.projectId];
            if (project && !project.company) {
                await api(`/api/projects/${body.projectId}`, { method: "PATCH", body: { company: body.company } });
            }
        }
        delete body.company;
        delete body.id;
        if (!canUseOvertime()) delete body.overtime;
        const updated = await api(`/api/worklogs/${targetId}`, { method: "PATCH", body });
        await logPendingProjectCorrection(updated);
        await logPendingDrawingCorrection(updated, body.note || "");
        pendingProjectOcrCorrection = null;
        pendingDrawingOcrCorrection = null;
        editingWorklogId = "";
        worklogProjectId = "";
        cncWorklogProjectId = "";
    }
    if (action === "add-cnc-machine") await api("/api/cnc-machines", { method: "POST", body });
    if (action === "add-manual-project") await api("/api/projects/manual", { method: "POST", body });
    if (action === "add-user") await api("/api/users", { method: "POST", body });
    if (action === "add-catalog") await api("/api/catalog", { method: "POST", body: { kind: form.dataset.kind, value: body.value } });
    if (action === "add-supplier") await api("/api/finance/suppliers", { method: "POST", body });
    if (action === "add-price-item") await api("/api/finance/price-items", { method: "POST", body });
    if (action === "add-cost-item") await api("/api/finance/cost-items", { method: "POST", body });
    if (action === "add-outsource-item") await api("/api/finance/outsource-items", { method: "POST", body });
    if (action === "add-production-item") await api("/api/finance/production-items", { method: "POST", body });
    if (action === "add-design-item") await api("/api/finance/design-items", { method: "POST", body });
    if (action === "add-quote") await api("/api/finance/quotes", { method: "POST", body });
    if (action === "add-engineering-note") await api("/api/finance/engineering-notes", { method: "POST", body });
    if (action === "save-finance-settings") {
        await api("/api/finance/settings", {
            method: "POST",
            body: {
                categories: splitLines(body.categories),
                currencies: splitLines(body.currencies),
                statuses: splitLines(body.statuses),
                quoteStatuses: splitLines(body.quoteStatuses),
                noteTypes: splitLines(body.noteTypes),
                noteStatuses: splitLines(body.noteStatuses),
                outsourceOperations: splitLines(body.outsourceOperations),
                outsourceStatuses: splitLines(body.outsourceStatuses),
                productionOperations: splitLines(body.productionOperations),
                productionWorkplaces: splitLines(body.productionWorkplaces),
                productionTypes: splitLines(body.productionTypes),
                productionPriorities: splitLines(body.productionPriorities),
                productionStatuses: splitLines(body.productionStatuses),
                costCategories: splitLines(body.costCategories),
                designAreas: splitLines(body.designAreas),
                designStatuses: splitLines(body.designStatuses)
            }
        });
    }
    if (action === "save-settings") {
        await api("/api/settings", {
            method: "POST",
            body: {
                workingDirectory: body.workingDirectory,
                scanRoots: splitLines(body.scanRoots),
                excludedPaths: splitLines(body.excludedPaths),
                scanIntervalSeconds: Number(body.scanIntervalSeconds || 10),
                localAuthRequired: Boolean(body.localAuthRequired),
                internetEnabled: Boolean(body.internetEnabled)
            }
        });
    }
    if (action === "save-whitelist") {
        await api("/api/security/whitelist", {
            method: "POST",
            body: {
                whitelist: splitLines(body.whitelist)
            }
        });
        await loadSecurityState(false);
        toastMessage("Whitelist mentve.");
        await loadState(true);
        return;
    }
    if (action === "block-ip-form") {
        if (!body.ip) throw new Error("Adj meg IP címet.");
        await api("/api/security/block-ip", {
            method: "POST",
            body: { ip: String(body.ip).trim(), reason: body.reason || "" }
        });
        form.reset();
        await loadSecurityState(false);
        toastMessage("IP tiltva.");
        await loadState(true);
        return;
    }

    form.reset();
    lastFormInteractionAt = 0;
    toastMessage(finalToastMessage, finalToastIsError);
    if (FINANCE_DATA_VIEWS.has(currentView)) await loadFinanceState(false);
    await loadState(true);
}

async function submitBom(form, body) {
    const fileInput = form.querySelector('input[name="bomFile"]');
    const file = fileInput?.files?.[0] || null;
    if (file) {
        const params = new URLSearchParams({
            projectId: body.projectId || "",
            name: body.name || file.name.replace(/\.[^.]+$/, ""),
            revision: body.revision || ""
        });
        const response = await fetch(`/api/boms/upload?${params}`, {
            method: "POST",
            headers: { "X-File-Name": encodeURIComponent(file.name), ...(authCsrfToken ? { "X-CSRF-Token": authCsrfToken } : {}) },
            body: file,
            credentials: "same-origin"
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "BOM feltöltés sikertelen.");
        return payload;
    }
    await api("/api/boms", {
        method: "POST",
        body: {
            projectId: body.projectId,
            name: body.name,
            revision: body.revision,
            filePath: body.filePath || bomLinkPath
        }
    });
}

function splitLines(value) {
    return String(value || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
}

async function attachPendingToTask(task) {
    if (!task?.projectId || !task?.id) return;
    for (const link of pendingTaskLinks) {
        await api("/api/files/link", {
            method: "POST",
            body: {
                projectId: task.projectId,
                taskId: task.id,
                path: link.path,
                name: link.name || ""
            }
        });
    }
}

async function attachPendingToCncTask(task) {
    if (!task?.projectId || !task?.id) return;
    for (const link of pendingTaskLinks) {
        await api("/api/files/link", {
            method: "POST",
            body: {
                projectId: task.projectId,
                cncTaskId: task.id,
                path: link.path,
                name: link.name || ""
            }
        });
    }
}

function pathFileName(filePath) {
    return String(filePath || "").split(/[\\/]/).filter(Boolean).pop() || "";
}

function setPendingRequestAttachmentLink(type, filePath, name = "") {
    const clean = String(filePath || "").trim();
    if (!clean) throw new Error(globalThis.ERP_DEMO_CONFIG ? "Adj meg egy fájlútvonalat a helyi documents mappából." : "Adj meg egy Y: meghajtós Office- vagy PDF-fájlútvonalat.");
    if (!globalThis.ERP_DEMO_CONFIG && !/^y:\\/i.test(clean)) throw new Error("Csak Y: meghajtós Office- vagy PDF-fájl linkelhető.");
    if (!isRequestAttachmentPath(clean)) throw new Error("Nem támogatott melléklet. Válassz Office-, OpenDocument- vagy PDF-fájlt.");
    const key = requestAttachmentStateKey(type);
    setPendingRequestAttachment(key, {
        kind: "link",
        path: clean,
        name: name || pathFileName(clean)
    });
    refreshRequestAttachmentPreview(key);
    toastMessage(globalThis.ERP_DEMO_CONFIG ? "Helyi dokumentum link kiválasztva." : "Y: dokumentum link kiválasztva.");
}

async function setRequestAttachmentFromHelper(type, endpoint) {
    const result = await callHelper(endpoint);
    const paths = Array.isArray(result.paths) ? result.paths : [];
    if (!paths.length) throw new Error("Nem lett fájl kiválasztva.");
    setPendingRequestAttachmentLink(type, paths[0], pathFileName(paths[0]));
}

function setPendingFastenerAttachmentLink(filePath, name = "") {
    setPendingRequestAttachmentLink("fastener", filePath, name);
}

async function setFastenerAttachmentFromHelper(endpoint) {
    await setRequestAttachmentFromHelper("fastener", endpoint);
}

async function handleClick(event) {
    if (!event.target.closest?.("#project-notice-root")) projectNoticeRoot?.querySelector("details")?.removeAttribute("open");
    if (!event.target.closest?.("[data-project-picker]")) {
        closeProjectPickers();
    }
    if (!event.target.closest?.("[data-option-picker]")) {
        closeOptionPickers();
    }
    const target = event.target.closest("button[data-action], a[data-action], .modal-backdrop[data-action]");
    if (!target) {
        const taskRowTarget = event.target.closest("[data-task-open]");
        if (taskRowTarget && !event.target.closest("button, a, input, select, textarea, label")) {
            taskDetailId = taskRowTarget.dataset.taskOpen || "";
            renderModal();
        }
        return;
    }
    if (target.closest("form, [data-drop]")) markFormInteraction();
    const action = target.dataset.action;

    try {
        if (action === "close-project-notices" || action === "read-project-notices") {
            const ids = action === "close-project-notices" ? projectNoticePopupIds : (data().projectNotices || []).filter((notice) => !notice.read).map((notice) => notice.id);
            await markProjectNoticesRead(ids);
            return;
        }
        if (action === "open-password-settings") {
            currentView = "stats";
            pendingSettingsPanelFocus = "password";
            render();
            return;
        }
        if (action === "restore-archive") {
            if (!hasFinanceClearance()) return;
            restoringArchiveId = target.dataset.id;
            archiveRestoreProjectId = "";
            renderModal();
            return;
        }
        if (action === "confirm-archive-restore") {
            if (!restoringArchiveId || !archiveRestoreProjectId) return;
            target.disabled = true;
            try {
                const result = await api(`/api/archive/${restoringArchiveId}/restore`, { method: "POST", body: { projectId: archiveRestoreProjectId } });
                restoringArchiveId = "";
                archiveRestoreProjectId = "";
                await loadArchiveState(false);
                await loadState(true);
                const count = Object.values(result.counts || {}).reduce((sum, value) => sum + Number(value || 0), 0);
                toastMessage(`${count} bejegyzés visszaállítva. Az eredeti dátumok megmaradtak.`);
            } finally { target.disabled = false; }
            return;
        }
        if (action === "hours-step") {
            event.preventDefault();
            stepHoursInput(target);
            return;
        }
        if (action === "reload-app") {
            window.location.reload();
            return;
        }
        if (action === "install-pwa") {
            event.preventDefault();
            await installPwa();
            return;
        }
        if (action === "enable-push") {
            event.preventDefault();
            await enablePushNotifications();
            return;
        }
        if (action === "disable-push") {
            event.preventDefault();
            await disablePushNotifications();
            return;
        }
        if (action === "test-push") {
            event.preventDefault();
            await sendTestNotification();
            return;
        }
        if (action === "project-picker-toggle") {
            const picker = target.closest("[data-project-picker]");
            openProjectPicker(picker, true);
            picker?.querySelector?.("[data-project-picker-input]")?.focus();
            return;
        }
        if (action === "project-picker-select") {
            const picker = target.closest("[data-project-picker]");
            const project = projectById(target.dataset.projectId);
            setProjectPickerValue(picker, project, true);
            return;
        }
        if (action === "option-picker-toggle") {
            const picker = target.closest("[data-option-picker]");
            openOptionPicker(picker, true);
            picker?.querySelector?.("[data-option-picker-input]")?.focus();
            return;
        }
        if (action === "option-picker-select") {
            setOptionPickerValue(target.closest("[data-option-picker]"), target.dataset.value || "", true);
            return;
        }
        if (action === "open-cad-model") {
            showCadViewer(target.dataset.id || "");
            return;
        }
        if (action === "edit-cad-model-nickname") {
            const model = (data().cadModels || []).find((item) => item.id === target.dataset.id);
            if (!model) return;
            editingCadModelNicknameId = model.id;
            renderModal();
            return;
        }
        if (action === "save-cad-model-nickname") {
            if (!editingCadModelNicknameId) return;
            const input = modalRoot.querySelector("[data-cad-nickname-input]");
            if (!input) return;
            target.disabled = true;
            try {
                await api(`/api/cadmodels/${editingCadModelNicknameId}/nickname`, { method: "PATCH", body: { nickname: input.value.trim() } });
                editingCadModelNicknameId = "";
                await loadState(true);
                toastMessage("A modell beceneve mentve.");
            } finally { target.disabled = false; }
            return;
        }
        if (action === "close-cad-viewer") {
            if (target.classList.contains("cad-viewer-backdrop") && event.target !== target) return;
            closeCadViewer();
            return;
        }
        if (action === "assign-cad-model") {
            if (!hasFinanceClearance()) return;
            const model = (data().cadModels || []).find((item) => item.id === target.dataset.id);
            if (!model) return;
            assigningCadModelId = model.id;
            cadAssignProjectId = projectById(model.projectId) ? model.projectId : "";
            renderModal();
            return;
        }
        if (action === "save-cad-assignment") {
            if (!hasFinanceClearance() || !assigningCadModelId) return;
            target.disabled = true;
            try {
                await api(`/api/cadmodels/${assigningCadModelId}`, { method: "PATCH", body: { projectId: cadAssignProjectId } });
                assigningCadModelId = "";
                cadAssignProjectId = "";
                await loadState(true);
                toastMessage("A modell projekt-hozzárendelése mentve.");
            } finally { target.disabled = false; }
            return;
        }
        if (action === "trash-cad-model") {
            if (!hasFinanceClearance()) return;
            const model = (data().cadModels || []).find((item) => item.id === target.dataset.id);
            if (!model || !window.confirm(`Eltávolítjuk a modellt a listából? Az elérhető GLB és JSON fájlokat a ${globalThis.ERP_DEMO_CONFIG ? "helyi .demo-data/trash" : "Y:\\trash"} mappába mozgatjuk; a már hiányzó fájlok nem okoznak hibát.\n\n${model.sourceName || model.glbFile}`)) return;
            target.disabled = true;
            try {
                const result = await api(`/api/cadmodels/${model.id}`, { method: "DELETE" });
                if (openCadViewerId === model.id) closeCadViewer();
                await loadState(true);
                const moved = result.movedFiles?.length || 0;
                toastMessage(moved
                  ? `${moved} modellfájl a ${globalThis.ERP_DEMO_CONFIG ? "helyi .demo-data/trash" : "Y:\\trash"} mappába került; ${2 - moved} már hiányzott. A sor eltűnt a listából.`
                  : "A GLB és JSON már hiányzott; a sor eltűnt a listából." +
                    (result.cachedFiles?.length ? ` A gyorsítótár a ${globalThis.ERP_DEMO_CONFIG ? "helyi .demo-data/trash" : "Y:\\trash"} mappába került.` : ""));
            } finally { target.disabled = false; }
            return;
        }
        if (action === "view") {
            currentView = target.dataset.view;
            if (LEVEL2_VIEWS.has(currentView) && !hasFinanceClearance()) {
                financeState = null;
                toastMessage("Nincs jogosultság ehhez a menühöz.", true);
            }
            responsibleFlyoutProjectId = null;
            deadlineFlyoutProjectId = null;
            priorityFlyoutProjectId = null;
            maybeRefreshSecurity();
            maybeRefreshHostStatus();
            render();
            return;
        }
        if (action === "personal-tasks") {
            if (!currentUser?.id) {
                toastMessage("Előbb jelentkezz be.", true);
                return;
            }
            personalTasksOpen = true;
            renderModal();
            return;
        }
        if (action === "open-worklog-fullscreen") {
            worklogListFullscreen = true;
            renderModal();
            return;
        }
        if (action === "open-personal-task-view") {
            currentView = target.dataset.view || "todos";
            personalTasksOpen = false;
            if (currentView === "todos") taskUserFilter = currentUser?.id || "";
            modalRoot.innerHTML = "";
            render();
            return;
        }
        if (action === "open-project") {
            modalProjectId = target.dataset.id;
            renderModal();
            return;
        }
        if (action === "open-demo-project-browser" && globalThis.ERP_DEMO_CONFIG) {
            modalProjectId = null;
            await openProjectBrowser(target.dataset.id);
            return;
        }
        if (action === "project-browser-refresh") {
            await openProjectBrowser(projectBrowser.projectId);
            return;
        }
        if (action === "close-modal" || action === "close-modal-backdrop") {
            if (action === "close-modal-backdrop" && !event.target.classList.contains("modal-backdrop")) return;
            restoringArchiveId = "";
            archiveRestoreProjectId = "";
            assigningCadModelId = "";
            cadAssignProjectId = "";
            editingCadModelNicknameId = "";
            modalProjectId = null;
            projectBrowser.open = false;
            taskDetailId = "";
            personalTasksOpen = false;
            dashboardImageTodoId = "";
            cncImageView = { taskId: "", index: 0 };
            taskImageView = { taskId: "", index: 0 };
            materialImageView = { requestId: "", index: 0 };
            linkBrowser.open = false;
            worklogListFullscreen = false;
            resetDrawingOcr();
            resetMobilePhotoCapture();
            renderModal();
            return;
        }
        if (action === "close-login-warning") {
            if (target.classList.contains("modal-backdrop") && event.target !== target) return;
            modalRoot.innerHTML = "";
            return;
        }
        if (action === "open-dashboard-image") {
            dashboardImageTodoId = target.dataset.id || "";
            renderModal();
            return;
        }
        if (action === "open-cnc-image") {
            cncImageView = { taskId: target.dataset.taskId || "", index: Number(target.dataset.index) || 0 };
            renderModal();
            return;
        }
        if (action === "open-task-image") {
            taskImageView = { taskId: target.dataset.taskId || "", index: Number(target.dataset.index) || 0 };
            renderModal();
            return;
        }
        if (action === "open-material-image") {
            materialImageView = { requestId: target.dataset.requestId || "", index: Number(target.dataset.index) || 0 };
            renderModal();
            return;
        }
        if (action === "cnc-image-prev") {
            cncImageView.index = Math.max(0, (Number(cncImageView.index) || 0) - 1);
            renderModal();
            return;
        }
        if (action === "cnc-image-next") {
            cncImageView.index = (Number(cncImageView.index) || 0) + 1;
            renderModal();
            return;
        }
        if (action === "task-image-prev") {
            taskImageView.index = Math.max(0, (Number(taskImageView.index) || 0) - 1);
            renderModal();
            return;
        }
        if (action === "task-image-next") {
            taskImageView.index = (Number(taskImageView.index) || 0) + 1;
            renderModal();
            return;
        }
        if (action === "material-image-prev") {
            materialImageView.index = Math.max(0, (Number(materialImageView.index) || 0) - 1);
            renderModal();
            return;
        }
        if (action === "material-image-next") {
            materialImageView.index = (Number(materialImageView.index) || 0) + 1;
            renderModal();
            return;
        }
        if (action === "remove-pending-cnc-image") {
            pendingCncTaskImages.splice(Number(target.dataset.index), 1);
            refreshPendingCncTaskImages();
            return;
        }
        if (action === "remove-modelling-photo") {
            const folderInput = document.querySelector('form[data-action="upload-modelling-photos"] input[name="folder"]');
            if (folderInput) modellingFolderName = folderInput.value;
            modellingPhotos.splice(Number(target.dataset.index), 1);
            render();
            return;
        }
        if (action === "open-demo-modelling" && globalThis.ERP_DEMO_CONFIG) {
            demoModellingMode = true;
            modellingFolders = null;
            render();
            return;
        }
        if (action === "exit-demo-modelling" && globalThis.ERP_DEMO_CONFIG && !modellingUploadBusy) {
            demoModellingMode = false;
            currentView = "stats";
            render();
            return;
        }
        if (action === "remove-pending-task-image") {
            pendingTaskImages.splice(Number(target.dataset.index), 1);
            refreshPendingTaskImages();
            return;
        }
        if (action === "remove-pending-material-prefab-image") {
            pendingMaterialPrefabImages.splice(Number(target.dataset.index), 1);
            refreshPendingMaterialPrefabImages();
            return;
        }
        if (action === "choose-cnc-file") {
            await openLinkBrowser("", "cnc-worklog");
            return;
        }
        if (action === "helper-pick-cnc-file") {
            await setCncWorklogFileFromHelper("/pick-file", target);
            return;
        }
        if (action === "helper-drop-cnc-file") {
            await setCncWorklogFileFromHelper("/drop-file", target);
            return;
        }
        if (action === "clear-dashboard-image") {
            pendingDashboardTodoImage = null;
            refreshDashboardTodoImagePreview();
            return;
        }
        if (action === "choose-link") {
            await openLinkBrowser("", "task");
            return;
        }
        if (action === "choose-bom-link") {
            await openLinkBrowser("", "bom");
            return;
        }
        if (action === "choose-request-attachment-link") {
            await openLinkBrowser(globalThis.ERP_DEMO_CONFIG ? "" : "Y:\\", `${requestAttachmentStateKey(target.dataset.target)}-attachment`);
            return;
        }
        if (action === "apply-request-attachment-path") {
            const key = requestAttachmentStateKey(target.dataset.target);
            const input = document.getElementById(`${key}-attachment-path`);
            setPendingRequestAttachmentLink(key, input?.value || "", pathFileName(input?.value || ""));
            markFormInteraction();
            return;
        }
        if (action === "choose-fastener-attachment-link") {
            await openLinkBrowser(globalThis.ERP_DEMO_CONFIG ? "" : "Y:\\", "fastener-attachment");
            return;
        }
        if (action === "helper-pick-link") {
            await addPendingTaskLinksFromHelper("/pick-file");
            return;
        }
        if (action === "helper-drop-link") {
            await addPendingTaskLinksFromHelper("/drop-file");
            return;
        }
        if (action === "helper-pick-bom-link") {
            await setBomLinkFromHelper("/pick-file");
            return;
        }
        if (action === "helper-drop-bom-link") {
            await setBomLinkFromHelper("/drop-file");
            return;
        }
        if (action === "helper-pick-request-attachment") {
            await setRequestAttachmentFromHelper(target.dataset.target, "/pick-file");
            return;
        }
        if (action === "helper-drop-request-attachment") {
            await setRequestAttachmentFromHelper(target.dataset.target, "/drop-file");
            return;
        }
        if (action === "helper-pick-fastener-attachment") {
            await setFastenerAttachmentFromHelper("/pick-file");
            return;
        }
        if (action === "helper-drop-fastener-attachment") {
            await setFastenerAttachmentFromHelper("/drop-file");
            return;
        }
        if (action === "open-mobile-photo") {
            openMobilePhotoCapture(target.dataset.target || "task");
            return;
        }
        if (action === "capture-mobile-photo") {
            await captureMobilePhoto();
            return;
        }
        if (action === "cancel-mobile-photo") {
            if (target.classList.contains("modal-backdrop") && event.target !== target) return;
            resetMobilePhotoCapture();
            renderModal();
            return;
        }
        if (action === "open-drawing-ocr") {
            drawingOcr.open = true;
            drawingOcr.phase = "camera";
            drawingOcr.step = "project";
            drawingOcr.image = null;
            drawingOcr.crop = null;
            pendingDrawingOcrCorrection = null;
            pendingProjectOcrCorrection = null;
            renderModal();
            return;
        }
        if (action === "material-prefab-direction") {
            const form = target.closest("form");
            const input = form?.querySelector('input[name="prefabDirection"]');
            if (input) {
                input.value = materialPrefabDirection(input.value) === "elhozni" ? "elvinni" : "elhozni";
                syncMaterialPrefabMode(form);
                markFormInteraction();
            }
            return;
        }
        if (action === "capture-drawing-ocr") {
            await captureDrawingOcrPhoto();
            return;
        }
        if (action === "skip-project-ocr") {
            continueDrawingOcrScan();
            return;
        }
        if (action === "retake-drawing-ocr") {
            drawingOcr.phase = "camera";
            drawingOcr.image = null;
            drawingOcr.crop = null;
            renderModal();
            return;
        }
        if (action === "recognize-drawing-ocr") {
            await recognizeDrawingOcrCrop();
            return;
        }
        if (action === "clear-request-attachment") {
            const key = requestAttachmentStateKey(target.dataset.target);
            setPendingRequestAttachment(key, null);
            refreshRequestAttachmentPreview(key);
            return;
        }
        if (action === "copy-request-attachment-path") {
            await copyText(target.dataset.path || "");
            toastMessage("Útvonal másolva.");
            return;
        }
        if (action === "clear-fastener-attachment") {
            pendingFastenerAttachment = null;
            refreshFastenerAttachmentPreview();
            return;
        }
        if (action === "pick-bom-upload") {
            markFormInteraction();
            document.getElementById("bom-upload-file")?.click();
            return;
        }
        if (action === "clear-bom-link") {
            setBomLink("", "");
            return;
        }
        if (action === "delete-dashboard-todo") await api(`/api/dashboard/todos/${target.dataset.id}`, { method: "DELETE" });
        if (action === "delete-meeting") await api(`/api/meetings/${target.dataset.id}`, { method: "DELETE" });
        if (action === "delete-dayoff") await api(`/api/dayoffs/${target.dataset.id}`, { method: "DELETE" });
        if (action === "delete-bom") await api(`/api/boms/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-cnc") {
            editingCncTaskId = target.dataset.id;
            render();
            return;
        }
        if (action === "open-cnc-report") {
            reportingCncTaskId = target.dataset.id;
            if (target.matches('input[type="checkbox"]')) target.checked = false;
            renderModal();
            return;
        }
        if (action === "cancel-cnc-report") {
            if (target.classList.contains("modal-backdrop") && event.target !== target) return;
            reportingCncTaskId = "";
            renderModal();
            return;
        }
        if (action === "cancel-cnc-edit") {
            editingCncTaskId = "";
            render();
            return;
        }
        if (action === "insert-diameter") {
            const form = target.closest("form");
            const targetName = target.dataset.target || "size";
            const input = form?.querySelector(`input[name="${targetName}"], textarea[name="${targetName}"]`);
            if (input) {
                const start = input.selectionStart ?? input.value.length;
                const end = input.selectionEnd ?? input.value.length;
                input.value = `${input.value.slice(0, start)}Ø${input.value.slice(end)}`;
                input.focus();
                const pos = start + 1;
                if (typeof input.setSelectionRange === "function") {
                    input.setSelectionRange(pos, pos);
                }
                markFormInteraction();
            }
            return;
        }
        if (action === "edit-task") {
            editingTaskId = target.dataset.id;
            render();
            return;
        }
        if (action === "cancel-edit-task") {
            editingTaskId = "";
            render();
            return;
        }
        if (action === "repeat-request") {
            if (requestRepeatLoading) return;
            const type = target.dataset.target;
            const collection = { tool: "toolRequests", material: "materialRequests", fastener: "fastenerRequests" }[type];
            const item = (data()[collection] || []).find((entry) => entry.id === target.dataset.id);
            if (!item) throw new Error("Nincs ilyen igény.");
            requestRepeatLoading = true;
            target.disabled = true;
            try {
                await loadRequestIntoNewForm(type, structuredClone(item));
                toastMessage("Betöltve új bejegyzésként. Az eredeti változatlan.");
            } finally {
                requestRepeatLoading = false;
                target.disabled = false;
            }
            return;
        }
        if (action === "edit-tool") {
            editingToolRequestId = target.dataset.id;
            render();
            return;
        }
        if (action === "cancel-edit-tool") {
            editingToolRequestId = "";
            render();
            return;
        }
        if (action === "edit-material") {
            editingMaterialRequestId = target.dataset.id;
            render();
            return;
        }
        if (action === "cancel-edit-material") {
            editingMaterialRequestId = "";
            render();
            return;
        }
        if (action === "edit-fastener") {
            editingFastenerRequestId = target.dataset.id;
            render();
            return;
        }
        if (action === "cancel-edit-fastener") {
            editingFastenerRequestId = "";
            render();
            return;
        }
        if (action === "edit-worklog") {
            const log = (data().workLogs || []).find((item) => item.id === target.dataset.id);
            if (!log) {
                toastMessage("Nincs ilyen naplózás.", true);
                return;
            }
            if (worklogListFullscreen) {
                worklogListFullscreen = false;
                renderModal();
            }
            loadWorklogIntoForm(log);
            return;
        }
        if (action === "resubmit-worklog") {
            const log = (data().workLogs || []).find((item) => item.id === target.dataset.id);
            if (!log) {
                toastMessage("Nincs ilyen naplózás.", true);
                return;
            }
            if (worklogListFullscreen) {
                worklogListFullscreen = false;
                renderModal();
            }
            loadWorklogIntoForm(log, { createNew: true });
            toastMessage("Betöltve új bejegyzésként.");
            return;
        }
        if (action === "cancel-edit-worklog") {
            editingWorklogId = "";
            resetWorklogEditForms();
            render();
            return;
        }
        if (action === "delete-task" || action === "delete-cnc-task" || action === "delete-tool" || action === "delete-material" || action === "delete-fastener" || action === "delete-worklog") {
            const label = target.dataset.label || "ezt a tételt";
            if (!window.confirm(`Tényleg törlöd?\n\n${label}\n\nA művelet nem visszavonható.`)) return;
            const endpoint = {
                "delete-task": "/api/tasks",
                "delete-cnc-task": "/api/cnc-tasks",
                "delete-tool": "/api/tool-requests",
                "delete-material": "/api/material-requests",
                "delete-fastener": "/api/fastener-requests",
                "delete-worklog": "/api/worklogs"
            }[action];
            await api(`${endpoint}/${target.dataset.id}`, { method: "DELETE" });
            toastMessage("Törölve.");
            await loadState(true);
            return;
        }
        if (action === "edit-cnc-machine") await editCncMachine(target.dataset.id);
        if (action === "delete-cnc-machine") await api(`/api/cnc-machines/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-supplier") await editSupplier(target.dataset.id);
        if (action === "delete-supplier") await api(`/api/finance/suppliers/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-price-item") await editPriceItem(target.dataset.id);
        if (action === "delete-price-item") await api(`/api/finance/price-items/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-cost-item") await editCostItem(target.dataset.id);
        if (action === "delete-cost-item") await api(`/api/finance/cost-items/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-outsource-item") await editOutsourceItem(target.dataset.id);
        if (action === "delete-outsource-item") await api(`/api/finance/outsource-items/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-production-item") await editProductionItem(target.dataset.id);
        if (action === "delete-production-item") await api(`/api/finance/production-items/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-design-item") await editDesignItem(target.dataset.id);
        if (action === "issue-design-item") await api(`/api/finance/design-items/${target.dataset.id}`, { method: "PATCH", body: { status: "Kiadva", percent: 100 } });
        if (action === "delete-design-item") await api(`/api/finance/design-items/${target.dataset.id}`, { method: "DELETE" });
        if (action === "quote-status") await editQuoteStatus(target.dataset.id);
        if (action === "delete-quote") await api(`/api/finance/quotes/${target.dataset.id}`, { method: "DELETE" });
        if (action === "close-engineering-note") await api(`/api/finance/engineering-notes/${target.dataset.id}`, { method: "PATCH", body: { status: "Lezárva" } });
        if (action === "delete-engineering-note") await api(`/api/finance/engineering-notes/${target.dataset.id}`, { method: "DELETE" });
        if (action === "complete-project") await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { completed: true } });
        if (action === "delete-project") {
            const sourceText = globalThis.ERP_DEMO_CONFIG
                ? "A projekt az ERP helyi archívumába kerül. A demó dokumentumfájljai megmaradnak."
                : target.dataset.source === "manual"
                ? "Kézi projekt. Az ERP adatai archiválódnak."
                : "Mappából olvasott projekt. A Y: projektmappa NEM törlődik, az ERP adatai archiválódnak, és a projekt ki lesz hagyva a későbbi mappaszkennelésből.";
            const ok = window.confirm(`Biztosan archiválod ezt a projektet az ERP-ből?\n\n${target.dataset.name || ""}\n\n${sourceText}`);
            if (!ok) return;
            await api(`/api/projects/${target.dataset.id}`, { method: "DELETE" });
            toastMessage("Projekt archiválva.");
            await loadState(true);
            return;
        }
        if (action === "purge-archive") {
            const ok = window.confirm(`Véglegesen törlöd ezt az archív ERP adatot?\n\n${target.dataset.label || ""}\n\nA Y: projektmappákhoz nem nyúl a rendszer, de ERP-feltöltések törlődhetnek.`);
            if (!ok) return;
            await api(`/api/archive/${target.dataset.id}`, { method: "DELETE" });
            selectedArchiveIds.delete(target.dataset.id);
            await loadArchiveState(false);
            toastMessage("Archív tétel véglegesen törölve.");
            render();
            return;
        }
        if (action === "purge-selected-archives") {
            const ids = [...selectedArchiveIds];
            if (!ids.length) return;
            const ok = window.confirm(`${ids.length} archív ERP tételt véglegesen törölsz?\n\nA Y: projektmappákhoz nem nyúl a rendszer, de ERP-feltöltések törlődhetnek.`);
            if (!ok) return;
            await api("/api/archive", { method: "DELETE", body: { ids } });
            selectedArchiveIds.clear();
            await loadArchiveState(false);
            toastMessage("Kijelölt archív tételek véglegesen törölve.");
            render();
            return;
        }
        if (action === "refresh-host-status") {
            await loadHostStatus(false);
            if (!replaceHostStatusPanel()) render();
            return;
        }
        if (action === "restart-host-server") {
            const current = hostStatus?.currentHost;
            const currentText = current?.hostname ? hostLabelWithNickname(current.hostname, current.nickname) : "az aktuális host";
            const standbyCount = (hostStatus?.watchdogs || []).filter((item) => item.ready && item.role !== "legacy" && !item.isCurrentHost).length;
            if (!window.confirm(`Újraindítod az aktuális ERP szervert?\n\nHost: ${currentText}\nStandby watchdog restart parancs: ${standbyCount} PC\n\nPár másodpercig megszakadhat a kapcsolat.`)) return;
            const result = await api("/api/host-restart", { method: "POST" });
            hostStatus = result.status || hostStatus;
            toastMessage(`Szerver restart elküldve. Standby watchdog: ${(result.standbyWatchdogRestarts || []).length} PC.`);
            render();
            return;
        }
        if (action === "save-host-nickname") {
            const host = target.dataset.host || "";
            if (!host) return;
            const editor = target.closest(".host-nickname-editor");
            const input = editor?.querySelector('input[data-action="host-nickname-input"]');
            const nickname = input ? input.value : "";
            const result = await api("/api/host-nicknames", { method: "POST", body: { hostname: host, nickname } });
            hostStatus = result.status || await api("/api/host-status");
            toastMessage(nickname.trim() ? "Becenév mentve." : "Becenév törölve.");
            render();
            return;
        }
        if (action === "remove-host") {
            const host = target.dataset.host || "";
            if (!host) return;
            const item = (hostStatus?.watchdogs || []).find(item => item.hostname === host);
            if (!window.confirm(`Eltávolítod ezt a PC-t a host listából?\n\n${hostLabelWithNickname(host, item?.nickname)}\n\nNem törlünk projektadatot. A PC rejtve és letiltva marad, amíg azon az aktuális install-startup.bat sikeresen újra nem fut.`)) return;
            const result = await api("/api/host-remove", {method:"POST",body:{hostname:host}});
            hostStatus = result.status;
            if (!replaceHostStatusPanel()) render();
            toastMessage("PC eltávolítva. Visszatéréshez újra kell futtatni az install-startup.bat-ot.");
            return;
        }
        if (action === "switch-host") {
            const host = target.dataset.host || "";
            if (!host) return;
            if (!window.confirm(`Átváltson erre a host PC-re?\n\n${host}\n\nA régi host automatikusan leáll, amikor az új host átvette a lockot.`)) return;
            await api("/api/host-switch", { method: "POST", body: { hostname: host } });
            await loadHostStatus(false);
            toastMessage("Host váltási kérés elküldve.");
            render();
            return;
        }
        if (action === "scan-now") await api("/api/scan", { method: "POST" });
        if (action === "edit-user") await editUser(target.dataset.id);
        if (action === "reset-user-password") await resetUserPassword(target.dataset.id);
        if (action === "delete-user") await api(`/api/users/${target.dataset.id}`, { method: "DELETE" });
        if (action === "edit-catalog") await editCatalog(target.dataset.kind, target.dataset.value);
        if (action === "delete-catalog") await api(`/api/catalog?kind=${encodeURIComponent(target.dataset.kind)}&value=${encodeURIComponent(target.dataset.value)}`, { method: "DELETE" });
        if (action === "copy-path") {
            await copyText(target.dataset.path || "");
            toastMessage("Útvonal másolva.");
            return;
        }
        if (action === "open-file" || action === "open-project-folder") {
            await openLocalPath(target.dataset.path || "", target.dataset.id || "");
            return;
        }
        if (action === "reveal-file" || action === "reveal-project-folder") {
            await revealLocalPath(target.dataset.path || "");
            return;
        }
        if (action === "delete-file") await api(`/api/files/${target.dataset.id}`, { method: "DELETE" });
        if (action === "remove-pending-link") {
            pendingTaskLinks.splice(Number(target.dataset.index), 1);
            refreshPendingAttachments();
            return;
        }
        if (action === "browse-link-root") {
            await openLinkBrowser("", linkBrowser.target || "task");
            return;
        }
        if (action === "browse-link-folder") {
            await openLinkBrowser(target.dataset.path || "", linkBrowser.target || "task");
            return;
        }
        if (action === "browse-link-entered-path") {
            const input = document.getElementById("link-browser-path-input");
            const enteredPath = String(input?.value || "").trim();
            if (!enteredPath) throw new Error("Adj meg egy mappaútvonalat.");
            await openLinkBrowser(enteredPath, linkBrowser.target || "task");
            return;
        }
        if (action === "select-link-entered-path") {
            const input = document.getElementById("link-browser-path-input");
            const enteredPath = String(input?.value || "").trim();
            setPendingRequestAttachmentLink(target.dataset.target, enteredPath, pathFileName(enteredPath));
            linkBrowser.open = false;
            renderModal();
            return;
        }
        if (action === "copy-link-entered-path") {
            const input = document.getElementById("link-browser-path-input");
            await copyText(input?.value || "");
            toastMessage("Útvonal másolva.");
            return;
        }
        if (action === "select-link-file") {
            if (linkBrowser.target === "bom") {
                setBomLink(target.dataset.path, target.dataset.name);
            } else if (linkBrowser.target === "cnc-worklog") {
                const picked = target.dataset.path || "";
                if (!globalThis.ERP_DEMO_CONFIG && !/^y:\\/i.test(picked)) {
                    toastMessage("Csak Y: meghajtós fájl engedélyezett.", true);
                } else {
                    const input = activeCncWorklogForm()?.querySelector('input[name="filePath"]');
                    if (input) {
                        input.value = picked;
                        markFormInteraction();
                        toastMessage("Fájl link kiválasztva.");
                    }
                }
            } else if (String(linkBrowser.target || "").endsWith("-attachment")) {
                setPendingRequestAttachmentLink(String(linkBrowser.target).replace(/-attachment$/, ""), target.dataset.path, target.dataset.name);
            } else {
                addPendingTaskLink(target.dataset.path, target.dataset.name);
            }
            linkBrowser.open = false;
            renderModal();
            return;
        }
        if (action === "open-responsibles") {
            responsibleFlyoutProjectId = responsibleFlyoutProjectId === target.dataset.id ? null : target.dataset.id;
            deadlineFlyoutProjectId = null;
            priorityFlyoutProjectId = null;
            render();
            return;
        }
        if (action === "open-deadline") {
            deadlineFlyoutProjectId = deadlineFlyoutProjectId === target.dataset.id ? null : target.dataset.id;
            responsibleFlyoutProjectId = null;
            priorityFlyoutProjectId = null;
            render();
            return;
        }
        if (action === "open-priority") {
            priorityFlyoutProjectId = priorityFlyoutProjectId === target.dataset.id ? null : target.dataset.id;
            responsibleFlyoutProjectId = null;
            deadlineFlyoutProjectId = null;
            render();
            return;
        }
        if (action === "set-priority") {
            await setProjectPriorityFromButton(target.dataset.id, Number(target.dataset.priority));
            priorityFlyoutProjectId = null;
        }
        if (action === "clear-priority") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { priority: "" } });
            priorityFlyoutProjectId = null;
        }
        if (action === "clear-deadline") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { deadline: "" } });
            deadlineFlyoutProjectId = null;
        }
        if (action === "kick-session") {
            await api("/api/security/disconnect-session", {
                method: "POST",
                body: { token: target.dataset.token || "" }
            });
            await loadSecurityState(false);
            toastMessage("Munkamenet kidobva.");
            await loadState(true);
            return;
        }
        if (action === "block-ip") {
            const ip = target.dataset.ip || "";
            if (!ip) return;
            if (!window.confirm(`Tényleg letiltod ezt az IP-t?\n\n${ip}\n\nA jelenlegi munkamenetei lezárulnak.`)) return;
            await api("/api/security/block-ip", {
                method: "POST",
                body: { ip, reason: "Blokkolva a biztonsági panelből" }
            });
            await loadSecurityState(false);
            toastMessage("IP tiltva.");
            await loadState(true);
            return;
        }
        if (action === "unblock-ip") {
            await api("/api/security/unblock-ip", {
                method: "POST",
                body: { ip: target.dataset.ip || "" }
            });
            await loadSecurityState(false);
            toastMessage("IP feloldva.");
            await loadState(true);
            return;
        }
        toastMessage("Mentve.");
        if (FINANCE_DATA_VIEWS.has(currentView)) await loadFinanceState(false);
        await loadState(true);
    } catch (error) {
        toastMessage(error.message, true);
    }
}

async function setProjectPriorityFromButton(projectId, priority) {
    const conflict = projects(false).find((project) => project.id !== projectId && Number(project.priority) === priority);
    const body = { priority };
    if (conflict) {
        const ok = window.confirm(`A(z) ${priority}. prioritás már foglalt: ${conflict.name}\n\nÁtadod ezt a prioritást és átrendezed a többit?`);
        if (!ok) return;
        body.reorderPriority = true;
    }
    await api(`/api/projects/${projectId}`, { method: "PATCH", body });
}

async function openLinkBrowser(folderPath, target = "task") {
    modalProjectId = null;
    linkBrowser = { open: true, target, current: folderPath || "", parent: null, entries: [], loading: true, error: "" };
    renderModal();
    try {
        const attachmentFilter = String(target || "").endsWith("-attachment") ? "&filter=office" : "";
        const result = await api(`/api/files/browse?path=${encodeURIComponent(folderPath || "")}${attachmentFilter}`);
        linkBrowser = {
            open: true,
            target,
            current: result.current || "",
            parent: result.parent || null,
            entries: result.entries || [],
            loading: false,
            error: ""
        };
    } catch (error) {
        linkBrowser = { open: true, target, current: folderPath || "", parent: null, entries: [], loading: false, error: error.message };
    }
    renderModal();
}

async function openProjectBrowser(projectId) {
    if (!projectId) return;
    projectBrowserProjectId = projectId;
    projectBrowser = { open: true, projectId, loading: true, error: "", files: [], roots: [], missingRoots: [], truncated: false, scannedAt: "" };
    renderModal();
    try {
        const result = await api(`/api/projects/${encodeURIComponent(projectId)}/browser`);
        projectBrowser = {
            open: true,
            projectId,
            loading: false,
            error: "",
            files: result.files || [],
            roots: result.roots || [],
            missingRoots: result.missingRoots || [],
            truncated: Boolean(result.truncated),
            scannedAt: result.scannedAt || ""
        };
    } catch (error) {
        projectBrowser = { open: true, projectId, loading: false, error: error.message, files: [], roots: [], missingRoots: [], truncated: false, scannedAt: "" };
    }
    renderModal();
}

function addPendingTaskLink(filePath, name = "") {
    if (!filePath) return;
    if (!pendingTaskLinks.some((item) => item.path.toLocaleLowerCase("hu-HU") === filePath.toLocaleLowerCase("hu-HU"))) {
        pendingTaskLinks.push({ path: filePath, name });
    }
    refreshPendingAttachments();
    toastMessage("Link hozzáadva a munkafolyamathoz.");
}

function helperBaseUrl() {
    if (globalThis.ERP_DEMO_CONFIG) {
        throw new Error("A helyi demó nem kapcsolódik a telepített Helperhez. Használd a demó documents mappáját és a Szerver tallózást.");
    }
    return String(state?.config?.helperUrl || "http://127.0.0.1:4799").replace(/\/+$/, "") + "/";
}

function helperDelay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHelperPayload(endpoint, params = {}, options = {}) {
    const cleanEndpoint = String(endpoint || "").replace(/^\/+/, "");
    const url = new URL(cleanEndpoint, helperBaseUrl());
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    let response;
    try {
        response = await fetch(url.toString(), {
            method: "GET",
            mode: "cors",
            cache: "no-store",
            targetAddressSpace: "local"
        });
    } catch {
        const isChromium = /(?:Chrome|Chromium|Edg)\//.test(navigator.userAgent);
        if (options.promptForPermission && isChromium) {
            const retry = window.confirm(
                "A Chrome nem érte el a helyi Helpert. Ha a böngésző engedélyt kér a helyi hálózathoz, válaszd az Engedélyezés gombot.\n\n" +
                "Ha korábban letiltottad: a címsor bal oldalán nyisd meg a webhely beállításait, majd állítsd a Helyi hálózati hozzáférés / Helyi hálózati eszközök jogosultságot Engedélyezésre. PWA-ban az alkalmazás webhelyengedélyeinél keresd ugyanezt.\n\n" +
                "A beállítás után kattints az OK gombra az azonnali újrapróbáláshoz."
            );
            if (retry) return fetchHelperPayload(endpoint, params, { promptForPermission: false });
        }
        const chromiumHint = isChromium
            ? " A címsor melletti webhelybeállításokban engedélyezd a Helyi hálózati hozzáférés / Helyi hálózati eszközök jogosultságot, majd próbáld újra."
            : "";
        throw new Error(`A helyi helper nem érhető el. Ellenőrizd, hogy fut-e ezen a PC-n.${chromiumHint}`);
    }
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload?.error || payload || "Helper hiba.");
    return payload;
}

async function waitForHelperJob(jobId) {
    const started = Date.now();
    toastMessage("Helper ablak megnyitva.");
    while (Date.now() - started < 15 * 60 * 1000) {
        await helperDelay(700);
        const result = await fetchHelperPayload("/result", { id: jobId });
        if (result?.pending) continue;
        if (result?.error) throw new Error(result.error);
        return result;
    }
    throw new Error("A helper ablak idotullepes miatt nem adott vissza eredmenyt.");
}

async function callHelper(endpoint, params = {}) {
    const payload = await fetchHelperPayload(endpoint, params, { promptForPermission: true });
    if (payload?.pending && payload?.jobId) {
        return waitForHelperJob(payload.jobId);
    }
    if (payload?.error) throw new Error(payload.error);
    return payload;
}

async function addPendingTaskLinksFromHelper(endpoint) {
    const result = await callHelper(endpoint);
    const paths = Array.isArray(result.paths) ? result.paths : [];
    if (!paths.length) throw new Error("Nem lett fájl kiválasztva.");
    for (const filePath of paths) addPendingTaskLink(filePath);
}

function setBomLink(filePath, name = "") {
    markFormInteraction();
    bomLinkPath = filePath || "";
    bomLinkName = name || (filePath ? filePath.split(/[\\/]/).pop() : "");
    refreshBomLinkUI();
}

async function setBomLinkFromHelper(endpoint) {
    const result = await callHelper(endpoint);
    const paths = Array.isArray(result.paths) ? result.paths : [];
    if (!paths.length) throw new Error("Nem lett fájl kiválasztva.");
    setBomLink(paths[0], paths[0].split(/[\\/]/).pop());
    toastMessage("BOM link kiválasztva.");
}

async function setCncWorklogFileFromHelper(endpoint, sourceButton = null) {
    const result = await callHelper(endpoint);
    const paths = Array.isArray(result.paths) ? result.paths : [];
    if (!paths.length) throw new Error("Nem lett fájl kiválasztva.");
    const picked = paths[0];
    if (!/^y:\\/i.test(picked)) {
        throw new Error("Csak Y: meghajtós fájl engedélyezett.");
    }
    const form = sourceButton ? sourceButton.closest("form") : activeCncWorklogForm();
    const input = form?.querySelector('input[name="filePath"]');
    if (input) {
        input.value = picked;
        markFormInteraction();
    }
    toastMessage("Fájl link kiválasztva.");
}

async function openLocalPath(filePath, fileId = "") {
    if (!filePath) return;
    try {
        await callHelper("/open", { path: filePath });
        toastMessage("Megnyitva.");
    } catch (error) {
        if (fileId) {
            window.open(`/api/files/${encodeURIComponent(fileId)}/download`, "_blank", "noopener");
            toastMessage("A helper nem elérhető, letöltés indul.");
            return;
        }
        throw error;
    }
}

async function revealLocalPath(filePath) {
    if (!filePath) return;
    await callHelper("/reveal", { path: filePath });
    toastMessage("Mappa megnyitva.");
}

async function copyText(text) {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.left = "-9999px";
    document.body.appendChild(area);
    area.select();
    try {
        document.execCommand("copy");
    } finally {
        area.remove();
    }
}

async function editUser(userId) {
    const user = users().find((item) => item.id === userId);
    if (!user) return;
    const name = window.prompt("Felhasználó neve", user.name);
    if (!name) return;
    await api(`/api/users/${userId}`, { method: "PATCH", body: { name, clearanceLevel: user.clearanceLevel || 1 } });
}

async function resetUserPassword(userId) {
    const user = users().find((item) => item.id === userId);
    if (!user) return;
    const password = window.prompt(`${user.name} új jelszava`, "");
    if (!password) return;
    await api(`/api/users/${userId}`, { method: "PATCH", body: { name: user.name, clearanceLevel: user.clearanceLevel || 1, password } });
}

async function editCncMachine(machineId) {
    const machine = (data().cncMachines || []).find((item) => item.id === machineId);
    if (!machine) return;
    const name = window.prompt("CNC gép neve", machine.name);
    if (!name) return;
    await api(`/api/cnc-machines/${machineId}`, { method: "PATCH", body: { name } });
}

async function editCatalog(kind, oldValue) {
    const value = window.prompt("Új érték", oldValue);
    if (!value) return;
    await api("/api/catalog", { method: "PATCH", body: { kind, oldValue, value } });
}

async function editSupplier(supplierId) {
    const supplier = (financeData().suppliers || []).find((item) => item.id === supplierId);
    if (!supplier) return;
    const name = window.prompt("Beszállító neve", supplier.name);
    if (!name) return;
    const contact = window.prompt("Kapcsolattartó", supplier.contact || "") ?? supplier.contact;
    const email = window.prompt("Email", supplier.email || "") ?? supplier.email;
    const phone = window.prompt("Telefon", supplier.phone || "") ?? supplier.phone;
    const note = window.prompt("Megjegyzés", supplier.note || "") ?? supplier.note;
    await api(`/api/finance/suppliers/${supplierId}`, { method: "PATCH", body: { name, contact, email, phone, note } });
}

async function editPriceItem(itemId) {
    const item = (financeData().priceItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const name = window.prompt("Megnevezés", item.name || "");
    if (!name) return;
    const quantity = window.prompt("Mennyiség", item.quantity ?? 1);
    if (quantity === null) return;
    const unitPrice = window.prompt("Egységár", item.unitPrice ?? 0);
    if (unitPrice === null) return;
    const status = window.prompt("Státusz", item.status || "");
    if (status === null) return;
    const note = window.prompt("Megjegyzés", item.note || "");
    if (note === null) return;
    await api(`/api/finance/price-items/${itemId}`, { method: "PATCH", body: { name, quantity, unitPrice, status, note } });
}

async function editCostItem(itemId) {
    const item = (financeData().costItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const name = window.prompt("Tétel", item.name || "");
    if (!name) return;
    const plannedAmount = window.prompt("Terv Ft", item.plannedAmount ?? 0);
    if (plannedAmount === null) return;
    const actualAmount = window.prompt("Tény Ft", item.actualAmount ?? 0);
    if (actualAmount === null) return;
    const status = window.prompt("Státusz", item.status || "");
    if (status === null) return;
    await api(`/api/finance/cost-items/${itemId}`, { method: "PATCH", body: { name, plannedAmount, actualAmount, status } });
}

async function editOutsourceItem(itemId) {
    const item = (financeData().outsourceItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const part = window.prompt("Alkatrész", item.part || "");
    if (!part) return;
    const status = window.prompt("Státusz", item.status || "");
    if (status === null) return;
    const actualAmount = window.prompt("Tény Ft", item.actualAmount ?? 0);
    if (actualAmount === null) return;
    const nextStep = window.prompt("Következő lépés", item.nextStep || "");
    if (nextStep === null) return;
    await api(`/api/finance/outsource-items/${itemId}`, { method: "PATCH", body: { part, status, actualAmount, nextStep } });
}

async function editProductionItem(itemId) {
    const item = (financeData().productionItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const part = window.prompt("Alkatrész", item.part || "");
    if (!part) return;
    const actualHours = window.prompt("Tény óra", item.actualHours ?? 0);
    if (actualHours === null) return;
    const status = window.prompt("Státusz", item.status || "");
    if (status === null) return;
    await api(`/api/finance/production-items/${itemId}`, { method: "PATCH", body: { part, actualHours, status } });
}

async function editDesignItem(itemId) {
    const item = (financeData().designItems || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const percent = window.prompt("Készültség %", item.percent ?? 0);
    if (percent === null) return;
    const status = window.prompt("Státusz", item.status || "");
    if (status === null) return;
    const note = window.prompt("Megjegyzés", item.note || "");
    if (note === null) return;
    await api(`/api/finance/design-items/${itemId}`, { method: "PATCH", body: { percent, status, note } });
}

async function editQuoteStatus(itemId) {
    const item = (financeData().quotes || []).find((entry) => entry.id === itemId);
    if (!item) return;
    const status = window.prompt("Ajánlat státusz", item.status || "");
    if (status === null) return;
    const amount = window.prompt("Összeg", item.amount ?? 0);
    if (amount === null) return;
    const note = window.prompt("Megjegyzés", item.note || "");
    if (note === null) return;
    await api(`/api/finance/quotes/${itemId}`, { method: "PATCH", body: { status, amount, note } });
}

async function updateProjectResponsible(projectId, userId, checked) {
    const project = projectById(projectId);
    if (!project) return;
    const ids = projectResponsibleIds(project).slice();
    const next = checked
        ? Array.from(new Set([...ids, userId]))
        : ids.filter((id) => id !== userId);
    await api(`/api/projects/${projectId}`, { method: "PATCH", body: { responsibleUserIds: next } });
}

async function handleChange(event) {
    markFormInteraction();
    const target = event.target;
    const action = target.dataset.action;
    if (!action) return;

    try {
        if (action === "material-prefab-toggle") {
            syncMaterialPrefabMode(target.closest("form"));
            return;
        }
        if (action === "toggle-dashboard-todo") {
            await api(`/api/dashboard/todos/${target.dataset.id}`, { method: "PATCH", body: { checked: target.checked } });
        }
        if (action === "done-task") {
            await api(`/api/tasks/${target.dataset.id}`, { method: "PATCH", body: { done: target.checked } });
            await loadState(true);
            return;
        }
        if (action === "task-priority") {
            await api(`/api/tasks/${target.dataset.id}`, { method: "PATCH", body: { priority: target.value } });
            await loadState(true);
            return;
        }
        if (action === "open-cnc-report") {
            if (target.checked) {
                // Newly checked → open the report modal so user can enter actualEnd
                reportingCncTaskId = target.dataset.id;
                target.checked = false;
                renderModal();
            } else {
                // Unchecking a previously-done CNC task → reopen
                await api(`/api/cnc-tasks/${target.dataset.id}`, { method: "PATCH", body: { done: false } });
                await loadState(true);
            }
            return;
        }
        if (action === "done-tool") {
            await api(`/api/tool-requests/${target.dataset.id}`, { method: "PATCH", body: { done: target.checked } });
            await loadState(true);
            return;
        }
        if (action === "done-material") {
            await api(`/api/material-requests/${target.dataset.id}`, { method: "PATCH", body: { done: target.checked } });
            await loadState(true);
            return;
        }
        if (action === "done-fastener") {
            await api(`/api/fastener-requests/${target.dataset.id}`, { method: "PATCH", body: { done: target.checked } });
            await loadState(true);
            return;
        }
        if (action === "project-active") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { active: target.checked } });
            await loadState(true);
            return;
        }
        if (action === "project-priority") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { priority: target.value } });
            await loadState(true);
            return;
        }
        if (action === "project-responsible") {
            await updateProjectResponsible(target.dataset.id, target.dataset.userId, target.checked);
            await loadState(true);
            return;
        }
        if (action === "project-deadline") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { deadline: target.value } });
            deadlineFlyoutProjectId = null;
            await loadState(true);
            return;
        }
        if (action === "user-clearance") {
            await api(`/api/users/${target.dataset.id}`, { method: "PATCH", body: { name: userName(target.dataset.id), clearanceLevel: Number(target.value || 1) } });
            await loadState(true);
            return;
        }
        if (action === "project-view-owner") {
            projectViewOwnerId = target.value;
            render();
            return;
        }
        if (action === "archive-restore-project") {
            archiveRestoreProjectId = target.value;
            const button = modalRoot.querySelector('[data-action="confirm-archive-restore"]');
            if (button) button.disabled = !archiveRestoreProjectId;
            return;
        }
        if (action === "cad-assign-project") {
            cadAssignProjectId = target.value;
            return;
        }
        if (action === "archive-select") {
            if (target.checked) selectedArchiveIds.add(target.dataset.id);
            else selectedArchiveIds.delete(target.dataset.id);
            render();
            return;
        }
        if (action === "stats-project") {
            statsProjectId = target.value;
            render();
            return;
        }
        if (action === "production-date") {
            productionDate = target.value || localInputDate();
            render();
            return;
        }
        if (action === "finance-project") {
            financeProjectId = target.value;
            render();
            return;
        }
        if (action === "cost-planning-project") {
            costPlanningProjectId = target.value;
            render();
            return;
        }
        if (action === "cost-planning-user-filter") {
            costPlanningUserFilter = target.value;
            render();
            return;
        }
        if (action === "outsource-project-filter") {
            outsourceProjectFilter = target.value;
            render();
            return;
        }
        if (action === "outsource-user-filter") {
            outsourceUserFilter = target.value;
            render();
            return;
        }
        if (action === "production-item-project-filter") {
            productionItemProjectFilter = target.value;
            render();
            return;
        }
        if (action === "production-item-user-filter") {
            productionItemUserFilter = target.value;
            render();
            return;
        }
        if (action === "design-project-filter") {
            designProjectFilter = target.value;
            render();
            return;
        }
        if (action === "design-user-filter") {
            designUserFilter = target.value;
            render();
            return;
        }
        if (action === "tool-request-project-filter") {
            toolRequestProjectFilter = target.value;
            render();
            return;
        }
        if (action === "material-request-project-filter") {
            materialRequestProjectFilter = target.value;
            render();
            return;
        }
        if (action === "fastener-request-project-filter") {
            fastenerRequestProjectFilter = target.value;
            render();
            return;
        }
        if (action === "worklog-user-filter") {
            worklogUserFilter = target.value;
            render();
            return;
        }
        if (action === "worklog-project-filter") {
            worklogProjectFilter = target.value;
            render();
            return;
        }
        if (action === "worklog-export-project") {
            worklogExportProjectId = target.value;
            render();
            return;
        }
        if (action === "worklog-export-user") {
            worklogExportUserId = target.value;
            render();
            return;
        }
        if (action === "task-user-filter") {
            taskUserFilter = target.value;
            render();
            return;
        }
        if (action === "worklog-project") {
            worklogProjectId = projectPickerValue(target);
            const section = document.getElementById("worklog-company-section");
            if (section) section.innerHTML = worklogCompanySectionHtml(worklogProjectId);
            return;
        }
        if (action === "cnc-worklog-project") {
            cncWorklogProjectId = projectPickerValue(target);
            const section = document.getElementById("cnc-worklog-company-section");
            if (section) section.innerHTML = cncWorklogCompanySectionHtml();
            return;
        }
        if (action === "project-browser-project") {
            const projectId = projectPickerValue(target);
            projectBrowserProjectId = projectId;
            if (projectId) await openProjectBrowser(projectId);
            return;
        }
        if (action === "cnc-export-from") {
            cncExportFrom = target.value;
            render();
            return;
        }
        if (action === "cnc-export-to") {
            cncExportTo = target.value;
            render();
            return;
        }
        if (action === "cnc-filter-project") {
            cncFilterProjectId = target.value;
            render();
            return;
        }
        if (action === "project-company") {
            await api(`/api/projects/${target.dataset.id}`, { method: "PATCH", body: { company: target.value } });
            await loadState(true);
            return;
        }
        if (action === "toggle-password-visibility") {
            const form = target.closest("form");
            const input = form?.querySelector('input[name="password"]');
            if (input) input.type = target.checked ? "text" : "password";
            return;
        }
        if (action === "login-user-select") {
            rememberLoginUserId(target.value);
            updateLoginPasswordReminder();
            return;
        }
        if (action === "finance-year") {
            financeYear = target.value || String(new Date().getFullYear());
            renderAndRestoreInput(action, target.selectionStart);
            return;
        }
        if (action === "bom-upload-file") {
            const label = document.getElementById("bom-upload-name");
            if (label) label.textContent = target.files?.[0]?.name || "Nincs fájl kiválasztva.";
            return;
        }
        if (action === "modelling-photos-input") {
            const files = Array.from(target.files || []).filter((file) => /^image\//.test(file.type || ""));
            // Remember the typed folder before re-render wipes the input state.
            const folderInput = target.closest("form")?.querySelector('input[name="folder"]');
            if (folderInput) modellingFolderName = folderInput.value;
            for (const file of files) {
                if (modellingPhotos.length >= 20) {
                    toastMessage("Egyszerre legfeljebb 20 fotó tölthető fel.", true);
                    break;
                }
                const dataUrl = await readFileAsDataUrl(file);
                modellingPhotos.push({ dataUrl, name: file.name || `foto-${Date.now()}.jpg` });
            }
            render();
            return;
        }
        await loadState(false);
    } catch (error) {
        toastMessage(error.message, true);
    }
}

function handleInput(event) {
    markFormInteraction();
    const target = event.target;
    const action = target.dataset.action;
    if (action === "modelling-folder-input") {
        modellingFolderName = target.value;
        return;
    }
    if (target.matches?.("[data-option-picker-input]")) {
        const picker = target.closest("[data-option-picker]");
        openOptionPicker(picker, false);
        if (!target.value.trim()) {
            const hidden = picker?.querySelector?.("[data-option-value]");
            if (hidden?.value) setOptionPickerValue(picker, "", true);
        }
        return;
    }
    if (target.matches?.("[data-project-picker-input]")) {
        syncProjectPickerInput(target, false);
        openProjectPicker(target.closest("[data-project-picker]"), false);
        if (action === "worklog-project") {
            worklogProjectId = projectPickerValue(target);
            const section = document.getElementById("worklog-company-section");
            if (section) section.innerHTML = worklogCompanySectionHtml(worklogProjectId);
        }
        if (action === "cnc-worklog-project") {
            cncWorklogProjectId = projectPickerValue(target);
            const section = document.getElementById("cnc-worklog-company-section");
            if (section) section.innerHTML = cncWorklogCompanySectionHtml();
        }
        if (action === "project-browser-project") {
            const projectId = projectPickerValue(target);
            projectBrowserProjectId = projectId;
        }
        return;
    }
    if (action === "tool-request-search") {
        toolRequestSearch = target.value;
        renderAndRestoreInput(action, target.selectionStart);
        return;
    }
    if (action === "material-request-search") {
        materialRequestSearch = target.value;
        renderAndRestoreInput(action, target.selectionStart);
        return;
    }
    if (action === "fastener-request-search") {
        fastenerRequestSearch = target.value;
        renderAndRestoreInput(action, target.selectionStart);
        return;
    }
    if (action === "project-view-search") {
        projectViewSearch = target.value;
        renderAndRestoreInput(action, target.selectionStart);
    }
    if (action === "project-manage-search") {
        projectManageSearch = target.value;
        renderAndRestoreInput(action, target.selectionStart);
    }
}

function handleProjectPickerFocus(event) {
    const target = event.target;
    if (target?.matches?.("[data-project-picker-input]")) {
        openProjectPicker(target.closest("[data-project-picker]"), false);
        return;
    }
    if (target?.matches?.("[data-option-picker-input]")) {
        // Show the full list on focus and highlight any current text, so the
        // resting "all" placeholder never has to be deleted to browse or search.
        openOptionPicker(target.closest("[data-option-picker]"), true);
        if (target.value) target.select();
    }
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Nem sikerült beolvasni a beillesztett képet."));
        reader.readAsDataURL(file);
    });
}

async function handlePaste(event) {
    const target = event.target;
    const isDashboardTodo = target?.matches?.("[data-dashboard-todo-input]");
    const isCncTask = target?.matches?.("[data-cnc-task-input]");
    const isTask = target?.matches?.("[data-task-input]");
    const isMaterialPrefab = target?.matches?.("[data-material-prefab-input]")
        && Boolean(target.closest("form")?.querySelector('input[name="prefabTransport"]')?.checked);
    const detailTaskId = target?.matches?.("[data-task-detail-image-input]") ? target.dataset.taskId : "";
    if (!isDashboardTodo && !isCncTask && !isTask && !isMaterialPrefab && !detailTaskId) return;
    const items = Array.from(event.clipboardData?.items || []);
    const imageItem = items.find((item) => String(item.type || "").startsWith("image/"));
    if (!imageItem) return;
    const file = imageItem.getAsFile();
    if (!file) return;
    event.preventDefault();
    markFormInteraction();
    try {
        const dataUrl = await readFileAsDataUrl(file);
        if (isDashboardTodo) {
            pendingDashboardTodoImage = {
                dataUrl,
                name: file.name || `beillesztett-kep-${Date.now()}.png`,
                type: file.type || "image/png"
            };
            refreshDashboardTodoImagePreview();
            target.focus();
            toastMessage("Kép beillesztve. Írhatsz mellé leírást, majd Hozzáadás.");
        } else if (isCncTask) {
            if (pendingCncTaskImages.length >= 10) {
                throw new Error("Maximum 10 kép illeszthető be egy CNC feladathoz.");
            }
            pendingCncTaskImages.push({
                dataUrl,
                name: file.name || `cnc-kep-${Date.now()}.png`,
                type: file.type || "image/png"
            });
            refreshPendingCncTaskImages();
            target.focus();
            toastMessage("Kép beillesztve a CNC feladathoz.");
        } else if (isTask) {
            if (pendingTaskImages.length >= 10) {
                throw new Error("Maximum 10 kép illeszthető be egy feladathoz.");
            }
            pendingTaskImages.push({
                dataUrl,
                name: file.name || `feladat-kep-${Date.now()}.png`,
                type: file.type || "image/png"
            });
            refreshPendingTaskImages();
            target.focus();
            toastMessage("Kép beillesztve a feladathoz.");
        } else if (isMaterialPrefab) {
            if (pendingMaterialPrefabImages.length >= 10) {
                throw new Error("Maximum 10 kép illeszthető be egy előgyártmány szállításhoz.");
            }
            pendingMaterialPrefabImages.push({
                dataUrl,
                name: file.name || `elogyartmany-kep-${Date.now()}.png`,
                type: file.type || "image/png"
            });
            refreshPendingMaterialPrefabImages();
            target.focus();
            toastMessage("Kép beillesztve az előgyártmány szállításhoz.");
        } else if (detailTaskId) {
            await api(`/api/tasks/${detailTaskId}/images`, {
                method: "POST",
                body: {
                    imageDataUrl: dataUrl,
                    imageName: file.name || `feladat-kep-${Date.now()}.png`
                }
            });
            await loadState(false);
            taskDetailId = detailTaskId;
            renderModal();
            toastMessage("Kép csatolva a feladathoz.");
        }
    } catch (error) {
        toastMessage(error.message, true);
    }
}

function setDrawingOcrStatus(message, isError = false) {
    const target = document.getElementById("drawing-ocr-status");
    if (!target) return;
    target.textContent = message;
    target.style.color = isError ? "var(--danger)" : "var(--muted)";
}

function normalizeOcrCorrectionCompare(value) {
    return String(value || "")
        .trim()
        .toLocaleUpperCase("hu-HU")
        .replace(/\s+/g, " ");
}

function correctedDrawingTextFromNote(finalNote, scan) {
    const scanned = String(scan?.scannedText || "").trim();
    if (!scanned) return "";
    const note = String(finalNote || "").trim();
    const before = String(scan.noteBefore || "").trim();
    if (!note) return "";
    let corrected = before && note.startsWith(before) ? note.slice(before.length).trim() : note;
    if (corrected.includes(scanned)) return "";
    corrected = corrected
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .pop() || corrected;
    if (!corrected || normalizeOcrCorrectionCompare(corrected) === normalizeOcrCorrectionCompare(scanned)) {
        return "";
    }
    return corrected;
}

async function logPendingDrawingCorrection(worklog, finalNote) {
    const scan = pendingDrawingOcrCorrection;
    const correctedText = correctedDrawingTextFromNote(finalNote, scan);
    if (!scan || !correctedText) return;
    try {
        await api("/api/ocr/drawing-correction", {
            method: "POST",
            body: {
                worklogId: worklog?.id || "",
                projectId: worklog?.projectId || scan.projectId || cncWorklogProjectId || "",
                cncMachineId: worklog?.cncMachineId || "",
                scannedText: scan.scannedText,
                correctedText,
                confidence: scan.confidence ?? null,
                engine: scan.engine || "",
                debugId: scan.debugId || "",
                noteBefore: scan.noteBefore || "",
                noteAfter: finalNote || "",
                imageDataUrls: scan.imageDataUrls || []
            }
        });
    } catch (error) {
        console.warn("OCR correction log failed", error);
    }
}

async function logPendingProjectCorrection(worklog) {
    const scan = pendingProjectOcrCorrection;
    const correctedProjectId = worklog?.projectId || cncWorklogProjectId || "";
    if (!scan || !correctedProjectId || correctedProjectId === scan.scannedProjectId) return;
    const createdAt = Date.parse(scan.createdAt || "");
    if (Number.isFinite(createdAt) && Date.now() - createdAt > 45 * 60 * 1000) return;
    const correctedProject = projectById(correctedProjectId);
    if (!correctedProject) return;
    try {
        await api("/api/ocr/project-correction", {
            method: "POST",
            body: {
                worklogId: worklog?.id || "",
                cncMachineId: worklog?.cncMachineId || "",
                scannedText: scan.scannedText || "",
                scannedProjectId: scan.scannedProjectId || "",
                scannedProjectName: scan.scannedProjectName || "",
                scannedProjectFolder: scan.scannedProjectFolder || "",
                correctedProjectId,
                correctedProjectName: correctedProject.name || "",
                correctedProjectFolder: correctedProject.primaryFolder || "",
                confidence: scan.confidence ?? null,
                engine: scan.engine || "",
                debugId: scan.debugId || "",
                matchScore: scan.matchScore ?? null,
                tokenRatio: scan.tokenRatio ?? null,
                descriptorRatio: scan.descriptorRatio ?? null,
                folderApproxScore: scan.folderApproxScore ?? null,
                codeHit: Boolean(scan.codeHit),
                rootHit: Boolean(scan.rootHit),
                rootMismatch: Boolean(scan.rootMismatch),
                scannedRoot: scan.scannedRoot || "",
                scannedCodes: scan.scannedCodes || [],
                imageDataUrls: scan.imageDataUrls || []
            }
        });
    } catch (error) {
        console.warn("Project OCR correction log failed", error);
    }
}

async function startDrawingOcrCamera() {
    const video = document.getElementById("drawing-ocr-video");
    if (!video || drawingOcr.phase !== "camera") return;
    if (drawingOcr.stream) {
        video.srcObject = drawingOcr.stream;
        await video.play().catch(() => {});
        setDrawingOcrStatus("Kamera készen áll.");
        return;
    }
    if (drawingOcr.starting) return;
    drawingOcr.starting = true;
    try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("A böngésző nem támogatja a kamera megnyitását.");
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });
        drawingOcr.stream = stream;
        video.srcObject = stream;
        await video.play().catch(() => {});
        setDrawingOcrStatus("Kamera készen áll.");
    } catch (error) {
        setDrawingOcrStatus(error.message || "Nem sikerült megnyitni a kamerát.", true);
    } finally {
        drawingOcr.starting = false;
    }
}

async function captureDrawingOcrPhoto() {
    const video = document.getElementById("drawing-ocr-video");
    if (!video || !video.videoWidth || !video.videoHeight) {
        throw new Error("A kamera képe még nem áll készen.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext("2d").drawImage(video, 0, 0);
    const image = new Image();
    image.onload = () => {
        const isProjectStep = drawingOcr.step === "project";
        const width = Math.round(image.naturalWidth * (isProjectStep ? 0.96 : 0.72));
        const height = Math.round(image.naturalHeight * (isProjectStep ? 0.12 : 0.28));
        drawingOcr.image = image;
        drawingOcr.crop = {
            x: Math.round((image.naturalWidth - width) / 2),
            y: isProjectStep ? Math.round(image.naturalHeight * 0.43) : Math.round((image.naturalHeight - height) / 2),
            width,
            height
        };
        drawingOcr.phase = "crop";
        renderModal();
    };
    image.onerror = () => toastMessage("Nem sikerült a fotót előkészíteni.", true);
    image.src = canvas.toDataURL("image/png");
}

function drawingOcrCropRect() {
    if (!drawingOcr.crop || !drawingOcr.view) return null;
    const scale = drawingOcr.view.scale;
    return {
        x: drawingOcr.crop.x * scale,
        y: drawingOcr.crop.y * scale,
        width: drawingOcr.crop.width * scale,
        height: drawingOcr.crop.height * scale
    };
}

function normalizeDrawingOcrCrop() {
    const image = drawingOcr.image;
    const crop = drawingOcr.crop;
    if (!image || !crop) return;
    const minSize = 24;
    crop.width = Math.max(minSize, Math.min(image.naturalWidth, Math.round(crop.width || minSize)));
    crop.height = Math.max(minSize, Math.min(image.naturalHeight, Math.round(crop.height || minSize)));
    crop.x = Math.max(0, Math.min(image.naturalWidth - crop.width, Math.round(crop.x || 0)));
    crop.y = Math.max(0, Math.min(image.naturalHeight - crop.height, Math.round(crop.y || 0)));
}

function drawDrawingOcrCanvas() {
    const canvas = document.getElementById("drawing-ocr-canvas");
    const image = drawingOcr.image;
    if (!canvas || !image) return;
    normalizeDrawingOcrCrop();
    const parentWidth = canvas.parentElement?.clientWidth || 900;
    const displayWidth = Math.min(parentWidth, image.naturalWidth);
    const scale = displayWidth / image.naturalWidth;
    const displayHeight = Math.max(1, Math.round(image.naturalHeight * scale));
    const dpr = window.devicePixelRatio || 1;
    drawingOcr.view = { scale, width: displayWidth, height: displayHeight };
    canvas.style.width = `${displayWidth}px`;
    canvas.style.height = `${displayHeight}px`;
    canvas.width = Math.round(displayWidth * dpr);
    canvas.height = Math.round(displayHeight * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, displayWidth, displayHeight);
    ctx.drawImage(image, 0, 0, displayWidth, displayHeight);
    const rect = drawingOcrCropRect();
    if (rect) {
        ctx.fillStyle = "rgba(0,0,0,0.48)";
        ctx.fillRect(0, 0, displayWidth, displayHeight);
        ctx.drawImage(image, drawingOcr.crop.x, drawingOcr.crop.y, drawingOcr.crop.width, drawingOcr.crop.height, rect.x, rect.y, rect.width, rect.height);
        ctx.strokeStyle = "#ff6b12";
        ctx.lineWidth = 3;
        ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
        ctx.fillStyle = "rgba(255,107,18,0.9)";
        const handle = Math.max(22, Math.min(36, Math.round(Math.min(displayWidth, displayHeight) * 0.055)));
        ctx.fillRect(rect.x - handle / 2, rect.y - handle / 2, handle, handle);
        ctx.fillRect(rect.x + rect.width - handle / 2, rect.y + rect.height - handle / 2, handle, handle);
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x - handle / 2, rect.y - handle / 2, handle, handle);
        ctx.strokeRect(rect.x + rect.width - handle / 2, rect.y + rect.height - handle / 2, handle, handle);
    }
}

function drawingOcrCanvasPoint(clientX, clientY) {
    const canvas = document.getElementById("drawing-ocr-canvas");
    if (!canvas || !drawingOcr.view) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
        displayX: clientX - bounds.left,
        displayY: clientY - bounds.top,
        imageX: (clientX - bounds.left) / drawingOcr.view.scale,
        imageY: (clientY - bounds.top) / drawingOcr.view.scale
    };
}

function drawingOcrPointerMode(point) {
    const rect = drawingOcrCropRect();
    if (!rect || !point) return null;
    const handle = Math.max(30, Math.min(46, Math.round(Math.min(drawingOcr.view.width, drawingOcr.view.height) * 0.075)));
    const near = (x, y) => Math.abs(point.displayX - x) <= handle && Math.abs(point.displayY - y) <= handle;
    if (near(rect.x, rect.y)) return "nw";
    if (near(rect.x + rect.width, rect.y + rect.height)) return "se";
    if (point.displayX >= rect.x && point.displayX <= rect.x + rect.width && point.displayY >= rect.y && point.displayY <= rect.y + rect.height) return "move";
    return null;
}

function updateDrawingOcrCorner(mode, imageX, imageY) {
    const image = drawingOcr.image;
    const crop = drawingOcr.crop;
    if (!image || !crop) return;
    const minSize = 24;
    const right = crop.x + crop.width;
    const bottom = crop.y + crop.height;
    if (mode === "nw") {
        const nx = Math.max(0, Math.min(right - minSize, Math.round(imageX)));
        const ny = Math.max(0, Math.min(bottom - minSize, Math.round(imageY)));
        crop.x = nx;
        crop.y = ny;
        crop.width = right - nx;
        crop.height = bottom - ny;
    } else if (mode === "se") {
        const nr = Math.max(crop.x + minSize, Math.min(image.naturalWidth, Math.round(imageX)));
        const nb = Math.max(crop.y + minSize, Math.min(image.naturalHeight, Math.round(imageY)));
        crop.width = nr - crop.x;
        crop.height = nb - crop.y;
    }
    normalizeDrawingOcrCrop();
}

function moveDrawingOcrCrop(clientX, clientY, pointerInfo) {
    const image = drawingOcr.image;
    const crop = drawingOcr.crop;
    const point = drawingOcrCanvasPoint(clientX, clientY);
    if (!image || !crop || !point || !pointerInfo) return;
    if (pointerInfo.mode === "nw" || pointerInfo.mode === "se") {
        updateDrawingOcrCorner(pointerInfo.mode, point.imageX, point.imageY);
        drawDrawingOcrCanvas();
        return;
    }
    if (pointerInfo.mode === "move") {
        crop.x = Math.max(0, Math.min(image.naturalWidth - crop.width, Math.round(point.imageX - pointerInfo.offsetX)));
        crop.y = Math.max(0, Math.min(image.naturalHeight - crop.height, Math.round(point.imageY - pointerInfo.offsetY)));
    }
    normalizeDrawingOcrCrop();
    drawDrawingOcrCanvas();
}

// Otsu's method: pick the luminance threshold that maximises between-class
// variance, i.e. the value that best separates "ink" from "paper" for this
// specific image. Replaces the old fixed 145 cutoff which failed on photos
// with dark or washed-out lighting.
function otsuThreshold(lumArr) {
    const histogram = new Uint32Array(256);
    for (let i = 0; i < lumArr.length; i++) {
        const v = lumArr[i] < 0 ? 0 : lumArr[i] > 255 ? 255 : Math.round(lumArr[i]);
        histogram[v]++;
    }
    const total = lumArr.length;
    let sumAll = 0;
    for (let i = 0; i < 256; i++) sumAll += i * histogram[i];
    let sumB = 0;
    let wB = 0;
    let maxVar = -1;
    let threshold = 127;
    for (let t = 0; t < 256; t++) {
        wB += histogram[t];
        if (wB === 0) continue;
        const wF = total - wB;
        if (wF === 0) break;
        sumB += t * histogram[t];
        const mB = sumB / wB;
        const mF = (sumAll - sumB) / wF;
        const variance = wB * wF * (mB - mF) * (mB - mF);
        if (variance > maxVar) {
            maxVar = variance;
            threshold = t;
        }
    }
    return threshold;
}

// Two-pass 1D kernel [1,2,1]/4 — small Gaussian-like blur. Kills JPEG /
// scan grain so Otsu threshold finds clean character edges instead of
// firing on noise.
function smallBlur(lumArr, w, h) {
    const horizontal = new Float32Array(lumArr.length);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            const c = lumArr[row + x];
            const l = x > 0 ? lumArr[row + x - 1] : c;
            const r = x < w - 1 ? lumArr[row + x + 1] : c;
            horizontal[row + x] = (l + 2 * c + r) * 0.25;
        }
    }
    const result = new Float32Array(lumArr.length);
    for (let y = 0; y < h; y++) {
        const row = y * w;
        for (let x = 0; x < w; x++) {
            const c = horizontal[row + x];
            const t = y > 0 ? horizontal[row - w + x] : c;
            const b = y < h - 1 ? horizontal[row + w + x] : c;
            result[row + x] = (t + 2 * c + b) * 0.25;
        }
    }
    return result;
}

function canvasFromLuminance(lumArr, w, h) {
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const img = ctx.createImageData(w, h);
    const data = img.data;
    for (let i = 0, j = 0; j < lumArr.length; i += 4, j++) {
        const v = lumArr[j] < 0 ? 0 : lumArr[j] > 255 ? 255 : lumArr[j];
        data[i] = data[i + 1] = data[i + 2] = v;
        data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return canvas;
}

function rotateCanvas(source, degrees) {
    const w = source.width;
    const h = source.height;
    const canvas = document.createElement("canvas");
    if (degrees === 90 || degrees === 270) {
        canvas.width = h;
        canvas.height = w;
    } else {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((degrees * Math.PI) / 180);
    ctx.drawImage(source, -w / 2, -h / 2);
    return canvas;
}

function drawingOcrVariantDataUrls(sourceCanvas) {
    const w = sourceCanvas.width;
    const h = sourceCanvas.height;
    const ctx = sourceCanvas.getContext("2d");
    const baseData = ctx.getImageData(0, 0, w, h).data;
    // Compute luminance buffer once (rec.601 weights) — feeds contrast,
    // blur, Otsu threshold, inverted threshold.
    const lum = new Float32Array(w * h);
    for (let i = 0, j = 0; j < lum.length; i += 4, j++) {
        lum[j] = 0.299 * baseData[i] + 0.587 * baseData[i + 1] + 0.114 * baseData[i + 2];
    }

    const variants = [];
    // Variant 1: original color crop, unchanged.
    variants.push(sourceCanvas.toDataURL("image/png"));

    // Variant 2: contrast boost (gain 1.9 around mid-grey).
    const contrast = new Float32Array(lum.length);
    for (let j = 0; j < lum.length; j++) contrast[j] = (lum[j] - 128) * 1.9 + 128;
    variants.push(canvasFromLuminance(contrast, w, h).toDataURL("image/png"));

    // Variant 3: 3x3 blur + Otsu auto-threshold (light text on dark / dark
    // text on light — Otsu handles whichever the image is). Replaces the
    // old fixed-145 threshold which failed on lit/dim images.
    const blurred = smallBlur(lum, w, h);
    const ot = otsuThreshold(blurred);
    const thr = new Float32Array(blurred.length);
    for (let j = 0; j < blurred.length; j++) thr[j] = blurred[j] > ot ? 255 : 0;
    variants.push(canvasFromLuminance(thr, w, h).toDataURL("image/png"));

    // Variant 4: inverted Otsu threshold — needed when the drawing label
    // is light text on a dark background, which would otherwise be erased.
    const inv = new Float32Array(blurred.length);
    for (let j = 0; j < blurred.length; j++) inv[j] = blurred[j] > ot ? 0 : 255;
    variants.push(canvasFromLuminance(inv, w, h).toDataURL("image/png"));

    // Variants 5-7: rotations of the original crop. Tesseract is very
    // sensitive to orientation; photos taken sideways or upside-down were
    // the most common failure mode before this.
    for (const deg of [90, 180, 270]) {
        variants.push(rotateCanvas(sourceCanvas, deg).toDataURL("image/png"));
    }

    return Array.from(new Set(variants));
}

async function recognizeDrawingOcrCrop() {
    const image = drawingOcr.image;
    const crop = drawingOcr.crop;
    if (!image || !crop) throw new Error("Nincs kijelölt kép.");
    setDrawingOcrStatus("OCR felismerés folyamatban...");
    const output = document.createElement("canvas");
    normalizeDrawingOcrCrop();
    const maxSide = Math.max(crop.width, crop.height);
    const scale = Math.max(1, Math.min(3, 1400 / Math.max(1, maxSide)));
    output.width = Math.max(1, Math.round(crop.width * scale));
    output.height = Math.max(1, Math.round(crop.height * scale));
    output.getContext("2d").drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);

    const sourceImageDataUrl = output.toDataURL("image/png");
    const imageDataUrls = drawingOcrVariantDataUrls(output);

    if (drawingOcr.step === "project") {
        const response = await api("/api/ocr/project-path", {
            method: "POST",
            body: { imageDataUrls }
        });
        const text = String(response.text || "").trim();
        if (!text) {
            setDrawingOcrStatus("Nem talált olvasható projekt útvonalat. Próbálj közelebbi képet.", true);
            return;
        }
        const match = matchScannedProject(text);
        if (!match?.project) {
            setDrawingOcrStatus(`Nem találtam aktív projektet ehhez: ${text}`, true);
            return;
        }
        pendingProjectOcrCorrection = {
            createdAt: new Date().toISOString(),
            scannedText: text,
            scannedProjectId: match.project.id || "",
            scannedProjectName: match.project.name || "",
            scannedProjectFolder: match.project.primaryFolder || "",
            confidence: response.confidence ?? null,
            engine: response.engine || "",
            debugId: response.debugId || "",
            matchScore: Number.isFinite(match.score) ? match.score : null,
            tokenRatio: Number.isFinite(match.tokenRatio) ? match.tokenRatio : null,
            descriptorRatio: Number.isFinite(match.descriptorRatio) ? match.descriptorRatio : null,
            folderApproxScore: Number.isFinite(match.folderApproxScore) ? match.folderApproxScore : null,
            codeHit: Boolean(match.codeHit),
            rootHit: Boolean(match.rootHit),
            rootMismatch: Boolean(match.rootMismatch),
            scannedRoot: ocrProjectRootKey(text),
            scannedCodes: Array.from(ocrProjectCodes(text)),
            imageDataUrls: [sourceImageDataUrl]
        };
        selectCncWorklogProject(match.project);
        toastMessage(`Projekt kiválasztva: ${match.project.name}`);
        continueDrawingOcrScan();
        return;
    }

    const response = await api("/api/ocr/drawing-number", {
        method: "POST",
        body: { imageDataUrls }
    });
    const text = String(response.text || "").trim();
    resetDrawingOcr();
    renderModal();
    if (!text) {
        toastMessage("Nem talált olvasható szöveget. Próbálj közelebbi képet.", true);
        return;
    }
    const note = activeCncWorklogForm()?.querySelector('textarea[name="note"]');
    if (note) {
        const current = note.value.trim();
        note.value = current ? `${current}\n${text}` : text;
        note.dispatchEvent(new Event("input", { bubbles: true }));
        markFormInteraction();
        pendingDrawingOcrCorrection = {
            scannedText: text,
            noteBefore: current,
            projectId: cncWorklogProjectId,
            imageDataUrls: [sourceImageDataUrl],
            confidence: response.confidence ?? null,
            engine: response.engine || "",
            debugId: response.debugId || ""
        };
    }
    toastMessage(`Rajzszám beillesztve: ${text}`);
}

function handlePointerDown(event) {
    if (!drawingOcr.open || drawingOcr.phase !== "crop") return;
    const canvas = event.target.closest?.("#drawing-ocr-canvas");
    if (!canvas || !drawingOcr.crop || !drawingOcr.view) return;
    const point = drawingOcrCanvasPoint(event.clientX, event.clientY);
    const mode = drawingOcrPointerMode(point);
    if (!mode) return;
    const crop = drawingOcr.crop;
    const pointerInfo = {
        mode,
        offsetX: point.imageX - crop.x,
        offsetY: point.imageY - crop.y
    };
    drawingOcr.activePointers.set(event.pointerId, pointerInfo);
    try { canvas.setPointerCapture?.(event.pointerId); } catch { /* noop */ }
    event.preventDefault();
    moveDrawingOcrCrop(event.clientX, event.clientY, pointerInfo);
}

function handlePointerMove(event) {
    const pointerInfo = drawingOcr.activePointers?.get?.(event.pointerId);
    if (!pointerInfo) return;
    event.preventDefault();
    moveDrawingOcrCrop(event.clientX, event.clientY, pointerInfo);
}

function handlePointerUp(event) {
    drawingOcr.activePointers?.delete?.(event.pointerId);
}

function renderAndRestoreInput(action, cursorPosition) {
    render();
    window.requestAnimationFrame(() => {
        const next = document.querySelector(`[data-action="${action}"]`);
        if (!next) return;
        next.focus();
        if (typeof next.setSelectionRange === "function") {
            const pos = Number.isFinite(cursorPosition) ? cursorPosition : next.value.length;
            next.setSelectionRange(pos, pos);
        }
    });
}

function handleDrag(event) {
    const zone = event.target.closest("[data-drop]");
    if (!zone) return;
    event.preventDefault();
    zone.classList.add("dragover");
}

function handleDragLeave(event) {
    const zone = event.target.closest("[data-drop]");
    if (!zone) return;
    zone.classList.remove("dragover");
}

async function handleDrop(event) {
    const zone = event.target.closest("[data-drop]");
    if (!zone) return;
    markFormInteraction();
    event.preventDefault();
    zone.classList.remove("dragover");
    try {
        if (String(zone.dataset.drop || "").endsWith("-attachment")) {
            const paths = droppedPaths(event.dataTransfer);
            if (!paths.length) throw new Error("A böngésző nem adta át a fájl teljes útvonalát. Helyi drag-and-drophoz használd a Helper Drop ablakot.");
            setPendingRequestAttachmentLink(String(zone.dataset.drop || "").replace(/-attachment$/, ""), paths[0], pathFileName(paths[0]));
        } else if (zone.dataset.drop === "bom-link") {
            const paths = droppedPaths(event.dataTransfer);
            if (!paths.length) throw new Error("A böngésző nem adta át a fájl teljes útvonalát. Használd a Helper Drop ablakot.");
            setBomLink(paths[0], paths[0].split(/[\\/]/).pop());
        } else {
            await linkDroppedFiles(event.dataTransfer);
        }
    } catch (error) {
        toastMessage(error.message, true);
    }
}

async function linkDroppedFiles(dataTransfer) {
    const paths = droppedPaths(dataTransfer);
    if (!paths.length) {
        throw new Error("A böngésző nem adta át a fájl teljes útvonalát. Helyi drag-and-drophoz használd a Helper Drop ablakot.");
    }
    for (const filePath of paths) {
        addPendingTaskLink(filePath);
    }
}

function droppedPaths(dataTransfer) {
    const paths = [];
    const addPath = (value) => {
        const cleaned = decodeFilePath(value);
        if (cleaned && !paths.some((item) => item.toLocaleLowerCase("hu-HU") === cleaned.toLocaleLowerCase("hu-HU"))) {
            paths.push(cleaned);
        }
    };

    for (const type of ["text/uri-list", "text/plain"]) {
        const text = dataTransfer.getData(type);
        if (!text) continue;
        text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).forEach(addPath);
    }

    for (const file of Array.from(dataTransfer.files || [])) {
        addPath(file.path || file.mozFullPath || file.webkitRelativePath || "");
    }

    return paths.filter((item) => /^([a-z]:\\|\\\\)/i.test(item));
}

function decodeFilePath(value) {
    let text = String(value || "").trim();
    if (!text || text.startsWith("#")) return "";
    if (/^file:\/\//i.test(text)) {
        try {
            const url = new URL(text);
            text = decodeURIComponent(url.pathname || "");
            if (/^\/[a-z]:/i.test(text)) text = text.slice(1);
            text = text.replace(/\//g, "\\");
            if (url.hostname) text = `\\\\${url.hostname}${text}`;
        } catch {
            return "";
        }
    }
    return text;
}

function rememberFinanceMenu(event) {
    if (!event.target?.matches?.("[data-finance-menu]")) return;
    financeMenuOpen = event.target.open;
    localStorage.setItem("workshop_finance_menu_open", financeMenuOpen ? "1" : "0");
}

function tryShowPicker(event) {
    const el = event.target;
    if (!el || el.tagName !== "INPUT" || !el.list) return;
    try { el.showPicker?.(); } catch { /* ignore */ }
}

document.addEventListener("submit", async (event) => {
    const form = event.target.closest("form[data-action]");
    if (!form) return;
    event.preventDefault();
    try {
        await submitForm(form);
    } catch (error) {
        toastMessage(error.message, true);
    }
});

document.addEventListener("click", handleClick);
document.addEventListener("focusin", markInteractiveElement);
document.addEventListener("focusin", handleProjectPickerFocus);
document.addEventListener("focusin", tryShowPicker);
document.addEventListener("dblclick", tryShowPicker);
document.addEventListener("pointerdown", markInteractiveElement);
document.addEventListener("toggle", rememberFinanceMenu, true);
document.addEventListener("change", markUserDraft, true);
document.addEventListener("input", markUserDraft, true);
document.addEventListener("change", handleChange);
document.addEventListener("input", handleInput);
document.addEventListener("paste", handlePaste);
document.addEventListener("dragover", handleDrag);
document.addEventListener("dragleave", handleDragLeave);
document.addEventListener("drop", handleDrop);
document.addEventListener("pointerdown", handlePointerDown);
document.addEventListener("pointermove", handlePointerMove);
document.addEventListener("pointerup", handlePointerUp);
window.addEventListener("focus", refreshClientStateOnResume);
document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshClientStateOnResume();
});
window.addEventListener("pageshow", refreshClientStateOnResume);
window.addEventListener("online", refreshClientStateOnResume);
window.addEventListener("error", (event) => {
    reportClientError("window-error", event.error || event.message || "window error", {
        source: event.filename || "",
        line: event.lineno,
        column: event.colno
    });
});
window.addEventListener("unhandledrejection", (event) => {
    reportClientError("unhandled-rejection", event.reason || "unhandled rejection");
});
refreshButton.addEventListener("click", () => loadState(true).catch((error) => {
    if (!error.authRequired) toastMessage(error.message, true);
}));
logoutButton?.addEventListener("click", async () => {
    const secureDemo = Boolean(globalThis.ERP_DEMO_CONFIG && state?.config?.localAuthRequired);
    try {
        await api("/api/logout", { method: "POST" });
    } catch {
        // The local session is cleared below even if the server was already restarted.
    }
    closeEventStream();
    state = null;
    financeState = null;
    financeUnlocked = false;
    securityState = null;
    hostStatus = null;
    currentUser = null;
    authCsrfToken = "";
    if (globalThis.ERP_DEMO_CONFIG && !secureDemo) {
        await loadState(true);
        return;
    }
    authRequired = true;
    const auth = await fetch("/api/auth", { credentials: "same-origin" }).then((response) => response.json()).catch(() => null);
    authUsers = auth?.users || [];
    authPasswordSet = Boolean(auth?.passwordSet);
    renderLogin();
});

const deletePermissionObserver = new MutationObserver(() => applyDeleteButtonPermissions(document));
if (app) deletePermissionObserver.observe(app, { childList: true, subtree: true });
if (modalRoot) deletePermissionObserver.observe(modalRoot, { childList: true, subtree: true });

applyRouteFromUrl();
refreshNotificationRuntimeStatus();
window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    refreshNotificationRuntimeStatus();
    if (currentView === "stats") render();
});
window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    pwaSessionEnsuredForUserId = "";
    refreshNotificationRuntimeStatus();
    ensurePwaSession().catch(() => {});
    if (currentView === "stats") render();
});
try {
    window.matchMedia?.("(display-mode: standalone)")?.addEventListener?.("change", () => {
        pwaSessionEnsuredForUserId = "";
        refreshNotificationRuntimeStatus();
        ensurePwaSession().catch(() => {});
        if (currentView === "stats") render();
    });
} catch {
    // Older browsers expose matchMedia without change listeners.
}
registerServiceWorker().then(() => {
    if (currentView === "stats") render();
}).catch(() => {});

loadState(true)
    .then(() => ensureRefreshTimer())
    .catch((error) => {
        if (error.authRequired) return;
        reportClientError("startup-load-state", error);
        renderStartupFailure(error);
    });
