/**
 * Follower interpolator for smoothing and easing master position updates.
 * Supports second-order extrapolation with velocity and acceleration,
 * sample buffering, backward-drift suppression, and top-jump prevention.
 */
// Tuning thresholds for interpolation, regression, and jump suppression
const MIN_SAMPLES_FOR_REGRESSION = 2;
const MIN_SAMPLES_FOR_ACCELERATION = 3;
const VARIANCE_EPSILON = 0.000001;
const MIN_REGRESSION_VELOCITY_PX_S = 0.15;
const MAX_PREDICTION_DT_SEC = 2.0;
const MAX_ACCELERATION_PX_S2 = 300;
const MIN_ACCELERATION_PX_S2 = 0.5;

// Jump & Top-Snap Guard Thresholds
const GUARD_SCROLLED_DOWN_THRESHOLD_PX = 100;
const GUARD_NEAR_TOP_THRESHOLD_PX = 50;
const GUARD_BACKWARD_JUMP_THRESHOLD_PX = 150;
const GUARD_TARGET_NEAR_PREV_TOLERANCE_PX = 50;

// Smoothing & Jitter Filter Thresholds
const LOW_PASS_MAX_DELTA_PX = 60;
const LOW_PASS_PREV_WEIGHT = 0.25;
const LOW_PASS_NEW_WEIGHT = 0.75;

export class FollowerInterpolator {
    constructor({
        followBufferMs = 1250,
        followAverageWindowMs = 3000,
        followMaxWaitMs = 3000,
        followWaitEpsilonPx = 2,
        ptpClock = null
    } = {}) {
        this.followBufferMs = followBufferMs;
        this.followAverageWindowMs = followAverageWindowMs;
        this.followMaxWaitMs = followMaxWaitMs;
        this.followWaitEpsilonPx = followWaitEpsilonPx;
        this.ptpClock = ptpClock;

        this.samples = [];
        this.clockServerMs = null;
        this.clockPerfMs = null;
        this.lastRenderedPosition = null;
        this.waitingSince = null;
        this.direction = 0; // +1 forward, -1 reverse, 0 unknown/stationary
    }

    reset() {
        this.samples = [];
        this.clockServerMs = null;
        this.clockPerfMs = null;
        this.waitingSince = null;
        this.direction = 0;
    }

    hasSamples() {
        return this.samples.length > 0 && this.clockServerMs !== null && this.clockPerfMs !== null;
    }

    addSample(sample, serverTime, receivedPerf = performance.now()) {
        if (this.clockServerMs !== null && serverTime < this.clockServerMs) return;

        this.samples.push(sample);
        // Retain sample buffer up to 12s
        const cutoff = sample.serverMs - 12000;
        this.samples = this.samples.filter(s => s.serverMs >= cutoff);

        this.clockServerMs = serverTime;
        this.clockPerfMs = receivedPerf;
    }

    setDirection(dir) {
        this.direction = dir;
    }

    getDirection() {
        return this.direction;
    }

    getLastSample() {
        return this.samples.length ? this.samples[this.samples.length - 1] : null;
    }

    getSamplesCount() {
        return this.samples.length;
    }

