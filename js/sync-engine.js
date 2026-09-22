import {motionSignature as syncMotionSignature, stateAgeAtDeliveryMs} from "./sync-protocol.js";
import {createSyncHealthMonitor} from "./sync-health.js";
import {FollowerInterpolator} from "./sync-follower-interpolator.js";

export function createSyncEngine({
    viewport,
    content,
    toolbarSync,
    toolbarTransport,
    toolbarSliders,
    masterIdleBorder,
    syncEndpoint,
    sseEndpoint,
    syncRoom = "main",
    masterSendIntervalMs = 250,
    masterIdleHeartbeatMs = 2000,
    followPollIntervalMs = 250,
    followIdleAfterMs = 10000,
    followIdlePollMs = 2000,
    followSleepAfterMs = 60 * 60 * 1000,
    followSleepPollMs = 60000,
    followBufferMs = 1250,
    followAverageWindowMs = 3000,
    followMaxWaitMs = 3000,
    followWaitEpsilonPx = 2,
    followStateStaleMs = 10000,
    masterHeartbeatOkMs = 3500,
    masterHeartbeatWarnMs = 6500,
    serverHeartbeatOkMs = 7000,
    serverHeartbeatWarnMs = 12000,
    masterAutoWarnMs = 30000,
    masterAutoErrorMs = 120000,
    masterIdleBorderEnabled = false,
    masterBorderStartMs = 4000,
    masterBorderRedMs = 15000,
    findSemanticPosition = () => null,
    targetScrollForState = () => null,
    maxScrollTop = () => 0,
    getScrollPos = () => 0,
    setScrollPos = () => {},
    getCurrentScriptId = () => null,
    getAvailableScripts = () => [],
    loadShowScript = async () => {},
    isPlaying = () => false,
    setPlaying = () => {},
    getSpeed = () => 2.0,
    stopDragMomentum = () => {},
    scheduleToolbarHide = () => {},
    scheduleContextUpdate = () => {},
    updateMasterPositionMarker = () => {},
    handleAnnotationRevisionEvent = () => {},
    handleCueRevisionEvent = () => {},
    handleDepartmentSettingsEvent = () => {},
    getActiveDepartment = () => null,
    updateCueLockUi = () => {}
}) {
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

    let masterLastSpeed = null;
    let masterLastSpeedTime = null;

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
    const interpolator = new FollowerInterpolator({
        followBufferMs,
        followAverageWindowMs,
        followMaxWaitMs,
        followWaitEpsilonPx
    });
    let lastRemotePlaying = null;
    let syncAnimationRunning = false;
    let pendingTopJump = null;
    const FOLLOW_TOP_GUARD_FRACTION = 0.025;
    const FOLLOW_TOP_GUARD_FROM_FRACTION = 0.15;
    const FOLLOW_TOP_GUARD_CONFIRM_MS = 1800;

    function syncUrl() {
        return syncEndpoint + "?room=" + encodeURIComponent(syncRoom);
    }

    function sseUrl() {
        return sseEndpoint + "?room=" + encodeURIComponent(syncRoom);
    }

    const healthMonitor = createSyncHealthMonitor({
        masterIdleBorder,
        masterIdleBorderEnabled,
        masterBorderStartMs,
        masterBorderRedMs,
        masterHeartbeatOkMs,
        masterHeartbeatWarnMs,
        serverHeartbeatOkMs,
        serverHeartbeatWarnMs,
        masterAutoWarnMs,
        masterAutoErrorMs,
        getSyncMode: () => syncMode,
        isPlaying,
        getHeartbeatTimestamps: () => ({
            lastMasterServerAckPerf,
            lastMasterInteractionPerf,
            lastMasterHeartbeatBaseMs,
            lastMasterHeartbeatSamplePerf,
            lastMasterInteractionBaseMs,
            lastMasterInteractionSamplePerf,
            lastServerHeartbeatPerf,
            latestRemoteState
        }),
        onHealthChecksUpdate: (checks) => {
            if (toolbarSync) toolbarSync.healthChecks = checks;
        }
    });

    function recordMasterInteraction() {
        if (syncMode !== "master") return;
        lastMasterInteractionPerf = performance.now();
        updateMasterHealthStatus();
        updateMasterIdleBorder();
    }

    function updateMasterIdleBorder() {
        healthMonitor.updateIdleBorder(lastMasterInteractionPerf);
    }

    function getHealthChecks() {
        return healthMonitor.computeHealthChecks();
    }

    function updateMasterHealthStatus() {
        if (!toolbarSync) return;
        toolbarSync.healthChecks = healthMonitor.updateHealth();
    }

    const borderInterval = setInterval(updateMasterIdleBorder, 200);

    function setSyncStatus(message, cls = "") {
        if (toolbarSync) {
            if (typeof toolbarSync.setSyncStatus === "function") {
                toolbarSync.setSyncStatus(message, cls);
            } else {
                toolbarSync.syncStatusText = message;
                toolbarSync.syncStatusClass = cls;
            }
        }
    }

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
            interpolator.reset();
            forgetRemoteState();
            if (followingLive) {
                setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
            }
        }, Math.max(0, followStateStaleMs - ageAtReceiveMs));
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
        if (idleFor >= followSleepAfterMs) return followSleepPollMs;
        if (idleFor >= followIdleAfterMs) return followIdlePollMs;
        return followPollIntervalMs;
    }

    function scheduleNextFollowerPoll(delay = null) {
        if (followTimer !== null) {
            clearTimeout(followTimer);
            followTimer = null;
        }

        if (syncMode !== "follow" || followTransport !== "poll") return;
        const nextDelay = delay === null ? followerPollDelay() : delay;

        if (followingLive && performance.now() - lastRemoteMotionAt >= followSleepAfterMs) {
            setSyncStatus("FOLLOW: sleeping · POLL", "warn");
        }

        followTimer = setTimeout(async () => {
            followTimer = null;
            await pollMasterState();
            scheduleNextFollowerPoll();
        }, nextDelay);
    }

    async function publishMasterState() {
        if (syncMode !== "master") return;
        if (masterRequestInFlight) return;

        const pos = findSemanticPosition();
        if (!pos || typeof pos.prompt !== "string" || !pos.prompt ||
            !Number.isFinite(pos.fraction) || pos.fraction < 0 || pos.fraction > 1) {
            console.warn("Not publishing invalid master semantic position", pos);
            return;
        }

        const now = Date.now();
        const playing = isPlaying();
        const speedMultiplier = getSpeed();
        // Speed in px/s (where 1.0 multiplier is 20 px/s in teleprompter-transport)
        const currentSpeedPxPerSec = playing ? speedMultiplier * 20 : 0;
        let accelerationPxPerSec2 = 0;

        if (masterLastSpeed !== null && masterLastSpeedTime !== null) {
            const dtSec = Math.max(0.05, (now - masterLastSpeedTime) / 1000);
            accelerationPxPerSec2 = (currentSpeedPxPerSec - masterLastSpeed) / dtSec;
            // Clamp wild acceleration spikes
            accelerationPxPerSec2 = Math.max(-500, Math.min(500, accelerationPxPerSec2));
            if (Math.abs(accelerationPxPerSec2) < 0.2) {
                accelerationPxPerSec2 = 0;
            }
        }
        masterLastSpeed = currentSpeedPxPerSec;
        masterLastSpeedTime = now;

        const state = {
            sequence: ++syncSequence,
            script: getCurrentScriptId(),
            prompt: pos.prompt,
            fraction: pos.fraction,
            playing,
            speed: speedMultiplier,
            acceleration: Number(accelerationPxPerSec2.toFixed(2)),
            interactionAgeMs: Math.max(0, performance.now() - lastMasterInteractionPerf),
            updatedByClient: now
        };

        const signature = syncMotionSignature(state);

        if (signature === lastMasterStateSignature &&
            now - lastMasterSendAt < masterIdleHeartbeatMs) {
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
            lastMasterHeartbeatPerf = receivedAt;
            lastServerHeartbeatPerf = receivedAt;
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

        if (!Number.isFinite(stateAgeAtReceive) || stateAgeAtReceive >= followStateStaleMs) {
            const acceptedAge = latestRemoteStateAgeMs();
            if (acceptedAge === null || acceptedAge >= followStateStaleMs) {
                forgetRemoteState();
                followTargetScrollTop = null;
                interpolator.reset();
            }
            if (followingLive) {
                setSyncStatus("FOLLOW: stale master state ignored · " + transport, "warn");
            }
            return;
        }

        const currentScriptId = getCurrentScriptId();
        if (incomingState.script && incomingState.script !== currentScriptId) {
            const available = getAvailableScripts();
            if (!available.some(s => s.id === incomingState.script)) {
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

            const maxScroll = Math.max(1, maxScrollTop());
            const previousAccepted = followTargetScrollTop;
            const nearTop = clampedTarget <= Math.max(40, maxScroll * FOLLOW_TOP_GUARD_FRACTION);
            const wasWellInside = (previousAccepted !== null &&
                previousAccepted >= Math.max(300, maxScroll * FOLLOW_TOP_GUARD_FROM_FRACTION)) ||
                (viewport.scrollTop >= Math.max(300, maxScroll * FOLLOW_TOP_GUARD_FROM_FRACTION));

            if (nearTop && wasWellInside && incomingState.script === getCurrentScriptId()) {
                const nowPerf = performance.now();
                const seq = Number(incomingState.sequence) || 0;
                const confirmed = pendingTopJump &&
                    (nowPerf - pendingTopJump.at) <= FOLLOW_TOP_GUARD_CONFIRM_MS &&
                    seq !== pendingTopJump.sequence;
                if (!confirmed) {
                    pendingTopJump = {at: nowPerf, sequence: seq, prompt: incomingState.prompt};
                    console.warn("Held suspicious master jump to top", incomingState);
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

            if (lastRemotePlaying !== null && remotePlaying !== lastRemotePlaying) {
                interpolator.reset();
            }

            lastRemotePlaying = remotePlaying;

            let sampleServerMs = Number(latestRemoteState.serverTime) * 1000;
            if (!Number.isFinite(sampleServerMs)) {
                sampleServerMs = Date.now();
            }

            const sequence = Number(latestRemoteState.sequence) || 0;
            const acceleration = Number(latestRemoteState.acceleration) || 0;

            const previousSample = interpolator.getLastSample();
            if (previousSample) {
                const delta = clampedTarget - previousSample.target;
                if (Math.abs(delta) >= 2) {
                    const newDirection = delta > 0 ? 1 : -1;
                    const curDir = interpolator.getDirection();
                    if (curDir !== 0 && newDirection !== curDir) {
                        interpolator.reset();
                        interpolator.addSample(previousSample, previousSample.serverMs, receivePerf);
                    }
                    interpolator.setDirection(newDirection);
                }
            }

            if (!previousSample || previousSample.sequence !== sequence || previousSample.serverMs !== sampleServerMs) {
                interpolator.addSample({
                    serverMs: sampleServerMs,
                    target: clampedTarget,
                    playing: remotePlaying,
                    acceleration,
                    sequence
                }, sampleServerMs, receivePerf);
            }

            followTargetScrollTop = clampedTarget;
            startFollowAnimation();
            setSyncStatus("FOLLOW: live · " + transport, "ok");
        } else if (!followingLive) {
            rememberFreshRemoteState(incomingState, stateAgeAtReceive, receivedAt);
            pendingTopJump = null;
            updateMasterPositionMarker();
            setSyncStatus("FOLLOW: PAUSED — tap ◎ to rejoin", "warn");
        } else if (target === null) {
            // Script is matching but prompt block temporarily not found or still rendering.
            // Do NOT jump to top or flag script mismatch; retain current position and log warning.
            console.warn("Follower received prompt not yet present in DOM", incomingState.prompt);
            rememberFreshRemoteState(incomingState, stateAgeAtReceive, receivedAt);
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
            if (syncMode === "follow" && (!followEventSource || followEventSource.readyState !== EventSource.OPEN)) {
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

            handleRemoteState(state, "SSE").catch((e) => {
                if (followingLive) {
                    console.error("Error handling SSE state", e);
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
            !interpolator.hasSamples()
        ) {
            syncAnimationRunning = false;
            return;
        }

        const currentStateAge = latestRemoteStateAgeMs();
        if (currentStateAge === null || currentStateAge >= followStateStaleMs) {
            followTargetScrollTop = null;
            interpolator.reset();
            forgetRemoteState();
            setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
            syncAnimationRunning = false;
            return;
        }

        const desired = interpolator.computeDesiredPosition(maxScrollTop(), performance.now());
        if (desired === null) {
            syncAnimationRunning = false;
            return;
        }

        viewport.scrollTop = desired;
        setScrollPos(viewport.scrollTop);
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
        interpolator.reset();
        lastRemotePlaying = null;
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

        if (toolbarTransport) {
            toolbarTransport.hidden = follower;
            toolbarTransport.disabled = follower;
        }
        if (toolbarSliders) {
            toolbarSliders.disabled = follower;
            toolbarSliders.hideStatus = follower;
        }
        if (toolbarSync) {
            toolbarSync.syncMode = mode;
            toolbarSync.isMaster = !follower;
            toolbarSync.canRejoin = follower && !followingLive;
        }

        const activeDepartment = getActiveDepartment();
        if (!activeDepartment) {
            if (toolbarSync) {
                toolbarSync.isMaster = !follower;
            }
        } else {
            updateCueLockUi();
        }

        if (follower && isPlaying()) {
            setPlaying(false);
        }

        if (mode === "master") {
            if (toolbarSync) {
                toolbarSync.passwordOpen = false;
                toolbarSync.clearPassword();
            }
            setSyncStatus("MASTER: starting…", "warn");
            publishMasterState();
            masterTimer = setInterval(publishMasterState, masterSendIntervalMs);
        } else {
            setSyncStatus("FOLLOW: connecting · SSE", "warn");
            startFollowerTransport();
        }
    }

    function pauseFollowingForManualControl() {
        if (syncMode === "follow" && followingLive) {
            followingLive = false;
            followTargetScrollTop = null;
            interpolator.reset();
            lastRemotePlaying = null;
            document.body.classList.add("follow-paused");
            if (toolbarSync) toolbarSync.canRejoin = true;
            setSyncStatus("FOLLOW: PAUSED — tap ◎ to rejoin", "warn");
            updateMasterPositionMarker();
            scheduleToolbarHide();
        }
    }

    function rejoinMaster() {
        if (syncMode !== "follow") return;
        stopDragMomentum();
        followingLive = true;
        interpolator.reset();
        lastRemotePlaying = null;
        document.body.classList.remove("follow-paused");
        if (toolbarSync) toolbarSync.canRejoin = false;
        updateMasterPositionMarker();

        const latestAge = latestRemoteStateAgeMs();
        if (latestRemoteState &&
            latestAge !== null && latestAge < followStateStaleMs &&
            (!latestRemoteState.script || latestRemoteState.script === getCurrentScriptId())) {
            const target = targetScrollForState(latestRemoteState);
            if (target !== null) {
                followTargetScrollTop = Math.max(0, Math.min(maxScrollTop(), target));
                setScrollPos(followTargetScrollTop);
            }
            setSyncStatus("FOLLOW: live", "ok");
        } else {
            forgetRemoteState();
            setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
        }
        scheduleToolbarHide();
    }

    async function masterCookieAuthenticated() {
        try {
            const response = await fetch(syncUrl() + "&auth=status", {cache: "no-store"});
            if (!response.ok) return false;
            const body = await response.json();
            return !!body.authenticated;
        } catch (_) {
            return false;
        }
    }

    async function logoutMasterCookie() {
        try {
            await fetch(syncUrl() + "&auth=logout", {cache: "no-store"});
        } catch (_) {
        }
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
        try {
            body = await response.json();
        } catch (_) {
        }
        return {response, body};
    }

    function showMasterConflict(message = "MASTER: another controller is active") {
        masterControlConflict = true;
        masterKey = masterKey || "";
        setSyncMode("follow");
        if (toolbarSync) {
            toolbarSync.passwordOpen = true;
            toolbarSync.conflictActive = true;
        }
        setSyncStatus(message, "warn");
    }

    function clearMasterConflictUi() {
        masterControlConflict = false;
        if (toolbarSync) {
            toolbarSync.conflictActive = false;
        }
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
        if (toolbarSync) {
            toolbarSync.passwordOpen = false;
            toolbarSync.clearPassword();
        }
        setSyncMode("master");
        return true;
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
                setScrollPos(Math.max(0, Math.min(maxScrollTop(), target)));

                if (syncMode === "follow") {
                    interpolator.reset();
                }

                if (syncMode === "master") {
                    publishMasterState();
                }
            }
        });
    }

    return {
        syncUrl,
        sseUrl,
        setSyncMode,
        getSyncMode: () => syncMode,
        isFollowingLive: () => followingLive,
        getLatestRemoteState: () => latestRemoteState,
        latestRemoteStateAgeMs,
        recordMasterInteraction,
        updateMasterIdleBorder,
        updateMasterHealthStatus,
        getHealthChecks,
        setSyncStatus,
        publishMasterState,
        pauseFollowingForManualControl,
        rejoinMaster,
        claimMasterControl,
        enterMasterMode,
        showMasterConflict,
        clearMasterConflictUi,
        masterCookieAuthenticated,
        logoutMasterCookie,
        preserveSemanticPositionDuringLayoutChange,
        getMasterKey: () => masterKey,
        setMasterKey: (val) => { masterKey = val || ""; },
        isMasterControlConflict: () => masterControlConflict,
        destroy: () => {
            healthMonitor.destroy();
            clearInterval(borderInterval);
            stopSyncTimers();
            stopFollowerTransport();
        }
    };
}
