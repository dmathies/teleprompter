import {extractActLabel} from "./context-header.js";

export function createOverviewRail({
    overviewRail,
    overviewMarkers,
    overviewViewportIndicator,
    overviewMasterIndicator,
    viewport,
    content,
    getPromptBlocks,
    getLoadedCues = () => [],
    getLoadedAnnotations = () => [],
    getActiveDepartment = () => null,
    getDepartmentDefaultColor = () => "#ffd000",
    toDocumentY = () => null,
    promptLineHeightPx = () => 20,
    getSyncMode = () => "follow",
    isFollowingLive = () => true,
    getLatestRemoteState = () => null,
    getCurrentScriptId = () => null,
    maxScrollTop = () => 0,
    onScrub = null,
    scheduleContextUpdate = null
}) {
    let masterPositionLine = null;
    let cueStartPositionLine = null;
    let cueEndPositionLine = null;

    let overviewScrubbing = false;
    let overviewPointerId = null;

    function ensurePositionLine(kind) {
        let line = kind === 'master'
            ? masterPositionLine
            : (kind === 'start' ? cueStartPositionLine : cueEndPositionLine);
        if (line && line.isConnected) return line;
        line = document.createElement('div');
        line.id = kind === 'master'
            ? 'masterPositionLine'
            : (kind === 'start' ? 'cueStartPositionLine' : 'cueEndPositionLine');
        line.hidden = true;
        content.appendChild(line);
        if (kind === 'master') masterPositionLine = line;
        else if (kind === 'start') cueStartPositionLine = line;
        else cueEndPositionLine = line;
        return line;
    }

    function updateMasterPositionMarker() {
        if (!overviewMasterIndicator) return;
        const syncMode = getSyncMode();
        const followingLive = isFollowingLive();
        const latestRemoteState = getLatestRemoteState();
        const currentScriptId = getCurrentScriptId();

        const show = syncMode === 'follow' && !followingLive &&
            latestRemoteState && latestRemoteState.script === currentScriptId;
        const line = ensurePositionLine('master');
        if (!show) {
            line.hidden = true;
            overviewMasterIndicator.hidden = true;
            return;
        }
        const y = toDocumentY(latestRemoteState);
        if (y === null) {
            line.hidden = true;
            overviewMasterIndicator.hidden = true;
            return;
        }
        line.style.top = y + 'px';
        line.hidden = false;
        const total = Math.max(1, content.scrollHeight);
        overviewMasterIndicator.style.top = Math.max(0, Math.min(100, y / total * 100)) + '%';
        overviewMasterIndicator.hidden = false;
    }

    function updateOverviewViewport() {
        if (!overviewRail || !overviewViewportIndicator) return;
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

    function rebuildOverviewRail() {
        if (!overviewMarkers) return;
        overviewMarkers.innerHTML = "";
        const total = Math.max(1, content.scrollHeight);
        const activeDepartment = getActiveDepartment();
        const defaultColor = getDepartmentDefaultColor();
        const loadedCues = getLoadedCues();
        const loadedAnnotations = getLoadedAnnotations();
        const promptBlocks = getPromptBlocks();

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
            for (const block of promptBlocks) {
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
            const color = cue.color || defaultColor;
            addMark(
                "cue",
                block.offsetTop,
                color,
                (activeDepartment || "") + " " + (cue.number || "")
            );
        }

        for (const cue of loadedCues) {
            const end = cue && cue.endAnchor;
            const y = toDocumentY(end);
            if (y === null) continue;
            addMark('cue-end', y, cue.color || defaultColor, (activeDepartment || "") + ' ' + (cue.number || '') + ' end');
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
            const color = ann.color || defaultColor;
            const detail = ann.type === "text" && ann.text
                ? ": " + String(ann.text).slice(0, 50)
                : "";

            addMark(
                "annotation",
                annotationTop,
                color,
                (activeDepartment || "") + " annotation (" + (ann.type || "drawing") + ")" + detail
            );
        }

        updateOverviewViewport();
        updateMasterPositionMarker();
    }

    function scrubOverviewTo(clientY) {
        if (!overviewRail) return;
        const rect = overviewRail.getBoundingClientRect();
        const fraction = Math.max(
            0,
            Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))
        );

        const targetScroll = fraction * maxScrollTop();
        if (onScrub) {
            onScrub(targetScroll);
        } else {
            viewport.scrollTop = targetScroll;
        }
        if (scheduleContextUpdate) scheduleContextUpdate();
    }

    function endOverviewScrub(e) {
        if (!overviewScrubbing || e.pointerId !== overviewPointerId) return;

        overviewScrubbing = false;
        overviewPointerId = null;

        try {
            overviewRail.releasePointerCapture(e.pointerId);
        } catch (_) {
        }
    }

    if (overviewRail) {
        overviewRail.addEventListener("pointerdown", (e) => {
            e.preventDefault();
            e.stopPropagation();

            overviewScrubbing = true;
            overviewPointerId = e.pointerId;

            try {
                overviewRail.setPointerCapture(e.pointerId);
            } catch (_) {
            }

            scrubOverviewTo(e.clientY);
        });

        overviewRail.addEventListener("pointermove", (e) => {
            if (!overviewScrubbing || e.pointerId !== overviewPointerId) return;
            e.preventDefault();
            e.stopPropagation();
            scrubOverviewTo(e.clientY);
        });

        overviewRail.addEventListener("pointerup", endOverviewScrub);
        overviewRail.addEventListener("pointercancel", endOverviewScrub);
    }

    function resetPositionLines() {
        masterPositionLine = null;
        cueStartPositionLine = null;
        cueEndPositionLine = null;
    }

    return {
        rebuildOverviewRail,
        updateOverviewViewport,
        updateMasterPositionMarker,
        ensurePositionLine,
        resetPositionLines
    };
}
