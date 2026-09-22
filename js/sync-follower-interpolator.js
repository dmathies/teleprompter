/**
 * Follower interpolator for smoothing and easing master position updates.
 * Supports second-order extrapolation with velocity and acceleration,
 * sample buffering, backward-drift suppression, and top-jump prevention.
 */
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

        const estimatedServerNow = (this.ptpClock && this.ptpClock.synced)
            ? this.ptpClock.toServerTimeMs(nowPerf)
            : this.clockServerMs + (nowPerf - this.clockPerfMs);

        const renderServerMs = estimatedServerNow - this.followBufferMs;

        let desired = this.samples[0].target;
        const latestSample = this.samples[this.samples.length - 1];

        if (latestSample.playing && this.samples.length >= 2) {
            const windowStart = renderServerMs - this.followAverageWindowMs / 2;
            const windowEnd = renderServerMs + this.followAverageWindowMs / 2;

            let samples = this.samples.filter(
                s => s.serverMs >= windowStart && s.serverMs <= windowEnd
            );

            if (samples.length < 2) {
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

            let regressionVelocity = variance > 0.000001 ? covariance / variance : 0;
            if (Math.abs(regressionVelocity) < 0.15) regressionVelocity = 0;

            // Direct authoritative master velocity (if sent by master)
            const masterVelocity = Number.isFinite(latestSample.velocity) ? latestSample.velocity : null;

            // Fuse master authoritative velocity with empirical regression velocity
            let velocity = regressionVelocity;
            if (masterVelocity !== null) {
                // If regression has high variance or few samples, weight master velocity higher
                velocity = samples.length >= 4
                    ? (masterVelocity * 0.4 + regressionVelocity * 0.6)
                    : masterVelocity;
            }

            // Directional clamping: when playing forward, velocity cannot be negative
            if (this.direction > 0 && velocity < 0) {
                velocity = 0;
            } else if (this.direction < 0 && velocity > 0) {
                velocity = 0;
            }

            const renderDt = (renderServerMs - meanT) / 1000;

            // 2nd-order Taylor expansion motion prediction:
            // s(t) = s_0 + v * dt + 0.5 * a * dt^2
            const accel = Number.isFinite(latestSample.acceleration) ? latestSample.acceleration : 0;
            if (accel !== 0 && Math.abs(renderDt) <= 2.0) {
                desired = meanY + velocity * renderDt + 0.5 * accel * (renderDt * renderDt);
            } else {
                desired = meanY + velocity * renderDt;
            }

            // Prevent overshooting backwards past the minimum recent target when moving forward
            if (this.direction > 0) {
                const minRecentTarget = Math.min(...samples.map(s => s.target));
                desired = Math.max(minRecentTarget, desired);
            }
        } else {
            if (renderServerMs <= this.samples[0].serverMs) {
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
        }

        // Clamp to valid document bounds
        desired = Math.max(0, Math.min(maxScrollTop, desired));

        // Jitter & Top-Jump Protection:
        // 1. If currently scrolled down (>100px) and a sudden computation predicts jumping to near-top (<50px)
        // or a massive backward jump during forward playback, hold position if master latest target is not near top.
        if (this.lastRenderedPosition !== null && this.lastRenderedPosition > 100) {
            if (desired < 50 && latestSample.target >= 50) {
                desired = this.lastRenderedPosition;
            } else if (this.direction > 0 && latestSample.playing && desired < this.lastRenderedPosition - 150 && latestSample.target >= this.lastRenderedPosition - 50) {
                desired = this.lastRenderedPosition;
            }
        }

        // 2. Suppress micro-jitter when stationary or playing steadily
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

        // 3. Smooth low-pass easing between frames: blend 80% new desired, 20% previous rendered
        // to prevent micro-stutters when frame rates fluctuate or network packets arrive asynchronously.
        if (this.lastRenderedPosition !== null && latestSample.playing && Math.abs(desired - this.lastRenderedPosition) < 60) {
            desired = this.lastRenderedPosition * 0.25 + desired * 0.75;
        }

        this.lastRenderedPosition = desired;
        return desired;
    }
}
