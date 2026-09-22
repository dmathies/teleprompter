/**
 * PTP (Precision Time Protocol / IEEE 1588 / SNTP style) Clock Synchronizer.
 *
 * Establishes and periodically maintains an accurate clock offset and round-trip delay
 * estimate relative to the server clock.
 *
 * For a request-response exchange:
 *   t1: Client local monotonic send time (ms)
 *   t2: Server receive & transmit timestamp (ms)
 *   t4: Client local monotonic receive time (ms)
 *
 * Round-trip delay (RTT):
 *   RTT = (t4 - t1)
 * Clock offset:
 *   offset = t2 - (t1 + t4) / 2
 *
 * Smooth filtering:
 *   Samples are collected into a sliding window. Outliers with abnormally high RTT
 *   (e.g., due to network jitter or packet loss) are rejected or downweighted in favor
 *   of minimum RTT samples, following standard NTP/PTP best practice.
 */
export class PtpClock {
    constructor({
        syncUrl,
        sampleCount = 6,
        syncIntervalMs = 30000,
        minIntervalMs = 5000
    } = {}) {
        this.syncUrl = syncUrl;
        this.sampleCount = sampleCount;
        this.syncIntervalMs = syncIntervalMs;
        this.minIntervalMs = minIntervalMs;

        this.offsetMs = 0; // serverTime - localTime
        this.rttMs = 0;
        this.synced = false;
        this.lastSyncPerf = 0;
        this.syncTimer = null;
        this.running = false;
        this.samples = [];
        this.listeners = new Set();
    }

    /**
     * Converts a local performance.now() timestamp to estimated serverTime (in seconds).
     */
    toServerTimeSec(perfNow = performance.now()) {
        const localEpochMs = performance.timeOrigin ? performance.timeOrigin + perfNow : Date.now();
        return (localEpochMs + this.offsetMs) / 1000;
    }

    /**
     * Converts a local performance.now() timestamp to estimated serverTime (in milliseconds).
     */
    toServerTimeMs(perfNow = performance.now()) {
        const localEpochMs = performance.timeOrigin ? performance.timeOrigin + perfNow : Date.now();
        return localEpochMs + this.offsetMs;
    }

    /**
     * Given a server timestamp in seconds, estimates the local performance.now()
     * when that event occurred or will occur.
     */
    toLocalPerf(serverTimeSec) {
        const targetServerMs = serverTimeSec * 1000;
        const targetLocalEpochMs = targetServerMs - this.offsetMs;
        const baseOrigin = performance.timeOrigin || (Date.now() - performance.now());
        return targetLocalEpochMs - baseOrigin;
    }

    /**
     * Calculates the true age in ms of a message stamped with serverTime (in seconds).
     */
    messageAgeMs(serverTimeSec, nowPerf = performance.now()) {
        if (!Number.isFinite(serverTimeSec) || serverTimeSec <= 0) return null;
        const currentServerMs = this.toServerTimeMs(nowPerf);
        return Math.max(0, currentServerMs - (serverTimeSec * 1000));
    }

    /**
     * Checks if this client is ready and has time to smoothly interpolate to a
     * target timestamp.
     * @param {number} targetServerTimeSec
     * @param {number} bufferMs Buffer/delay window
     * @returns {{ hasTime: boolean, deltaMs: number }}
     */
    evaluatePlaybackLead(targetServerTimeSec, bufferMs = 1250) {
        const currentServerMs = this.toServerTimeMs();
        const targetServerMs = targetServerTimeSec * 1000;
        // Positive delta means target is in the future relative to render buffer basis
        const renderServerMs = currentServerMs - bufferMs;
        const deltaMs = targetServerMs - renderServerMs;
        return {
            hasTime: deltaMs > 0,
            deltaMs
        };
    }

    /**
     * Add a single PTP sample:
     * @param {number} t1 Local epoch time sent (ms)
     * @param {number} t2 Server time (sec or ms)
     * @param {number} t4 Local epoch time received (ms)
     */
    recordSample(t1, t2, t4) {
        const serverMs = t2 < 10000000000 ? t2 * 1000 : t2;
        const rtt = Math.max(0, t4 - t1);
        const offset = serverMs - (t1 + t4) / 2;

        this.samples.push({ rtt, offset, time: t4 });
        if (this.samples.length > this.sampleCount * 2) {
            this.samples.shift();
        }

        this._recalculate();
    }

    _recalculate() {
        if (!this.samples.length) return;

        // Sort by RTT ascending - shortest network transit has lowest asymmetry error
        const sorted = [...this.samples].sort((a, b) => a.rtt - b.rtt);
        const bestSubset = sorted.slice(0, Math.max(1, Math.ceil(sorted.length / 2)));

        // Median offset of lowest RTT samples
        const mid = Math.floor(bestSubset.length / 2);
        const bestOffset = bestSubset.length % 2 !== 0
            ? bestSubset[mid].offset
            : (bestSubset[mid - 1].offset + bestSubset[mid].offset) / 2;

        const bestRtt = bestSubset.reduce((sum, s) => sum + s.rtt, 0) / bestSubset.length;

        // If already synced, apply exponential moving average filter to avoid step jumps
        if (this.synced) {
            this.offsetMs = this.offsetMs * 0.7 + bestOffset * 0.3;
            this.rttMs = this.rttMs * 0.7 + bestRtt * 0.3;
        } else {
            this.offsetMs = bestOffset;
            this.rttMs = bestRtt;
            this.synced = true;
        }

        this.lastSyncPerf = performance.now();
        this._notifyListeners();
    }

    onSync(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    _notifyListeners() {
        for (const fn of this.listeners) {
            try {
                fn({ offsetMs: this.offsetMs, rttMs: this.rttMs, synced: this.synced });
            } catch (_) {}
        }
    }

    /**
     * Perform one burst of PTP queries against the server.
     */
    async syncBurst() {
        if (!this.syncUrl) return;
        const urlBase = typeof this.syncUrl === 'function' ? this.syncUrl() : this.syncUrl;

        // Collect bursts of 3-4 probes spaced slightly apart
        const probeCount = 3;
        for (let i = 0; i < probeCount; i++) {
            try {
                const t1 = (performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
                const res = await fetch(`${urlBase}&action=time&t1=${t1}&_=${t1}`, {
                    method: 'GET',
                    cache: 'no-store'
                });
                if (!res.ok) continue;
                const data = await res.json();
                const t4 = (performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
                if (data && Number.isFinite(Number(data.serverTime))) {
                    this.recordSample(t1, Number(data.serverTime), t4);
                }
            } catch (_) {
                // Ignore transient network errors
            }
            if (i < probeCount - 1) {
                await new Promise(r => setTimeout(r, 60));
            }
        }
    }

    start() {
        if (this.running) return;
        this.running = true;

        const loop = async () => {
            if (!this.running) return;
            await this.syncBurst();
            if (!this.running) return;

            const nextInterval = !this.synced ? this.minIntervalMs : this.syncIntervalMs;
            this.syncTimer = setTimeout(loop, nextInterval);
        };

        loop();
    }

    stop() {
        this.running = false;
        if (this.syncTimer) {
            clearTimeout(this.syncTimer);
            this.syncTimer = null;
        }
    }
}
