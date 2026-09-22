import { AnnotationEraser } from "./annotation-eraser.js";

export function createAnnotationsController({
    content,
    viewport,
    annotationToolbar,
    annotationStore,
    annotationGeometry,
    annotationApiEndpoint,
    getActiveDepartment = () => null,
    getCurrentScriptId = () => null,
    getCueEditorUnlocked = () => false,
    getCueEditorKey = () => "",
    getDepartmentColor = () => "#ffd000",
    getPromptBlocks = () => [],
    rebuildOverviewRail = () => {},
    scheduleToolbarHide = () => {},
    onManualControl = () => {}
}) {
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

    function annotationCacheKey(script = getCurrentScriptId(), dept = getActiveDepartment()) {
        return annotationStore.key(script, dept);
    }

    let currentSyncState = null;

    async function updateAnnotationSyncLabel() {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (!activeDepartment || !currentScriptId) {
            currentSyncState = null;
            if (annotationToolbar) {
                annotationToolbar.syncState = null;
                annotationToolbar.syncStatus = '';
            }
            return;
        }
        const pending = await annotationStore.opsFor(annotationCacheKey());
        const online = !!navigator.onLine;
        let stateObj = null;

        if (annotationFlushRunning) {
            stateObj = { status: 'syncing' };
        } else if (annotationSyncDebounceTimer !== null) {
            stateObj = { status: 'saving' };
        } else if (pending.length) {
            stateObj = { status: 'pending', pendingCount: pending.length, online };
        } else {
            stateObj = { status: 'saved', online };
        }

        currentSyncState = stateObj;
        if (annotationToolbar) {
            annotationToolbar.syncState = stateObj;
        }
    }

    function renderAnnotations() {
        annotationGeometry.clearLayers();
        const activeDepartment = getActiveDepartment();
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
            const geometry = annotationGeometry.horizontalGeometry(block);
            const height = Math.max(1, block.clientHeight);
            const lineHeight = annotationGeometry.lineHeightPx(block);
            const svg = annotationGeometry.svgElement('svg', {width: '100%', height: '100%'});
            svg.classList.add('annotation-layer');
            svg.dataset.promptId = prompt;
            for (const ann of annotations) {
                const shape = annotationGeometry.buildShape(svg, ann, geometry, height, lineHeight);
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

    async function loadDepartmentAnnotations({preferCache = true, preserveExisting = false} = {}) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (!activeDepartment || !currentScriptId) return;

        const script = currentScriptId;
        const department = activeDepartment;
        const key = annotationCacheKey(script, department);
        const serial = ++annotationLoadSerial;

        if (!preserveExisting) {
            loadedAnnotations = [];
            annotationRevision = 0;
            annotationDraft = null;
            annotationGeometry.clearLayers();
        }

        if (preferCache) {
            const cached = await annotationStore.getDoc(key);
            if (serial !== annotationLoadSerial ||
                script !== getCurrentScriptId() || department !== getActiveDepartment()) return;
            if (cached && Array.isArray(cached.annotations)) {
                loadedAnnotations = cached.annotations;
                annotationRevision = Number(cached.revision) || 0;
                renderAnnotations();
                requestAnimationFrame(rebuildOverviewRail);
            }

            const pending = await annotationStore.opsFor(key);
            if (serial !== annotationLoadSerial ||
                script !== getCurrentScriptId() || department !== getActiveDepartment()) return;
            if (pending.length) {
                updateAnnotationSyncLabel();
                if (getCueEditorUnlocked() && navigator.onLine) flushAnnotationQueue();
                return;
            }
        }

        try {
            const url = annotationApiEndpoint +
                '?action=get&script=' + encodeURIComponent(script) +
                '&dept=' + encodeURIComponent(department) + '&_=' + Date.now();
            const response = await fetch(url, {cache: 'no-store'});
            if (!response.ok) throw new Error('Annotation load HTTP ' + response.status);
            const body = await response.json();
            if (serial !== annotationLoadSerial ||
                script !== getCurrentScriptId() || department !== getActiveDepartment()) return;
            loadedAnnotations = Array.isArray(body.annotations) ? body.annotations : [];
            annotationRevision = Number(body.revision) || 0;
            await annotationStore.putDoc(script, department, annotationRevision, loadedAnnotations);
            renderAnnotations();
            requestAnimationFrame(rebuildOverviewRail);
        } catch (_) {
            // Cached annotations remain visible.
        }
        updateAnnotationSyncLabel();
    }

    function makeAnnotationId() {
        const dept = (getActiveDepartment() || "ann").toLowerCase();
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            return dept + '-ann-' + window.crypto.randomUUID();
        }
        return dept + '-ann-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
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
        document.body.classList.add('annotation-erase');
        const target = document.elementFromPoint(clientX, clientY);
        const shape = target && target.closest ? target.closest('[data-annotation-id]') : null;
        const id = shape && shape.dataset ? shape.dataset.annotationId : '';
        if (!penEraseActive && !annotationMode) document.body.classList.remove('annotation-erase');
        return id || '';
    }

    function showAutoPenPalette() {
        if (!getActiveDepartment() || !getCueEditorUnlocked()) return;
        if (!penPaletteAutoVisible && !annotationMode) {
            setAnnotationTool('pen');
        }
        if (annotationToolbar) annotationToolbar.open = true;
        penPaletteAutoVisible = !annotationMode;
        updateAnnotationSyncLabel();
    }

    function hideAutoPenPalette() {
        if (!penPaletteAutoVisible || annotationMode) return;
        penPaletteAutoVisible = false;
        if (annotationToolbar) annotationToolbar.open = false;
        document.body.classList.remove('annotation-erase');
    }

    const annotationEraser = new AnnotationEraser({
        onEraseAnnotation: (id) => applyAnnotationLocal('delete', {id}),
        isAnnotationMode: () => annotationMode,
        getAnnotationTool: () => annotationTool
    });

    function startEraserStroke(e) {
        penEraseActive = true;
        annotationEraser.startStroke(e.clientX, e.clientY);
    }

    function moveEraserStroke(e) {
        annotationEraser.moveStroke(e.clientX, e.clientY);
    }

    function endEraserStroke() {
        const removedCount = annotationEraser.endStroke();
        penEraseActive = false;
        if (removedCount > 0) scheduleAnnotationSync(500);
    }

    async function annotationServerMutation(action, payload) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        const response = await fetch(annotationApiEndpoint + '?action=' + encodeURIComponent(action), {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Cue-Key': getCueEditorKey()
            },
            cache: 'no-store',
            body: JSON.stringify({
                script: currentScriptId,
                department: activeDepartment,
                ...payload
            })
        });
        const text = await response.text();
        let body = null;
        try {
            body = JSON.parse(text);
        } catch (_) {
        }
        if (!response.ok) throw new Error((body && body.error) || 'Annotation update failed');
        return body || {};
    }

    async function queueAnnotationMutation(action, payload) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (!activeDepartment || !currentScriptId) return;
        const script = currentScriptId;
        const department = activeDepartment;
        const key = annotationCacheKey(script, department);
        const opId = await annotationStore.addOp({key, script, department, action, payload, createdAt: Date.now()});
        await annotationStore.putDoc(script, department, annotationRevision, loadedAnnotations);
        updateAnnotationSyncLabel();

        if (opId === null) {
            if (navigator.onLine && getCueEditorUnlocked()) {
                try {
                    const body = await annotationServerMutation(action, payload);
                    annotationRevision = Math.max(annotationRevision, Number(body.revision) || 0);
                    currentSyncState = { status: 'saved', online: true };
                    if (annotationToolbar) annotationToolbar.syncState = currentSyncState;
                } catch (_) {
                    currentSyncState = { status: 'not-saved' };
                    if (annotationToolbar) annotationToolbar.syncState = currentSyncState;
                }
            } else {
                currentSyncState = { status: 'offline-not-cached' };
                if (annotationToolbar) annotationToolbar.syncState = currentSyncState;
            }
            return;
        }

        scheduleAnnotationSync(500);
    }

    async function applyAnnotationLocal(action, payload, {recordUndo = true} = {}) {
        annotationLoadSerial++;
        if (action === 'save' && payload.annotation) {
            const ann = payload.annotation;
            const idx = loadedAnnotations.findIndex(a => a && a.id === ann.id);
            const previous = idx >= 0 ? JSON.parse(JSON.stringify(loadedAnnotations[idx])) : null;
            if (idx >= 0) loadedAnnotations[idx] = ann;
            else loadedAnnotations.push(ann);
            if (recordUndo) {
                annotationUndoStack.push(previous
                    ? {action: 'save', payload: {annotation: previous}}
                    : {action: 'delete', payload: {id: ann.id}});
            }
        } else if (action === 'delete' && payload.id) {
            const idx = loadedAnnotations.findIndex(a => a && a.id === payload.id);
            if (idx >= 0) {
                const previous = JSON.parse(JSON.stringify(loadedAnnotations[idx]));
                loadedAnnotations.splice(idx, 1);
                if (recordUndo) annotationUndoStack.push({action: 'save', payload: {annotation: previous}});
            }
        }
        renderAnnotations();
        requestAnimationFrame(rebuildOverviewRail);
        await queueAnnotationMutation(action, payload);
    }

    async function flushAnnotationQueue() {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (annotationFlushRunning || !navigator.onLine || !getCueEditorUnlocked() || !activeDepartment || !currentScriptId) {
            updateAnnotationSyncLabel();
            return;
        }
        annotationFlushRunning = true;
        updateAnnotationSyncLabel();
        try {
            const key = annotationCacheKey();
            let ops = await annotationStore.opsFor(key);
            while (ops.length && navigator.onLine && getCueEditorUnlocked() &&
                   activeDepartment === getActiveDepartment() && currentScriptId === getCurrentScriptId()) {
                const op = ops[0];
                try {
                    const body = await annotationServerMutation(op.action, op.payload);
                    annotationRevision = Math.max(annotationRevision, Number(body.revision) || 0);
                    await annotationStore.deleteOp(op.id);
                } catch (e) {
                    break;
                }
                ops = await annotationStore.opsFor(key);
            }
            if (currentScriptId === getCurrentScriptId() && activeDepartment === getActiveDepartment()) {
                await annotationStore.putDoc(currentScriptId, activeDepartment, annotationRevision, loadedAnnotations);
            }
        } finally {
            annotationFlushRunning = false;
            updateAnnotationSyncLabel();
        }
    }

    function normalizedPointForBlock(block, clientX, clientY) {
        const rect = block.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return [0, 0];
        const lineHeight = annotationGeometry.lineHeightPx(block);
        const geometry = annotationGeometry.horizontalGeometry(block);

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

        if (el.closest('#toolbar, #annotationTools, cue-editor-dialog, settings-dialog, export-dialog, #overviewRail, #contextHeader')) {
            return null;
        }

        const viewportRect = viewport.getBoundingClientRect();
        const contentRect = content.getBoundingClientRect();
        if (clientX < contentRect.left || clientX > contentRect.right ||
            clientY < viewportRect.top || clientY > viewportRect.bottom) {
            return null;
        }

        let nearest = null;
        let nearestDistance = Infinity;
        for (const block of getPromptBlocks()) {
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
        if (annotationToolbar) annotationToolbar.tool = tool;
    }

    function startAnnotationMode() {
        if (!getActiveDepartment() || !getCueEditorUnlocked()) return;
        onManualControl();
        annotationMode = true;
        penPaletteAutoVisible = false;
        if (annotationToolbar) {
            annotationToolbar.color = getDepartmentColor();
            annotationToolbar.open = true;
        }
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
        if (annotationToolbar) annotationToolbar.open = false;
        clearAnnotationSyncDebounce();
        document.body.classList.remove('annotation-mode', 'annotation-erase');
        renderAnnotations();
    }

    function startAnnotationGesture(e, options = {}) {
        const penAuto = !!options.penAuto;
        const gestureTool = options.tool || annotationTool;
        if ((!annotationMode && !penAuto) || !getCueEditorUnlocked()) return false;

        if (gestureTool === 'erase') {
            annotationPointerId = e.pointerId;
            startEraserStroke(e);
            try {
                viewport.setPointerCapture(e.pointerId);
            } catch (_) {}
            return true;
        }

        const block = promptBlockAtPoint(e.clientX, e.clientY);
        if (!block || !block.dataset.promptId) return true;
        const point = normalizedPointForBlock(block, e.clientX, e.clientY);
        const annColor = annotationToolbar ? annotationToolbar.color : getDepartmentColor();
        const annWidth = Number(annotationToolbar ? annotationToolbar.width : 3) || 3;

        if (annotationTool === 'text') {
            const text = prompt('Annotation text:');
            if (text && text.trim()) {
                const ann = {
                    id: makeAnnotationId(), type: 'text', prompt: block.dataset.promptId,
                    at: point, text: text.trim().slice(0, 160), color: annColor,
                    width: annWidth, fontPx: annotationGeometry.currentScriptFontPx(),
                    lineHeightPx: annotationGeometry.lineHeightPx(block), coordMode: 'line'
                };
                applyAnnotationLocal('save', {annotation: ann});
                scheduleAnnotationSync(500);
            }
            return true;
        }

        annotationPointerId = e.pointerId;
        const base = {
            id: makeAnnotationId(), type: gestureTool === 'pen' ? 'stroke' : gestureTool,
            prompt: block.dataset.promptId, color: annColor,
            width: annWidth, fontPx: annotationGeometry.currentScriptFontPx(),
            lineHeightPx: annotationGeometry.lineHeightPx(block), coordMode: 'line'
        };
        if (base.type === 'stroke') {
            base.points = [point, point];
            base.pressures = [penPressure(e), penPressure(e)];
        } else {
            base.from = point;
            base.to = point;
        }
        annotationDraft = base;
        scheduleAnnotationRender();
        try {
            viewport.setPointerCapture(e.pointerId);
        } catch (_) {
        }
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
            const last = pts[pts.length - 1];
            const geometry = annotationGeometry.horizontalGeometry(block);
            const dx = (point[0] - last[0]) * geometry.width;
            const dy = (point[1] - last[1]) * annotationGeometry.lineHeightPx(block);
            if (dx * dx + dy * dy >= 2.25) {
                pts.push(point);
                if (Array.isArray(annotationDraft.pressures)) annotationDraft.pressures.push(penPressure(e));
            }
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
            try {
                viewport.releasePointerCapture(e.pointerId);
            } catch (_) {
            }
            endEraserStroke();
            return true;
        }
        const ann = annotationDraft;
        annotationPointerId = null;
        annotationDraft = null;
        try {
            viewport.releasePointerCapture(e.pointerId);
        } catch (_) {
        }
        if (!ann) return true;

        if (ann.type === 'stroke' && ann.points.length < 2) return true;
        applyAnnotationLocal('save', {annotation: ann});
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
        await applyAnnotationLocal(undo.action, undo.payload, {recordUndo: false});
    }

    async function handleAnnotationRevisionEvent(event) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (!activeDepartment || !currentScriptId || !event) return;
        let body = null;
        if (typeof event.data === "string") {
            try { body = JSON.parse(event.data); } catch (_) { return; }
        } else if (event.data && typeof event.data === "object") {
            body = event.data;
        } else if (typeof event === "object") {
            body = event;
        }
        const revisions = body && body.revisions ? body.revisions : body;
        if (!revisions || typeof revisions !== 'object') return;
        const entry = revisions[currentScriptId + '_' + activeDepartment];
        if (!entry || Number(entry.revision) <= annotationRevision) return;

        const pending = await annotationStore.opsFor(annotationCacheKey());
        if (pending.length) {
            flushAnnotationQueue();
            return;
        }
        loadDepartmentAnnotations({preferCache: false, preserveExisting: true});
    }

    // Annotation Toolbar event listeners
    if (annotationToolbar) {
        annotationToolbar.addEventListener('tool-change', (e) => setAnnotationTool(e.detail.tool));
        annotationToolbar.addEventListener('undo', undoAnnotationChange);
        annotationToolbar.addEventListener('done', stopAnnotationMode);
    }

    window.addEventListener('online', () => {
        updateAnnotationSyncLabel();
        flushAnnotationQueue();
    });
    window.addEventListener('offline', updateAnnotationSyncLabel);

    // Pointer event listeners for Pen / Annotation mode
    document.addEventListener('pointerdown', (e) => {
        const settingsDialog = document.querySelector('settings-dialog');
        if (settingsDialog?.open &&
            e.target?.closest?.('settings-dialog, #settingsPanel, #settingsBackdrop')) return;

        const inAnnotationUi = e.target?.closest?.('#annotationTools, annotation-toolbar');

        if (e.pointerType !== 'pen' && !inAnnotationUi) hideAutoPenPalette();
        if (e.target?.closest?.('#annotationTools, annotation-toolbar, #toolbar')) return;

        const activeDepartment = getActiveDepartment();
        const cueEditorUnlocked = getCueEditorUnlocked();

        if (e.pointerType === 'pen' && activeDepartment && cueEditorUnlocked) {
            e.preventDefault();
            e.stopImmediatePropagation();
            penAnnotationPointerId = e.pointerId;
            const paletteWasHidden = !annotationToolbar?.open;
            showAutoPenPalette();
            const penTool = paletteWasHidden ? 'pen' : (annotationTool || 'pen');

            if (isPenEraserEvent(e) || isPenBarrelEraserEvent(e) || penTool === 'erase') {
                annotationPointerId = e.pointerId;
                startEraserStroke(e);
                try {
                    viewport.setPointerCapture(e.pointerId);
                } catch (_) {
                }
                return;
            }

            startAnnotationGesture(e, {penAuto: true, tool: penTool});
            return;
        }

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
            try {
                viewport.releasePointerCapture(e.pointerId);
            } catch (_) {
            }
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

    document.addEventListener('wheel', hideAutoPenPalette, {capture: true, passive: true});
    document.addEventListener('keydown', (e) => {
        const tag = e.target?.tagName ? e.target.tagName.toLowerCase() : '';
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        hideAutoPenPalette();
    }, true);

    return {
        renderAnnotations,
        scheduleAnnotationRender,
        loadDepartmentAnnotations,
        flushAnnotationQueue,
        updateAnnotationSyncLabel,
        setAnnotationTool,
        startAnnotationMode,
        stopAnnotationMode,
        undoAnnotationChange,
        handleAnnotationRevisionEvent,
        hideAutoPenPalette,
        showAutoPenPalette,
        scheduleAnnotationSync,
        clearAnnotationSyncDebounce,
        isAnnotationMode: () => annotationMode,
        getLoadedAnnotations: () => loadedAnnotations,
        getAnnotationRevision: () => annotationRevision,
        getSyncState: () => currentSyncState
    };
}
