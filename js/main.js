import {createAnnotationGeometry} from "./annotation-geometry.js";
import {createAnnotationStore} from "./annotation-store.js";
import {createAnnotationsController} from "./annotations-controller.js";
import {createContextHeader} from "./context-header.js";
import {createCuesManager} from "./cues-manager.js";
import {createDepartmentSettings, normalizeDepartmentMargin} from "./department-settings.js";
import {getTeleprompterDom} from "./dom.js";
import {createOverviewRail} from "./overview-rail.js";
import {createPdfExporter} from "./pdf-export.js";
import {createSemanticPositionApi} from "./semantic-position.js";
import {createSyncEngine} from "./sync-engine.js";
import {createTeleprompterTransport} from "./teleprompter-transport.js";

import "./components/settings-dialog.js";
import "./components/export-dialog.js";
import "./components/cue-editor-dialog.js";
import "./components/annotation-toolbar.js";
import "./components/toolbar-transport.js";
import "./components/toolbar-display.js";
import "./components/toolbar-navigation.js";
import "./components/toolbar-sync.js";
import "./components/toolbar-sliders.js";
import '@fontsource-variable/work-sans';
import "@fontsource-variable/jetbrains-mono";
import {
    fetchDepartments,
    getDepartments,
    getDepartmentMetadata,
    getDepartmentColor,
    isAllowedDepartment
} from "./departments.js";


const dom = getTeleprompterDom();

const {
    viewport,
    content,
    settingsDialog,
    exportDialog,
    cueEditorDialog,
    annotationToolbar,
    toolbarTransport,
    toolbarDisplay,
    toolbarNavigation,
    toolbarSync,
    toolbarSliders,
    contextHeader,
    headerAct,
    headerScene,
    headerPage,
    overviewRail,
    overviewMarkers,
    overviewViewportIndicator,
    overviewMasterIndicator,
    masterIdleBorder,
} = dom;

content.innerHTML =
    "<div class='cue'><span class='dialog'>Loading script…</span></div>";

const SYNC_ENDPOINT = "/scripts/teleprompter_sync.php";
const SSE_ENDPOINT = "/scripts/teleprompter_events.php";
const SCRIPT_LIST_ENDPOINT = "/scripts/list_scripts.php";
const SCRIPT_GET_ENDPOINT = "/scripts/get_script.php";
const CUE_API_ENDPOINT = "/scripts/cue_api.php";
let allowedDepartments = [];

const ANNOTATION_API_ENDPOINT = "/scripts/annotation_api.php";
const SETTINGS_API_ENDPOINT = "/scripts/settings_api.php";
const RAIL_SIDE_STORAGE_KEY = "gaosTeleprompterRailSide";
const FONT_SIZE_STORAGE_KEY = "gaosTeleprompterFontSize";
const STAGE_DIRECTIONS_STORAGE_KEY = "gaosTeleprompterStageDirections";
const DEPARTMENT_STORAGE_KEY = "gaosTeleprompterDepartment";
const REFERENCE_LINE_FRACTION = 0.35;

function getStoredDepartment() {
    try {
        return localStorage.getItem(DEPARTMENT_STORAGE_KEY) || "";
    } catch (_) {
        return "";
    }
}

function getStoredFontSize() {
    try {
        const stored = parseInt(localStorage.getItem(FONT_SIZE_STORAGE_KEY), 10);
        return Number.isFinite(stored) && stored >= 16 && stored <= 180 ? stored : 42;
    } catch (_) {
        return 42;
    }
}

function getStoredStageDirections() {
    try {
        const stored = localStorage.getItem(STAGE_DIRECTIONS_STORAGE_KEY);
        return stored === "true";
    } catch (_) {
        return false;
    }
}

const query = new URLSearchParams(window.location.search);
const hasDeptQueryParam = query.has("dept");
const requestedDepartment = (query.get("dept") || "").trim().toUpperCase();
let activeDepartment = requestedDepartment || null;

let availableScripts = [];
let currentScriptId = null;
let scriptLoadSerial = 0;
let showStageDirections = getStoredStageDirections();
let cachedPromptBlocks = [];

function refreshPromptBlockCache() {
    cachedPromptBlocks = Array.from(content.querySelectorAll("[data-prompt-id]"));
}

