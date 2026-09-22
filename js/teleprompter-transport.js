export function createTeleprompterTransport({
    viewport,
    content,
    toolbarTransport,
    toolbarSliders,
    toolbarDisplay,
    getSyncMode = () => "follow",
    onManualControl = () => {},
    onStatusUpdate = () => {},
    onMasterIdleBorderUpdate = () => {},
    isCueWordPickActive = () => false,
    recordMasterInteraction = () => {}
}) {
    let playing = false;
    let speed = 2.0;
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

    function maxScrollTop() {
        return Math.max(0, content.scrollHeight - viewport.clientHeight);
    }

    function clampScrollPos() {
        scrollPos = Math.max(0, Math.min(maxScrollTop(), scrollPos));
        viewport.scrollTop = Math.round(scrollPos);
    }

    function setScrollPos(pos) {
        scrollPos = Math.max(0, Math.min(maxScrollTop(), pos));
        viewport.scrollTop = Math.round(scrollPos);
    }

    function stopAutoScrollForManualControl() {
        // Followers keep their existing local-pause behaviour. For the master,
        // manual repositioning must NOT change the Play/Pause state: if auto
        // scroll is running, continue from the newly chosen position.
        if (getSyncMode() !== "master" && playing) {
            setPlaying(false);
        }

        scrollPos = viewport.scrollTop;

        // Restart the auto-scroll timing basis from the manually adjusted
        // position. This avoids the next animation frame applying elapsed time
        // from before the operator's drag/wheel/jump.
        if (getSyncMode() === "master" && playing) {
            lastTime = null;
        }
    }

    function setPlaying(newValue) {
        playing = newValue;
        if (toolbarTransport) toolbarTransport.playing = playing;
        onStatusUpdate();
        onMasterIdleBorderUpdate();

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

    function toggleFullscreen() {
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
    }

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

    // Wake Lock
    async function acquireWakeLock() {
        if (!wakeLockWanted) return;

        if (!("wakeLock" in navigator)) {
            if (toolbarDisplay) toolbarDisplay.wakeLockSupported = false;
            return;
        }

        if (document.visibilityState !== "visible") return;
        if (wakeLock) return;

        try {
            wakeLock = await navigator.wakeLock.request("screen");
            if (toolbarDisplay) toolbarDisplay.wakeLockActive = true;

            wakeLock.addEventListener("release", () => {
                wakeLock = null;
                if (toolbarDisplay) toolbarDisplay.wakeLockActive = false;
            });
        } catch (err) {
            wakeLock = null;
            if (toolbarDisplay) toolbarDisplay.wakeLockActive = false;
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
        if (toolbarDisplay) toolbarDisplay.wakeLockActive = false;
    }

    async function toggleWakeLock() {
        if (wakeLockWanted) {
            await releaseWakeLock();
        } else {
            wakeLockWanted = true;
            await acquireWakeLock();
        }
    }

    // Toolbar visibility
    function setToolbarHidden(hidden) {
        document.body.classList.toggle("toolbar-hidden", hidden);
    }

    function scheduleToolbarHide() {
        setToolbarHidden(false);
        if (toolbarHideTimer) {
            clearTimeout(toolbarHideTimer);
        }
        toolbarHideTimer = setTimeout(() => {
            const hasOpenDialog =
                (toolbarTransport && toolbarTransport.hasOpenPopover?.()) ||
                (toolbarDisplay && toolbarDisplay.hasOpenPopover?.());

            const isInteracting =
                document.activeElement?.tagName === "INPUT" ||
                document.activeElement?.tagName === "SELECT" ||
                isDragging;

            if (!hasOpenDialog && !isInteracting) {
                setToolbarHidden(true);
            }
        }, TOOLBAR_HIDE_DELAY_MS);
    }

    // Event listeners
    if (toolbarTransport) {
        toolbarTransport.addEventListener("play-pause", () => setPlaying(!playing));
        toolbarTransport.addEventListener("jump-back", jumpBack);
        toolbarTransport.addEventListener("slower", () => {
            speed = Math.max(0, speed - 0.5);
            if (toolbarSliders) toolbarSliders.speed = speed;
            onStatusUpdate();
        });
        toolbarTransport.addEventListener("faster", () => {
            speed = Math.min(20, speed + 0.5);
            if (toolbarSliders) toolbarSliders.speed = speed;
            onStatusUpdate();
        });
        toolbarTransport.addEventListener("jump-top", () => {
            onManualControl();
            stopAutoScrollForManualControl();
            scrollPos = 0;
            viewport.scrollTop = 0;
        });
        toolbarTransport.addEventListener("jump-bottom", () => {
            onManualControl();
            stopAutoScrollForManualControl();
            scrollPos = maxScrollTop();
            viewport.scrollTop = Math.round(scrollPos);
        });
    }

    if (toolbarSliders) {
        toolbarSliders.addEventListener("speed-input", (e) => {
            speed = e.detail.speed;
            onStatusUpdate();
        });
        toolbarSliders.addEventListener("speed-change", (e) => {
            speed = e.detail.speed;
            onStatusUpdate();
        });
    }

    // Smooth wheel scrolling
    viewport.addEventListener("wheel", (e) => {
        e.preventDefault();
        onManualControl();
        stopAutoScrollForManualControl();
        wheelVelocity += e.deltaY * 0.15;
        startWheelAnimation();
    }, {passive: false});

    // Unified mouse/touch/stylus dragging
    viewport.addEventListener("pointerdown", (e) => {
        if (isCueWordPickActive()) return;
        if (e.button !== undefined && e.button !== 0) return;

        if (
            e.target instanceof Element &&
            e.target.closest(".cue-marker.cue-editable")
        ) {
            return;
        }

        onManualControl();
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
        } catch (_) {}
    });

    viewport.addEventListener("pointermove", (e) => {
        if (!isDragging || e.pointerId !== activePointerId) return;

        e.preventDefault();
        const now = performance.now();
        const dy = lastPointerY - e.clientY;
        const dt = Math.max(1, now - lastPointerTime);

        lastPointerY = e.clientY;
        lastPointerTime = now;

        const instantVelocity = dy / dt;
        dragVelocity = dragVelocity * 0.65 + instantVelocity * 0.35;

        scrollPos = viewport.scrollTop + dy;
        clampScrollPos();
    });

    viewport.addEventListener("pointerup", endPointerDrag);
    viewport.addEventListener("pointercancel", endPointerDrag);

    // Keyboard shortcuts
    document.addEventListener("keydown", (e) => {
        const target = e.target;
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
            if (getSyncMode() !== "master") return;
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
            if (getSyncMode() !== "master") return;
            e.preventDefault();
            speed = Math.min(20, speed + 0.5);
            if (toolbarSliders) toolbarSliders.speed = speed;
            onStatusUpdate();
        } else if (e.code === "ArrowDown") {
            if (getSyncMode() !== "master") return;
            e.preventDefault();
            speed = Math.max(0, speed - 0.5);
            if (toolbarSliders) toolbarSliders.speed = speed;
            onStatusUpdate();
        } else if (e.code === "Home") {
            e.preventDefault();
            onManualControl();
            stopAutoScrollForManualControl();
            scrollPos = 0;
            viewport.scrollTop = 0;
        } else if (e.code === "End") {
            e.preventDefault();
            onManualControl();
            stopAutoScrollForManualControl();
            scrollPos = maxScrollTop();
            viewport.scrollTop = Math.round(scrollPos);
        } else if (e.key === "f" || e.key === "F") {
            e.preventDefault();
            toggleFullscreen();
        } else if (e.key === "b" || e.key === "B") {
            e.preventDefault();
            jumpBack();
        }
    });

    // Visibility change for wake lock
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible" && wakeLockWanted) {
            acquireWakeLock();
        }
    });

    // Human activity on master
    document.addEventListener("pointerdown", (e) => {
        if (e.isTrusted) recordMasterInteraction();
    }, {capture: true, passive: true});
    document.addEventListener("wheel", (e) => {
        if (e.isTrusted) recordMasterInteraction();
    }, {capture: true, passive: true});
    document.addEventListener("keydown", (e) => {
        if (e.isTrusted) recordMasterInteraction();
    }, {capture: true});
    document.addEventListener("input", (e) => {
        if (e.isTrusted) recordMasterInteraction();
    }, {capture: true});
    document.addEventListener("change", (e) => {
        if (e.isTrusted) recordMasterInteraction();
    }, {capture: true});

    // Toolbar hide reset triggers
    document.addEventListener("pointermove", scheduleToolbarHide, {passive: true});
    document.addEventListener("pointerdown", () => {
        scheduleToolbarHide();
        acquireWakeLock();
    }, {passive: true});
    document.addEventListener("touchstart", () => {
        scheduleToolbarHide();
        acquireWakeLock();
    }, {passive: true});
    document.addEventListener("keydown", () => {
        scheduleToolbarHide();
        acquireWakeLock();
    });

    return {
        maxScrollTop,
        clampScrollPos,
        getScrollPos: () => scrollPos,
        setScrollPos,
        syncScrollPosFromViewport: () => { scrollPos = viewport.scrollTop; },
        stopAutoScrollForManualControl,
        setPlaying,
        isPlaying: () => playing,
        getSpeed: () => speed,
        setSpeed: (val) => { speed = val; },
        jumpBack,
        startWheelAnimation,
        stopDragMomentum,
        toggleFullscreen,
        acquireWakeLock,
        releaseWakeLock,
        toggleWakeLock,
        setToolbarHidden,
        scheduleToolbarHide
    };
}
