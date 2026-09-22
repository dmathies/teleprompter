import {motionSignature as syncMotionSignature, stateAgeAtDeliveryMs} from "./sync-protocol.js";
import {createSyncHealthMonitor} from "./sync-health.js";
import {FollowerInterpolator} from "./sync-follower-interpolator.js";
import {PtpClock} from "./sync-ptp-clock.js";
import {SyncTransportCoordinator} from "./sync-transport-coordinator.js";

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


    let latestRemoteState = null;
    let latestRemoteStateAgeAtReceiveMs = null;
    let latestRemoteStateReceivedPerf = null;
    let remoteStateExpiryTimer = null;
    let lastRemoteMotionSignature = null;
    let lastRemoteMotionAt = performance.now();
    let followingLive = true;
    let followTargetScrollTop = null;
    function syncUrl() {
        return syncEndpoint + "?room=" + encodeURIComponent(syncRoom);
    }

    function sseUrl() {
        return sseEndpoint + "?room=" + encodeURIComponent(syncRoom);
    }

    const ptpClock = new PtpClock({
        syncUrl: () => syncUrl()
    });

    const interpolator = new FollowerInterpolator({
        followBufferMs,
        followAverageWindowMs,
        followMaxWaitMs,
        followWaitEpsilonPx,
        ptpClock
    });
    let lastRemotePlaying = null;
    let syncAnimationRunning = false;
    let pendingTopJump = null;
    let pendingDiscrepantJump = null;
    let lastAcceptedSequence = null;
    const FOLLOW_TOP_GUARD_FRACTION = 0.025;
    const FOLLOW_TOP_GUARD_FROM_FRACTION = 0.15;
    const FOLLOW_TOP_GUARD_CONFIRM_MS = 1800;
    const FOLLOW_DISCREPANCY_THRESHOLD_PX = 150;
    const FOLLOW_DISCREPANCY_CONFIRM_COUNT = 2;
    const FOLLOW_DISCREPANCY_WINDOW_MS = 800;

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
            latestRemoteState,
            ptpClock
        }),
        onHealthChecksUpdate: (checks) => {
            if (toolbarSync) toolbarSync.healthChecks = checks;
        }
    });

    ptpClock.onSync(() => {
        updateMasterHealthStatus();
    });
    ptpClock.start();

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

    const transportCoordinator = new SyncTransportCoordinator({
        syncUrl: () => syncUrl(),
        sseUrl: () => sseUrl(),
        ptpClock,
        followPollIntervalMs,
        followIdleAfterMs,
        followIdlePollMs,
        followSleepAfterMs,
        followSleepPollMs
    });

    transportCoordinator.on("state", ({state, transport}) => {
        handleRemoteState(state, transport).catch(e => {
            if (followingLive) {
                console.error("Error handling remote state:", e);
                setSyncStatus(`FOLLOW: processing error · ${transport}`, "error");
            }
        });
    });

    transportCoordinator.on("cue-revision", (event) => {
        lastServerHeartbeatPerf = performance.now();
        handleCueRevisionEvent(event);
    });

    transportCoordinator.on("annotation-revision", (event) => {
        lastServerHeartbeatPerf = performance.now();
        handleAnnotationRevisionEvent(event);
    });

    transportCoordinator.on("department-settings", (event) => {
        lastServerHeartbeatPerf = performance.now();
        handleDepartmentSettingsEvent(event);
    });

    transportCoordinator.on("server-heartbeat", ({data, nowPerf}) => {
        lastServerHeartbeatPerf = nowPerf;
        if (data && Number.isFinite(Number(data.serverTime))) {
            const localEpoch = (performance.timeOrigin ? performance.timeOrigin + nowPerf : Date.now());
            const assumedRtt = ptpClock.synced ? Math.max(10, ptpClock.rttMs) : 50;
            ptpClock.recordSample(localEpoch - assumedRtt, Number(data.serverTime), localEpoch);
        }
        updateMasterHealthStatus();
    });

    transportCoordinator.on("status", ({status, mode, transport, message}) => {
        if (syncMode !== "follow") return;
        if (!followingLive) return;

        switch (status) {
            case "connecting":
                setSyncStatus(`FOLLOW: connecting · ${transport || "SSE"}`, "warn");
                break;
            case "connected":
                setSyncStatus(`FOLLOW: connected · ${transport || "SSE"}`, "ok");
                break;
            case "fallback_poll":
                setSyncStatus("FOLLOW: fallback · POLL", "warn");
                break;
            case "reconnecting":
                setSyncStatus(`FOLLOW: reconnecting · ${transport || "SSE"}`, "warn");
                break;
            case "sleeping":
                setSyncStatus("FOLLOW: sleeping · POLL", "warn");
                break;
            case "error":
                setSyncStatus(message ? `FOLLOW: ${message}` : `FOLLOW: error · ${transport || "POLL"}`, "error");
                break;
        }
    });

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
        if (state && Number.isFinite(Number(state.sequence))) {
            lastAcceptedSequence = Number(state.sequence);
        }
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
        lastAcceptedSequence = null;
        updateMasterPositionMarker();
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

        const state = {
            sequence: ++syncSequence,
            script: getCurrentScriptId(),
            prompt: pos.prompt,
            fraction: pos.fraction,
            playing,
            speed: speedMultiplier,
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

            const t4 = (performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
            const text = await response.text();
            let body = null;
            try { body = JSON.parse(text); } catch (_) {}

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

            if (body && Number.isFinite(Number(body.serverTime))) {
                ptpClock.recordSample(now, Number(body.serverTime), t4);
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

        const incomingSequence = Number(incomingState.sequence);
        const currentScriptId = getCurrentScriptId();
        if (incomingState.script && incomingState.script !== currentScriptId) {
            const available = getAvailableScripts();
            if (!available.some(s => s.id === incomingState.script)) {
                setSyncStatus("FOLLOW: unknown script", "error");
                return;
            }
            await loadShowScript(incomingState.script);
            pendingTopJump = null;
            lastAcceptedSequence = null;
        } else if (Number.isFinite(incomingSequence) && lastAcceptedSequence !== null) {
            // Discard out-of-sequence packets (e.g. delayed poll responses arriving after SSE or newer poll)
            // to prevent backwards regressions and sudden top-jumps during rapid scrolling.
            if (incomingSequence < lastAcceptedSequence && (lastAcceptedSequence - incomingSequence) < 10000) {
                return;
            }
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
                    console.warn("[JUMP_DETECTION: INCOMING_PACKET_TOP_SNAP_HELD]", {
                        reason: "Incoming master packet mapped to near-top while follower is well inside document",
                        timestamp: new Date().toISOString(),
                        packet: {
                            sequence: seq,
                            script: incomingState.script,
                            prompt: incomingState.prompt,
                            fraction: incomingState.fraction,
                            playing: incomingState.playing,
                            serverTime: incomingState.serverTime,
                            deliveryServerTime: incomingState.deliveryServerTime
                        },
                        followerLayout: {
                            clampedTarget,
                            rawTarget: target,
                            viewportScrollTop: viewport.scrollTop,
                            previousAcceptedTarget: previousAccepted,
                            maxScrollTop: maxScroll,
                            nearTopThresholdPx: Math.max(40, maxScroll * FOLLOW_TOP_GUARD_FRACTION),
                            wellInsideThresholdPx: Math.max(300, maxScroll * FOLLOW_TOP_GUARD_FROM_FRACTION)
                        },
                        timing: {
                            nowPerf,
                            stateAgeAtReceiveMs: stateAgeAtReceive,
                            transport
                        }
                    });
                    setSyncStatus("FOLLOW: ignored suspect top jump · " + transport, "warn");
                    return;
                }
            }
            pendingTopJump = null;

            // Discrepancy Guard: hold position for a couple of packets if there is a sudden large jump (>150px)
            // e.g. when scrubbing/scrolling fast on master or transient out-of-sync packets
            const referencePos = followTargetScrollTop ?? viewport.scrollTop;
            if (referencePos !== null && Math.abs(clampedTarget - referencePos) > FOLLOW_DISCREPANCY_THRESHOLD_PX) {
                const nowPerf = performance.now();
                const seq = Number(incomingState.sequence) || 0;
                const isMatchingTarget = pendingDiscrepantJump &&
                    Math.abs(clampedTarget - pendingDiscrepantJump.target) <= 100;
                const isWithinWindow = pendingDiscrepantJump &&
                    (nowPerf - pendingDiscrepantJump.at) <= FOLLOW_DISCREPANCY_WINDOW_MS;
                const isNewSeq = pendingDiscrepantJump &&
                    seq !== pendingDiscrepantJump.sequence;

                if (isMatchingTarget && isWithinWindow && isNewSeq) {
                    pendingDiscrepantJump.count += 1;
                    pendingDiscrepantJump.sequence = seq;
                    pendingDiscrepantJump.at = nowPerf;
                    pendingDiscrepantJump.target = clampedTarget;
                } else {
                    pendingDiscrepantJump = {
                        count: 1,
                        target: clampedTarget,
                        sequence: seq,
                        at: nowPerf
                    };
                }

                if (pendingDiscrepantJump.count < FOLLOW_DISCREPANCY_CONFIRM_COUNT) {
                    console.warn("[JUMP_DETECTION: PACKET_DISCREPANCY_HELD]", {
                        reason: "Incoming packet target jumped >150px from current position; holding until confirmed",
                        heldCount: pendingDiscrepantJump.count,
                        neededCount: FOLLOW_DISCREPANCY_CONFIRM_COUNT,
                        currentPosition: referencePos,
                        suspectTarget: clampedTarget,
                        deltaPx: clampedTarget - referencePos,
                        viewportScrollTop: viewport.scrollTop,
                        packet: {
                            sequence: seq,
                            prompt: incomingState.prompt,
                            fraction: incomingState.fraction,
                            playing: incomingState.playing,
                            serverTime: incomingState.serverTime
                        },
                        timestamp: new Date().toISOString()
                    });
                    setSyncStatus("FOLLOW: holding position… · " + transport, "ok");
                    return;
                }
                // Confirmed jump across multiple packets (intentional user seek or sustained fast scroll)
                pendingDiscrepantJump = null;
            } else {
                pendingDiscrepantJump = null;
            }

            rememberFreshRemoteState(incomingState, stateAgeAtReceive, receivedAt);
            const motionSignature = syncMotionSignature(latestRemoteState);
            if (motionSignature !== lastRemoteMotionSignature) {
                lastRemoteMotionSignature = motionSignature;
                lastRemoteMotionAt = performance.now();
                transportCoordinator.notifyMotion();
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

            const previousSample = interpolator.getLastSample();
            if (previousSample) {
                const delta = clampedTarget - previousSample.target;
                if (Math.abs(delta) >= 2) {
                    const newDirection = delta > 0 ? 1 : -1;
                    const curDir = interpolator.getDirection();
                    if (curDir !== 0 && newDirection !== curDir) {
                        interpolator.reset();
                        // Only seed previous sample if it is close to current viewport position
                        if (Math.abs(previousSample.target - viewport.scrollTop) <= 200) {
                            interpolator.addSample(previousSample, previousSample.serverMs, receivePerf);
                        }
                    }
                    interpolator.setDirection(newDirection);
                }
            }

            // Detect and trace large sudden jumps in accepted target scroll position
            if (previousAccepted !== null && Math.abs(clampedTarget - previousAccepted) > 150) {
                console.warn("[JUMP_DETECTION: PACKET_TARGET_DISCREPANCY]", {
                    reason: "New target scroll position jumped >150px from previously accepted target (confirmed)",
                    previousAcceptedTarget: previousAccepted,
                    newClampedTarget: clampedTarget,
                    rawTarget: target,
                    deltaPx: clampedTarget - previousAccepted,
                    viewportScrollTop: viewport.scrollTop,
                    maxScrollTop: maxScroll,
                    packet: {
                        sequence,
                        prompt: incomingState.prompt,
                        fraction: incomingState.fraction,
                        playing: incomingState.playing,
                        speed: incomingState.speed,
                        serverTime: incomingState.serverTime
                    },
                    timestamp: new Date().toISOString()
                });
            }

            if (!previousSample || previousSample.sequence !== sequence || previousSample.serverMs !== sampleServerMs) {
                interpolator.addSample({
                    serverMs: sampleServerMs,
                    target: clampedTarget,
                    playing: remotePlaying,
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
    function stopFollowerTransport() {
        transportCoordinator.stop();
    }

    function startFollowerTransport() {
        transportCoordinator.start();
    }

    let lastAnimatedScrollTop = null;

    function followAnimationStep(timestamp) {
        if (
            syncMode !== "follow" ||
            !followingLive ||
            !interpolator.hasSamples()
        ) {
            syncAnimationRunning = false;
            lastAnimatedScrollTop = null;
            return;
        }

        const currentStateAge = latestRemoteStateAgeMs();
        if (currentStateAge === null || currentStateAge >= followStateStaleMs) {
            followTargetScrollTop = null;
            interpolator.reset();
            forgetRemoteState();
            setSyncStatus("FOLLOW: waiting for fresh master state", "warn");
            syncAnimationRunning = false;
            lastAnimatedScrollTop = null;
            return;
        }

        const maxScroll = maxScrollTop();
        const desired = interpolator.computeDesiredPosition(maxScroll, performance.now());
        if (desired === null) {
            syncAnimationRunning = false;
            lastAnimatedScrollTop = null;
            return;
        }

        // Trace any abrupt frame-to-frame jump (>100px) during animation rendering
        if (lastAnimatedScrollTop !== null && Math.abs(desired - lastAnimatedScrollTop) > 100) {
            console.warn("[JUMP_DETECTION: FRAME_RENDER_JUMP]", {
                reason: "Follower animation frame jumped >100px in a single frame",
                fromScrollTop: lastAnimatedScrollTop,
                toDesired: desired,
                deltaPx: desired - lastAnimatedScrollTop,
                currentViewportScrollTop: viewport.scrollTop,
                maxScrollTop: maxScroll,
                interpolatorSamplesCount: interpolator.getSamplesCount(),
                interpolatorDirection: interpolator.getDirection(),
                latestRemoteState: latestRemoteState ? {
                    sequence: latestRemoteState.sequence,
                    prompt: latestRemoteState.prompt,
                    fraction: latestRemoteState.fraction,
                    playing: latestRemoteState.playing
                } : null,
                timestamp: new Date().toISOString()
            });
        }

        lastAnimatedScrollTop = desired;
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
        pendingTopJump = null;
        pendingDiscrepantJump = null;
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
            pendingTopJump = null;
            pendingDiscrepantJump = null;
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
        pendingTopJump = null;
        pendingDiscrepantJump = null;
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
        getPtpClock: () => ptpClock,
        destroy: () => {
            healthMonitor.destroy();
            ptpClock.stop();
            clearInterval(borderInterval);
            stopSyncTimers();
            stopFollowerTransport();
        }
    };
}