const promptBlocks = () => cachedPromptBlocks;

const semanticPosition = createSemanticPositionApi({
    content,
    viewport,
    getPromptBlocks: promptBlocks,
    referenceLineFraction: REFERENCE_LINE_FRACTION
});

const annotationStore = createAnnotationStore();

let currentFontSize = getStoredFontSize();

const annotationGeometry = createAnnotationGeometry({
    content,
    fontSizeInput: {
        get value() {
            return currentFontSize;
        }
    },
    getDepartmentMargin: () => departmentSettings.departmentMarginSetting(),
    getActiveDepartment: () => activeDepartment,
    getDepartmentColor: () => cuesManager.departmentDefaultColor()
});

const contextHeaderManager = createContextHeader({
    headerAct,
    headerScene,
    headerPage,
    viewport,
    promptBlocks,
    referenceLineFraction: REFERENCE_LINE_FRACTION,
    onUpdate: () => overviewRailManager.updateOverviewViewport()
});

const overviewRailManager = createOverviewRail({
    overviewRail,
    overviewMarkers,
    overviewViewportIndicator,
    overviewMasterIndicator,
    viewport,
    content,
    getPromptBlocks: promptBlocks,
    getLoadedCues: () => cuesManager.getLoadedCues(),
    getLoadedAnnotations: () => annotationsController.getLoadedAnnotations(),
    getActiveDepartment: () => activeDepartment,
    getDepartmentDefaultColor: () => cuesManager.departmentDefaultColor(),
    toDocumentY: (pos) => semanticPosition.toDocumentY(pos),
    promptLineHeightPx: (block) => annotationGeometry.lineHeightPx(block),
    getSyncMode: () => syncEngine.getSyncMode(),
    isFollowingLive: () => syncEngine.isFollowingLive(),
    getLatestRemoteState: () => syncEngine.getLatestRemoteState(),
    getCurrentScriptId: () => currentScriptId,
    maxScrollTop: () => transport.maxScrollTop(),
    onScrub: (targetScroll) => {
        syncEngine.pauseFollowingForManualControl();
        transport.stopAutoScrollForManualControl();
        transport.stopDragMomentum();
        transport.setScrollPos(targetScroll);
    },
    scheduleContextUpdate: () => contextHeaderManager.scheduleContextUpdate()
});

const departmentSettings = createDepartmentSettings({
    settingsDialog,
    content,
    settingsApiEndpoint: SETTINGS_API_ENDPOINT,
    railSideStorageKey: RAIL_SIDE_STORAGE_KEY,
    getActiveDepartment: () => activeDepartment,
    getCueEditorUnlocked: () => cuesManager.isCueEditorUnlocked(),
    getCueEditorKey: () => cuesManager.getCueEditorKey(),
    preserveSemanticPosition: (fn) => syncEngine.preserveSemanticPositionDuringLayoutChange(fn),
    onLayoutChanged: () => {
        requestAnimationFrame(() => {
            cuesManager.drawCueConnectors();
            cuesManager.drawCueRanges();
            annotationsController.scheduleAnnotationRender();
            overviewRailManager.rebuildOverviewRail();
            contextHeaderManager.scheduleContextUpdate();
            overviewRailManager.updateMasterPositionMarker();
            cuesManager.updateCueEditorPositionMarkers();
        });
    },
    scheduleToolbarHide: () => transport.scheduleToolbarHide()
});

const transport = createTeleprompterTransport({
    viewport,
    content,
    toolbarTransport,
    toolbarSliders,
    toolbarDisplay,
    settingsDialog,
    getSyncMode: () => syncEngine.getSyncMode(),
    onManualControl: () => syncEngine.pauseFollowingForManualControl(),
    onStatusUpdate: () => updateStatus(),
    onMasterIdleBorderUpdate: () => syncEngine.updateMasterIdleBorder(),
    isCueWordPickActive: () => cuesManager.isCueWordPickActive(),
    recordMasterInteraction: () => syncEngine.recordMasterInteraction()
});