    computeDesiredPosition(maxScrollTop, nowPerf = performance.now()) {
        if (!this.hasSamples()) return null;

        // 1. Cluster Timing: Determine current target time in server epoch
        const estimatedServerNow = (this.ptpClock && this.ptpClock.synced)
            ? this.ptpClock.toServerTimeMs(nowPerf)
            : this.clockServerMs + (nowPerf - this.clockPerfMs);

        const bufferMs = Math.max(
            this.followBufferMs,
            (this.ptpClock && this.ptpClock.synced ? this.ptpClock.rttMs * 2 + 100 : 0)
        );
        const renderServerMs = estimatedServerNow - bufferMs;

        let desired = this.samples[0].target;
        const latestSample = this.samples[this.samples.length - 1];

        // 2. Extrapolation & Kinematics (Playing State)
        if (latestSample.playing && this.samples.length >= MIN_SAMPLES_FOR_REGRESSION) {
            const windowStart = renderServerMs - this.followAverageWindowMs / 2;
            const windowEnd = renderServerMs + this.followAverageWindowMs / 2;

            let samples = this.samples.filter(
                s => s.serverMs >= windowStart && s.serverMs <= windowEnd
            );

            if (samples.length < MIN_SAMPLES_FOR_REGRESSION) {
                const newest = this.samples[this.samples.length - 1].serverMs;
                samples = this.samples.filter(
                    s => s.serverMs >= newest - this.followAverageWindowMs
                );
            }

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

            let regressionVelocity = variance > VARIANCE_EPSILON ? covariance / variance : 0;
            if (Math.abs(regressionVelocity) < MIN_REGRESSION_VELOCITY_PX_S) {
                regressionVelocity = 0;
            }

            // Directional clamping: when moving forward, velocity cannot be negative
            if (this.direction > 0 && regressionVelocity < 0) {
                regressionVelocity = 0;
            } else if (this.direction < 0 && regressionVelocity > 0) {
                regressionVelocity = 0;
            }

            const velocity = regressionVelocity;

            // Follower-side acceleration: rate of change across newest vs overall sub-intervals
            let followerAccel = 0;
            if (samples.length >= MIN_SAMPLES_FOR_ACCELERATION) {
                const sLast = samples[samples.length - 1];
                const sPrev = samples[samples.length - 2];
                const sFirst = samples[0];

                const dtRecentSec = (sLast.serverMs - sPrev.serverMs) / 1000;
                const dtTotalSec = (sLast.serverMs - sFirst.serverMs) / 1000;

                if (dtRecentSec >= 0.05 && dtTotalSec >= 0.1) {
                    const recentV = (sLast.target - sPrev.target) / dtRecentSec;
                    const overallV = (sLast.target - sFirst.target) / dtTotalSec;
                    followerAccel = (recentV - overallV) / (dtRecentSec + dtTotalSec * 0.5);
                    followerAccel = Math.max(-MAX_ACCELERATION_PX_S2, Math.min(MAX_ACCELERATION_PX_S2, followerAccel));
                    if (Math.abs(followerAccel) < MIN_ACCELERATION_PX_S2) followerAccel = 0;
                }
            }

            const renderDt = (renderServerMs - meanT) / 1000;

            // 2nd-order Taylor expansion motion prediction:
            // s(t) = s_0 + v * dt + 0.5 * a * dt^2
            if (followerAccel !== 0 && Math.abs(renderDt) <= MAX_PREDICTION_DT_SEC) {
                desired = meanY + velocity * renderDt + 0.5 * followerAccel * (renderDt * renderDt);
            } else {
                desired = meanY + velocity * renderDt;
            }

            // Prevent overshooting backwards past minimum recent target when moving forward
            if (this.direction > 0) {
                const minRecentTarget = Math.min(...samples.map(s => s.target));
                desired = Math.max(minRecentTarget, desired);
            }
        } else if (renderServerMs <= this.samples[0].serverMs) {
            // 3. Static / Linear Interpolation (Paused / Scrubbing / < 2 samples)
            desired = this.samples[0].target;
        } else {
            let foundPair = false;
            for (let i = 1; i < this.samples.length; i++) {
                const a = this.samples[i - 1];
                const b = this.samples[i];
                if (renderServerMs <= b.serverMs) {
                    const span = Math.max(1, b.serverMs - a.serverMs);
                    const f = Math.max(0, Math.min(1, (renderServerMs - a.serverMs) / span));
                    desired = a.target + (b.target - a.target) * f;
                    foundPair = true;
                    break;
                }
            }
            if (!foundPair) {
                desired = this.samples.at(-1).target;
            }
        }

        // Clamp to document boundaries
        desired = Math.max(0, Math.min(maxScrollTop, desired));

        // 4. Jitter & Jump Detection
        if (this.lastRenderedPosition !== null && this.lastRenderedPosition > GUARD_SCROLLED_DOWN_THRESHOLD_PX) {
            const isNearTopJump = desired < GUARD_NEAR_TOP_THRESHOLD_PX && latestSample.target >= GUARD_NEAR_TOP_THRESHOLD_PX;
            const isMassiveBackwardJump = this.direction > 0 &&
                latestSample.playing &&
                desired < (this.lastRenderedPosition - GUARD_BACKWARD_JUMP_THRESHOLD_PX) &&
                latestSample.target >= (this.lastRenderedPosition - GUARD_TARGET_NEAR_PREV_TOLERANCE_PX);

            if (isNearTopJump || isMassiveBackwardJump) {
                const jumpType = isNearTopJump ? "NEAR_TOP_SNAP_SUPPRESSED" : "MASSIVE_BACKWARD_DRIFT_SUPPRESSED";
                console.warn(`[JUMP_DETECTION: ${jumpType}]`, {
                    jumpType,
                    calculatedDesired: desired,
                    heldPosition: this.lastRenderedPosition,
                    suppressedDeltaPx: desired - this.lastRenderedPosition,
                    latestSample: {
                        target: latestSample.target,
                        serverMs: latestSample.serverMs,
                        playing: latestSample.playing,
                        sequence: latestSample.sequence
                    },
                    interpolatorState: {
                        direction: this.direction,
                        sampleCount: this.samples.length,
                        renderServerMs,
                        estimatedServerNow,
                        bufferMs,
                        maxScrollTop
                    },
                    timestamp: new Date().toISOString()
                });
                desired = this.lastRenderedPosition;
            }
        }

        // 5. Stationary Hold & Deadband Filtering
        if (latestSample.playing && this.lastRenderedPosition !== null && this.direction !== 0) {
            const oppositeBy = this.direction > 0
                ? this.lastRenderedPosition - desired
                : desired - this.lastRenderedPosition;

            if (oppositeBy > this.followWaitEpsilonPx) {
                if (this.waitingSince === null) {
                    this.waitingSince = nowPerf;
                }
                const waited = nowPerf - this.waitingSince;
                if (waited >= this.followMaxWaitMs) {
                    desired = latestSample.target;
                    this.samples = [latestSample];
                    this.clockServerMs = latestSample.serverMs;
                    this.clockPerfMs = nowPerf;
                    this.lastRenderedPosition = desired;
                    this.waitingSince = null;
                } else {
                    desired = this.lastRenderedPosition;
                }
            } else {
                this.waitingSince = null;
                desired = this.direction > 0
                    ? Math.max(this.lastRenderedPosition, desired)
                    : Math.min(this.lastRenderedPosition, desired);
            }
        } else {
            this.waitingSince = null;
        }

        // 6. Smooth low-pass blend between animation frames
        if (this.lastRenderedPosition !== null && latestSample.playing && Math.abs(desired - this.lastRenderedPosition) < LOW_PASS_MAX_DELTA_PX) {
            desired = this.lastRenderedPosition * LOW_PASS_PREV_WEIGHT + desired * LOW_PASS_NEW_WEIGHT;
        }

        this.lastRenderedPosition = desired;
        return desired;
    }
}
