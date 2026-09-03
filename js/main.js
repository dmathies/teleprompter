import { contrastingTextColor, formatHealthAge, healthClass, hslToRgb } from "./utils.js";
import { createPdfExporter } from "./pdf-export.js";
import { createSemanticPositionApi } from "./semantic-position.js";
import { createAnnotationStore } from "./annotation-store.js";
import { cueTextNodes, cueWordEntries, wrapCueTriggerWord as wrapCueTriggerWordElement } from "./cue-text.js";
import { createAnnotationGeometry } from "./annotation-geometry.js";
import { getTeleprompterDom } from "./dom.js";
import { stateAgeAtDeliveryMs, motionSignature } from "./sync-protocol.js";

const {
  viewport,
  content,
  contextHeader,
  headerAct,
  headerScene,
  headerPage,
  overviewRail,
  overviewMarkers,
  overviewViewportIndicator,
  playPauseBtn,
  backBtn,
  slowerBtn,
  fasterBtn,
  topBtn,
  bottomBtn,
  fullscreenBtn,
  wakeLockBtn,
  stageDirectionsBtn,
  settingsBtn,
  settingsBackdrop,
  settingsPanel,
  railSideSelect,
  settingsMarginControls,
  annotationMarginSideSelect,
  annotationMarginWidth,
  annotationMarginWidthValue,
  settingsSaveStatus,
  settingsDoneBtn,
  exportBtn,
  exportBackdrop,
  exportPanel,
  exportDepartment,
  exportStageDirections,
  exportCues,
  exportAnnotations,
  exportStatus,
  exportCancelBtn,
  exportOpenBtn,
  overviewMasterIndicator,
  speedInput,
  speedControl,
  fontSizeInput,
  status,
  scriptSelect,
  sceneSelect,
  songSelect,
  rejoinBtn,
  syncStatus,
  masterHealthStatus,
  masterIdleBorder,
  masterBtn,
  passwordPanel,
  masterPassword,
  masterLoginBtn,
  takeControlBtn,
  masterCancelBtn,
  deptLabel,
  addCueBtn,
  annotateBtn,
  nextCueBtn,
  annotationTools,
  annotationColor,
  annotationWidth,
  annotationUndoBtn,
  annotationDoneBtn,
  annotationSyncStatus,
  cueEditorPanel,
  cueEditorTitle,
  cueNumber,
  cueDescription,
  cueColor,
  cueAnchorInfo,
  cueWordRow,
  cueChooseWordBtn,
  cueWordInfo,
  cueUseEndCurrentBtn,
  cueClearEndBtn,
  cueEndInfo,
  cueEditorError,
  cueUseCurrentBtn,
  cueDeleteBtn,
  cueCancelBtn,
  cueSaveBtn
} = getTeleprompterDom();


    content.innerHTML =
      "<div class='cue'><span class='dialog'>Loading script…</span></div>";

    let playing = false;
    let speed = parseFloat(speedInput.value);
    let lastTime = null;
    let scrollPos = 0;

    // Smooth wheel scrolling state
    let wheelVelocity = 0;
    let wheelAnimating = false;

    // Toolbar auto-hide
    const TOOLBAR_HIDE_DELAY_MS = 3500;
    let toolbarHideTimer = null;

    // Screen Wake Lock
    let wakeLock = null;
    let wakeLockWanted = true;

    // Pointer drag state
    let isDragging = false;
    let activePointerId = null;
    let lastPointerY = 0;
    let lastPointerTime = 0;
    let dragVelocity = 0; // pixels per millisecond
    let dragMomentumFrame = null;

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
    const MASTER_SEND_INTERVAL_MS = 250;
    const MASTER_IDLE_HEARTBEAT_MS = 2000;

    const FOLLOW_POLL_INTERVAL_MS = 250;
    const FOLLOW_IDLE_AFTER_MS = 10000;
    const FOLLOW_IDLE_POLL_MS = 2000;
    const FOLLOW_SLEEP_AFTER_MS = 60 * 60 * 1000;
    const FOLLOW_SLEEP_POLL_MS = 60000;
    const FOLLOW_BUFFER_MS = 1250;
    const FOLLOW_AVERAGE_WINDOW_MS = 3000;
    const FOLLOW_MAX_WAIT_MS = 3000;
    const FOLLOW_WAIT_EPSILON_PX = 2;
    // Match the server-side master ownership lease. A state older than this
    // cannot prove that a master is still active and must never move a follower.
    const FOLLOW_STATE_STALE_MS = 10000;
    const REFERENCE_LINE_FRACTION = 0.35;
    const MASTER_HEARTBEAT_OK_MS = 3500;
    const MASTER_HEARTBEAT_WARN_MS = 6500;
    const SERVER_HEARTBEAT_OK_MS = 7000;
    const SERVER_HEARTBEAT_WARN_MS = 12000;
    const MASTER_AUTO_WARN_MS = 30000;
    const MASTER_AUTO_ERROR_MS = 120000;
    const MASTER_IDLE_BORDER_ENABLED = false; // optional; enable later if desired
    const MASTER_BORDER_START_MS = 4000;
    const MASTER_BORDER_RED_MS = 15000;

    let syncMode = "follow";
    let masterKey = "";
    const masterSessionStorageKey = "teleprompterMasterSessionId";
    let masterSessionId = sessionStorage.getItem(masterSessionStorageKey) || "";
    if (!masterSessionId) {
      masterSessionId = (crypto.randomUUID ? crypto.randomUUID() :
        (Date.now().toString(36) + "-" + Math.random().toString(36).slice(2)));
      sessionStorage.setItem(masterSessionStorageKey, masterSessionId);
    }
    let masterControlConflict = false;
    let railSide = "right";
    let departmentMargin = {side:"none", width:20};
    let departmentSettingsRevision = 0;
    let departmentSettingsLoadSerial = 0;
    let departmentSettingsSaveRunning = false;
    let departmentSettingsSavePending = false;
    let availableScripts = [];
    let currentScriptId = null;
    let scriptLoadSerial = 0;

    // Department cue layer. A department URL remains a normal follower;
    // its password unlocks cue editing only, not ASM/master control.
    let activeDepartment = null;
    let cueEditorKey = "";
    let cueEditorUnlocked = false;
    let loadedCues = [];
    let cueRevision = 0;
    let cueLoadSerial = 0;
    let editingCue = null;
    let editingAnchorPrompt = null;
    let editingAnchorWordIndex = null;
    let editingAnchorWordText = "";
    let editingAnchorFraction = 0;
    let cueWordPickActive = false;
    let editingEndPosition = null;
    let cuePositionTracking = null; // null, "start", or "end" while interactively choosing a cue position
    let showStageDirections = false;
    let masterPositionLine = null;
    let cueStartPositionLine = null;
    let cueEndPositionLine = null;

    // Vector annotations. Geometry is stored relative to a semantic prompt
    // block, not screen pixels. Reference font size is retained so stroke
    // weights scale sensibly when each device uses a different font size.
    let loadedAnnotations = [];
    let annotationRevision = 0;
    let annotationLoadSerial = 0;
    let annotationMode = false;
    let annotationTool = "pen";
    let annotationDraft = null;
    let annotationPointerId = null;
    let annotationUndoStack = [];
    let annotationRenderPending = false;
    let annotationFlushRunning = false;
    let annotationSyncDebounceTimer = null;
    let annotationPreviousTool = null;
    let penAnnotationPointerId = null;
    let penEraseActive = false;
    let penPaletteAutoVisible = false;
    let eraserTrailCanvas = null;
    let eraserTrailCtx = null;
    let eraserLastPoint = null;
    let eraserDeletedIds = new Set();
    const ANNOTATION_ERASER_WIDTH_PX = 10;
    let syncSequence = 0;
    let masterTimer = null;
    let masterRequestInFlight = false;
    let masterAbortController = null;
    let lastMasterStateSignature = null;
    let lastMasterSendAt = 0;
    let lastMasterInteractionPerf = performance.now();
    let lastMasterServerAckPerf = null;
    let lastMasterHeartbeatPerf = null;
    let lastMasterHeartbeatBaseMs = null;
    let lastMasterHeartbeatSamplePerf = null;
    let lastMasterInteractionBaseMs = null;
    let lastMasterInteractionSamplePerf = null;
    let lastServerHeartbeatPerf = null;

    let followTimer = null;
    let followEventSource = null;
    let followTransport = "none";
    let sseFallbackTimer = null;
    let sseHasOpened = false;
    let latestRemoteState = null;
    let latestRemoteStateAgeAtReceiveMs = null;
    let latestRemoteStateReceivedPerf = null;
    let remoteStateExpiryTimer = null;
    let lastRemoteMotionSignature = null;
    let lastRemoteMotionAt = performance.now();
    let followingLive = true;
    let followTargetScrollTop = null;
    let followSamples = [];
    let followClockServerMs = null;
    let followClockPerfMs = null;
    let lastRemotePlaying = null;
    let lastRenderedFollowPosition = null;
    let followWaitingSince = null;
    let followDirection = 0; // +1 forward, -1 reverse, 0 unknown/stationary
    let syncAnimationRunning = false;
    // Protect followers from a single transient packet that maps to the very
    // beginning of the script. A genuine jump-to-top is accepted when a
    // second consecutive master update confirms it.
    let pendingTopJump = null;
    const FOLLOW_TOP_GUARD_FRACTION = 0.025;
    const FOLLOW_TOP_GUARD_FROM_FRACTION = 0.15;
    const FOLLOW_TOP_GUARD_CONFIRM_MS = 1800;

    let cachedPromptBlocks = [];

    function refreshPromptBlockCache() {
      cachedPromptBlocks =
        Array.from(content.querySelectorAll("[data-prompt-id]"));
    }

    const promptBlocks = () => cachedPromptBlocks;

    const semanticPosition = createSemanticPositionApi({
      content, viewport, getPromptBlocks: promptBlocks,
      referenceLineFraction: REFERENCE_LINE_FRACTION
    });
    const annotationStore = createAnnotationStore();
    const annotationGeometry = createAnnotationGeometry({
      content, fontSizeInput,
      getDepartmentMargin: () => departmentMarginSetting(),
      getActiveDepartment: () => activeDepartment,
      getDepartmentColor: () => departmentDefaultColor()
    });
    const currentScriptFontPx = () => annotationGeometry.currentScriptFontPx();
    const promptLineHeightPx = block => annotationGeometry.lineHeightPx(block);
    const promptHorizontalGeometry = block => annotationGeometry.horizontalGeometry(block);
    const annotationPointToPx = (point, geometry, blockHeight, lineHeight, ann) => annotationGeometry.pointToPx(point, geometry, blockHeight, lineHeight, ann);
    const svgElement = (name, attrs={}) => annotationGeometry.svgElement(name, attrs);
    const buildAnnotationShape = (svg, ann, geometry, height, lineHeight) => annotationGeometry.buildShape(svg, ann, geometry, height, lineHeight);
    const clearAnnotationLayers = () => annotationGeometry.clearLayers();


    async function loadAvailableScripts() {
      const r = await fetch(SCRIPT_LIST_ENDPOINT, {cache:"no-store"});
      if (!r.ok) throw new Error("script list");
      const data = await r.json();
      availableScripts = Array.isArray(data.scripts) ? data.scripts : [];
      scriptSelect.innerHTML = "";
      for (const item of availableScripts) {
        const o = document.createElement("option");
        o.value = item.id; o.textContent = item.name;
        scriptSelect.appendChild(o);
      }
    }

    function referenceBlock() {
      const blocks = promptBlocks();
      if (!blocks.length) return null;

      const y =
        viewport.scrollTop +
        viewport.clientHeight * REFERENCE_LINE_FRACTION;

      let chosen = blocks[0];
      for (const block of blocks) {
        if (block.offsetTop <= y) chosen = block;
        else break;
      }
      return chosen;
    }

    function previousMatchingBlock(fromBlock, predicate) {
      const blocks = promptBlocks();
      let index = blocks.indexOf(fromBlock);
      if (index < 0) index = blocks.length - 1;

      for (let i = index; i >= 0; --i) {
        if (predicate(blocks[i])) return blocks[i];
      }
      return null;
    }

    function extractActLabel(text) {
      const match = String(text || "").match(
        /\bACT\s+(ONE|TWO|THREE|FOUR|FIVE|I{1,3}|IV|V|\d+)\b/i
      );
      return match ? ("Act " + match[1]) : null;
    }

    function updateContextHeader() {
      const current = referenceBlock();
      if (!current) {
        headerAct.textContent = "Act —";
        headerScene.textContent = "Scene —";
        headerPage.textContent = "Page —";
        updateOverviewViewport();
        return;
      }

      const scene = previousMatchingBlock(
        current,
        b => b.classList.contains("scene-heading")
      );

      let sceneText = scene ? scene.textContent.trim() : "—";
      headerScene.textContent =
        /^scene\b/i.test(sceneText) || /^prologue\b/i.test(sceneText)
          ? sceneText
          : ("Scene " + sceneText);

      // Act/page metadata are optional. If future script HTML includes
      // data-act/data-page attributes they appear automatically.
      let act =
        current.dataset.act ||
        (scene && scene.dataset.act) ||
        null;

      if (!act) {
        const actBlock = previousMatchingBlock(
          current,
          b =>
            b.classList.contains("act-heading") ||
            !!b.dataset.act ||
            !!extractActLabel(b.textContent)
        );
        if (actBlock) {
          act = actBlock.dataset.act || extractActLabel(actBlock.textContent);
        }
      }

      let page = current.dataset.page || null;
      if (!page) {
        const pageBlock = previousMatchingBlock(
          current,
          b => !!b.dataset.page
        );
        if (pageBlock) page = pageBlock.dataset.page;
      }

      headerAct.textContent = act ? String(act) : "Act —";
      headerPage.textContent = page ? ("Page " + page) : "Page —";
      updateOverviewViewport();
    }

    let contextUpdatePending = false;
    function scheduleContextUpdate() {
      if (contextUpdatePending) return;
      contextUpdatePending = true;
      requestAnimationFrame(() => {
        contextUpdatePending = false;
        updateContextHeader();
      });
    }

    const semanticDocumentY = position => semanticPosition.toDocumentY(position);

    function ensurePositionLine(kind) {
      let line = kind === 'master' ? masterPositionLine : (kind === 'start' ? cueStartPositionLine : cueEndPositionLine);
      if (line && line.isConnected) return line;
      line = document.createElement('div');
      line.id = kind === 'master' ? 'masterPositionLine' : (kind === 'start' ? 'cueStartPositionLine' : 'cueEndPositionLine');
      line.hidden = true;
      content.appendChild(line);
      if (kind === 'master') masterPositionLine = line;
      else if (kind === 'start') cueStartPositionLine = line;
      else cueEndPositionLine = line;
      return line;
    }

    function updateMasterPositionMarker() {
      const show = syncMode === 'follow' && !followingLive && latestRemoteState && latestRemoteState.script === currentScriptId;
      const line = ensurePositionLine('master');
      if (!show) {
        line.hidden = true;
        overviewMasterIndicator.hidden = true;
        return;
      }
      const y = semanticDocumentY(latestRemoteState);
      if (y === null) { line.hidden = true; overviewMasterIndicator.hidden = true; return; }
      line.style.top = y + 'px';
      line.hidden = false;
      const total = Math.max(1, content.scrollHeight);
      overviewMasterIndicator.style.top = Math.max(0, Math.min(100, y / total * 100)) + '%';
      overviewMasterIndicator.hidden = false;
    }

    function updateTrackedCuePositionFromViewport() {
      if (cueEditorPanel.hidden || !cuePositionTracking) return;
      const pos = findSemanticPosition();
      if (!pos || !pos.prompt) return;

      if (cuePositionTracking === 'start') {
        editingAnchorPrompt = pos.prompt;
        editingAnchorFraction = pos.fraction;
        if (departmentUsesWordAnchors()) {
          editingAnchorWordIndex = null;
          editingAnchorWordText = '';
        }
      } else if (cuePositionTracking === 'end') {
        editingEndPosition = { prompt: pos.prompt, fraction: pos.fraction };
      }
      updateCueAnchorUi();
    }

    function updateCueEditorPositionMarkers() {
      const startLine = ensurePositionLine('start');
      const endLine = ensurePositionLine('end');
      if (cueEditorPanel.hidden) { startLine.hidden = true; endLine.hidden = true; return; }
      const startPos = editingAnchorPrompt ? {prompt:editingAnchorPrompt, fraction:editingAnchorFraction} : null;
      let sy = semanticDocumentY(startPos);
      const startBlock = editingAnchorPrompt && content.querySelector('[data-prompt-id="' + CSS.escape(editingAnchorPrompt) + '"]');
      if (startBlock && departmentUsesWordAnchors() && Number.isInteger(editingAnchorWordIndex)) {
        const trigger = startBlock.querySelector('.cue-trigger-word[data-word-index="' + CSS.escape(String(editingAnchorWordIndex)) + '"]');
        if (trigger) sy = startBlock.offsetTop + trigger.offsetTop + trigger.offsetHeight * .5;
      }
      if (sy !== null) { startLine.style.top = sy + 'px'; startLine.hidden = false; } else startLine.hidden = true;
      const ey = semanticDocumentY(editingEndPosition);
      if (ey !== null) { endLine.style.top = ey + 'px'; endLine.hidden = false; } else endLine.hidden = true;
    }

    function stageDirectionPrompt(promptId) {
      if (!promptId) return null;
      const block = content.querySelector('[data-prompt-id="' + CSS.escape(promptId) + '"]');
      return block && (block.classList.contains('stage-direction') || block.classList.contains('stage-inline')) ? block : null;
    }

    function applyStageDirectionVisibility() {
      content.classList.toggle('show-stage-directions', showStageDirections);
      for (const block of content.querySelectorAll('.stage-direction-forced')) block.classList.remove('stage-direction-forced');
      if (activeDepartment) {
        for (const cue of loadedCues) {
          const prompts = [cue && cue.anchor && cue.anchor.prompt, cue && cue.endAnchor && cue.endAnchor.prompt];
          for (const prompt of prompts) {
            const block = stageDirectionPrompt(prompt);
            if (block) block.classList.add('stage-direction-forced');
          }
        }
      }
      stageDirectionsBtn.classList.toggle('active', showStageDirections);
      stageDirectionsBtn.title = showStageDirections ? 'Hide stage directions' : 'Show stage directions';
      stageDirectionsBtn.setAttribute('aria-label', stageDirectionsBtn.title);
      scheduleAnnotationRender();
      requestAnimationFrame(() => { drawCueRanges(); rebuildOverviewRail(); scheduleContextUpdate(); updateMasterPositionMarker(); updateCueEditorPositionMarkers(); });
    }

    function rebuildOverviewRail() {
      overviewMarkers.innerHTML = "";
      const total = Math.max(1, content.scrollHeight);

      function addMark(kind, top, color, title) {
        const mark = document.createElement("div");
        mark.className = "overview-mark " + kind;
        mark.style.top =
          Math.max(0, Math.min(100, top / total * 100)) + "%";
        if (color) mark.style.background = color;
        if (title) mark.title = title;
        overviewMarkers.appendChild(mark);
      }

      // Prefer explicit Act headings; fall back to metadata transitions.
      const explicitActs = content.querySelectorAll(".act-heading");
      if (explicitActs.length) {
        for (const block of explicitActs) {
          addMark(
            "act",
            block.offsetTop,
            null,
            block.dataset.act || block.textContent.trim()
          );
        }
      } else {
        let lastAct = null;
        for (const block of cachedPromptBlocks) {
          const act = block.dataset.act || extractActLabel(block.textContent);
          if (act && act !== lastAct) {
            addMark("act", block.offsetTop, null, String(act));
            lastAct = act;
          }
        }
      }

      for (const block of content.querySelectorAll(".scene-heading[data-prompt-id]")) {
        addMark("scene", block.offsetTop, null, block.textContent.trim());
      }

      for (const cue of loadedCues) {
        const prompt = cue && cue.anchor && cue.anchor.prompt;
        if (!prompt) continue;
        const block = content.querySelector(
          '[data-prompt-id="' + CSS.escape(prompt) + '"]'
        );
        if (!block) continue;
        const color = cue.color || departmentDefaultColor();
        addMark(
          "cue",
          block.offsetTop,
          color,
          activeDepartment + " " + (cue.number || "")
        );
      }

      for (const cue of loadedCues) {
        const end = cue && cue.endAnchor;
        const y = semanticDocumentY(end);
        if (y === null) continue;
        addMark('cue-end', y, cue.color || departmentDefaultColor(), activeDepartment + ' ' + (cue.number || '') + ' end');
      }

      for (const ann of loadedAnnotations) {
        if (!ann || !ann.prompt) continue;
        const block = content.querySelector(
          '[data-prompt-id="' + CSS.escape(ann.prompt) + '"]'
        );
        if (!block) continue;
        if (getComputedStyle(block).display === 'none') continue;

        const point = ann.at || ann.from ||
          (Array.isArray(ann.points) && ann.points.length ? ann.points[0] : null);
        const y = point && Number.isFinite(Number(point[1])) ? Number(point[1]) : 0;
        const yScale = ann.coordMode === 'block'
          ? Math.max(1, block.clientHeight)
          : promptLineHeightPx(block);
        const annotationTop = block.offsetTop + y * yScale;
        const color = ann.color || departmentDefaultColor();
        const detail = ann.type === "text" && ann.text
          ? ": " + String(ann.text).slice(0, 50)
          : "";

        addMark(
          "annotation",
          annotationTop,
          color,
          activeDepartment + " annotation (" + (ann.type || "drawing") + ")" + detail
        );
      }

      updateOverviewViewport();
      updateMasterPositionMarker();
    }

    function updateOverviewViewport() {
      const railHeight = overviewRail.clientHeight;
      const contentHeight = Math.max(1, content.scrollHeight);
      const viewportHeight = viewport.clientHeight;
      const maxScroll = Math.max(1, contentHeight - viewportHeight);

      const indicatorHeight = Math.max(
        10,
        Math.min(
          railHeight,
          railHeight * viewportHeight / contentHeight
        )
      );

      const top =
        (viewport.scrollTop / maxScroll) *
        Math.max(0, railHeight - indicatorHeight);

      overviewViewportIndicator.style.height = indicatorHeight + "px";
      overviewViewportIndicator.style.top = top + "px";
    }

    function currentReferencePromptId() {
      return semanticPosition.currentPromptId();
    }

    function departmentDefaultColor(dept = activeDepartment) {
      return DEPARTMENT_DEFAULT_COLORS[dept] || "#ffd000";
    }

    function clearCueDecorations() {
      for (const block of content.querySelectorAll("[data-prompt-id]")) {
        block.classList.remove("prompt-with-cues");
        block.style.removeProperty("--cue-border");

        const markers = block.querySelector(":scope > .cue-markers");
        if (markers) markers.remove();

        const connector = block.querySelector(":scope > .cue-connector-layer");
        if (connector) connector.remove();
        for (const endMarker of block.querySelectorAll(":scope > .cue-end-marker")) endMarker.remove();

        for (const span of block.querySelectorAll(".cue-trigger-word")) {
          span.replaceWith(document.createTextNode(span.textContent || ""));
        }
        block.normalize();
      }
      for (const line of content.querySelectorAll(":scope > .cue-range-line")) line.remove();
      for (const endMarker of content.querySelectorAll(":scope > .cue-end-marker")) endMarker.remove();
    }

    function wrapCueTriggerWord(block, cue) {
      return wrapCueTriggerWordElement(block, cue, cue.color || departmentDefaultColor());
    }

    function drawCueConnectors() {
      for (const block of content.querySelectorAll(".prompt-with-cues")) {
        const old = block.querySelector(":scope > .cue-connector-layer");
        if (old) old.remove();

        const connectorPairs = [];
        for (const badge of block.querySelectorAll(".cue-marker[data-trigger-word-index]")) {
          const idx = badge.dataset.triggerWordIndex;
          const target = block.querySelector(
            '.cue-trigger-word[data-word-index="' + CSS.escape(idx) + '"]'
          );
          if (target) connectorPairs.push([badge, target]);
        }

        if (!connectorPairs.length) continue;

        const blockRect = block.getBoundingClientRect();
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.classList.add("cue-connector-layer");
        svg.setAttribute("viewBox", "0 0 " + blockRect.width + " " + blockRect.height);
        svg.setAttribute("preserveAspectRatio", "none");

        for (const [badge, target] of connectorPairs) {
          const br = badge.getBoundingClientRect();
          const tr = target.getBoundingClientRect();

          const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
          line.classList.add("cue-connector-line");
          line.setAttribute("x1", String(br.left - blockRect.left + br.width * 0.5));
          line.setAttribute("y1", String(br.bottom - blockRect.top));
          line.setAttribute("x2", String(tr.left - blockRect.left + tr.width * 0.5));
          line.setAttribute("y2", String(tr.top - blockRect.top + tr.height * 0.5));
          line.setAttribute("stroke", badge.style.getPropertyValue("--cue-color") || departmentDefaultColor());
          svg.appendChild(line);
        }

        block.insertBefore(svg, block.firstChild);
      }
    }

    function drawCueRanges() {
      for (const old of content.querySelectorAll(":scope > .cue-range-line")) old.remove();
      if (!activeDepartment || !loadedCues.length) return;

      for (const cue of loadedCues) {
        if (!cue || !cue.anchor || !cue.anchor.prompt || !cue.endAnchor || !cue.endAnchor.prompt) continue;
        const startY = semanticDocumentY(cue.anchor);
        const endY = semanticDocumentY(cue.endAnchor);
        if (startY === null || endY === null || endY <= startY) continue;

        const line = document.createElement("div");
        line.className = "cue-range-line";
        line.dataset.cueId = cue.id || "";
        line.style.setProperty("--cue-color", cue.color || departmentDefaultColor());
        line.style.top = startY + "px";
        line.style.height = Math.max(1, endY - startY) + "px";
        content.appendChild(line);
      }
    }

    function renderCues() {
      clearCueDecorations();
      if (!activeDepartment || !loadedCues.length) {
        applyStageDirectionVisibility();
        nextCueBtn.hidden = !activeDepartment;
        requestAnimationFrame(() => {
          rebuildOverviewRail();
          scheduleContextUpdate();
        });
        return;
      }

      const byPrompt = new Map();
      for (const cue of loadedCues) {
        const prompt = cue && cue.anchor && cue.anchor.prompt;
        if (!prompt) continue;
        if (!byPrompt.has(prompt)) byPrompt.set(prompt, []);
        byPrompt.get(prompt).push(cue);
      }

      for (const [prompt, cues] of byPrompt.entries()) {
        const block = content.querySelector('[data-prompt-id="' + CSS.escape(prompt) + '"]');
        if (!block) continue;

        block.classList.add("prompt-with-cues");

        const holder = document.createElement("div");
        holder.className = "cue-markers";

        for (const cue of cues) {
          const cueColorValue = cue.color || departmentDefaultColor();
          const badge = document.createElement("span");
          badge.className = "cue-marker" + (cueEditorUnlocked ? " cue-editable" : "");
          badge.style.setProperty("--cue-color", cueColorValue);
          badge.style.setProperty("--cue-text-color", contrastingTextColor(cueColorValue));
          badge.dataset.cueId = cue.id;

          const number = document.createElement("span");
          number.className = "cue-number";
          number.textContent = activeDepartment + " " + (cue.number || "");
          badge.appendChild(number);

          if (cue.description) {
            const desc = document.createElement("span");
            desc.textContent = cue.description;
            badge.appendChild(desc);
          }

          if (cue.anchor && cue.anchor.type === "word") {
            const trigger = wrapCueTriggerWord(block, cue);
            if (trigger) {
              badge.dataset.triggerWordIndex = String(cue.anchor.wordIndex);
              trigger.style.setProperty("--cue-color", cueColorValue);
            }
          }

          if (cueEditorUnlocked) {
            badge.title = "Edit cue";
            badge.addEventListener("pointerdown", (e) => {
              e.stopPropagation();
            });
            badge.addEventListener("click", (e) => {
              e.preventDefault();
              e.stopPropagation();
              openCueEditor(cue);
            });
          }

          holder.appendChild(badge);
        }

        block.insertBefore(holder, block.firstChild);
      }

      for (const cue of loadedCues) {
        if (!cue || !cue.endAnchor || !cue.endAnchor.prompt) continue;
        const endY = semanticDocumentY(cue.endAnchor);
        if (endY === null) continue;
        const marker = document.createElement('div');
        marker.className = 'cue-end-marker';
        marker.style.setProperty('--cue-color', cue.color || departmentDefaultColor());
        marker.style.top = endY + 'px';
        marker.dataset.cueId = cue.id || '';
        const label = document.createElement('span');
        label.textContent = 'END ' + activeDepartment + ' ' + (cue.number || '');
        marker.appendChild(label);
        content.appendChild(marker);
      }
      applyStageDirectionVisibility();

      nextCueBtn.hidden = false;
      requestAnimationFrame(() => {
        drawCueConnectors();
        drawCueRanges();
        rebuildOverviewRail();
        scheduleContextUpdate();
      });
    }

    async function loadDepartmentCues({preserveExisting=false} = {}) {
      if (!activeDepartment || !currentScriptId) return;

      const script = currentScriptId;
      const department = activeDepartment;
      const serial = ++cueLoadSerial;

      if (!preserveExisting) {
        loadedCues = [];
        cueRevision = 0;
        clearCueDecorations();
      }

      const url = CUE_API_ENDPOINT +
        "?action=get&script=" + encodeURIComponent(script) +
        "&dept=" + encodeURIComponent(department) +
        "&_=" + Date.now();

      const response = await fetch(url, {cache: "no-store"});
      if (!response.ok) throw new Error("Cue load HTTP " + response.status);
      const body = await response.json();
      if (serial !== cueLoadSerial ||
          script !== currentScriptId || department !== activeDepartment) return;
      loadedCues = Array.isArray(body.cues) ? body.cues : [];
      cueRevision = Number(body.revision) || 0;
      renderCues();
    }

    async function authenticateCueEditor(key = "") {
      const headers = {"Content-Type": "application/json"};
      if (key) headers["X-Cue-Key"] = key;

      const response = await fetch(CUE_API_ENDPOINT + "?action=auth", {
        method: "POST",
        headers,
        cache: "no-store",
        body: JSON.stringify({department: activeDepartment})
      });
      await response.text();
      return response.ok;
    }

    async function logoutCueEditorCookie() {
      if (!activeDepartment) return;
      try {
        await fetch(CUE_API_ENDPOINT + "?action=logout", {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          cache: "no-store",
          body: JSON.stringify({department: activeDepartment})
        });
      } catch (_) {}
    }

    async function masterCookieAuthenticated() {
      try {
        const response = await fetch(syncUrl() + "&auth=status", {cache:"no-store"});
        if (!response.ok) return false;
        const body = await response.json();
        return !!body.authenticated;
      } catch (_) {
        return false;
      }
    }

    async function logoutMasterCookie() {
      try {
        await fetch(syncUrl() + "&auth=logout", {cache:"no-store"});
      } catch (_) {}
    }

    async function claimMasterControl(force = false) {
      const headers = {
        "Content-Type": "application/json",
        "X-Teleprompter-Key": masterKey
      };
      const response = await fetch(syncUrl() + "&control=claim", {
        method: "POST", headers, cache: "no-store",
        body: JSON.stringify({sessionId: masterSessionId, force: !!force})
      });
      let body = {};
      try { body = await response.json(); } catch (_) {}
      return {response, body};
    }

    function showMasterConflict(message = "MASTER: another controller is active") {
      masterControlConflict = true;
      masterKey = masterKey || "";
      setSyncMode("follow");
      passwordPanel.hidden = false;
      masterPassword.hidden = true;
      masterLoginBtn.hidden = true;
      takeControlBtn.hidden = false;
      setSyncStatus(message, "warn");
    }

    function clearMasterConflictUi() {
      masterControlConflict = false;
      masterPassword.hidden = false;
      masterLoginBtn.hidden = false;
      takeControlBtn.hidden = true;
    }

    async function enterMasterMode(force = false) {
      const {response, body} = await claimMasterControl(force);
      if (response.status === 409) {
        showMasterConflict("MASTER: another controller is active");
        return false;
      }
      if (response.status === 401 || response.status === 403) {
        masterKey = "";
        clearMasterConflictUi();
        setSyncStatus("MASTER: wrong password", "error");
        return false;
      }
      if (!response.ok) {
        setSyncStatus("MASTER: control error", "error");
        return false;
      }
      clearMasterConflictUi();
      passwordPanel.hidden = true;
      masterPassword.value = "";
      setSyncMode("master");
      return true;
    }

    async function restorePersistentLogin() {
      if (activeDepartment) {
        const ok = await authenticateCueEditor("");
        if (!ok) return false;
        cueEditorKey = "";
        cueEditorUnlocked = true;
        updateCueLockUi();
        renderCues();
        scheduleAnnotationSync();
        setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");
        return true;
      }

      const ok = await masterCookieAuthenticated();
      if (!ok) return false;
      masterKey = "";
      return await enterMasterMode(false);
    }

    async function cueMutation(action, payload) {
      const response = await fetch(CUE_API_ENDPOINT + "?action=" + encodeURIComponent(action), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Cue-Key": cueEditorKey
        },
        cache: "no-store",
        body: JSON.stringify({
          script: currentScriptId,
          department: activeDepartment,
          ...payload
        })
      });

      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch (_) {}
      if (!response.ok) throw new Error((body && body.error) || "Cue update failed");
      return body || {};
    }

    function updateCueLockUi() {
      const deptMode = !!activeDepartment;
      deptLabel.textContent = deptMode ? activeDepartment : "ASM";

      if (deptMode) {
        nextCueBtn.hidden = false;
        masterBtn.textContent = cueEditorUnlocked ? "🔓" : "🔒";
        masterBtn.classList.toggle("master-active", cueEditorUnlocked);
        masterBtn.title = cueEditorUnlocked
          ? "Lock " + activeDepartment + " editing"
          : "Unlock " + activeDepartment + " editing";
        masterBtn.setAttribute("aria-label", masterBtn.title);
        addCueBtn.hidden = !cueEditorUnlocked;
        annotateBtn.hidden = !cueEditorUnlocked;
        masterPassword.placeholder = activeDepartment + " password";
        masterPassword.setAttribute("aria-label", activeDepartment + " cue editor password");
        masterLoginBtn.title = "Unlock " + activeDepartment + " cue editing";
      } else {
        nextCueBtn.hidden = true;
        addCueBtn.hidden = true;
        annotateBtn.hidden = true;
        masterPassword.placeholder = "Master password";
        masterPassword.setAttribute("aria-label", "Master password");
        masterLoginBtn.title = "Authenticate as master";
      }
      syncSettingsControls();
      if (cueEditorUnlocked && departmentSettingsSavePending && !departmentSettingsSaveRunning) {
        flushDepartmentMarginSave();
      }
    }

    function departmentUsesWordAnchors(dept = activeDepartment) {
      return dept === "LX" || dept === "SND" || dept === "STG";
    }

    function updateCueAnchorUi() {
      const wordMode = departmentUsesWordAnchors();
      cueWordRow.hidden = !wordMode;

      cueAnchorInfo.textContent = editingAnchorPrompt || "No prompt selected";

      if (wordMode) {
        cueWordInfo.textContent =
          Number.isInteger(editingAnchorWordIndex)
            ? ('"' + editingAnchorWordText + '"')
            : "No trigger word selected";
      } else {
        cueWordInfo.textContent = "";
      }
      cueEndInfo.textContent = editingEndPosition
        ? (editingEndPosition.prompt + ' @ ' + Math.round((Number(editingEndPosition.fraction)||0) * 100) + '%')
        : 'No end position';

      cueUseCurrentBtn.hidden = !editingCue;
      cueUseCurrentBtn.classList.toggle('active', cuePositionTracking === 'start');
      cueUseEndCurrentBtn.classList.toggle('active', cuePositionTracking === 'end');
      cueUseCurrentBtn.textContent = cuePositionTracking === 'start' ? 'Choosing start position…' : 'Change start position';
      cueUseEndCurrentBtn.textContent = cuePositionTracking === 'end' ? 'Choosing end position…' : 'Choose end position';
      updateCueEditorPositionMarkers();
    }

    function openCueEditor(cue = null) {
      if (!activeDepartment || !cueEditorUnlocked) return;

      editingCue = cue;
      const currentCuePosition = findSemanticPosition();
      editingAnchorPrompt =
        cue && cue.anchor ? cue.anchor.prompt : (currentCuePosition ? currentCuePosition.prompt : currentReferencePromptId());
      editingAnchorFraction = cue && cue.anchor
        ? Math.max(0, Math.min(1, Number(cue.anchor.fraction) || 0))
        : (currentCuePosition ? currentCuePosition.fraction : 0);

      editingAnchorWordIndex =
        cue && cue.anchor && cue.anchor.type === "word" &&
        Number.isInteger(Number(cue.anchor.wordIndex))
          ? Number(cue.anchor.wordIndex)
          : null;

      editingAnchorWordText =
        cue && cue.anchor && cue.anchor.type === "word"
          ? (cue.anchor.text || "")
          : "";

      editingEndPosition = cue && cue.endAnchor && cue.endAnchor.prompt
        ? { prompt: cue.endAnchor.prompt, fraction: Math.max(0, Math.min(1, Number(cue.endAnchor.fraction) || 0)) }
        : null;
      cuePositionTracking = cue ? null : 'start';

      cueEditorTitle.textContent =
        cue ? ("Edit " + activeDepartment + " Cue") :
              ("Add " + activeDepartment + " Cue");

      cueNumber.value = cue ? (cue.number || "") : "";
      cueDescription.value = cue ? (cue.description || "") : "";
      cueColor.value =
        cue && /^#[0-9A-Fa-f]{6}$/.test(cue.color || "")
          ? cue.color
          : departmentDefaultColor();

      cueDeleteBtn.hidden = !cue;
      cueEditorError.textContent = "";
      updateCueAnchorUi();
      cueEditorPanel.hidden = false;
      updateCueEditorPositionMarkers();
      setTimeout(() => cueNumber.focus(), 0);
    }

    function stopCueWordPick() {
      cueWordPickActive = false;
      document.body.classList.remove("cue-word-pick");
    }

    function closeCueEditor() {
      stopCueWordPick();
      cueEditorPanel.hidden = true;
      editingCue = null;
      editingAnchorPrompt = null;
      editingAnchorFraction = 0;
      editingAnchorWordIndex = null;
      editingAnchorWordText = "";
      editingEndPosition = null;
      cuePositionTracking = null;
      cueEditorError.textContent = "";
      updateCueEditorPositionMarkers();
    }

    function startCueWordPick() {
      if (!departmentUsesWordAnchors()) return;
      cueWordPickActive = true;
      document.body.classList.add("cue-word-pick");
      cueEditorPanel.hidden = true;
      setSyncStatus(activeDepartment + ": click trigger word", "warn");
    }

    function wordAtPoint(clientX, clientY) {
      let range = null;

      if (document.caretPositionFromPoint) {
        const pos = document.caretPositionFromPoint(clientX, clientY);
        if (pos && pos.offsetNode && pos.offsetNode.nodeType === Node.TEXT_NODE) {
          range = document.createRange();
          range.setStart(pos.offsetNode, pos.offset);
          range.collapse(true);
        }
      } else if (document.caretRangeFromPoint) {
        range = document.caretRangeFromPoint(clientX, clientY);
      }

      if (!range || !range.startContainer || range.startContainer.nodeType !== Node.TEXT_NODE) {
        return null;
      }

      const node = range.startContainer;
      const block = node.parentElement && node.parentElement.closest("[data-prompt-id]");
      if (!block) return null;
      if (node.parentElement.closest(".cue-markers")) return null;

      const entries = cueWordEntries(block);
      const offset = range.startOffset;
      let entry = entries.find(e => e.node === node && offset >= e.start && offset <= e.end);

      // Clicking very near a word boundary can produce the adjacent offset.
      if (!entry) {
        entry = entries.find(e => e.node === node && offset >= e.start - 1 && offset <= e.end + 1);
      }

      if (!entry) return null;

      return {
        prompt: block.dataset.promptId,
        wordIndex: entry.index,
        text: entry.text
      };
    }

    async function saveCueFromEditor() {
      if (!editingAnchorPrompt) {
        cueEditorError.textContent = "Choose an anchor position first.";
        return;
      }

      const number = cueNumber.value.trim();
      const description = cueDescription.value.trim();
      if (!number) {
        cueEditorError.textContent = "Cue number is required.";
        return;
      }

      const anchor = departmentUsesWordAnchors() && Number.isInteger(editingAnchorWordIndex)
        ? {
            type: "word",
            prompt: editingAnchorPrompt,
            fraction: Math.max(0, Math.min(1, Number(editingAnchorFraction) || 0)),
            wordIndex: editingAnchorWordIndex,
            text: editingAnchorWordText
          }
        : {
            type: "paragraph",
            prompt: editingAnchorPrompt,
            fraction: Math.max(0, Math.min(1, Number(editingAnchorFraction) || 0))
          };

      cueSaveBtn.disabled = true;
      cueEditorError.textContent = "";
      try {
        await cueMutation("save", {
          cue: {
            id: editingCue ? editingCue.id : null,
            number,
            description,
            color: cueColor.value,
            anchor,
            endAnchor: editingEndPosition ? {
              prompt: editingEndPosition.prompt,
              fraction: Math.max(0, Math.min(1, Number(editingEndPosition.fraction) || 0))
            } : null
          }
        });
        closeCueEditor();
        await loadDepartmentCues();
      } catch (err) {
        cueEditorError.textContent = err.message || "Could not save cue.";
      } finally {
        cueSaveBtn.disabled = false;
      }
    }

    async function deleteCueFromEditor() {
      if (!editingCue || !confirm("Delete " + activeDepartment + " cue " + (editingCue.number || "") + "?")) return;
      cueDeleteBtn.disabled = true;
      cueEditorError.textContent = "";
      try {
        await cueMutation("delete", {id: editingCue.id});
        closeCueEditor();
        await loadDepartmentCues();
      } catch (err) {
        cueEditorError.textContent = err.message || "Could not delete cue.";
      } finally {
        cueDeleteBtn.disabled = false;
      }
    }


    // ------------------------------------------------------------
    // Department annotations
    // ------------------------------------------------------------

    function annotationCacheKey(script = currentScriptId, dept = activeDepartment) {
      return annotationStore.key(script, dept);
    }
    const annotationDbGetDoc = key => annotationStore.getDoc(key);
    const annotationDbPutDoc = (script, dept, revision, annotations) => annotationStore.putDoc(script, dept, revision, annotations);
    const annotationDbAddOp = op => annotationStore.addOp(op);
    const annotationDbDeleteOp = id => annotationStore.deleteOp(id);
    const annotationDbOpsFor = key => annotationStore.opsFor(key);

    async function updateAnnotationSyncLabel() {
      if (!activeDepartment || !currentScriptId) {
        annotationSyncStatus.textContent = '';
        return;
      }
      const pending = await annotationDbOpsFor(annotationCacheKey());
      if (annotationFlushRunning) annotationSyncStatus.textContent = 'syncing…';
      else if (annotationSyncDebounceTimer !== null) annotationSyncStatus.textContent = 'saving…';
      else if (pending.length) annotationSyncStatus.textContent = navigator.onLine ? (pending.length + ' pending') : ('offline · ' + pending.length);
      else annotationSyncStatus.textContent = navigator.onLine ? 'saved' : 'offline';
    }

    function renderAnnotations() {
      clearAnnotationLayers();
      if (!activeDepartment || (!loadedAnnotations.length && !annotationDraft)) return;

      const byPrompt = new Map();
      const all = annotationDraft ? loadedAnnotations.concat([annotationDraft]) : loadedAnnotations;
      for (const ann of all) {
        if (!ann || !ann.prompt) continue;
        if (!byPrompt.has(ann.prompt)) byPrompt.set(ann.prompt, []);
        byPrompt.get(ann.prompt).push(ann);
      }

      for (const [prompt, annotations] of byPrompt.entries()) {
        const block = content.querySelector('[data-prompt-id="' + CSS.escape(prompt) + '"]');
        if (!block) continue;
        block.classList.add('prompt-with-annotations');
        const geometry = promptHorizontalGeometry(block);
        const height = Math.max(1, block.clientHeight);
        const lineHeight = promptLineHeightPx(block);
        const svg = svgElement('svg', {width:'100%', height:'100%'});
        svg.classList.add('annotation-layer');
        svg.dataset.promptId = prompt;
        for (const ann of annotations) {
          const shape = buildAnnotationShape(svg, ann, geometry, height, lineHeight);
          if (shape) svg.appendChild(shape);
        }
        block.appendChild(svg);
      }
    }

    function scheduleAnnotationRender() {
      if (annotationRenderPending) return;
      annotationRenderPending = true;
      requestAnimationFrame(() => {
        annotationRenderPending = false;
        renderAnnotations();
      });
    }

    async function loadDepartmentAnnotations({preferCache=true, preserveExisting=false} = {}) {
      if (!activeDepartment || !currentScriptId) return;

      const script = currentScriptId;
      const department = activeDepartment;
      const key = annotationCacheKey(script, department);
      const serial = ++annotationLoadSerial;

      if (!preserveExisting) {
        loadedAnnotations = [];
        annotationRevision = 0;
        annotationDraft = null;
        clearAnnotationLayers();
      }

      if (preferCache) {
        const cached = await annotationDbGetDoc(key);
        if (serial !== annotationLoadSerial ||
            script !== currentScriptId || department !== activeDepartment) return;
        if (cached && Array.isArray(cached.annotations)) {
          loadedAnnotations = cached.annotations;
          annotationRevision = Number(cached.revision) || 0;
          renderAnnotations();
          requestAnimationFrame(rebuildOverviewRail);
        }

        // Never overwrite locally queued offline edits with an older server
        // copy. They remain visible until the editor unlocks and syncs them.
        const pending = await annotationDbOpsFor(key);
        if (serial !== annotationLoadSerial ||
            script !== currentScriptId || department !== activeDepartment) return;
        if (pending.length) {
          updateAnnotationSyncLabel();
          if (cueEditorUnlocked && navigator.onLine) flushAnnotationQueue();
          return;
        }
      }

      try {
        const url = ANNOTATION_API_ENDPOINT +
          '?action=get&script=' + encodeURIComponent(script) +
          '&dept=' + encodeURIComponent(department) + '&_=' + Date.now();
        const response = await fetch(url, {cache:'no-store'});
        if (!response.ok) throw new Error('Annotation load HTTP ' + response.status);
        const body = await response.json();
        if (serial !== annotationLoadSerial ||
            script !== currentScriptId || department !== activeDepartment) return;
        loadedAnnotations = Array.isArray(body.annotations) ? body.annotations : [];
        annotationRevision = Number(body.revision) || 0;
        await annotationDbPutDoc(script, department, annotationRevision, loadedAnnotations);
        renderAnnotations();
        requestAnimationFrame(rebuildOverviewRail);
      } catch (_) {
        // Cached annotations remain visible. This is intentional show-time
        // behaviour when the device or venue network is offline.
      }
      updateAnnotationSyncLabel();
    }

    function makeAnnotationId() {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') {
        return activeDepartment.toLowerCase() + '-ann-' + window.crypto.randomUUID();
      }
      return activeDepartment.toLowerCase() + '-ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }


    function scheduleAnnotationSync(delay = 500) {
      if (annotationSyncDebounceTimer !== null) {
        clearTimeout(annotationSyncDebounceTimer);
      }
      annotationSyncDebounceTimer = setTimeout(() => {
        annotationSyncDebounceTimer = null;
        flushAnnotationQueue();
      }, delay);
      updateAnnotationSyncLabel();
    }

    function clearAnnotationSyncDebounce() {
      if (annotationSyncDebounceTimer !== null) {
        clearTimeout(annotationSyncDebounceTimer);
        annotationSyncDebounceTimer = null;
      }
    }

    function penPressure(e) {
      const p = Number(e && e.pressure);
      // Some devices report 0.5 for contact when pressure sensing is absent.
      return Number.isFinite(p) && p > 0 ? Math.max(0.05, Math.min(1, p)) : 0.5;
    }

    function isPenEraserEvent(e) {
      return !!(e && e.pointerType === 'pen' &&
        (e.button === 5 || ((Number(e.buttons) || 0) & 32) !== 0));
    }

    function isPenBarrelEraserEvent(e) {
      return !!(e && e.pointerType === 'pen' &&
        (e.button === 2 || ((Number(e.buttons) || 0) & 2) !== 0));
    }

    function annotationIdAtPoint(clientX, clientY) {
      // Temporarily enable SVG hit testing without putting the whole page into
      // annotation mode. This lets the flipped pen/barrel button erase while
      // fingers continue to scroll normally.
      document.body.classList.add('annotation-erase');
      const target = document.elementFromPoint(clientX, clientY);
      const shape = target && target.closest ? target.closest('[data-annotation-id]') : null;
      const id = shape && shape.dataset ? shape.dataset.annotationId : '';
      if (!penEraseActive && !annotationMode) document.body.classList.remove('annotation-erase');
      return id || '';
    }

    function eraseAnnotationAtPenPoint(e) {
      const id = annotationIdAtPoint(e.clientX, e.clientY);
      if (id) {
        applyAnnotationLocal('delete', {id});
        scheduleAnnotationSync(500);
        return true;
      }
      return false;
    }


    function showAutoPenPalette() {
      if (!activeDepartment || !cueEditorUnlocked) return;
      if (!penPaletteAutoVisible && !annotationMode) {
        setAnnotationTool('pen');
      }
      annotationTools.hidden = false;
      penPaletteAutoVisible = !annotationMode;
      updateAnnotationSyncLabel();
    }

    function hideAutoPenPalette() {
      if (!penPaletteAutoVisible || annotationMode) return;
      penPaletteAutoVisible = false;
      annotationTools.hidden = true;
      document.body.classList.remove('annotation-erase');
    }

    function ensureEraserTrailCanvas() {
      if (eraserTrailCanvas) return eraserTrailCanvas;
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-hidden', 'true');
      Object.assign(canvas.style, {
        position:'fixed', inset:'0', width:'100%', height:'100%',
        pointerEvents:'none', zIndex:'1900'
      });
      document.body.appendChild(canvas);
      eraserTrailCanvas = canvas;
      eraserTrailCtx = canvas.getContext('2d');
      return canvas;
    }

    function resizeEraserTrailCanvas() {
      const canvas = ensureEraserTrailCanvas();
      const dpr = Math.max(1, window.devicePixelRatio || 1);
      const w = Math.max(1, window.innerWidth);
      const h = Math.max(1, window.innerHeight);
      if (canvas.width !== Math.round(w*dpr) || canvas.height !== Math.round(h*dpr)) {
        canvas.width = Math.round(w*dpr);
        canvas.height = Math.round(h*dpr);
      }
      eraserTrailCtx.setTransform(dpr,0,0,dpr,0,0);
      eraserTrailCtx.lineCap = 'round';
      eraserTrailCtx.lineJoin = 'round';
    }

    function clearEraserTrail() {
      if (!eraserTrailCanvas || !eraserTrailCtx) return;
      eraserTrailCtx.setTransform(1,0,0,1,0,0);
      eraserTrailCtx.clearRect(0,0,eraserTrailCanvas.width,eraserTrailCanvas.height);
      eraserLastPoint = null;
    }

    function annotationIdsNearPoint(clientX, clientY, radius = ANNOTATION_ERASER_WIDTH_PX/2) {
      const ids = new Set();
      const step = Math.max(3, radius * .7);
      const offsets = [
        [0,0], [radius,0], [-radius,0], [0,radius], [0,-radius],
        [step,step], [step,-step], [-step,step], [-step,-step]
      ];
      document.body.classList.add('annotation-erase');
      for (const [dx,dy] of offsets) {
        for (const el of document.elementsFromPoint(clientX+dx, clientY+dy)) {
          const shape = el && el.closest ? el.closest('[data-annotation-id]') : null;
          const id = shape && shape.dataset ? shape.dataset.annotationId : '';
          if (id) ids.add(id);
        }
      }
      if (!annotationMode && !penEraseActive && annotationTool !== 'erase') {
        document.body.classList.remove('annotation-erase');
      }
      return ids;
    }

    function eraseAnnotationsAlongSegment(x1,y1,x2,y2) {
      const dist = Math.hypot(x2-x1, y2-y1);
      const spacing = Math.max(2, ANNOTATION_ERASER_WIDTH_PX * .35);
      const steps = Math.max(1, Math.ceil(dist / spacing));
      for (let i=0; i<=steps; i++) {
        const t = steps ? i/steps : 0;
        const x = x1 + (x2-x1)*t;
        const y = y1 + (y2-y1)*t;
        for (const id of annotationIdsNearPoint(x,y,ANNOTATION_ERASER_WIDTH_PX/2)) {
          if (eraserDeletedIds.has(id)) continue;
          eraserDeletedIds.add(id);
          applyAnnotationLocal('delete', {id});
        }
      }
    }

    function startEraserStroke(e) {
      resizeEraserTrailCanvas();
      clearEraserTrail();
      eraserDeletedIds = new Set();
      eraserLastPoint = {x:e.clientX, y:e.clientY};
      penEraseActive = true;
      document.body.classList.add('annotation-erase');
      eraseAnnotationsAlongSegment(e.clientX,e.clientY,e.clientX,e.clientY);
    }

    function moveEraserStroke(e) {
      if (!eraserLastPoint) return;
      const from = eraserLastPoint;
      const to = {x:e.clientX, y:e.clientY};
      eraserTrailCtx.beginPath();
      eraserTrailCtx.moveTo(from.x, from.y);
      eraserTrailCtx.lineTo(to.x, to.y);
      eraserTrailCtx.strokeStyle = 'rgba(255,255,255,.32)';
      eraserTrailCtx.lineWidth = ANNOTATION_ERASER_WIDTH_PX;
      eraserTrailCtx.stroke();
      eraseAnnotationsAlongSegment(from.x,from.y,to.x,to.y);
      eraserLastPoint = to;
    }

    function endEraserStroke() {
      const removedAny = eraserDeletedIds.size > 0;
      penEraseActive = false;
      eraserDeletedIds = new Set();
      setTimeout(clearEraserTrail, 120);
      if (!annotationMode && annotationTool !== 'erase') document.body.classList.remove('annotation-erase');
      if (removedAny) scheduleAnnotationSync(500);
    }

    async function annotationServerMutation(action, payload) {
      const response = await fetch(ANNOTATION_API_ENDPOINT + '?action=' + encodeURIComponent(action), {
        method:'POST',
        headers:{
          'Content-Type':'application/json',
          'X-Cue-Key':cueEditorKey
        },
        cache:'no-store',
        body:JSON.stringify({
          script:currentScriptId,
          department:activeDepartment,
          ...payload
        })
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch (_) {}
      if (!response.ok) throw new Error((body && body.error) || 'Annotation update failed');
      return body || {};
    }

    async function queueAnnotationMutation(action, payload) {
      if (!activeDepartment || !currentScriptId) return;
      const script = currentScriptId;
      const department = activeDepartment;
      const key = annotationCacheKey(script, department);
      const opId = await annotationDbAddOp({key, script, department, action, payload, createdAt:Date.now()});
      await annotationDbPutDoc(script, department, annotationRevision, loadedAnnotations);
      updateAnnotationSyncLabel();

      // IndexedDB should be available on normal show devices. If it is not,
      // still save immediately while online rather than silently dropping the
      // change. Offline persistence requires IndexedDB.
      if (opId === null) {
        if (navigator.onLine && cueEditorUnlocked) {
          try {
            const body = await annotationServerMutation(action, payload);
            annotationRevision = Math.max(annotationRevision, Number(body.revision) || 0);
            annotationSyncStatus.textContent = 'saved';
          } catch (_) {
            annotationSyncStatus.textContent = 'not saved';
          }
        } else {
          annotationSyncStatus.textContent = 'offline · not cached';
        }
        return;
      }

      scheduleAnnotationSync(500);
    }

    async function applyAnnotationLocal(action, payload, {recordUndo=true} = {}) {
      // A local edit wins over any older server document currently in flight.
      annotationLoadSerial++;
      if (action === 'save' && payload.annotation) {
        const ann = payload.annotation;
        const idx = loadedAnnotations.findIndex(a => a && a.id === ann.id);
        const previous = idx >= 0 ? JSON.parse(JSON.stringify(loadedAnnotations[idx])) : null;
        if (idx >= 0) loadedAnnotations[idx] = ann;
        else loadedAnnotations.push(ann);
        if (recordUndo) {
          annotationUndoStack.push(previous
            ? {action:'save', payload:{annotation:previous}}
            : {action:'delete', payload:{id:ann.id}});
        }
      } else if (action === 'delete' && payload.id) {
        const idx = loadedAnnotations.findIndex(a => a && a.id === payload.id);
        if (idx >= 0) {
          const previous = JSON.parse(JSON.stringify(loadedAnnotations[idx]));
          loadedAnnotations.splice(idx,1);
          if (recordUndo) annotationUndoStack.push({action:'save', payload:{annotation:previous}});
        }
      }
      renderAnnotations();
      requestAnimationFrame(rebuildOverviewRail);
      await queueAnnotationMutation(action, payload);
    }

    async function flushAnnotationQueue() {
      if (annotationFlushRunning || !navigator.onLine || !cueEditorUnlocked || !activeDepartment || !currentScriptId) {
        updateAnnotationSyncLabel();
        return;
      }
      annotationFlushRunning = true;
      updateAnnotationSyncLabel();
      const key = annotationCacheKey();
      try {
        const ops = await annotationDbOpsFor(key);
        for (const op of ops) {
          if (!navigator.onLine || !cueEditorUnlocked) break;
          try {
            const body = await annotationServerMutation(op.action, op.payload || {});
            annotationRevision = Math.max(annotationRevision, Number(body.revision) || 0);
            await annotationDbDeleteOp(op.id);
          } catch (err) {
            // Keep the operation for retry. 403 typically means the editor
            // must unlock again; network failures are retried on `online`.
            break;
          }
        }
        // Do not reload the server document here. A new stroke may already
        // be visible locally but still be in the tiny asynchronous window
        // before its IndexedDB operation has been committed. Reloading at
        // this point could replace that newer local drawing with the older
        // server snapshot, making rapid consecutive strokes appear to vanish.
        //
        // Keep the optimistic local document authoritative while draining
        // the mutation queue. SSE revision handling still refreshes from the
        // server when there are genuinely no pending local operations.
        await annotationDbPutDoc(currentScriptId, activeDepartment, annotationRevision, loadedAnnotations);

        const remaining = await annotationDbOpsFor(key);
        if (remaining.length && navigator.onLine && cueEditorUnlocked) {
          scheduleAnnotationSync(40);
        }
      } finally {
        annotationFlushRunning = false;
        updateAnnotationSyncLabel();
      }
    }

    function normalizedPointForBlock(block, clientX, clientY) {
      const rect = block.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return [0,0];
      const lineHeight = promptLineHeightPx(block);
      const geometry = promptHorizontalGeometry(block);

      return annotationGeometry.normalizePoint(
        (clientX - rect.left - geometry.offset) / geometry.width,
        (clientY - rect.top) / lineHeight
      );
    }

    function promptBlockAtPoint(clientX, clientY) {
      const el = document.elementFromPoint(clientX, clientY);
      if (!el || !el.closest) return null;

      const direct = el.closest('[data-prompt-id]');
      if (direct) return direct;

      // Controls and the overview rail must not accidentally start a drawing.
      if (el.closest('#toolbar, #annotationTools, #cueEditorPanel, #settingsPanel, #settingsBackdrop, #overviewRail, #contextHeader')) {
        return null;
      }

      const viewportRect = viewport.getBoundingClientRect();
      const contentRect = content.getBoundingClientRect();
      if (clientX < contentRect.left || clientX > contentRect.right ||
          clientY < viewportRect.top || clientY > viewportRect.bottom) {
        return null;
      }

      // Margins between semantic blocks belong to the nearest visible block.
      // Y coordinates may extend beyond an anchor block, so the existing data
      // format already represents drawings that begin in these gaps.
      let nearest = null;
      let nearestDistance = Infinity;
      for (const block of promptBlocks()) {
        const rect = block.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) continue;
        const distance = clientY < rect.top
          ? rect.top - clientY
          : clientY > rect.bottom
            ? clientY - rect.bottom
            : 0;
        if (distance < nearestDistance) {
          nearest = block;
          nearestDistance = distance;
        }
      }
      return nearest;
    }

    function setAnnotationTool(tool) {
      annotationTool = tool;
      document.body.classList.toggle('annotation-erase', annotationMode && tool === 'erase');
      for (const btn of annotationTools.querySelectorAll('[data-ann-tool]')) {
        btn.classList.toggle('active', btn.dataset.annTool === tool);
      }
    }

    function startAnnotationMode() {
      if (!activeDepartment || !cueEditorUnlocked) return;
      pauseFollowingForManualControl();
      stopAutoScrollForManualControl();
      stopDragMomentum();
      annotationMode = true;
      penPaletteAutoVisible = false;
      annotationTools.hidden = false;
      annotationColor.value = departmentDefaultColor();
      document.body.classList.add('annotation-mode');
      setAnnotationTool(annotationTool || 'pen');
      scheduleToolbarHide();
      updateAnnotationSyncLabel();
    }

    function stopAnnotationMode() {
      annotationMode = false;
      penPaletteAutoVisible = false;
      annotationDraft = null;
      annotationPointerId = null;
      annotationTools.hidden = true;
      clearAnnotationSyncDebounce();
      document.body.classList.remove('annotation-mode','annotation-erase');
      renderAnnotations();
    }

    function startAnnotationGesture(e, options = {}) {
      const penAuto = !!options.penAuto;
      const gestureTool = options.tool || annotationTool;
      if ((!annotationMode && !penAuto) || !cueEditorUnlocked) return false;

      if (gestureTool === 'erase') {
        annotationPointerId = e.pointerId;
        startEraserStroke(e);
        try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
        return true;
      }

      const block = promptBlockAtPoint(e.clientX, e.clientY);
      if (!block || !block.dataset.promptId) return true;
      const point = normalizedPointForBlock(block, e.clientX, e.clientY);

      if (annotationTool === 'text') {
        const text = prompt('Annotation text:');
        if (text && text.trim()) {
          const ann = {
            id:makeAnnotationId(), type:'text', prompt:block.dataset.promptId,
            at:point, text:text.trim().slice(0,160), color:annotationColor.value,
            width:Number(annotationWidth.value)||3, fontPx:currentScriptFontPx(),
            lineHeightPx:promptLineHeightPx(block), coordMode:'line'
          };
          applyAnnotationLocal('save', {annotation:ann});
          scheduleAnnotationSync(500);
        }
        return true;
      }

      annotationPointerId = e.pointerId;
      const base = {
        id:makeAnnotationId(), type:gestureTool === 'pen' ? 'stroke' : gestureTool,
        prompt:block.dataset.promptId, color:annotationColor.value,
        width:Number(annotationWidth.value)||3, fontPx:currentScriptFontPx(),
        lineHeightPx:promptLineHeightPx(block), coordMode:'line'
      };
      if (base.type === 'stroke') { base.points = [point, point]; base.pressures = [penPressure(e), penPressure(e)]; }
      else { base.from = point; base.to = point; }
      annotationDraft = base;
      scheduleAnnotationRender();
      try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
      return true;
    }

    function moveAnnotationGesture(e) {
      if (annotationPointerId !== e.pointerId) return false;
      if (penEraseActive && annotationTool === 'erase') {
        moveEraserStroke(e);
        return true;
      }
      if (!annotationDraft) return false;
      const block = content.querySelector('[data-prompt-id="' + CSS.escape(annotationDraft.prompt) + '"]');
      if (!block) return true;
      const point = normalizedPointForBlock(block, e.clientX, e.clientY);
      if (annotationDraft.type === 'stroke') {
        const pts = annotationDraft.points;
        const last = pts[pts.length-1];
        const geometry = promptHorizontalGeometry(block);
        const dx = (point[0]-last[0]) * geometry.width;
        const dy = (point[1]-last[1]) * promptLineHeightPx(block);
        if (dx*dx + dy*dy >= 2.25) { pts.push(point); if (Array.isArray(annotationDraft.pressures)) annotationDraft.pressures.push(penPressure(e)); }
      } else {
        annotationDraft.to = point;
      }
      scheduleAnnotationRender();
      return true;
    }

    function endAnnotationGesture(e) {
      if (annotationPointerId !== e.pointerId) return false;
      if (penEraseActive && annotationTool === 'erase') {
        annotationPointerId = null;
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        endEraserStroke();
        return true;
      }
      const ann = annotationDraft;
      annotationPointerId = null;
      annotationDraft = null;
      try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
      if (!ann) return true;

      if (ann.type === 'stroke' && ann.points.length < 2) return true;
      applyAnnotationLocal('save', {annotation:ann});
      scheduleAnnotationSync(500);
      if (e.pointerType === 'pen') {
        penAnnotationPointerId = null;
        penEraseActive = false;
        if (!annotationMode) document.body.classList.remove('annotation-erase');
      }
      if (annotationTool === 'erase' && annotationPreviousTool) {
        setAnnotationTool(annotationPreviousTool);
        annotationPreviousTool = null;
      }
      return true;
    }

    async function undoAnnotationChange() {
      const undo = annotationUndoStack.pop();
      if (!undo) return;
      await applyAnnotationLocal(undo.action, undo.payload, {recordUndo:false});
    }

    async function handleAnnotationRevisionEvent(event) {
      if (!activeDepartment || !currentScriptId) return;
      let body = null;
      try { body = JSON.parse(event.data); } catch (_) { return; }
      const revisions = body && body.revisions;
      if (!revisions || typeof revisions !== 'object') return;
      const entry = revisions[currentScriptId + '_' + activeDepartment];
      if (!entry || Number(entry.revision) <= annotationRevision) return;

      const pending = await annotationDbOpsFor(annotationCacheKey());
      if (pending.length) {
        flushAnnotationQueue();
        return;
      }
      loadDepartmentAnnotations({preferCache:false, preserveExisting:true});
    }

    async function handleCueRevisionEvent(event) {
      if (!activeDepartment || !currentScriptId) return;
      let body = null;
      try { body = JSON.parse(event.data); } catch (_) { return; }
      const revisions = body && body.revisions;
      if (!revisions || typeof revisions !== 'object') return;
      const entry = revisions[currentScriptId + '_' + activeDepartment];
      if (!entry || Number(entry.revision) <= cueRevision) return;

      try {
        await loadDepartmentCues({preserveExisting:true});
      } catch (_) {
        // Keep the currently rendered cues. The next signal or page/script
        // reload will retry without disrupting live follower operation.
      }
    }

    function handleDepartmentSettingsEvent(event) {
      if (!activeDepartment || departmentSettingsSaveRunning || departmentSettingsSavePending) return;
      let body = null;
      try { body = JSON.parse(event.data); } catch (_) { return; }
      const entry = body && body.departments && body.departments[activeDepartment];
      if (!entry || Number(entry.revision) <= departmentSettingsRevision) return;
      departmentSettingsRevision = Math.max(0, Number(entry.revision) || 0);
      departmentMargin = normalizeDepartmentMargin(entry.annotationMargin);
      applyDisplaySettings();
      if (!settingsPanel.hidden) setSettingsSaveStatus("Updated from central settings.");
    }

    async function loadShowScript(id) {
      if (!availableScripts.some(s => s.id === id)) throw new Error("unknown script");
      const serial = ++scriptLoadSerial;
      const r = await fetch(SCRIPT_GET_ENDPOINT + "?id=" + encodeURIComponent(id), {cache:"no-store"});
      if (!r.ok) throw new Error("script load");
      const t = await r.text();
      if (serial !== scriptLoadSerial) return;
      content.innerHTML = t;
      masterPositionLine = null; cueStartPositionLine = null; cueEndPositionLine = null;
      currentScriptId = id;
      scriptSelect.value = id;
      refreshPromptBlockCache();
      populateNavigationSelectors();
      requestAnimationFrame(() => {
        rebuildOverviewRail();
        scheduleContextUpdate();
      });
      if (activeDepartment) {
        try { await loadDepartmentCues(); }
        catch (_) { setSyncStatus(activeDepartment + ": cue load error", "error"); }
        try { await loadDepartmentAnnotations(); }
        catch (_) { /* cached annotations, if any, remain available */ }
      }
      applyStageDirectionVisibility();
      scrollPos = 0;
      viewport.scrollTop = 0;
    }

    function populateNavigationSelectors() {
      refreshPromptBlockCache();

      sceneSelect.innerHTML = '<option value="">Scene…</option>';
      songSelect.innerHTML = '<option value="">Song…</option>';

      for (const block of cachedPromptBlocks) {
        const id = block.dataset.promptId;
        if (!id) continue;

        if (block.classList.contains("scene-heading")) {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = block.textContent.trim();
          sceneSelect.appendChild(option);
        }

        if (block.classList.contains("song-heading")) {
          const option = document.createElement("option");
          option.value = id;
          option.textContent = block.textContent.trim();
          songSelect.appendChild(option);
        }
      }
      requestAnimationFrame(() => {
        rebuildOverviewRail();
        scheduleContextUpdate();
      });
    }

    function cueSortPosition(cue) {
      const prompt = cue && cue.anchor && cue.anchor.prompt;
      const blockIndex = cachedPromptBlocks.findIndex(
        b => b.dataset.promptId === prompt
      );
      const wordIndex =
        cue && cue.anchor && cue.anchor.type === "word"
          ? (Number(cue.anchor.wordIndex) || 0)
          : 0;
      return [blockIndex, wordIndex];
    }

    function jumpToNextCue() {
      if (!activeDepartment || !loadedCues.length) return;

      const current = findSemanticPosition();
      if (!current) return;

      const currentBlockIndex = cachedPromptBlocks.findIndex(
        b => b.dataset.promptId === current.prompt
      );

      const sorted = loadedCues
        .filter(c => c && c.anchor && c.anchor.prompt)
        .slice()
        .sort((a, b) => {
          const pa = cueSortPosition(a);
          const pb = cueSortPosition(b);
          return pa[0] - pb[0] || pa[1] - pb[1];
        });

      let next = sorted.find(c => cueSortPosition(c)[0] > currentBlockIndex);

      // If already within the same prompt, a later word-level cue also counts.
      if (!next) {
        next = sorted.find(c => cueSortPosition(c)[0] >= 0);
      }

      if (!next) return;

      pauseFollowingForManualControl();

      const block = content.querySelector(
        '[data-prompt-id="' + CSS.escape(next.anchor.prompt) + '"]'
      );
      if (!block) return;

      let targetElement = block;
      if (next.anchor.type === "word") {
        const trigger = block.querySelector(
          '.cue-trigger-word[data-word-index="' +
          CSS.escape(String(next.anchor.wordIndex)) + '"]'
        );
        if (trigger) targetElement = trigger;
      }

      const target =
        block.offsetTop -
        viewport.clientHeight * REFERENCE_LINE_FRACTION;

      scrollPos = Math.max(0, Math.min(maxScrollTop(), target));
      viewport.scrollTop = scrollPos;
      scheduleToolbarHide();
    }

    function jumpToPromptId(promptId) {
      if (!promptId) return;

      const block = content.querySelector(
        '[data-prompt-id="' + CSS.escape(promptId) + '"]'
      );

      if (!block) return;

      pauseFollowingForManualControl();

      const target =
        block.offsetTop -
        viewport.clientHeight * REFERENCE_LINE_FRACTION;

      scrollPos = Math.max(
        0,
        Math.min(maxScrollTop(), target)
      );
      viewport.scrollTop = scrollPos;

      if (syncMode === "master") {
        publishMasterState();
      }

      scheduleToolbarHide();
    }


    function recordMasterInteraction() {
      if (syncMode !== "master") return;
      lastMasterInteractionPerf = performance.now();
      updateMasterHealthStatus();
      updateMasterIdleBorder();
    }

    function updateMasterIdleBorder() {
      if (!masterIdleBorder) return;

      if (!MASTER_IDLE_BORDER_ENABLED) {
        masterIdleBorder.style.opacity = "0";
        return;
      }

      // This warning is specifically about unattended master auto-scroll.
      if (syncMode !== "master" || !playing) {
        masterIdleBorder.style.opacity = "0";
        return;
      }

      const age = Math.max(0, performance.now() - lastMasterInteractionPerf);
      if (age <= MASTER_BORDER_START_MS) {
        masterIdleBorder.style.opacity = "0";
        return;
      }

      const t = Math.max(0, Math.min(1,
        (age - MASTER_BORDER_START_MS) /
        (MASTER_BORDER_RED_MS - MASTER_BORDER_START_MS)
      ));

      // Hue moves continuously from yellow (~55°), through orange, to red.
      const hue = 55 * (1 - t);
      const [r,g,b] = hslToRgb(hue, 1, .50);

      // Start gently just after 4s; reach a clear but still transparent red
      // glow by 15s. The 5mm CSS gradients fade inward from every screen edge.
      const alpha = 0.12 + 0.50 * t;
      masterIdleBorder.style.setProperty("--idle-border-rgb", `${r}, ${g}, ${b}`);
      masterIdleBorder.style.setProperty("--idle-border-alpha", alpha.toFixed(3));
      masterIdleBorder.style.opacity = "1";
    }

    function updateMasterHealthStatus() {
      if (!masterHealthStatus) return;
      const now = performance.now();

      if (syncMode === "master") {
        const ackAge = lastMasterServerAckPerf === null ? Infinity : now - lastMasterServerAckPerf;
        const inputAge = Math.max(0, now - lastMasterInteractionPerf);
        const ackCls = healthClass(ackAge, MASTER_HEARTBEAT_OK_MS, MASTER_HEARTBEAT_WARN_MS);
        const autoCls = playing
          ? (inputAge > MASTER_AUTO_ERROR_MS ? "health-error" :
             inputAge > MASTER_AUTO_WARN_MS ? "health-warn" : "health-ok")
          : "health-idle";
        const inputLabel = playing ? "AUTO" : "INPUT";
        masterHealthStatus.innerHTML =
          '<span class="' + ackCls + '">SERVER ● ' + formatHealthAge(ackAge) + '</span>' +
          ' · <span class="' + autoCls + '">' + inputLabel + ' ' + formatHealthAge(inputAge) + '</span>';
        return;
      }

      let masterAge = Infinity;
      if (Number.isFinite(lastMasterHeartbeatBaseMs) && lastMasterHeartbeatSamplePerf !== null) {
        masterAge = lastMasterHeartbeatBaseMs + (now - lastMasterHeartbeatSamplePerf);
      }

      const serverAge = lastServerHeartbeatPerf === null ? Infinity : now - lastServerHeartbeatPerf;

      let interactionAge = Infinity;
      if (Number.isFinite(lastMasterInteractionBaseMs) && lastMasterInteractionSamplePerf !== null) {
        interactionAge = lastMasterInteractionBaseMs + (now - lastMasterInteractionSamplePerf);
      }

      const masterCls = healthClass(masterAge, MASTER_HEARTBEAT_OK_MS, MASTER_HEARTBEAT_WARN_MS);
      const netCls = healthClass(serverAge, SERVER_HEARTBEAT_OK_MS, SERVER_HEARTBEAT_WARN_MS);
      const remotePlaying = !!(latestRemoteState && latestRemoteState.playing !== false);
      const autoCls = remotePlaying
        ? (interactionAge > MASTER_AUTO_ERROR_MS ? "health-error" :
           interactionAge > MASTER_AUTO_WARN_MS ? "health-warn" : "health-ok")
        : "health-idle";
      const inputLabel = remotePlaying ? "AUTO" : "INPUT";

      masterHealthStatus.innerHTML =
        '<span class="' + masterCls + '">MASTER ● ' + formatHealthAge(masterAge) + '</span>' +
        ' · <span class="' + netCls + '">NET ● ' + formatHealthAge(serverAge) + '</span>' +
        ' · <span class="' + autoCls + '">' + inputLabel + ' ' + formatHealthAge(interactionAge) + '</span>';
    }

    setInterval(updateMasterHealthStatus, 500);
    setInterval(updateMasterIdleBorder, 200);

    function setSyncStatus(message, cls = "") {
      syncStatus.textContent = message;
      syncStatus.className = cls;
    }

    const SYNC_ROOM = "main";

    function syncUrl() {
      return SYNC_ENDPOINT + "?room=" + encodeURIComponent(SYNC_ROOM);
    }

    function sseUrl() {
      return SSE_ENDPOINT + "?room=" + encodeURIComponent(SYNC_ROOM);
    }

    const findSemanticPosition = () => semanticPosition.capture();
    const targetScrollForState = state => semanticPosition.toScrollTop(state);


    function latestRemoteStateAgeMs() {
      if (!latestRemoteState ||
          !Number.isFinite(latestRemoteStateAgeAtReceiveMs) ||
          !Number.isFinite(latestRemoteStateReceivedPerf)) {
        return null;
      }
      return latestRemoteStateAgeAtReceiveMs +
        Math.max(0, performance.now() - latestRemoteStateReceivedPerf);
    }

    function rememberFreshRemoteState(state, ageAtReceiveMs, receivedAt) {
      if (remoteStateExpiryTimer !== null) {
        clearTimeout(remoteStateExpiryTimer);
      }
      latestRemoteState = state;
      latestRemoteStateAgeAtReceiveMs = ageAtReceiveMs;
      latestRemoteStateReceivedPerf = receivedAt;
      remoteStateExpiryTimer = setTimeout(() => {
        remoteStateExpiryTimer = null;
        if (syncMode !== "follow" || latestRemoteState !== state) return;
        followTargetScrollTop = null;
        followSamples = [];
        followClockServerMs = null;
        followClockPerfMs = null;
        forgetRemoteState();
        if (followingLive) {
          setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
        }
      }, Math.max(0, FOLLOW_STATE_STALE_MS - ageAtReceiveMs));
    }

    function forgetRemoteState() {
      if (remoteStateExpiryTimer !== null) {
        clearTimeout(remoteStateExpiryTimer);
        remoteStateExpiryTimer = null;
      }
      latestRemoteState = null;
      latestRemoteStateAgeAtReceiveMs = null;
      latestRemoteStateReceivedPerf = null;
      pendingTopJump = null;
      updateMasterPositionMarker();
    }


    function followerPollDelay() {
      const idleFor = performance.now() - lastRemoteMotionAt;

      if (idleFor >= FOLLOW_SLEEP_AFTER_MS) {
        return FOLLOW_SLEEP_POLL_MS;
      }

      if (idleFor >= FOLLOW_IDLE_AFTER_MS) {
        return FOLLOW_IDLE_POLL_MS;
      }

      return FOLLOW_POLL_INTERVAL_MS;
    }

    function scheduleNextFollowerPoll(delay = null) {
      if (followTimer !== null) {
        clearTimeout(followTimer);
        followTimer = null;
      }

      if (syncMode !== "follow" || followTransport !== "poll") return;

      const nextDelay = delay === null ? followerPollDelay() : delay;

      if (
        followingLive &&
        performance.now() - lastRemoteMotionAt >= FOLLOW_SLEEP_AFTER_MS
      ) {
        setSyncStatus("FOLLOW: sleeping · POLL", "warn");
      }

      followTimer = setTimeout(
        async () => {
          followTimer = null;
          await pollMasterState();
          scheduleNextFollowerPoll();
        },
        nextDelay
      );
    }

    async function publishMasterState() {
      if (syncMode !== "master") return;

      // Never allow POST requests to accumulate. If one is still in
      // progress, skip this tick and send the newest position next time.
      if (masterRequestInFlight) return;

      const pos = findSemanticPosition();
      if (!pos || typeof pos.prompt !== "string" || !pos.prompt ||
          !Number.isFinite(pos.fraction) || pos.fraction < 0 || pos.fraction > 1) {
        console.warn("Not publishing invalid master semantic position", pos);
        return;
      }

      const state = {
        sequence: ++syncSequence,
        script: currentScriptId,
        prompt: pos.prompt,
        fraction: pos.fraction,
        playing,
        speed,
        interactionAgeMs: Math.max(0, performance.now() - lastMasterInteractionPerf),
        updatedByClient: Date.now()
      };

      const signature = motionSignature(state);
      const now = Date.now();

      // When nothing has changed, avoid sending 4 POSTs/second.
      // A 2-second heartbeat keeps the server state fresh and proves
      // the master is still present, even when the prompt is stationary.
      if (
        signature === lastMasterStateSignature &&
        now - lastMasterSendAt < MASTER_IDLE_HEARTBEAT_MS
      ) {
        return;
      }

      masterRequestInFlight = true;
      masterAbortController = new AbortController();

      const timeoutId = setTimeout(() => {
        if (masterAbortController) {
          masterAbortController.abort();
        }
      }, 2000);

      try {
        const response = await fetch(syncUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Teleprompter-Key": masterKey,
            "X-Teleprompter-Master-Session": masterSessionId
          },
          cache: "no-store",
          body: JSON.stringify(state),
          signal: masterAbortController.signal
        });

        // Consume the response so browser/network resources are released
        // promptly rather than being left for garbage collection.
        await response.text();

        if (response.status === 409) {
          showMasterConflict("MASTER CONTROL LOST — another device has taken control");
          return;
        }

        if (response.status === 401 || response.status === 403) {
          masterKey = "";
          setSyncStatus("MASTER: wrong password", "error");
          setSyncMode("follow");
          throw new Error("Authentication failed");
        }

        if (!response.ok) {
          throw new Error("HTTP " + response.status);
        }

        lastMasterStateSignature = signature;
        lastMasterSendAt = now;
        lastMasterServerAckPerf = performance.now();
        updateMasterHealthStatus();
        setSyncStatus("MASTER: live", "ok");
      } catch (err) {
        if (err && err.name === "AbortError") {
          setSyncStatus("MASTER: timeout", "warn");
        } else {
          setSyncStatus("MASTER: connection error", "error");
        }
      } finally {
        clearTimeout(timeoutId);
        masterAbortController = null;
        masterRequestInFlight = false;
      }
    }

    async function handleRemoteState(state, transport = "SSE") {
      if (syncMode !== "follow") return;

      // Never turn missing/corrupt semantic data into position zero. In older
      // code Number(undefined) || 0 could make a malformed packet look like
      // the start of a prompt. Ignore it instead.
      if (state) {
        const f = Number(state.fraction);
        if (typeof state.prompt !== "string" || !state.prompt ||
            !Number.isFinite(f) || f < 0 || f > 1) {
          console.warn("Ignoring invalid master position packet", state);
          return;
        }
      }

      const incomingState = state || null;

      let receivedAt = null;
      let stateAgeAtReceive = null;

      if (incomingState) {
        receivedAt = performance.now();
        lastMasterHeartbeatPerf = receivedAt; // retained for compatibility/debugging
        lastServerHeartbeatPerf = receivedAt; // a state event also proves the SSE/server path

        stateAgeAtReceive = stateAgeAtDeliveryMs(incomingState);

        lastMasterHeartbeatBaseMs = stateAgeAtReceive;
        lastMasterHeartbeatSamplePerf = receivedAt;

        const interactionAge = Number(incomingState.interactionAgeMs);
        if (Number.isFinite(stateAgeAtReceive) &&
            Number.isFinite(interactionAge) && interactionAge >= 0) {
          lastMasterInteractionBaseMs = interactionAge + stateAgeAtReceive;
          lastMasterInteractionSamplePerf = receivedAt;
        }
        updateMasterHealthStatus();
      }

      if (!incomingState) {
        if (followingLive) {
          setSyncStatus("FOLLOW: waiting · " + transport, "warn");
        }
        return;
      }

      // serverTime is stamped when the master writes; deliveryServerTime is
      // stamped by the SSE/GET response. Both use the same server clock, so
      // freshness does not depend on the follower device's wall clock.
      if (!Number.isFinite(stateAgeAtReceive) ||
          stateAgeAtReceive >= FOLLOW_STATE_STALE_MS) {
        const acceptedAge = latestRemoteStateAgeMs();
        if (acceptedAge === null || acceptedAge >= FOLLOW_STATE_STALE_MS) {
          forgetRemoteState();
          followTargetScrollTop = null;
          followSamples = [];
          followClockServerMs = null;
          followClockPerfMs = null;
        }
        if (followingLive) {
          setSyncStatus("FOLLOW: stale master state ignored · " + transport, "warn");
        }
        return;
      }

      if (incomingState.script && incomingState.script !== currentScriptId) {
        if (!availableScripts.some(s => s.id === incomingState.script)) {
          setSyncStatus("FOLLOW: unknown script", "error");
          return;
        }
        await loadShowScript(incomingState.script);
        pendingTopJump = null;
      }

      const target = targetScrollForState(incomingState);

      if (target !== null && followingLive) {
        const receivePerf = performance.now();
        let clampedTarget = Math.max(0, Math.min(maxScrollTop(), target));

        // A one-packet leap from well inside the script to its very beginning
        // is almost always a transient bad semantic position. Hold it until a
        // following packet independently confirms the master is still there.
        const maxScroll = Math.max(1, maxScrollTop());
        const previousAccepted = followTargetScrollTop;
        const nearTop = clampedTarget <= Math.max(40, maxScroll * FOLLOW_TOP_GUARD_FRACTION);
        const wasWellInside = previousAccepted !== null &&
          previousAccepted >= Math.max(300, maxScroll * FOLLOW_TOP_GUARD_FROM_FRACTION);
        if (nearTop && wasWellInside && incomingState.script === currentScriptId) {
          const nowPerf = performance.now();
          const seq = Number(incomingState.sequence) || 0;
          const confirmed = pendingTopJump &&
            (nowPerf - pendingTopJump.at) <= FOLLOW_TOP_GUARD_CONFIRM_MS &&
            seq !== pendingTopJump.sequence;
          if (!confirmed) {
            pendingTopJump = { at: nowPerf, sequence: seq, prompt: incomingState.prompt };
            console.warn("Held suspicious single master jump to top", incomingState);
            setSyncStatus("FOLLOW: ignored suspect top jump · " + transport, "warn");
            return;
          }
        }
        pendingTopJump = null;

        rememberFreshRemoteState(incomingState, stateAgeAtReceive, receivedAt);
        const motionSignature = syncMotionSignature(latestRemoteState);
        if (motionSignature !== lastRemoteMotionSignature) {
          lastRemoteMotionSignature = motionSignature;
          lastRemoteMotionAt = performance.now();
        }
        updateMasterPositionMarker();

        const remotePlaying = latestRemoteState.playing !== false;

        // A change between stopped/playing can represent a real jump or
        // repositioning by the master. Start a fresh interpolation history
        // so we never interpolate across that discontinuity.
        if (
          lastRemotePlaying !== null &&
          remotePlaying !== lastRemotePlaying
        ) {
          followSamples = [];
          lastRenderedFollowPosition = null;
          followDirection = 0;
        }

        lastRemotePlaying = remotePlaying;

        // The POST endpoint stamps each state with serverTime. This remains
        // the clock source for interpolation whether the sample arrived by
        // SSE push or by the polling fallback.
        let sampleServerMs =
          Number(latestRemoteState.serverTime) * 1000;

        if (!Number.isFinite(sampleServerMs)) {
          sampleServerMs = Date.now();
        }

        const sequence = Number(latestRemoteState.sequence) || 0;
        let previousSample =
          followSamples.length
            ? followSamples[followSamples.length - 1]
            : null;

        if (previousSample) {
          const delta = clampedTarget - previousSample.target;

          // A clear reversal is intentional operator movement, not noise.
          // Drop the old-direction history so regression cannot pull the
          // follower alternately backwards and forwards.
          if (Math.abs(delta) >= 2) {
            const newDirection = delta > 0 ? 1 : -1;

            if (
              followDirection !== 0 &&
              newDirection !== followDirection
            ) {
              followSamples = [previousSample];
              lastRenderedFollowPosition = viewport.scrollTop;
              followWaitingSince = null;
              followClockServerMs = previousSample.serverMs;
              followClockPerfMs = receivePerf;
              previousSample = followSamples[0];
            }

            followDirection = newDirection;
          }
        }

        // SSE normally delivers each state once. Keep this duplicate guard
        // because reconnects and the polling fallback can legitimately see
        // the same state again.
        if (
          !previousSample ||
          previousSample.sequence !== sequence ||
          previousSample.serverMs !== sampleServerMs
        ) {
          followSamples.push({
            serverMs: sampleServerMs,
            target: clampedTarget,
            playing: remotePlaying,
            sequence
          });

          const cutoff = sampleServerMs - 7000;
          followSamples = followSamples.filter(
            sample => sample.serverMs >= cutoff
          );
        }

        followClockServerMs = sampleServerMs;
        followClockPerfMs = receivePerf;

        followTargetScrollTop = clampedTarget;
        startFollowAnimation();
        setSyncStatus("FOLLOW: live · " + transport, "ok");
      } else if (!followingLive) {
        rememberFreshRemoteState(incomingState, stateAgeAtReceive, receivedAt);
        pendingTopJump = null;
        updateMasterPositionMarker();
        setSyncStatus("FOLLOW: PAUSED — tap ◎ to rejoin", "warn");
      } else {
        setSyncStatus("FOLLOW: script mismatch", "error");
      }
    }

    async function pollMasterState() {
      if (syncMode !== "follow" || followTransport !== "poll") return;

      try {
        const response = await fetch(syncUrl() + "&_=" + Date.now(), {
          method: "GET",
          cache: "no-store"
        });
        if (!response.ok) throw new Error("HTTP " + response.status);

        const body = await response.json();
        const state = body && body.state ? body.state : null;
        if (state && Number.isFinite(Number(body.serverTime))) {
          state.deliveryServerTime = Number(body.serverTime);
        }
        await handleRemoteState(state, "POLL");
      } catch (err) {
        if (followingLive) {
          setSyncStatus("FOLLOW: connection lost · POLL", "error");
        }
      }
    }

    function stopFollowerPollingFallback() {
      // Stop only the polling fallback. Do NOT close EventSource here:
      // polling may be active temporarily while EventSource reconnects.
      if (followTimer !== null) {
        clearTimeout(followTimer);
        followTimer = null;
      }
    }

    function stopFollowerTransport() {
      stopFollowerPollingFallback();
      clearSseFallbackTimer();

      if (followEventSource) {
        followEventSource.close();
        followEventSource = null;
      }

      followTransport = "none";
      sseHasOpened = false;
    }

    function startFollowerPollingFallback() {
      if (syncMode !== "follow") return;
      if (followTransport === "poll") return;

      // Leave EventSource alive so it can reconnect in the background.
      // If it opens again, onopen() switches us straight back to SSE.
      followTransport = "poll";
      stopFollowerPollingFallback();
      if (followingLive) {
        setSyncStatus("FOLLOW: fallback · POLL", "warn");
      }
      scheduleNextFollowerPoll(0);
    }

    function clearSseFallbackTimer() {
      if (sseFallbackTimer !== null) {
        clearTimeout(sseFallbackTimer);
        sseFallbackTimer = null;
      }
    }

    function armSseFallbackTimer(delay = 8000) {
      clearSseFallbackTimer();
      if (syncMode !== "follow") return;

      sseFallbackTimer = setTimeout(() => {
        sseFallbackTimer = null;
        if (
          syncMode === "follow" &&
          (!followEventSource || followEventSource.readyState !== EventSource.OPEN)
        ) {
          startFollowerPollingFallback();
        }
      }, delay);
    }

    function startFollowerSse() {
      if (syncMode !== "follow") return;

      if (!("EventSource" in window)) {
        startFollowerPollingFallback();
        return;
      }

      if (followEventSource) {
        followEventSource.close();
        followEventSource = null;
      }

      sseHasOpened = false;
      followTransport = "sse";
      setSyncStatus("FOLLOW: connecting · SSE", "warn");

      const events = new EventSource(sseUrl());
      followEventSource = events;

      // If SSE cannot establish at all, retain the old polling transport as
      // an automatic compatibility fallback. If SSE later recovers, polling
      // is stopped immediately.
      armSseFallbackTimer(5000);

      events.onopen = () => {
        if (events !== followEventSource || syncMode !== "follow") return;
        sseHasOpened = true;
        followTransport = "sse";
        lastServerHeartbeatPerf = performance.now();
        clearSseFallbackTimer();
        stopFollowerPollingFallback();
        if (followingLive) {
          setSyncStatus("FOLLOW: connected · SSE", "ok");
        }
      };

      events.onmessage = (event) => {
        if (events !== followEventSource || syncMode !== "follow") return;

        let state = null;
        try {
          state = JSON.parse(event.data);
        } catch (_) {
          if (followingLive) {
            setSyncStatus("FOLLOW: bad SSE data", "error");
          }
          return;
        }

        handleRemoteState(state, "SSE").catch(() => {
          if (followingLive) {
            setSyncStatus("FOLLOW: SSE processing error", "error");
          }
        });
      };

      events.addEventListener('annotation-revision', (event) => {
        if (events !== followEventSource) return;
        lastServerHeartbeatPerf = performance.now();
        handleAnnotationRevisionEvent(event);
      });

      events.addEventListener('cue-revision', (event) => {
        if (events !== followEventSource) return;
        lastServerHeartbeatPerf = performance.now();
        handleCueRevisionEvent(event);
      });

      events.addEventListener('department-settings', (event) => {
        if (events !== followEventSource) return;
        lastServerHeartbeatPerf = performance.now();
        handleDepartmentSettingsEvent(event);
      });

      events.addEventListener('server-heartbeat', () => {
        if (events !== followEventSource) return;
        lastServerHeartbeatPerf = performance.now();
        updateMasterHealthStatus();
      });

      events.onerror = () => {
        if (events !== followEventSource || syncMode !== "follow") return;

        // EventSource reconnects automatically. Give it a few seconds before
        // activating polling; an intentional server-side SSE recycle should
        // therefore normally reconnect without ever using the fallback.
        if (followingLive) {
          setSyncStatus("FOLLOW: reconnecting · SSE", "warn");
        }
        armSseFallbackTimer(sseHasOpened ? 10000 : 5000);
      };
    }

    function startFollowerTransport() {
      stopFollowerTransport();
      startFollowerSse();
    }

    function followAnimationStep(timestamp) {
      if (
        syncMode !== "follow" ||
        !followingLive ||
        !followSamples.length ||
        followClockServerMs === null ||
        followClockPerfMs === null
      ) {
        syncAnimationRunning = false;
        return;
      }

      const currentStateAge = latestRemoteStateAgeMs();
      if (currentStateAge === null || currentStateAge >= FOLLOW_STATE_STALE_MS) {
        followTargetScrollTop = null;
        followSamples = [];
        followClockServerMs = null;
        followClockPerfMs = null;
        forgetRemoteState();
        setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
        syncAnimationRunning = false;
        return;
      }

      // Estimate current server time from the latest timestamp anchor, then
      // deliberately display a point FOLLOW_BUFFER_MS in the past. This
      // keeps the render time inside a multi-second history window.
      const estimatedServerNow =
        followClockServerMs +
        (performance.now() - followClockPerfMs);

      const renderServerMs =
        estimatedServerNow - FOLLOW_BUFFER_MS;

      let desired = followSamples[0].target;

      const latestSample =
        followSamples[followSamples.length - 1];

      // When the master is playing, fit one straight motion line through
      // several seconds of confirmed positions. A constant master scroll
      // therefore becomes a constant follower scroll instead of reflecting
      // every small timing variation in the HTTP samples.
      if (latestSample.playing && followSamples.length >= 3) {
        const windowStart =
          renderServerMs - FOLLOW_AVERAGE_WINDOW_MS / 2;
        const windowEnd =
          renderServerMs + FOLLOW_AVERAGE_WINDOW_MS / 2;

        let samples = followSamples.filter(
          s => s.serverMs >= windowStart && s.serverMs <= windowEnd
        );

        // Near the newest edge of the buffer there may not be samples on
        // both sides. Fall back to the most recent averaging window.
        if (samples.length < 3) {
          const newest = followSamples[followSamples.length - 1].serverMs;
          samples = followSamples.filter(
            s => s.serverMs >= newest - FOLLOW_AVERAGE_WINDOW_MS
          );
        }

        if (samples.length >= 2) {
          // Linear least-squares regression:
          // target = intercept + velocity * time
          // Use the mean time as the origin for numerical stability.
          let meanT = 0;
          let meanY = 0;

          for (const s of samples) {
            meanT += s.serverMs;
            meanY += s.target;
          }

          meanT /= samples.length;
          meanY /= samples.length;

          let covariance = 0;
          let variance = 0;

          for (const s of samples) {
            const dt = (s.serverMs - meanT) / 1000;
            const dy = s.target - meanY;
            covariance += dt * dy;
            variance += dt * dt;
          }

          let velocity =
            variance > 0.000001
              ? covariance / variance
              : 0;

          // Positive velocity means forward, negative means reverse.
          // Direction changes are handled when samples arrive, so both are valid.
          if (Math.abs(velocity) < 0.15) velocity = 0;

          const renderDt =
            (renderServerMs - meanT) / 1000;

          desired =
            meanY + velocity * renderDt;
        }
      } else {
        // If the master is stopped, use ordinary confirmed interpolation
        // so the follower settles exactly at the master's final position.
        if (renderServerMs <= followSamples[0].serverMs) {
          desired = followSamples[0].target;
        } else {
          let foundPair = false;

          for (let i = 1; i < followSamples.length; i++) {
            const a = followSamples[i - 1];
            const b = followSamples[i];

            if (renderServerMs <= b.serverMs) {
              const span = Math.max(1, b.serverMs - a.serverMs);
              const f = Math.max(
                0,
                Math.min(1, (renderServerMs - a.serverMs) / span)
              );

              desired =
                a.target + (b.target - a.target) * f;

              foundPair = true;
              break;
            }
          }

          if (!foundPair) {
            desired =
              followSamples[followSamples.length - 1].target;
          }
        }
      }

      desired = Math.max(
        0,
        Math.min(maxScrollTop(), desired)
      );

      // Avoid tiny corrections against the established direction of travel.
      // This works in both directions; a genuine reversal resets history
      // when its sample arrives, rather than producing a vertical-hold effect.
      if (
        latestSample.playing &&
        lastRenderedFollowPosition !== null &&
        followDirection !== 0
      ) {
        const oppositeBy =
          followDirection > 0
            ? lastRenderedFollowPosition - desired
            : desired - lastRenderedFollowPosition;

        if (oppositeBy > FOLLOW_WAIT_EPSILON_PX) {
          if (followWaitingSince === null) {
            followWaitingSince = performance.now();
          }

          const waited = performance.now() - followWaitingSince;

          if (waited >= FOLLOW_MAX_WAIT_MS) {
            desired = latestSample.target;
            followSamples = [latestSample];
            followClockServerMs = latestSample.serverMs;
            followClockPerfMs = performance.now();
            lastRenderedFollowPosition = desired;
            followWaitingSince = null;
          } else {
            desired = lastRenderedFollowPosition;
          }
        } else {
          followWaitingSince = null;
          desired =
            followDirection > 0
              ? Math.max(lastRenderedFollowPosition, desired)
              : Math.min(lastRenderedFollowPosition, desired);
        }
      } else {
        followWaitingSince = null;
      }

      viewport.scrollTop = desired;
      scrollPos = viewport.scrollTop;
      lastRenderedFollowPosition = viewport.scrollTop;
      scheduleContextUpdate();

      requestAnimationFrame(followAnimationStep);
    }

    function startFollowAnimation() {
      if (syncAnimationRunning) return;
      syncAnimationRunning = true;
      requestAnimationFrame(followAnimationStep);
    }

    function stopSyncTimers() {
      if (masterTimer !== null) {
        clearInterval(masterTimer);
        masterTimer = null;
      }

      if (masterAbortController) {
        masterAbortController.abort();
        masterAbortController = null;
      }
      masterRequestInFlight = false;

      if (followTimer !== null) {
        clearTimeout(followTimer);
        followTimer = null;
      }
    }

    function setSyncMode(mode) {
      stopSyncTimers();
      stopFollowerTransport();
      stopDragMomentum();

      if (mode === "master" && !masterKey) {
        mode = "follow";
      }

      syncMode = mode;
      followingLive = true;
      document.body.classList.remove("follow-paused");
      followTargetScrollTop = null;
      followSamples = [];
      followClockServerMs = null;
      followClockPerfMs = null;
      lastRemotePlaying = null;
      lastRenderedFollowPosition = null;
      followWaitingSince = null;
      followDirection = 0;
      if (remoteStateExpiryTimer !== null) {
        clearTimeout(remoteStateExpiryTimer);
        remoteStateExpiryTimer = null;
      }
      latestRemoteState = null;
      latestRemoteStateAgeAtReceiveMs = null;
      latestRemoteStateReceivedPerf = null;
      updateMasterPositionMarker();
      lastRemoteMotionSignature = null;
      lastRemoteMotionAt = performance.now();

      if (mode === "master") {
        lastMasterStateSignature = null;
        lastMasterSendAt = 0;
        lastMasterInteractionPerf = performance.now();
        lastMasterServerAckPerf = null;
      } else {
        lastMasterHeartbeatPerf = null;
        lastMasterHeartbeatBaseMs = null;
        lastMasterHeartbeatSamplePerf = null;
        lastMasterInteractionBaseMs = null;
        lastMasterInteractionSamplePerf = null;
        lastServerHeartbeatPerf = null;
      }
      updateMasterHealthStatus();
      updateMasterIdleBorder();

      const follower = mode !== "master";

      // Followers can resize locally and use fullscreen, but only the
      // authenticated master controls playback and transport. Hide those
      // master-only controls completely in follower mode instead of showing
      // disabled/grey controls.
      playPauseBtn.hidden = follower;
      backBtn.hidden = follower;
      slowerBtn.hidden = follower;
      fasterBtn.hidden = follower;
      topBtn.hidden = follower;
      bottomBtn.hidden = follower;
      speedControl.hidden = follower;
      status.hidden = follower;

      // Keep the underlying form controls disabled as a second layer of
      // protection even though they are hidden from followers.
      playPauseBtn.disabled = follower;
      slowerBtn.disabled = follower;
      fasterBtn.disabled = follower;
      speedInput.disabled = follower;
      topBtn.disabled = follower;
      bottomBtn.disabled = follower;
      backBtn.disabled = follower;

      rejoinBtn.disabled = !follower;

      if (!activeDepartment) {
        masterBtn.classList.toggle("master-active", !follower);
        masterBtn.textContent = follower ? "🔒" : "🔓";
        masterBtn.title = follower ? "Become master" : "Leave master mode";
        masterBtn.setAttribute("aria-label", masterBtn.title);
      } else {
        updateCueLockUi();
      }

      if (follower && playing) {
        setPlaying(false);
      }

      if (mode === "master") {
        passwordPanel.hidden = true;
        masterPassword.value = "";
        setSyncStatus("MASTER: starting…", "warn");
        publishMasterState();
        masterTimer = setInterval(
          publishMasterState,
          MASTER_SEND_INTERVAL_MS
        );
      } else {
        setSyncStatus("FOLLOW: connecting · SSE", "warn");
        startFollowerTransport();
      }
    }

    function pauseFollowingForManualControl() {
      if (syncMode === "follow" && followingLive) {
        followingLive = false;
        followTargetScrollTop = null;
        followSamples = [];
        followClockServerMs = null;
        followClockPerfMs = null;
        lastRemotePlaying = null;
        lastRenderedFollowPosition = null;
        followWaitingSince = null;
        followDirection = 0;
        document.body.classList.add("follow-paused");
        setSyncStatus("FOLLOW: PAUSED — tap ◎ to rejoin", "warn");
        updateMasterPositionMarker();
        scheduleToolbarHide();
      }
    }

    function rejoinMaster() {
      if (syncMode !== "follow") return;
      stopDragMomentum();
      followingLive = true;
      followSamples = [];
      followClockServerMs = null;
      followClockPerfMs = null;
      lastRemotePlaying = null;
      lastRenderedFollowPosition = null;
      followWaitingSince = null;
      followDirection = 0;
      document.body.classList.remove("follow-paused");
      updateMasterPositionMarker();

      const latestAge = latestRemoteStateAgeMs();
      if (latestRemoteState &&
          latestAge !== null && latestAge < FOLLOW_STATE_STALE_MS &&
          (!latestRemoteState.script || latestRemoteState.script === currentScriptId)) {
        const target = targetScrollForState(latestRemoteState);
        if (target !== null) {
          followTargetScrollTop = Math.max(0, Math.min(maxScrollTop(), target));
          viewport.scrollTop = followTargetScrollTop;
          scrollPos = viewport.scrollTop;
          lastRenderedFollowPosition = viewport.scrollTop;
        }
        setSyncStatus("FOLLOW: live", "ok");
      } else {
        forgetRemoteState();
        setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
      }
      scheduleToolbarHide();
    }


    function updateStatus() {
      status.textContent =
        (playing ? "Playing" : "Paused") +
        " | Speed: " + speed.toFixed(1);
    }

    function preserveSemanticPositionDuringLayoutChange(changeFn) {
      const semanticPosition =
        content.querySelector("[data-prompt-id]")
          ? findSemanticPosition()
          : null;

      changeFn();

      if (!semanticPosition) return;

      requestAnimationFrame(() => {
        const target = targetScrollForState(semanticPosition);

        if (target !== null) {
          scrollPos = Math.max(0, Math.min(maxScrollTop(), target));
          viewport.scrollTop = scrollPos;

          if (syncMode === "follow") {
            followSamples = [];
            followClockServerMs = null;
            followClockPerfMs = null;
            lastRenderedFollowPosition = viewport.scrollTop;
            followWaitingSince = null;
          }

          if (syncMode === "master") {
            publishMasterState();
          }
        }
      });
    }

    function loadDisplaySettings() {
      try {
        const storedRailSide = localStorage.getItem(RAIL_SIDE_STORAGE_KEY);
        railSide = storedRailSide === "left" ? "left" : "right";
      } catch (_) {
        railSide = "right";
      }
    }

    function normalizeDepartmentMargin(margin) {
      const side = margin && (margin.side === "left" || margin.side === "right")
        ? margin.side
        : "none";
      const storedWidth = margin ? Number(margin.width) : 20;
      const width = Number.isFinite(storedWidth)
        ? Math.max(0, Math.min(40, Math.round(storedWidth)))
        : 20;
      return {side, width};
    }

    function departmentMarginSetting() {
      return normalizeDepartmentMargin(departmentMargin);
    }

    function setSettingsSaveStatus(message, isError=false) {
      settingsSaveStatus.textContent = message;
      settingsSaveStatus.classList.toggle("error", isError);
    }

    function syncSettingsControls() {
      const margin = departmentMarginSetting();
      const canEditMargin = !!activeDepartment && cueEditorUnlocked;
      railSideSelect.value = railSide;
      annotationMarginSideSelect.value = activeDepartment ? margin.side : "none";
      annotationMarginWidth.value = activeDepartment ? String(margin.width) : "0";
      annotationMarginWidthValue.textContent = activeDepartment
        ? (margin.side === "none" ? "Off" : margin.width + "%")
        : "Department views only";
      settingsMarginControls.setAttribute("aria-disabled", canEditMargin ? "false" : "true");
      annotationMarginSideSelect.disabled = !canEditMargin;
      annotationMarginWidth.disabled = !canEditMargin || margin.side === "none";

      if (!activeDepartment) {
        setSettingsSaveStatus("");
      } else if (!cueEditorUnlocked && !departmentSettingsSaveRunning) {
        setSettingsSaveStatus("Unlock " + activeDepartment + " editing to change its central margin.");
      } else if (cueEditorUnlocked && settingsSaveStatus.textContent.startsWith("Unlock ")) {
        setSettingsSaveStatus("");
      }
    }

    async function loadCentralDepartmentSettings({preservePosition=true} = {}) {
      if (!activeDepartment) return true;
      const department = activeDepartment;
      const serial = ++departmentSettingsLoadSerial;
      try {
        const response = await fetch(
          SETTINGS_API_ENDPOINT + "?action=get&dept=" + encodeURIComponent(department) + "&_=" + Date.now(),
          {cache:"no-store"}
        );
        if (!response.ok) throw new Error("Settings load HTTP " + response.status);
        const body = await response.json();
        if (serial !== departmentSettingsLoadSerial || department !== activeDepartment ||
            departmentSettingsSavePending) return false;
        departmentSettingsRevision = Math.max(0, Number(body.revision) || 0);
        departmentMargin = normalizeDepartmentMargin(body.annotationMargin);
        applyDisplaySettings({preservePosition});
        return true;
      } catch (_) {
        if (serial === departmentSettingsLoadSerial && department === activeDepartment) {
          setSettingsSaveStatus("Could not load central department settings.", true);
        }
        return false;
      }
    }

    async function flushDepartmentMarginSave() {
      if (departmentSettingsSaveRunning) return;
      departmentSettingsSaveRunning = true;

      try {
        while (departmentSettingsSavePending && activeDepartment && cueEditorUnlocked) {
          departmentSettingsSavePending = false;
          const department = activeDepartment;
          const margin = departmentMarginSetting();
          setSettingsSaveStatus("Saving centrally…");

          try {
            const response = await fetch(SETTINGS_API_ENDPOINT + "?action=save", {
              method:"POST",
              headers:{
                "Content-Type":"application/json",
                "X-Cue-Key":cueEditorKey
              },
              cache:"no-store",
              body:JSON.stringify({department, annotationMargin:margin})
            });
            const text = await response.text();
            let body = null;
            try { body = JSON.parse(text); } catch (_) {}
            if (!response.ok) throw new Error((body && body.error) || "Settings update failed");
            if (department === activeDepartment) {
              departmentSettingsRevision = Math.max(
                departmentSettingsRevision,
                Number(body && body.revision) || 0
              );
              if (!departmentSettingsSavePending) {
                departmentMargin = normalizeDepartmentMargin(body && body.annotationMargin);
                applyDisplaySettings({preservePosition:false});
                setSettingsSaveStatus("Saved centrally.");
              }
            }
          } catch (_) {
            if (department === activeDepartment && !departmentSettingsSavePending) {
              await loadCentralDepartmentSettings();
              setSettingsSaveStatus("Central margin save failed; restored the server value.", true);
            }
          }
        }
      } finally {
        departmentSettingsSaveRunning = false;
        syncSettingsControls();
      }
    }

    function queueDepartmentMarginSave(side, width) {
      if (!activeDepartment || !cueEditorUnlocked) return;
      departmentMargin = normalizeDepartmentMargin({side, width});
      departmentSettingsSavePending = true;
      applyDisplaySettings();
      flushDepartmentMarginSave();
    }

    function applyDisplaySettings({preservePosition=true} = {}) {
      const margin = departmentMarginSetting();
      const effectiveWidth = activeDepartment && margin.side !== "none"
        ? margin.width
        : 0;

      const apply = () => {
        document.body.classList.toggle("overview-rail-left", railSide === "left");
        content.style.setProperty(
          "--annotation-margin-left",
          margin.side === "left" ? effectiveWidth + "%" : "0px"
        );
        content.style.setProperty(
          "--annotation-margin-right",
          margin.side === "right" ? effectiveWidth + "%" : "0px"
        );
      };

      if (preservePosition && content.querySelector("[data-prompt-id]")) {
        preserveSemanticPositionDuringLayoutChange(apply);
      } else {
        apply();
      }

      syncSettingsControls();

      requestAnimationFrame(() => {
        drawCueConnectors();
        drawCueRanges();
        scheduleAnnotationRender();
        rebuildOverviewRail();
        scheduleContextUpdate();
        updateMasterPositionMarker();
        updateCueEditorPositionMarkers();
      });
    }

    function openSettingsPanel() {
      settingsBackdrop.hidden = false;
      settingsPanel.hidden = false;
      scheduleToolbarHide();
      applyDisplaySettings({preservePosition:false});
      railSideSelect.focus();
    }

    function closeSettingsPanel() {
      settingsBackdrop.hidden = true;
      settingsPanel.hidden = true;
      settingsBtn.focus();
      scheduleToolbarHide();
    }

    function setToolbarHidden(hidden) {
      document.body.classList.toggle("toolbar-hidden", hidden);
    }

    function scheduleToolbarHide() {
      if (toolbarHideTimer !== null) {
        clearTimeout(toolbarHideTimer);
        toolbarHideTimer = null;
      }

      setToolbarHidden(false);

      // A locally-paused follower must make that state obvious. Keep the
      // controls permanently visible until the operator presses Rejoin.
      if (!settingsPanel.hidden || (syncMode === "follow" && !followingLive)) {
        return;
      }

      toolbarHideTimer = setTimeout(() => {
        setToolbarHidden(true);
      }, TOOLBAR_HIDE_DELAY_MS);
    }

    async function acquireWakeLock() {
      if (!wakeLockWanted) return;

      if (!("wakeLock" in navigator)) {
        wakeLockBtn.textContent = "☾";
        wakeLockBtn.title = "Screen wake lock is not supported by this browser";
        wakeLockBtn.disabled = true;
        return;
      }

      if (document.visibilityState !== "visible") return;
      if (wakeLock) return;

      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLockBtn.textContent = "☀";
        wakeLockBtn.title = "Screen will stay awake (click to disable)";
        wakeLockBtn.classList.add("master-active");

        wakeLock.addEventListener("release", () => {
          wakeLock = null;
          wakeLockBtn.classList.remove("master-active");

          if (wakeLockWanted && document.visibilityState === "visible") {
            wakeLockBtn.title = "Keep screen awake";
          }
        });
      } catch (err) {
        wakeLock = null;
        wakeLockBtn.classList.remove("master-active");
        wakeLockBtn.title = "Could not keep screen awake — tap to retry";
      }
    }

    async function releaseWakeLock() {
      wakeLockWanted = false;

      if (wakeLock) {
        try {
          await wakeLock.release();
        } catch (_) {
        }
      }

      wakeLock = null;
      wakeLockBtn.classList.remove("master-active");
      wakeLockBtn.textContent = "☾";
      wakeLockBtn.title = "Allow screen to sleep (click to keep awake)";
    }

    async function toggleWakeLock() {
      if (wakeLockWanted) {
        await releaseWakeLock();
      } else {
        wakeLockWanted = true;
        wakeLockBtn.textContent = "☀";
        wakeLockBtn.title = "Keep screen awake";
        await acquireWakeLock();
      }
    }


    function applyFontSize() {
      // Preserve the same semantic script position across reflow.
      // This is especially important for the master: changing font size
      // must not change what point in the script is being transmitted.
      let semanticPosition = null;

      if (content.querySelector("[data-prompt-id]")) {
        semanticPosition = findSemanticPosition();
      }

      content.style.fontSize = fontSizeInput.value + "px";

      if (semanticPosition) {
        // Wait until the browser has recalculated the new block geometry.
        requestAnimationFrame(() => {
          const target = targetScrollForState(semanticPosition);

          if (target !== null) {
            scrollPos = Math.max(
              0,
              Math.min(maxScrollTop(), target)
            );
            viewport.scrollTop = scrollPos;

            // If this device is a follower, its local geometry changed too.
            // Start a clean smoothing history from this new layout.
            if (syncMode === "follow") {
              followSamples = [];
              followClockServerMs = null;
              followClockPerfMs = null;
              lastRenderedFollowPosition = viewport.scrollTop;
              followWaitingSince = null;
            }

            // Publish the corrected semantic position promptly instead of
            // waiting for the next periodic master update.
            if (syncMode === "master") {
              publishMasterState();
            }
          } else {
            scrollPos = viewport.scrollTop;
            clampScrollPos();
          }
        });
      } else {
        scrollPos = viewport.scrollTop;
        clampScrollPos();
      }

      requestAnimationFrame(() => {
        drawCueConnectors();
        drawCueRanges();
        scheduleAnnotationRender();
      });
    }

    function maxScrollTop() {
      return Math.max(0, content.scrollHeight - viewport.clientHeight);
    }

    function clampScrollPos() {
      scrollPos = Math.max(0, Math.min(maxScrollTop(), scrollPos));
      viewport.scrollTop = Math.round(scrollPos);
    }

    function stopAutoScrollForManualControl() {
      // Followers keep their existing local-pause behaviour. For the master,
      // manual repositioning must NOT change the Play/Pause state: if auto
      // scroll is running, continue from the newly chosen position.
      if (syncMode !== "master" && playing) {
        setPlaying(false);
      }

      scrollPos = viewport.scrollTop;

      // Restart the auto-scroll timing basis from the manually adjusted
      // position. This avoids the next animation frame applying elapsed time
      // from before the operator's drag/wheel/jump.
      if (syncMode === "master" && playing) {
        lastTime = null;
      }
    }

    function setPlaying(newValue) {
      playing = newValue;
      playPauseBtn.textContent = playing ? "⏸" : "▶";
      updateStatus();
      updateMasterIdleBorder();

      if (playing) {
        lastTime = null;
        scrollPos = viewport.scrollTop;
        requestAnimationFrame(scrollStep);
      }
    }

    function jumpBack() {
      stopAutoScrollForManualControl();
      scrollPos = viewport.scrollTop - viewport.clientHeight / 3;
      clampScrollPos();
    }

    function scrollStep(timestamp) {
      if (!playing) {
        lastTime = null;
        return;
      }

      if (lastTime === null) {
        lastTime = timestamp;
        scrollPos = viewport.scrollTop;
      }

      const dt = (timestamp - lastTime) / 1000.0;
      lastTime = timestamp;

      scrollPos += speed * 20 * dt;
      clampScrollPos();

      const maxScroll = maxScrollTop();
      if (viewport.scrollTop >= maxScroll) {
        scrollPos = maxScroll;
        viewport.scrollTop = maxScroll;
        setPlaying(false);
        return;
      }

      requestAnimationFrame(scrollStep);
    }

    function startWheelAnimation() {
      if (!wheelAnimating) {
        wheelAnimating = true;
        requestAnimationFrame(wheelStep);
      }
    }

    function wheelStep() {
      scrollPos += wheelVelocity;
      clampScrollPos();

      // Friction / decay. Lower = stops quicker, higher = glides longer.
      wheelVelocity *= 0.90;

      if (Math.abs(wheelVelocity) < 0.1) {
        wheelVelocity = 0;
        wheelAnimating = false;
        return;
      }

      requestAnimationFrame(wheelStep);
    }

    playPauseBtn.addEventListener("click", () => {
      setPlaying(!playing);
    });

    backBtn.addEventListener("click", () => {
      jumpBack();
    });

    slowerBtn.addEventListener("click", () => {
      speed = Math.max(0, speed - 0.5);
      speedInput.value = speed.toFixed(1);
      updateStatus();
    });

    fasterBtn.addEventListener("click", () => {
      speed = Math.min(20, speed + 0.5);
      speedInput.value = speed.toFixed(1);
      updateStatus();
    });

    speedInput.addEventListener("input", () => {
      speed = parseFloat(speedInput.value);
      updateStatus();
    });

    fontSizeInput.addEventListener("input", () => {
      applyFontSize();
    });

    topBtn.addEventListener("click", () => {
      stopAutoScrollForManualControl();
      scrollPos = 0;
      viewport.scrollTop = 0;
    });

    bottomBtn.addEventListener("click", () => {
      stopAutoScrollForManualControl();
      scrollPos = maxScrollTop();
      viewport.scrollTop = Math.round(scrollPos);
    });

    fullscreenBtn.addEventListener("click", () => {
      const docEl = document.documentElement;

      if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        if (docEl.requestFullscreen) {
          docEl.requestFullscreen();
        } else if (docEl.webkitRequestFullscreen) {
          docEl.webkitRequestFullscreen();
        } else {
          alert("Fullscreen is not supported by this browser.");
        }
      } else {
        if (document.exitFullscreen) {
          document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          document.webkitExitFullscreen();
        }
      }
    });


    wakeLockBtn.addEventListener("click", async () => {
      scheduleToolbarHide();
      await toggleWakeLock();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && wakeLockWanted) {
        acquireWakeLock();
      }
    });

    // Human activity on the master is deliberately separate from auto-scroll.
    // Only trusted browser events count; animation frames and heartbeat POSTs do not.
    document.addEventListener("pointerdown", (e) => {
      if (e.isTrusted) recordMasterInteraction();
    }, {capture:true, passive:true});
    document.addEventListener("wheel", (e) => {
      if (e.isTrusted) recordMasterInteraction();
    }, {capture:true, passive:true});
    document.addEventListener("keydown", (e) => {
      if (e.isTrusted) recordMasterInteraction();
    }, {capture:true});
    document.addEventListener("input", (e) => {
      if (e.isTrusted) recordMasterInteraction();
    }, {capture:true});
    document.addEventListener("change", (e) => {
      if (e.isTrusted) recordMasterInteraction();
    }, {capture:true});

    document.addEventListener("pointermove", scheduleToolbarHide, {
      passive: true
    });

    document.addEventListener("pointerdown", () => {
      scheduleToolbarHide();
      acquireWakeLock();
    }, {
      passive: true
    });

    document.addEventListener("touchstart", () => {
      scheduleToolbarHide();
      acquireWakeLock();
    }, {
      passive: true
    });

    document.addEventListener("keydown", () => {
      scheduleToolbarHide();
      acquireWakeLock();
    });

    // Smooth mouse wheel / trackpad scrolling.
    viewport.addEventListener("wheel", (e) => {
      e.preventDefault();

      pauseFollowingForManualControl();
      stopAutoScrollForManualControl();

      // Windows wheels usually send larger stepped deltas; trackpads send smaller frequent deltas.
      // This turns both into a smooth decaying motion.
      wheelVelocity += e.deltaY * 0.15;
      startWheelAnimation();
    }, { passive: false });

    // Unified mouse/touch/stylus dragging using Pointer Events.
    function stopDragMomentum() {
      if (dragMomentumFrame !== null) {
        cancelAnimationFrame(dragMomentumFrame);
        dragMomentumFrame = null;
      }
      dragVelocity = 0;
    }

    function startDragMomentum(initialVelocity) {
      stopDragMomentum();

      // Ignore very slow releases: they should simply stop where the finger stops.
      if (!Number.isFinite(initialVelocity) || Math.abs(initialVelocity) < 0.04) {
        return;
      }

      dragVelocity = Math.max(-3.5, Math.min(3.5, initialVelocity));
      let previousTime = performance.now();

      function step(now) {
        const dt = Math.min(40, Math.max(1, now - previousTime));
        previousTime = now;

        const before = viewport.scrollTop;
        scrollPos = before + dragVelocity * dt;
        clampScrollPos();
        const after = viewport.scrollTop;

        // Exponential friction gives a natural tablet-like ease-out and
        // behaves consistently at different frame rates.
        dragVelocity *= Math.exp(-0.0055 * dt);

        // Stop at either end, or once motion is no longer perceptible.
        if (
          Math.abs(dragVelocity) < 0.015 ||
          (after === before && (after <= 0 || after >= maxScrollTop()))
        ) {
          dragMomentumFrame = null;
          dragVelocity = 0;
          return;
        }

        dragMomentumFrame = requestAnimationFrame(step);
      }

      dragMomentumFrame = requestAnimationFrame(step);
    }

    viewport.addEventListener("pointerdown", (e) => {
      if (cueWordPickActive) return;
      if (e.button !== undefined && e.button !== 0) return;

      // Editable cue badges are controls, not drag targets.
      // Let their own click/tap handler receive the complete gesture.
      if (
        e.target instanceof Element &&
        e.target.closest(".cue-marker.cue-editable")
      ) {
        return;
      }

      pauseFollowingForManualControl();
      stopAutoScrollForManualControl();

      stopDragMomentum();
      isDragging = true;
      activePointerId = e.pointerId;
      lastPointerY = e.clientY;
      lastPointerTime = performance.now();
      dragVelocity = 0;
      wheelVelocity = 0;

      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (_) {
        // Some browsers may not allow capture in all situations.
      }
    });

    viewport.addEventListener("pointermove", (e) => {
      if (!isDragging || e.pointerId !== activePointerId) return;

      e.preventDefault();

      const now = performance.now();
      const dy = lastPointerY - e.clientY;
      const dt = Math.max(1, now - lastPointerTime);

      lastPointerY = e.clientY;
      lastPointerTime = now;

      // Smooth the instantaneous finger velocity so release momentum
      // follows the gesture without reacting strongly to one noisy event.
      const instantVelocity = dy / dt;
      dragVelocity = dragVelocity * 0.65 + instantVelocity * 0.35;

      scrollPos = viewport.scrollTop + dy;
      clampScrollPos();
    });

    function endPointerDrag(e) {
      if (e.pointerId !== activePointerId) return;

      const releaseVelocity = dragVelocity;
      isDragging = false;
      activePointerId = null;

      try {
        viewport.releasePointerCapture(e.pointerId);
      } catch (_) {
        // Ignore.
      }

      startDragMomentum(releaseVelocity);
    }

    viewport.addEventListener("pointerup", endPointerDrag);
    viewport.addEventListener("pointercancel", endPointerDrag);

    document.addEventListener("keydown", (e) => {
      const target = e.target;

      // Do not trigger teleprompter shortcuts while the user is typing
      // into a form control or editable field.
      if (
        target instanceof HTMLElement &&
        (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("[contenteditable='true']")
        )
      ) {
        return;
      }

      if (e.code === "Space") {
        if (syncMode !== "master") return;
        e.preventDefault();
        setPlaying(!playing);
      } else if (e.code === "PageDown") {
        e.preventDefault();
        wheelVelocity += 100;
        startWheelAnimation();
      } else if (e.code === "PageUp") {
        e.preventDefault();
        wheelVelocity -= 100;
        startWheelAnimation();
      } else if (e.code === "ArrowUp") {
        if (syncMode !== "master") return;
        e.preventDefault();
        speed = Math.min(20, speed + 0.5);
        speedInput.value = speed.toFixed(1);
        updateStatus();
      } else if (e.code === "ArrowDown") {
        if (syncMode !== "master") return;
        e.preventDefault();
        speed = Math.max(0, speed - 0.5);
        speedInput.value = speed.toFixed(1);
        updateStatus();
      } else if (e.code === "Home") {
        e.preventDefault();
        stopAutoScrollForManualControl();
        scrollPos = 0;
        viewport.scrollTop = 0;
      } else if (e.code === "End") {
        e.preventDefault();
        stopAutoScrollForManualControl();
        scrollPos = maxScrollTop();
        viewport.scrollTop = Math.round(scrollPos);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        fullscreenBtn.click();
      } else if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        jumpBack();
      }
    });


    masterBtn.addEventListener("click", () => {
      if (activeDepartment) {
        if (cueEditorUnlocked) {
          logoutCueEditorCookie();
          cueEditorKey = "";
          cueEditorUnlocked = false;
          passwordPanel.hidden = true;
          masterPassword.value = "";
          closeCueEditor();
          stopAnnotationMode();
          updateCueLockUi();
          renderCues();
          scheduleToolbarHide();
          return;
        }

        passwordPanel.hidden = !passwordPanel.hidden;
        updateCueLockUi();
        if (!passwordPanel.hidden) setTimeout(() => masterPassword.focus(), 0);
        return;
      }

      if (syncMode === "master") {
        logoutMasterCookie();
        masterKey = "";
        setSyncMode("follow");
        scheduleToolbarHide();
        acquireWakeLock();
        return;
      }

      clearMasterConflictUi();
      passwordPanel.hidden = !passwordPanel.hidden;
      if (!passwordPanel.hidden) setTimeout(() => masterPassword.focus(), 0);
    });

    masterCancelBtn.addEventListener("click", () => {
      masterPassword.value = "";
      passwordPanel.hidden = true;
      clearMasterConflictUi();
    });

    async function attemptUnlock() {
      const key = masterPassword.value;
      if (!key) return;

      if (activeDepartment) {
        masterLoginBtn.disabled = true;
        try {
          const ok = await authenticateCueEditor(key);
          if (!ok) {
            setSyncStatus(activeDepartment + ": wrong password", "error");
            return;
          }
          cueEditorKey = key;
          cueEditorUnlocked = true;
          passwordPanel.hidden = true;
          masterPassword.value = "";
          updateCueLockUi();
          renderCues();
          flushAnnotationQueue();
          setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");
        } catch (_) {
          setSyncStatus(activeDepartment + ": authentication error", "error");
        } finally {
          masterLoginBtn.disabled = false;
        }
        return;
      }

      masterKey = key;
      await enterMasterMode(false);
    }

    masterLoginBtn.addEventListener("click", attemptUnlock);
    takeControlBtn.addEventListener("click", async () => {
      takeControlBtn.disabled = true;
      try {
        const ok = await enterMasterMode(true);
        if (ok) {
          setSyncStatus("MASTER: live — control taken", "ok");
          publishMasterState();
        }
      } finally {
        takeControlBtn.disabled = false;
      }
    });

    masterPassword.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        attemptUnlock();
      } else if (e.key === "Escape") {
        masterPassword.value = "";
        passwordPanel.hidden = true;
        clearMasterConflictUi();
      }
    });

    stageDirectionsBtn.addEventListener("click", () => {
      showStageDirections = !showStageDirections;
      applyStageDirectionVisibility();
    });
    settingsBtn.addEventListener("click", openSettingsPanel);
    settingsBackdrop.addEventListener("click", closeSettingsPanel);
    settingsBackdrop.addEventListener("pointerdown", (e) => e.stopPropagation());
    settingsPanel.addEventListener("pointerdown", (e) => e.stopPropagation());
    settingsDoneBtn.addEventListener("click", closeSettingsPanel);
    railSideSelect.addEventListener("change", () => {
      railSide = railSideSelect.value === "left" ? "left" : "right";
      try { localStorage.setItem(RAIL_SIDE_STORAGE_KEY, railSide); } catch (_) {}
      applyDisplaySettings();
    });
    annotationMarginSideSelect.addEventListener("change", () => {
      queueDepartmentMarginSave(
        annotationMarginSideSelect.value,
        annotationMarginWidth.value
      );
    });
    annotationMarginWidth.addEventListener("input", () => {
      annotationMarginWidthValue.textContent = annotationMarginWidth.value + "%";
    });
    annotationMarginWidth.addEventListener("change", () => {
      queueDepartmentMarginSave(
        annotationMarginSideSelect.value,
        annotationMarginWidth.value
      );
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !settingsPanel.hidden) {
        e.preventDefault();
        closeSettingsPanel();
      }
    });
    addCueBtn.addEventListener("click", () => openCueEditor(null));
    annotateBtn.addEventListener("click", startAnnotationMode);
    annotationDoneBtn.addEventListener("click", stopAnnotationMode);
    annotationUndoBtn.addEventListener("click", undoAnnotationChange);
    for (const btn of annotationTools.querySelectorAll('[data-ann-tool]')) {
      btn.addEventListener('click', () => setAnnotationTool(btn.dataset.annTool));
    }
    window.addEventListener('online', () => {
      updateAnnotationSyncLabel();
      flushAnnotationQueue();
    });
    window.addEventListener('offline', updateAnnotationSyncLabel);
    nextCueBtn.addEventListener("click", jumpToNextCue);
    cueCancelBtn.addEventListener("click", closeCueEditor);
    cueSaveBtn.addEventListener("click", saveCueFromEditor);
    cueDeleteBtn.addEventListener("click", deleteCueFromEditor);
    cueUseCurrentBtn.addEventListener("click", () => {
      if (!editingCue) return;
      const pos = findSemanticPosition();
      editingAnchorPrompt = pos ? pos.prompt : currentReferencePromptId();
      editingAnchorFraction = pos ? pos.fraction : 0;
      cuePositionTracking = 'start';
      if (departmentUsesWordAnchors()) {
        editingAnchorWordIndex = null;
        editingAnchorWordText = "";
      }
      updateCueAnchorUi();
    });

    cueChooseWordBtn.addEventListener("click", startCueWordPick);
    cueUseEndCurrentBtn.addEventListener("click", () => {
      // Whatever position is currently floating becomes the locked start/end
      // position before the end selector begins following the reference line.
      const pos = findSemanticPosition();
      if (cuePositionTracking === 'start' && pos) {
        editingAnchorPrompt = pos.prompt;
        editingAnchorFraction = pos.fraction;
      }
      editingEndPosition = pos ? {prompt:pos.prompt, fraction:pos.fraction} : null;
      cuePositionTracking = 'end';
      updateCueAnchorUi();
    });
    cueClearEndBtn.addEventListener("click", () => {
      editingEndPosition = null;
      cuePositionTracking = null;
      updateCueAnchorUi();
    });



    document.addEventListener('pointerdown', (e) => {
      if (!settingsPanel.hidden && e.target && e.target.closest &&
          e.target.closest('#settingsPanel, #settingsBackdrop')) return;

      const inAnnotationUi = e.target && e.target.closest && e.target.closest('#annotationTools');

      // Any non-pen navigation/touch outside the temporary palette dismisses
      // it immediately, without affecting the actual teleprompter gesture.
      if (e.pointerType !== 'pen' && !inAnnotationUi) hideAutoPenPalette();

      if (e.target && e.target.closest && e.target.closest('#annotationTools, #toolbar')) return;

      // Automatic pen path: reveal tools but do NOT enter global annotation
      // mode. Fingers therefore remain normal teleprompter navigation.
      if (e.pointerType === 'pen' && activeDepartment && cueEditorUnlocked) {
        e.preventDefault();
        e.stopImmediatePropagation();
        penAnnotationPointerId = e.pointerId;
        const paletteWasHidden = annotationTools.hidden;
        showAutoPenPalette();
        const penTool = paletteWasHidden ? 'pen' : (annotationTool || 'pen');

        // Keep standardized eraser/button support if another device exposes it.
        if (isPenEraserEvent(e) || isPenBarrelEraserEvent(e) || penTool === 'erase') {
          annotationPointerId = e.pointerId;
          startEraserStroke(e);
          try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
          return;
        }

        startAnnotationGesture(e, {penAuto:true, tool:penTool});
        return;
      }

      // Explicit ✎ mode retains mouse/touch annotation behaviour.
      if (!annotationMode) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      startAnnotationGesture(e);
    }, true);

    document.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'pen' && penAnnotationPointerId === e.pointerId && penEraseActive) {
        e.preventDefault();
        e.stopImmediatePropagation();
        moveEraserStroke(e);
        return;
      }
      if (annotationPointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      moveAnnotationGesture(e);
    }, true);

    document.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'pen' && penAnnotationPointerId === e.pointerId && penEraseActive) {
        e.preventDefault();
        e.stopImmediatePropagation();
        penAnnotationPointerId = null;
        annotationPointerId = null;
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
        endEraserStroke();
        return;
      }
      if (annotationPointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      endAnnotationGesture(e);
    }, true);

    document.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'pen' && penAnnotationPointerId === e.pointerId && penEraseActive) {
        penAnnotationPointerId = null;
        annotationPointerId = null;
        endEraserStroke();
        return;
      }
      if (annotationPointerId !== e.pointerId) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      endAnnotationGesture(e);
    }, true);

    // Wheel/trackpad and keyboard navigation also dismiss an auto-opened pen palette.
    document.addEventListener('wheel', hideAutoPenPalette, {capture:true, passive:true});
    document.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName ? e.target.tagName.toLowerCase() : '';
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      hideAutoPenPalette();
    }, true);

    document.addEventListener("pointerdown", (e) => {
      if (!cueWordPickActive) return;
      if (!settingsPanel.hidden && e.target && e.target.closest &&
          e.target.closest('#settingsPanel, #settingsBackdrop')) return;

      // Handle the trigger-word selection before the teleprompter's normal
      // drag/pointer-capture code can consume the gesture.
      e.preventDefault();
      e.stopPropagation();

      const picked = wordAtPoint(e.clientX, e.clientY);
      if (!picked) {
        setSyncStatus(activeDepartment + ": click a script word", "warn");
        return;
      }

      editingAnchorPrompt = picked.prompt;
      editingAnchorWordIndex = picked.wordIndex;
      editingAnchorWordText = picked.text;
      const pickedBlock = content.querySelector('[data-prompt-id="' + CSS.escape(picked.prompt) + '"]');
      if (pickedBlock) {
        const rect = pickedBlock.getBoundingClientRect();
        editingAnchorFraction = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
      } else {
        editingAnchorFraction = 0;
      }

      // Picking a trigger word is also an explicit choice of the cue start,
      // so stop any live start-position tracking.
      cuePositionTracking = null;
      stopCueWordPick();
      updateCueAnchorUi();
      cueEditorPanel.hidden = false;
      updateCueEditorPositionMarkers();
      setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");

      // Keep the selected word visible while returning to the editor.
      requestAnimationFrame(() => {
        cueNumber.focus();
      });
    }, true);

    const { openExportPanel, closeExportPanel, startPdfExport } = createPdfExporter({
      exportStatus, exportDepartment, exportPanel, exportBackdrop, exportCues, exportAnnotations,
      exportStageDirections, exportOpenBtn, ALLOWED_DEPARTMENTS, CUE_API_ENDPOINT,
      ANNOTATION_API_ENDPOINT, SETTINGS_API_ENDPOINT, SCRIPT_GET_ENDPOINT,
      normalizeDepartmentMargin, departmentDefaultColor,
      getCurrentScriptId: () => currentScriptId,
      getActiveDepartment: () => activeDepartment,
      getAvailableScripts: () => availableScripts
    });

    exportBtn.addEventListener("click", openExportPanel);
    exportCancelBtn.addEventListener("click", closeExportPanel);
    exportBackdrop.addEventListener("click", closeExportPanel);
    exportOpenBtn.addEventListener("click", startPdfExport);

    scriptSelect.addEventListener("change", async () => {
      const id = scriptSelect.value;
      if (!id || id === currentScriptId) return;
      if (syncMode !== "master") pauseFollowingForManualControl();
      try {
        await loadShowScript(id);
        if (syncMode === "master") publishMasterState();
      } catch (_) {
        setSyncStatus("Script load error", "error");
      }
      scheduleToolbarHide();
    });

    sceneSelect.addEventListener("change", () => {
      jumpToPromptId(sceneSelect.value);
      sceneSelect.value = "";
    });

    songSelect.addEventListener("change", () => {
      jumpToPromptId(songSelect.value);
      songSelect.value = "";
    });

    rejoinBtn.addEventListener("click", rejoinMaster);

    syncStatus.addEventListener("click", () => {
      if (syncMode === "follow" && !followingLive) {
        rejoinMaster();
      }
    });

    const query = new URLSearchParams(window.location.search);
    const requestedDepartment = (query.get("dept") || "").toUpperCase();
    activeDepartment = ALLOWED_DEPARTMENTS.includes(requestedDepartment)
      ? requestedDepartment
      : null;
    updateCueLockUi();
    loadDisplaySettings();
    applyDisplaySettings({preservePosition:false});


    let cueTrackingScrollPending = false;
    viewport.addEventListener("scroll", () => {
      scheduleContextUpdate();
      if (!cueTrackingScrollPending && !cueEditorPanel.hidden && cuePositionTracking) {
        cueTrackingScrollPending = true;
        requestAnimationFrame(() => {
          cueTrackingScrollPending = false;
          updateTrackedCuePositionFromViewport();
        });
      }
    }, {passive:true});

    let overviewScrubbing = false;
    let overviewPointerId = null;

    function scrubOverviewTo(clientY) {
      const rect = overviewRail.getBoundingClientRect();
      const fraction = Math.max(
        0,
        Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))
      );

      scrollPos = fraction * maxScrollTop();
      viewport.scrollTop = scrollPos;
      scheduleContextUpdate();
    }

    overviewRail.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();

      pauseFollowingForManualControl();
      stopAutoScrollForManualControl();
      stopDragMomentum();

      overviewScrubbing = true;
      overviewPointerId = e.pointerId;

      try {
        overviewRail.setPointerCapture(e.pointerId);
      } catch (_) {}

      scrubOverviewTo(e.clientY);
    });

    overviewRail.addEventListener("pointermove", (e) => {
      if (!overviewScrubbing || e.pointerId !== overviewPointerId) return;
      e.preventDefault();
      e.stopPropagation();
      scrubOverviewTo(e.clientY);
    });

    function endOverviewScrub(e) {
      if (!overviewScrubbing || e.pointerId !== overviewPointerId) return;

      overviewScrubbing = false;
      overviewPointerId = null;

      try {
        overviewRail.releasePointerCapture(e.pointerId);
      } catch (_) {}
    }

    overviewRail.addEventListener("pointerup", endOverviewScrub);
    overviewRail.addEventListener("pointercancel", endOverviewScrub);

    window.addEventListener("resize", () => {
      scrollPos = viewport.scrollTop;
      clampScrollPos();
      requestAnimationFrame(() => {
        drawCueConnectors();
        drawCueRanges();
        scheduleAnnotationRender();
        rebuildOverviewRail();
        scheduleContextUpdate();
      });
    });

    applyFontSize();
    updateStatus();

    async function initializeTeleprompter() {
      try {
        if (activeDepartment) {
          await loadCentralDepartmentSettings({preservePosition:false});
        }
        await loadAvailableScripts();
        const requested = query.get("script");
        const first = availableScripts.length ? availableScripts[0].id : null;
        const chosen = availableScripts.some(s => s.id === requested) ? requested : first;
        if (!chosen) throw new Error("No scripts available");
        await loadShowScript(chosen);
        setSyncMode("follow");
        updateCueLockUi();
        await restorePersistentLogin();
      } catch (_) {
        content.innerHTML = "<div class='cue'><span class='dialog'>Could not load script.</span></div>";
        setSyncStatus("Script load error", "error");
      }
      scheduleToolbarHide();
      acquireWakeLock();
    }

    initializeTeleprompter();
