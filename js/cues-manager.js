import {cueWordEntries, wrapCueTriggerWord as wrapCueTriggerWordElement} from "./cue-text.js";
import {contrastingTextColor} from "./utils.js";

export function createCuesManager({
    content,
    viewport,
    cueEditorDialog,
    toolbarSync,
    cueApiEndpoint,
    departmentDefaultColors = {},
    getActiveDepartment = () => null,
    getCurrentScriptId = () => null,
    getCachedPromptBlocks = () => [],
    findSemanticPosition = () => null,
    semanticDocumentY = () => null,
    currentReferencePromptId = () => null,
    ensurePositionLine = () => null,
    applyStageDirectionVisibility = () => {},
    scheduleContextUpdate = () => {},
    rebuildOverviewRail = () => {},
    scheduleToolbarHide = () => {},
    maxScrollTop = () => 0,
    setScrollPos = () => {},
    onManualControl = () => {},
    setSyncStatus = () => {},
    flushAnnotationQueue = async () => {},
    scheduleAnnotationSync = () => {},
    syncSettingsControls = () => {},
    isSavePending = () => false,
    isSaveRunning = () => false,
    flushDepartmentMarginSave = async () => {}
}) {
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
    let cuePositionTracking = null; // null, "start", or "end"

    function departmentDefaultColor(dept = getActiveDepartment()) {
        return departmentDefaultColors[dept] || "#ffd000";
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
        const activeDepartment = getActiveDepartment();
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
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment || !loadedCues.length) {
            applyStageDirectionVisibility();
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
        requestAnimationFrame(() => {
            drawCueConnectors();
            drawCueRanges();
            rebuildOverviewRail();
            scheduleContextUpdate();
        });
    }

    async function loadDepartmentCues({preserveExisting = false} = {}) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        if (!activeDepartment || !currentScriptId) return;

        const script = currentScriptId;
        const department = activeDepartment;
        const serial = ++cueLoadSerial;

        if (!preserveExisting) {
            loadedCues = [];
            cueRevision = 0;
            clearCueDecorations();
        }

        const url = cueApiEndpoint +
            "?action=get&script=" + encodeURIComponent(script) +
            "&dept=" + encodeURIComponent(department) +
            "&_=" + Date.now();

        const response = await fetch(url, {cache: "no-store"});
        if (!response.ok) throw new Error("Cue load HTTP " + response.status);
        const body = await response.json();
        if (serial !== cueLoadSerial ||
            script !== getCurrentScriptId() || department !== getActiveDepartment()) return;
        loadedCues = Array.isArray(body.cues) ? body.cues : [];
        cueRevision = Number(body.revision) || 0;
        renderCues();
    }

    async function authenticateCueEditor(key = "") {
        const activeDepartment = getActiveDepartment();
        const headers = {"Content-Type": "application/json"};
        if (key) headers["X-Cue-Key"] = key;

        const response = await fetch(cueApiEndpoint + "?action=auth", {
            method: "POST",
            headers,
            cache: "no-store",
            body: JSON.stringify({department: activeDepartment})
        });
        await response.text();
        return response.ok;
    }

    async function logoutCueEditorCookie() {
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment) return;
        try {
            await fetch(cueApiEndpoint + "?action=logout", {
                method: "POST",
                headers: {"Content-Type": "application/json"},
                cache: "no-store",
                body: JSON.stringify({department: activeDepartment})
            });
        } catch (_) {
        }
    }

    async function cueMutation(action, payload) {
        const activeDepartment = getActiveDepartment();
        const currentScriptId = getCurrentScriptId();
        const response = await fetch(cueApiEndpoint + "?action=" + encodeURIComponent(action), {
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
        try {
            body = JSON.parse(text);
        } catch (_) {
        }
        if (!response.ok) throw new Error((body && body.error) || "Cue update failed");
        return body || {};
    }

    function updateCueLockUi() {
        const activeDepartment = getActiveDepartment();
        if (toolbarSync) {
            toolbarSync.activeDepartment = activeDepartment;
            toolbarSync.cueEditorUnlocked = cueEditorUnlocked;
        }
        syncSettingsControls();
        if (cueEditorUnlocked && isSavePending() && !isSaveRunning()) {
            flushDepartmentMarginSave();
        }
    }

    function departmentUsesWordAnchors(dept = getActiveDepartment()) {
        return dept === "LX" || dept === "SND" || dept === "STG";
    }

    function updateCueEditorPositionMarkers() {
        if (!ensurePositionLine) return;
        const startLine = ensurePositionLine('start');
        const endLine = ensurePositionLine('end');
        if (!cueEditorDialog || !cueEditorDialog.open) {
            if (startLine) startLine.hidden = true;
            if (endLine) endLine.hidden = true;
            return;
        }
        const startPos = editingAnchorPrompt ? {prompt: editingAnchorPrompt, fraction: editingAnchorFraction} : null;
        let sy = semanticDocumentY(startPos);
        const startBlock = editingAnchorPrompt && content.querySelector('[data-prompt-id="' + CSS.escape(editingAnchorPrompt) + '"]');
        if (startBlock && departmentUsesWordAnchors() && Number.isInteger(editingAnchorWordIndex)) {
            const trigger = startBlock.querySelector('.cue-trigger-word[data-word-index="' + CSS.escape(String(editingAnchorWordIndex)) + '"]');
            if (trigger) sy = startBlock.offsetTop + trigger.offsetTop + trigger.offsetHeight * .5;
        }
        if (sy !== null) {
            startLine.style.top = sy + 'px';
            startLine.hidden = false;
        } else if (startLine) startLine.hidden = true;

        const ey = semanticDocumentY(editingEndPosition);
        if (ey !== null) {
            endLine.style.top = ey + 'px';
            endLine.hidden = false;
        } else if (endLine) endLine.hidden = true;
    }

    function updateCueAnchorUi() {
        if (!cueEditorDialog) return;
        const wordMode = departmentUsesWordAnchors();
        cueEditorDialog.wordMode = wordMode;
        cueEditorDialog.anchorInfo = editingAnchorPrompt || "No prompt selected";
        cueEditorDialog.wordInfo = wordMode && Number.isInteger(editingAnchorWordIndex)
            ? ('"' + editingAnchorWordText + '"')
            : (wordMode ? "No trigger word selected" : "");
        cueEditorDialog.endInfo = editingEndPosition
            ? (editingEndPosition.prompt + ' @ ' + Math.round((Number(editingEndPosition.fraction) || 0) * 100) + '%')
            : 'No end position';
        cueEditorDialog.positionTracking = cuePositionTracking;
        updateCueEditorPositionMarkers();
    }

    function openCueEditor(cue = null) {
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment || !cueEditorUnlocked || !cueEditorDialog) return;

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
            ? {prompt: cue.endAnchor.prompt, fraction: Math.max(0, Math.min(1, Number(cue.endAnchor.fraction) || 0))}
            : null;
        cuePositionTracking = cue ? null : 'start';

        cueEditorDialog.isEditing = !!cue;
        cueEditorDialog.department = activeDepartment;
        cueEditorDialog.cueNumber = cue ? (cue.number || "") : "";
        cueEditorDialog.description = cue ? (cue.description || "") : "";
        cueEditorDialog.color =
            cue && /^#[0-9A-Fa-f]{6}$/.test(cue.color || "")
                ? cue.color
                : departmentDefaultColor();
        cueEditorDialog.error = "";
        cueEditorDialog.busy = false;

        updateCueAnchorUi();
        cueEditorDialog.open = true;
        updateCueEditorPositionMarkers();
        cueEditorDialog.updateComplete.then(() => cueEditorDialog.focus());
    }

    function stopCueWordPick() {
        cueWordPickActive = false;
        document.body.classList.remove("cue-word-pick");
    }

    function closeCueEditor() {
        stopCueWordPick();
        if (cueEditorDialog) cueEditorDialog.open = false;
        editingCue = null;
        editingAnchorPrompt = null;
        editingAnchorFraction = 0;
        editingAnchorWordIndex = null;
        editingAnchorWordText = "";
        editingEndPosition = null;
        cuePositionTracking = null;
        if (cueEditorDialog) cueEditorDialog.error = "";
        updateCueEditorPositionMarkers();
    }

    function startCueWordPick() {
        if (!departmentUsesWordAnchors()) return;
        cueWordPickActive = true;
        document.body.classList.add("cue-word-pick");
        if (cueEditorDialog) cueEditorDialog.open = false;
        setSyncStatus(getActiveDepartment() + ": click trigger word", "warn");
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

    async function saveCueFromEditor(detail = null) {
        if (!cueEditorDialog) return;
        if (!editingAnchorPrompt) {
            cueEditorDialog.error = "Choose an anchor position first.";
            return;
        }

        const number = ((detail && detail.number) || cueEditorDialog.cueNumber || "").trim();
        const description = ((detail && detail.description !== undefined ? detail.description : cueEditorDialog.description) || "").trim();
        const color = (detail && detail.color) || cueEditorDialog.color;
        if (!number) {
            cueEditorDialog.error = "Cue number is required.";
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

        cueEditorDialog.busy = true;
        cueEditorDialog.error = "";
        try {
            await cueMutation("save", {
                cue: {
                    id: editingCue ? editingCue.id : null,
                    number,
                    description,
                    color,
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
            cueEditorDialog.error = err.message || "Could not save cue.";
        } finally {
            cueEditorDialog.busy = false;
        }
    }

    async function deleteCueFromEditor() {
        const activeDepartment = getActiveDepartment();
        if (!cueEditorDialog) return;
        if (!editingCue || !confirm("Delete " + activeDepartment + " cue " + (editingCue.number || "") + "?")) return;
        cueEditorDialog.busy = true;
        cueEditorDialog.error = "";
        try {
            await cueMutation("delete", {id: editingCue.id});
            closeCueEditor();
            await loadDepartmentCues();
        } catch (err) {
            cueEditorDialog.error = err.message || "Could not delete cue.";
        } finally {
            cueEditorDialog.busy = false;
        }
    }

    function cueSortPosition(cue) {
        const prompt = cue && cue.anchor && cue.anchor.prompt;
        const cachedPromptBlocks = getCachedPromptBlocks();
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
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment || !loadedCues.length) return;

        const current = findSemanticPosition();
        if (!current) return;

        const cachedPromptBlocks = getCachedPromptBlocks();
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

        onManualControl();

        const block = content.querySelector(
            '[data-prompt-id="' + CSS.escape(next.anchor.prompt) + '"]'
        );
        if (!block) return;

        const target =
            block.offsetTop -
            viewport.clientHeight * 0.35;

        setScrollPos(Math.max(0, Math.min(maxScrollTop(), target)));
        scheduleToolbarHide();
    }

    function updateTrackedCuePositionFromViewport() {
        if (!cueEditorDialog || !cueEditorDialog.open || !cuePositionTracking) return;
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
            editingEndPosition = {prompt: pos.prompt, fraction: pos.fraction};
        }
        updateCueAnchorUi();
    }

    function handleCueRevisionEvent(event) {
        const activeDepartment = getActiveDepartment();
        if (!activeDepartment || !event || event.dept !== activeDepartment) return;
        const rev = Number(event.revision) || 0;
        if (rev <= cueRevision) return;
        cueRevision = rev;
        loadDepartmentCues({preserveExisting: true});
    }

    // Cue Editor Dialog event listeners
    if (cueEditorDialog) {
        cueEditorDialog.addEventListener("close", closeCueEditor);
        cueEditorDialog.addEventListener("save", (e) => saveCueFromEditor(e.detail));
        cueEditorDialog.addEventListener("delete", deleteCueFromEditor);
        cueEditorDialog.addEventListener("choose-word", startCueWordPick);
        cueEditorDialog.addEventListener("toggle-track-start", () => {
            if (!editingCue) return;
            const pos = findSemanticPosition();
            editingAnchorPrompt = pos ? pos.prompt : currentReferencePromptId();
            editingAnchorFraction = pos ? pos.fraction : 0;
            cuePositionTracking = cuePositionTracking === 'start' ? null : 'start';
            if (departmentUsesWordAnchors()) {
                editingAnchorWordIndex = null;
                editingAnchorWordText = "";
            }
            updateCueAnchorUi();
        });
        cueEditorDialog.addEventListener("toggle-track-end", () => {
            const pos = findSemanticPosition();
            if (cuePositionTracking === 'start' && pos) {
                editingAnchorPrompt = pos.prompt;
                editingAnchorFraction = pos.fraction;
            }
            editingEndPosition = pos ? {prompt: pos.prompt, fraction: pos.fraction} : null;
            cuePositionTracking = cuePositionTracking === 'end' ? null : 'end';
            updateCueAnchorUi();
        });
        cueEditorDialog.addEventListener("clear-end", () => {
            editingEndPosition = null;
            if (cuePositionTracking === 'end') cuePositionTracking = null;
            updateCueAnchorUi();
        });
    }

    // Trigger word pick pointerdown handler
    document.addEventListener("pointerdown", (e) => {
        if (!cueWordPickActive) return;
        const settingsDialog = document.querySelector("settings-dialog");
        if (settingsDialog?.open &&
            e.target?.closest?.('settings-dialog, #settingsPanel, #settingsBackdrop')) return;

        e.preventDefault();
        e.stopPropagation();

        const picked = wordAtPoint(e.clientX, e.clientY);
        const activeDepartment = getActiveDepartment();
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

        cuePositionTracking = null;
        stopCueWordPick();
        updateCueAnchorUi();
        if (cueEditorDialog) {
            cueEditorDialog.open = true;
        }
        updateCueEditorPositionMarkers();
        setSyncStatus("FOLLOW: " + activeDepartment + " editor", "ok");

        requestAnimationFrame(() => {
            if (cueEditorDialog) cueEditorDialog.focus();
        });
    }, true);

    return {
        renderCues,
        clearCueDecorations,
        drawCueConnectors,
        drawCueRanges,
        loadDepartmentCues,
        authenticateCueEditor,
        logoutCueEditorCookie,
        cueMutation,
        updateCueLockUi,
        departmentUsesWordAnchors,
        updateCueEditorPositionMarkers,
        updateCueAnchorUi,
        openCueEditor,
        closeCueEditor,
        startCueWordPick,
        stopCueWordPick,
        wordAtPoint,
        saveCueFromEditor,
        deleteCueFromEditor,
        jumpToNextCue,
        updateTrackedCuePositionFromViewport,
        handleCueRevisionEvent,
        departmentDefaultColor,
        isCuePositionTracking: () => !!cuePositionTracking,
        isCueWordPickActive: () => cueWordPickActive,
        getLoadedCues: () => loadedCues,
        getCueRevision: () => cueRevision,
        isCueEditorUnlocked: () => cueEditorUnlocked,
        setCueEditorUnlocked: (val) => { cueEditorUnlocked = !!val; },
        getCueEditorKey: () => cueEditorKey,
        setCueEditorKey: (val) => { cueEditorKey = val || ""; }
    };
}