const cuesManager = createCuesManager({
    content,
    viewport,
    cueEditorDialog,
    toolbarSync,
    cueApiEndpoint: CUE_API_ENDPOINT,
    departmentDefaultColors: (dept) => getDepartmentColor(dept),
    getActiveDepartment: () => activeDepartment,
    getCurrentScriptId: () => currentScriptId,
    getCachedPromptBlocks: promptBlocks,
    findSemanticPosition: () => semanticPosition.capture(),
    semanticDocumentY: (pos) => semanticPosition.toDocumentY(pos),
    currentReferencePromptId: () => semanticPosition.currentPromptId(),
    ensurePositionLine: (kind) => overviewRailManager.ensurePositionLine(kind),
    applyStageDirectionVisibility: () => applyStageDirectionVisibility(),
    scheduleContextUpdate: () => contextHeaderManager.scheduleContextUpdate(),
    rebuildOverviewRail: () => overviewRailManager.rebuildOverviewRail(),
    scheduleToolbarHide: () => transport.scheduleToolbarHide(),
    maxScrollTop: () => transport.maxScrollTop(),
    setScrollPos: (pos) => transport.setScrollPos(pos),
    onManualControl: () => {
        syncEngine.pauseFollowingForManualControl();
        transport.stopAutoScrollForManualControl();
        transport.stopDragMomentum();
    },
    setSyncStatus: (msg, cls) => syncEngine.setSyncStatus(msg, cls),
    flushAnnotationQueue: () => annotationsController.flushAnnotationQueue(),
    scheduleAnnotationSync: () => annotationsController.scheduleAnnotationSync(),
    syncSettingsControls: () => departmentSettings.syncSettingsControls(),
    isSavePending: () => departmentSettings.isSavePending(),
    isSaveRunning: () => departmentSettings.isSaveRunning(),
    flushDepartmentMarginSave: () => departmentSettings.flushDepartmentMarginSave()
});

const annotationsController = createAnnotationsController({
    content,
    viewport,
    annotationToolbar,
    annotationStore,
    annotationGeometry,
    annotationApiEndpoint: ANNOTATION_API_ENDPOINT,
    getActiveDepartment: () => activeDepartment,
    getCurrentScriptId: () => currentScriptId,
    getCueEditorUnlocked: () => cuesManager.isCueEditorUnlocked(),
    getCueEditorKey: () => cuesManager.getCueEditorKey(),
    getDepartmentColor: () => cuesManager.departmentDefaultColor(),
    getPromptBlocks: promptBlocks,
    rebuildOverviewRail: () => overviewRailManager.rebuildOverviewRail(),
    scheduleToolbarHide: () => transport.scheduleToolbarHide(),
    onManualControl: () => {
        syncEngine.pauseFollowingForManualControl();
        transport.stopAutoScrollForManualControl();
        transport.stopDragMomentum();
    }
});

const syncEngine = createSyncEngine({
    viewport,
    content,
    toolbarSync,
    toolbarTransport,
    toolbarSliders,
    masterIdleBorder,
    syncEndpoint: SYNC_ENDPOINT,
    sseEndpoint: SSE_ENDPOINT,
    findSemanticPosition: () => semanticPosition.capture(),
    targetScrollForState: (state) => semanticPosition.toScrollTop(state),
    maxScrollTop: () => transport.maxScrollTop(),
    getScrollPos: () => transport.getScrollPos(),
    setScrollPos: (pos) => transport.setScrollPos(pos),
    getCurrentScriptId: () => currentScriptId,
    getAvailableScripts: () => availableScripts,
    loadShowScript: (id) => loadShowScript(id),
    isPlaying: () => transport.isPlaying(),
    setPlaying: (val) => transport.setPlaying(val),
    getSpeed: () => transport.getSpeed(),
    stopDragMomentum: () => transport.stopDragMomentum(),
    scheduleToolbarHide: () => transport.scheduleToolbarHide(),
    scheduleContextUpdate: () => contextHeaderManager.scheduleContextUpdate(),
    updateMasterPositionMarker: () => overviewRailManager.updateMasterPositionMarker(),
    handleAnnotationRevisionEvent: (e) => annotationsController.handleAnnotationRevisionEvent(e),
    handleCueRevisionEvent: (e) => cuesManager.handleCueRevisionEvent(e),
    handleDepartmentSettingsEvent: (e) => departmentSettings.handleDepartmentSettingsEvent(e),
    getActiveDepartment: () => activeDepartment,
    updateCueLockUi: () => cuesManager.updateCueLockUi()
});

