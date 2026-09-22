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
const ANNOTATION_API_ENDPOINT = "/scripts/annotation_api.php";
const SETTINGS_API_ENDPOINT = "/scripts/settings_api.php";
const RAIL_SIDE_STORAGE_KEY = "gaosTeleprompterRailSide";
const ALLOWED_DEPARTMENTS = ["FS", "LX", "SND", "STG"];
const DEPARTMENT_DEFAULT_COLORS = {
    FS: "#ffd000",
    LX: "#2f80ed",
    SND: "#27ae60",
    STG: "#00cfd5"
};
const REFERENCE_LINE_FRACTION = 0.35;

const query = new URLSearchParams(window.location.search);
const requestedDepartment = (query.get("dept") || "").toUpperCase();
const activeDepartment = ALLOWED_DEPARTMENTS.includes(requestedDepartment)
    ? requestedDepartment
    : null;

let availableScripts = [];
let currentScriptId = null;
let scriptLoadSerial = 0;
let showStageDirections = false;
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

const annotationGeometry = createAnnotationGeometry({
    content,
    fontSizeInput: {
        get value() {
            return toolbarSliders ? toolbarSliders.fontSize : 42;
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
    departmentDefaultColors: DEPARTMENT_DEFAULT_COLORS,
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

const {openExportPanel, closeExportPanel, startPdfExport} = createPdfExporter({
    exportDialog,
    ALLOWED_DEPARTMENTS,
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

async function loadAvailableScripts() {
    const r = await fetch(SCRIPT_LIST_ENDPOINT, {cache: "no-store"});
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
    const val = size || (toolbarSliders ? toolbarSliders.fontSize : 42);
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
    const text = (transport.isPlaying() ? "Playing" : "Paused") + " | Speed: " + transport.getSpeed().toFixed(1);
    if (toolbarSliders) toolbarSliders.statusText = text;
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
    toolbarSync.addEventListener("sync-status-click", () => {
        if (syncEngine.getSyncMode() === "follow" && !syncEngine.isFollowingLive()) {
            syncEngine.rejoinMaster();
        }
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
    toolbarDisplay.addEventListener("toggle-wakelock", async () => {
        transport.scheduleToolbarHide();
        await transport.toggleWakeLock();
    });
    toolbarDisplay.addEventListener("toggle-stage-directions", () => {
        showStageDirections = !showStageDirections;
        toolbarDisplay.showStageDirections = showStageDirections;
        applyStageDirectionVisibility();
    });
    toolbarDisplay.addEventListener("open-settings", departmentSettings.openSettingsPanel);
    toolbarDisplay.addEventListener("open-export", openExportPanel);
}

if (toolbarSliders) {
    toolbarSliders.addEventListener("font-size-input", (e) => {
        applyFontSize(e.detail.fontSize);
    });
    toolbarSliders.addEventListener("font-size-change", (e) => {
        applyFontSize(e.detail.fontSize);
    });
}

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
