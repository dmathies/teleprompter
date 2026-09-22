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
        followWaitEpsilonPx = 2
    } = {}) {
        this.followBufferMs = followBufferMs;
        this.followAverageWindowMs = followAverageWindowMs;
        this.followMaxWaitMs = followMaxWaitMs;
        this.followWaitEpsilonPx = followWaitEpsilonPx;

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
        this.lastRenderedPosition = null;
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

        const estimatedServerNow = this.clockServerMs + (nowPerf - this.clockPerfMs);
        const renderServerMs = estimatedServerNow - this.followBufferMs;

        let desired = this.samples[0].target;
        const latestSample = this.samples[this.samples.length - 1];

        if (latestSample.playing && this.samples.length >= 3) {
            const windowStart = renderServerMs - this.followAverageWindowMs / 2;
            const windowEnd = renderServerMs + this.followAverageWindowMs / 2;

            let samples = this.samples.filter(
                s => s.serverMs >= windowStart && s.serverMs <= windowEnd
            );

            if (samples.length < 3) {
                const newest = this.samples[this.samples.length - 1].serverMs;
                samples = this.samples.filter(
                    s => s.serverMs >= newest - this.followAverageWindowMs
                );
            }

            if (samples.length >= 2) {
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

                let velocity = variance > 0.000001 ? covariance / variance : 0;
                if (Math.abs(velocity) < 0.15) velocity = 0;

                // When playing forward, regression velocity shouldn't be negative (and vice versa)
                if (this.direction > 0 && velocity < 0) {
                    velocity = 0;
                } else if (this.direction < 0 && velocity > 0) {
                    velocity = 0;
                }

                const renderDt = (renderServerMs - meanT) / 1000;

                // 2nd-order smooth prediction using acceleration if available
                const accel = Number.isFinite(latestSample.acceleration) ? latestSample.acceleration : 0;
                if (accel !== 0 && Math.abs(renderDt) <= 2.0) {
                    // s(t) = meanY + v * dt + 0.5 * a * dt^2
                    desired = meanY + velocity * renderDt + 0.5 * accel * (renderDt * renderDt);
                } else {
                    desired = meanY + velocity * renderDt;
                }

                // Prevent overshooting backwards past the minimum sample when moving forward
                if (this.direction > 0) {
                    const minRecentTarget = Math.min(...samples.map(s => s.target));
                    desired = Math.max(minRecentTarget, desired);
                }
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
                    desired = this.samples[this.samples.length - 1].target;
                }
            }
        }

        // Clamp to valid document bounds
        desired = Math.max(0, Math.min(maxScrollTop, desired));

        // When moving forward, prevent false jump to top if we were already scrolled down
        if (this.lastRenderedPosition !== null && this.lastRenderedPosition > 150 && desired < 30) {
            // Check if latest sample actually confirmed top jump
            if (latestSample.target > 150) {
                desired = this.lastRenderedPosition;
            }
        }

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

        this.lastRenderedPosition = desired;
        return desired;
    }
}