if (toolbarTransport) toolbarTransport.controller = transport;
if (toolbarSliders) toolbarSliders.controller = transport;
if (toolbarSync) toolbarSync.controller = syncEngine;
if (annotationToolbar) annotationToolbar.controller = annotationsController;

const {openExportPanel, closeExportPanel, startPdfExport} = createPdfExporter({
    exportDialog,
    ALLOWED_DEPARTMENTS: allowedDepartments,
    CUE_API_ENDPOINT,
    ANNOTATION_API_ENDPOINT,
    SETTINGS_API_ENDPOINT,
    SCRIPT_GET_ENDPOINT,
    normalizeDepartmentMargin,
    departmentDefaultColor: (dept) => cuesManager.departmentDefaultColor(dept),
    getCurrentScriptId: () => currentScriptId,
    getActiveDepartment: () => activeDepartment,
    getAvailableScripts: () => availableScripts
});

function stageDirectionPrompt(promptId) {
    if (!promptId) return null;
    const block = content.querySelector('[data-prompt-id="' + CSS.escape(promptId) + '"]');
    return block && (block.classList.contains('stage-direction') || block.classList.contains('stage-inline')) ? block : null;
}

function applyStageDirectionVisibility() {
    content.classList.toggle('show-stage-directions', showStageDirections);
    for (const block of content.querySelectorAll('.stage-direction-forced')) block.classList.remove('stage-direction-forced');
    if (activeDepartment) {
        for (const cue of cuesManager.getLoadedCues()) {
            const prompts = [cue?.anchor?.prompt, cue?.endAnchor?.prompt];
            for (const prompt of prompts) {
                const block = stageDirectionPrompt(prompt);
                if (block) block.classList.add('stage-direction-forced');
            }
        }
    }
    if (toolbarDisplay) {
        toolbarDisplay.showStageDirections = showStageDirections;
    }
    annotationsController.scheduleAnnotationRender();
    requestAnimationFrame(() => {
        cuesManager.drawCueRanges();
        overviewRailManager.rebuildOverviewRail();
        contextHeaderManager.scheduleContextUpdate();
        overviewRailManager.updateMasterPositionMarker();
        cuesManager.updateCueEditorPositionMarkers();
    });
}

async function loadDepartments() {
    allowedDepartments = await fetchDepartments(SETTINGS_API_ENDPOINT);
    const meta = getDepartmentMetadata();
    if (toolbarSync) {
        toolbarSync.departmentMetadata = meta;
        toolbarSync.allowedDepartments = allowedDepartments;
    }
    if (exportDialog) {
        exportDialog.departmentMetadata = meta;
        exportDialog.allowedDepartments = allowedDepartments;
    }
    if (hasDeptQueryParam) {
        if (requestedDepartment && isAllowedDepartment(requestedDepartment)) {
            activeDepartment = requestedDepartment;
            try {
                localStorage.setItem(DEPARTMENT_STORAGE_KEY, activeDepartment);
            } catch (_) {}
        } else {
            activeDepartment = null;
            try {
                localStorage.removeItem(DEPARTMENT_STORAGE_KEY);
            } catch (_) {}
        }
    } else {
        const storedDept = getStoredDepartment();
        if (storedDept && isAllowedDepartment(storedDept)) {
            activeDepartment = storedDept;
        } else {
            activeDepartment = null;
        }
    }
    if (toolbarSync) toolbarSync.activeDepartment = activeDepartment;
}

async function loadAvailableScripts() {
    const r = await fetch(SCRIPT_LIST_ENDPOINT, {cache: "no-store"});
    if (r.status === 401) {
        window.location.href = "/login.php?redirect=" + encodeURIComponent(window.location.href);
        return;
    }
    if (!r.ok) throw new Error("script list");
    const data = await r.json();
    availableScripts = Array.isArray(data.scripts) ? data.scripts : [];
    if (toolbarNavigation) {
        toolbarNavigation.availableScripts = availableScripts;
    }
}

