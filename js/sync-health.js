import { formatHealthAge, healthClass, hslToRgb } from "./utils.js";

/**
 * Creates the Health & Idle Border monitor for Teleprompter master/follower state.
 */
export function createSyncHealthMonitor({
    masterIdleBorder,
    masterIdleBorderEnabled = false,
    masterBorderStartMs = 4000,
    masterBorderRedMs = 15000,
    masterHeartbeatOkMs = 3500,
    masterHeartbeatWarnMs = 6500,
    serverHeartbeatOkMs = 7000,
    serverHeartbeatWarnMs = 12000,
    masterAutoWarnMs = 30000,
    masterAutoErrorMs = 120000,
    getSyncMode = () => "follow",
    isPlaying = () => false,
    getHeartbeatTimestamps = () => ({}),
    onHealthChecksUpdate = () => {}
}) {
    function computeHealthChecks() {
        const now = performance.now();
        const syncMode = getSyncMode();
        const ts = getHeartbeatTimestamps();

        if (syncMode === "master") {
            const ackAge = ts.lastMasterServerAckPerf === null || ts.lastMasterServerAckPerf === undefined
                ? Infinity
                : now - ts.lastMasterServerAckPerf;
            const inputAge = Math.max(0, now - (ts.lastMasterInteractionPerf || now));
            const ackCls = healthClass(ackAge, masterHeartbeatOkMs, masterHeartbeatWarnMs);
            const playing = isPlaying();
            const autoCls = playing
                ? (inputAge > masterAutoErrorMs ? "health-error" :
                    inputAge > masterAutoWarnMs ? "health-warn" : "health-ok")
                : "health-idle";
            const inputLabel = playing ? "AUTO" : "INPUT";

            return {
                mode: "master",
                server: {
                    ageMs: ackAge,
                    formattedAge: formatHealthAge(ackAge),
                    className: ackCls
                },
                input: {
                    label: inputLabel,
                    ageMs: inputAge,
                    formattedAge: formatHealthAge(inputAge),
                    className: autoCls
                }
            };
        }

        let masterAge = Infinity;
        if (Number.isFinite(ts.lastMasterHeartbeatBaseMs) && ts.lastMasterHeartbeatSamplePerf !== null && ts.lastMasterHeartbeatSamplePerf !== undefined) {
            masterAge = ts.lastMasterHeartbeatBaseMs + (now - ts.lastMasterHeartbeatSamplePerf);
        }

        const serverAge = ts.lastServerHeartbeatPerf === null || ts.lastServerHeartbeatPerf === undefined
            ? Infinity
            : now - ts.lastServerHeartbeatPerf;

        let interactionAge = Infinity;
        if (Number.isFinite(ts.lastMasterInteractionBaseMs) && ts.lastMasterInteractionSamplePerf !== null && ts.lastMasterInteractionSamplePerf !== undefined) {
            interactionAge = ts.lastMasterInteractionBaseMs + (now - ts.lastMasterInteractionSamplePerf);
        }

        const masterCls = healthClass(masterAge, masterHeartbeatOkMs, masterHeartbeatWarnMs);
        const netCls = healthClass(serverAge, serverHeartbeatOkMs, serverHeartbeatWarnMs);
        const remotePlaying = !!(ts.latestRemoteState && ts.latestRemoteState.playing !== false);
        const autoCls = remotePlaying
            ? (interactionAge > masterAutoErrorMs ? "health-error" :
                interactionAge > masterAutoWarnMs ? "health-warn" : "health-ok")
            : "health-idle";
        const inputLabel = remotePlaying ? "AUTO" : "INPUT";

        return {
            mode: "follower",
            master: {
                ageMs: masterAge,
                formattedAge: formatHealthAge(masterAge),
                className: masterCls
            },
            net: {
                ageMs: serverAge,
                formattedAge: formatHealthAge(serverAge),
                className: netCls
            },
            input: {
                label: inputLabel,
                ageMs: interactionAge,
                formattedAge: formatHealthAge(interactionAge),
                className: autoCls
            }
        };
    }

    function updateHealth() {
        const checks = computeHealthChecks();
        onHealthChecksUpdate(checks);
        return checks;
    }

    function updateIdleBorder(lastMasterInteractionPerf) {
        if (!masterIdleBorder) return;

        if (!masterIdleBorderEnabled) {
            masterIdleBorder.style.opacity = "0";
            return;
        }

        if (getSyncMode() !== "master" || !isPlaying()) {
            masterIdleBorder.style.opacity = "0";
            return;
        }

        const age = Math.max(0, performance.now() - (lastMasterInteractionPerf || performance.now()));
        if (age <= masterBorderStartMs) {
            masterIdleBorder.style.opacity = "0";
            return;
        }

        const t = Math.max(0, Math.min(1,
            (age - masterBorderStartMs) /
            (masterBorderRedMs - masterBorderStartMs)
        ));

        const hue = 55 * (1 - t);
        const [r, g, b] = hslToRgb(hue, 1, .50);

        const alpha = 0.12 + 0.50 * t;
        masterIdleBorder.style.setProperty("--idle-border-rgb", `${r}, ${g}, ${b}`);
        masterIdleBorder.style.setProperty("--idle-border-alpha", alpha.toFixed(3));
        masterIdleBorder.style.opacity = "1";
    }

    const healthInterval = setInterval(updateHealth, 500);

    return {
        computeHealthChecks,
        updateHealth,
        updateIdleBorder,
        destroy: () => {
            clearInterval(healthInterval);
        }
    };
}