async function loadShowScript(id) {
    if (!availableScripts.some(s => s.id === id)) throw new Error("unknown script");
    const serial = ++scriptLoadSerial;
    const r = await fetch(SCRIPT_GET_ENDPOINT + "?id=" + encodeURIComponent(id), {cache: "no-store"});
    if (!r.ok) throw new Error("script load");
    const t = await r.text();
    if (serial !== scriptLoadSerial) return;
    content.innerHTML = t;
    overviewRailManager.resetPositionLines();
    currentScriptId = id;
    if (toolbarNavigation) toolbarNavigation.currentScriptId = id;
    refreshPromptBlockCache();
    populateNavigationSelectors();
    requestAnimationFrame(() => {
        overviewRailManager.rebuildOverviewRail();
        contextHeaderManager.scheduleContextUpdate();
    });
    if (activeDepartment) {
        try {
            await cuesManager.loadDepartmentCues();
        } catch (_) {
            syncEngine.setSyncStatus(activeDepartment + ": cue load error", "error");
        }
        try {
            await annotationsController.loadDepartmentAnnotations();
        } catch (_) { /* cached annotations remain available */ }
    }
    applyStageDirectionVisibility();
    transport.setScrollPos(0);
}

function populateNavigationSelectors() {
    refreshPromptBlockCache();

    const scenes = [];
    const songs = [];

    for (const block of cachedPromptBlocks) {
        const id = block.dataset.promptId;
        if (!id) continue;

        if (block.classList.contains("scene-heading")) {
            scenes.push({promptId: id, label: block.textContent.trim()});
        }

        if (block.classList.contains("song-heading")) {
            songs.push({promptId: id, label: block.textContent.trim()});
        }
    }

    if (toolbarNavigation) {
        toolbarNavigation.sceneList = scenes;
        toolbarNavigation.songList = songs;
    }

    requestAnimationFrame(() => {
        overviewRailManager.rebuildOverviewRail();
        contextHeaderManager.scheduleContextUpdate();
    });
}

function jumpToPromptId(promptId) {
    if (!promptId) return;

    syncEngine.pauseFollowingForManualControl();
    transport.stopAutoScrollForManualControl();
    transport.stopDragMomentum();

    const block = content.querySelector(
        '[data-prompt-id="' + CSS.escape(promptId) + '"]'
    );
    if (!block) return;

    const target =
        block.offsetTop -
        viewport.clientHeight * REFERENCE_LINE_FRACTION;

    transport.setScrollPos(Math.max(0, Math.min(transport.maxScrollTop(), target)));
    transport.scheduleToolbarHide();
}

function applyFontSize(size) {
    const val = size || currentFontSize || 42;
    currentFontSize = val;
    try {
        localStorage.setItem(FONT_SIZE_STORAGE_KEY, String(val));
    } catch (_) {}
    if (settingsDialog) {
        settingsDialog.fontSize = val;
    }
    syncEngine.preserveSemanticPositionDuringLayoutChange(() => {
        content.style.fontSize = val + "px";
    });
    requestAnimationFrame(() => {
        cuesManager.drawCueConnectors();
        cuesManager.drawCueRanges();
        annotationsController.scheduleAnnotationRender();
    });
}

function updateStatus() {
    if (toolbarSliders) {
        toolbarSliders.isPlaying = transport.isPlaying();
        toolbarSliders.speed = transport.getSpeed();
    }
}

async function attemptUnlock(key) {
    key = key || (toolbarSync ? toolbarSync.getPasswordValue() : "");
    if (!key) return;

    if (activeDepartment) {
        try {
            const ok = await cuesManager.authenticateCueEditor(key);
            if (!ok) {
                syncEngine.setSyncStatus(activeDepartment + ": wrong password", "error");
                return;
            }
            cuesManager.setCueEditorKey(key);
            cuesManager.setCueEditorUnlocked(true);
            if (toolbarSync) {
                toolbarSync.passwordOpen = false;
                toolbarSync.clearPassword();
            }
            cuesManager.updateCueLockUi();
            cuesManager.renderCues();
            await annotationsController.flushAnnotationQueue();
            syncEngine.setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");
        } catch (e) {
            syncEngine.setSyncStatus(activeDepartment + ": authentication error", "error");
            console.error(e);
        }
        return;
    }

    syncEngine.setMasterKey(key);
    await syncEngine.enterMasterMode(false);
}

async function restorePersistentLogin() {
    if (activeDepartment) {
        const ok = await cuesManager.authenticateCueEditor("");
        if (!ok) return false;
        cuesManager.setCueEditorKey("");
        cuesManager.setCueEditorUnlocked(true);
        cuesManager.updateCueLockUi();
        cuesManager.renderCues();
        annotationsController.scheduleAnnotationSync();
        syncEngine.setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");
        return true;
    }

    const ok = await syncEngine.masterCookieAuthenticated();
    if (!ok) return false;
    syncEngine.setMasterKey("");
    return await syncEngine.enterMasterMode(false);
}

if (toolbarSync) {
    toolbarSync.addEventListener("toggle-master", () => {
        if (activeDepartment) {
            if (cuesManager.isCueEditorUnlocked()) {
                cuesManager.logoutCueEditorCookie();
                cuesManager.setCueEditorKey("");
                cuesManager.setCueEditorUnlocked(false);
                toolbarSync.passwordOpen = false;
                toolbarSync.clearPassword();
                cuesManager.closeCueEditor();
                annotationsController.stopAnnotationMode();
                cuesManager.updateCueLockUi();
                cuesManager.renderCues();
                transport.scheduleToolbarHide();
                return;
            }

            toolbarSync.passwordOpen = !toolbarSync.passwordOpen;
            cuesManager.updateCueLockUi();
            if (toolbarSync.passwordOpen) setTimeout(() => toolbarSync.focusPassword(), 0);
            return;
        }

        if (syncEngine.getSyncMode() === "master") {
            syncEngine.logoutMasterCookie();
            syncEngine.setMasterKey("");
            syncEngine.setSyncMode("follow");
            transport.scheduleToolbarHide();
            transport.acquireWakeLock();
            return;
        }

        syncEngine.clearMasterConflictUi();
        toolbarSync.passwordOpen = !toolbarSync.passwordOpen;
        if (toolbarSync.passwordOpen) setTimeout(() => toolbarSync.focusPassword(), 0);
    });

    toolbarSync.addEventListener("cancel-password", () => {
        toolbarSync.clearPassword();
        toolbarSync.passwordOpen = false;
        syncEngine.clearMasterConflictUi();
    });

    toolbarSync.addEventListener("submit-password", (e) => {
        attemptUnlock(e.detail.password);
    });

    toolbarSync.addEventListener("take-control", async (e) => {
        syncEngine.setMasterKey(e.detail.password || (toolbarSync ? toolbarSync.getPasswordValue() : ""));
        const ok = await syncEngine.enterMasterMode(true);
        if (ok) {
            syncEngine.setSyncStatus("MASTER: live — control taken", "ok");
            await syncEngine.publishMasterState();
        }
    });

    toolbarSync.addEventListener("add-cue", () => cuesManager.openCueEditor(null));
    toolbarSync.addEventListener("annotate", annotationsController.startAnnotationMode);
    toolbarSync.addEventListener("next-cue", cuesManager.jumpToNextCue);
    toolbarSync.addEventListener("rejoin", syncEngine.rejoinMaster);
    toolbarSync.addEventListener("select-department", (e) => {
        const nextDept = (e.detail.department || "").trim().toUpperCase();
        try {
            if (nextDept) {
                localStorage.setItem(DEPARTMENT_STORAGE_KEY, nextDept);
            } else {
                localStorage.removeItem(DEPARTMENT_STORAGE_KEY);
            }
        } catch (_) {}
        const nextUrl = new URL(window.location.href);
        if (nextDept) {
            nextUrl.searchParams.set("dept", nextDept);
        } else {
            nextUrl.searchParams.delete("dept");
        }
        window.location.href = nextUrl.toString();
    });
}

if (settingsDialog) {
    settingsDialog.addEventListener("close", departmentSettings.closeSettingsPanel);
    settingsDialog.addEventListener("rail-side-change", (e) => {
        departmentSettings.setRailSide(e.detail.railSide);
    });
    settingsDialog.addEventListener("margin-change", (e) => {
        departmentSettings.queueDepartmentMarginSave(e.detail.side, e.detail.width);
    });
    settingsDialog.addEventListener("font-size-input", (e) => {
        applyFontSize(e.detail.fontSize);
    });
    settingsDialog.addEventListener("font-size-change", (e) => {
        applyFontSize(e.detail.fontSize);
    });
    settingsDialog.addEventListener("toggle-wakelock", async () => {
        transport.scheduleToolbarHide();
        await transport.toggleWakeLock();
    });
}

if (exportDialog) {
    exportDialog.addEventListener("export", (e) => startPdfExport(e.detail));
    exportDialog.addEventListener("close", closeExportPanel);
}

if (toolbarNavigation) {
    toolbarNavigation.addEventListener("select-script", async (e) => {
        const id = e.detail.scriptId;
        if (!id || id === currentScriptId) return;
        if (syncEngine.getSyncMode() !== "master") syncEngine.pauseFollowingForManualControl();
        try {
            await loadShowScript(id);
            if (syncEngine.getSyncMode() === "master") syncEngine.publishMasterState();
        } catch (e) {
            syncEngine.setSyncStatus("Script load error", "error");
            console.error(e);
        }
        transport.scheduleToolbarHide();
    });

    toolbarNavigation.addEventListener("jump-scene", (e) => {
        jumpToPromptId(e.detail.promptId);
    });

    toolbarNavigation.addEventListener("jump-song", (e) => {
        jumpToPromptId(e.detail.promptId);
    });
}

if (toolbarDisplay) {
    toolbarDisplay.addEventListener("toggle-fullscreen", transport.toggleFullscreen);
    toolbarDisplay.addEventListener("toggle-stage-directions", () => {
        showStageDirections = !showStageDirections;
        try {
            localStorage.setItem(STAGE_DIRECTIONS_STORAGE_KEY, String(showStageDirections));
        } catch (_) {}
        toolbarDisplay.showStageDirections = showStageDirections;
        applyStageDirectionVisibility();
    });
    toolbarDisplay.addEventListener("open-settings", departmentSettings.openSettingsPanel);
    toolbarDisplay.addEventListener("open-export", openExportPanel);
}

document.getElementById("follow-paused-click").addEventListener("click", () => {
    if (syncEngine.getSyncMode() === "follow" && !syncEngine.isFollowingLive()) {
        syncEngine.rejoinMaster();
    }
});

cuesManager.updateCueLockUi();
departmentSettings.loadDisplaySettings();
departmentSettings.applyDisplaySettings({preservePosition: false});

let cueTrackingScrollPending = false;
viewport.addEventListener("scroll", () => {
    contextHeaderManager.scheduleContextUpdate();
    if (!cueTrackingScrollPending && cueEditorDialog?.open && cuesManager.isCuePositionTracking?.()) {
        cueTrackingScrollPending = true;
        requestAnimationFrame(() => {
            cueTrackingScrollPending = false;
            cuesManager.updateTrackedCuePositionFromViewport();
        });
    }
}, {passive: true});

window.addEventListener("resize", () => {
    transport.syncScrollPosFromViewport();
    transport.clampScrollPos();
    requestAnimationFrame(() => {
        cuesManager.drawCueConnectors();
        cuesManager.drawCueRanges();
        annotationsController.scheduleAnnotationRender();
        overviewRailManager.rebuildOverviewRail();
        contextHeaderManager.scheduleContextUpdate();
    });
});

applyFontSize();
updateStatus();

async function initializeTeleprompter() {
    try {
        await loadDepartments();
        if (activeDepartment) {
            await departmentSettings.loadCentralDepartmentSettings({preservePosition: false});
        }
        await loadAvailableScripts();
        const requested = query.get("script");
        const first = availableScripts.length ? availableScripts[0].id : null;
        const chosen = availableScripts.some(s => s.id === requested) ? requested : first;
        if (!chosen) throw new Error("No scripts available");
        await loadShowScript(chosen);
        syncEngine.setSyncMode("follow");
        cuesManager.updateCueLockUi();
        await restorePersistentLogin();
    } catch (e) {
        content.innerHTML = "<div class='cue'><span class='dialog'>Could not load script.</span></div>";
        syncEngine.setSyncStatus("Script load error", "error");
        console.error(e);
    }
    transport.scheduleToolbarHide();
    await transport.acquireWakeLock();
}

await initializeTeleprompter();
