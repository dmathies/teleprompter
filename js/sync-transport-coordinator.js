/**
 * SyncTransportCoordinator
 * Unifies Server-Sent Events (SSE) and HTTP polling fallback into a cohesive,
 * event-driven transport state machine.
 *
 * Emits standardized events:
 * - 'state': Master teleprompter state (from SSE message or polling body)
 * - 'cue-revision': Map of cue revisions ({revisions: {...}})
 * - 'annotation-revision': Map of annotation revisions ({revisions: {...}})
 * - 'department-settings': Central department settings doc
 * - 'server-heartbeat': Timestamped heartbeat from server
 * - 'status': Standardized connection lifecycle & telemetry updates
 *             ('connecting', 'connected', 'fallback_poll', 'sleeping', 'reconnecting', 'error', 'offline')
 */
export class SyncTransportCoordinator {
    constructor({
        syncUrl,
        sseUrl,
        ptpClock,
        followPollIntervalMs = 250,
        followIdleAfterMs = 10000,
        followIdlePollMs = 2000,
        followSleepAfterMs = 60 * 60 * 1000,
        followSleepPollMs = 60000,
        sseOpenTimeoutMs = 5000,
        sseReconnectGraceMs = 10000,
        activePtpIntervalMs = 15000,
        fetchFn = (...args) => fetch(...args),
        EventSourceClass = typeof EventSource !== "undefined" ? EventSource : null
    } = {}) {
        this.syncUrl = syncUrl;
        this.sseUrl = sseUrl;
        this.ptpClock = ptpClock;
        this.followPollIntervalMs = followPollIntervalMs;
        this.followIdleAfterMs = followIdleAfterMs;
        this.followIdlePollMs = followIdlePollMs;
        this.followSleepAfterMs = followSleepAfterMs;
        this.followSleepPollMs = followSleepPollMs;
        this.sseOpenTimeoutMs = sseOpenTimeoutMs;
        this.sseReconnectGraceMs = sseReconnectGraceMs;
        this.activePtpIntervalMs = activePtpIntervalMs;
        this.fetchFn = fetchFn;
        this.EventSourceClass = EventSourceClass;

        this.listeners = new Map();
        this.activeMode = "none"; // "sse" | "poll" | "none"
        this.status = "offline";
        this.eventSource = null;
        this.pollTimer = null;
        this.sseFallbackTimer = null;
        this.ptpIntervalTimer = null;
        this.sseHasOpened = false;
        this.lastMotionPerf = performance.now();
        this.lastHeartbeatPerf = null;
        this.running = false;
    }

    on(event, handler) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event).add(handler);
        return () => this.off(event, handler);
    }

    off(event, handler) {
        if (this.listeners.has(event)) {
            this.listeners.get(event).delete(handler);
        }
    }

    emit(event, data) {
        if (this.listeners.has(event)) {
            for (const handler of this.listeners.get(event)) {
                try {
                    handler(data);
                } catch (err) {
                    console.error(`Error in SyncTransportCoordinator [${event}] handler:`, err);
                }
            }
        }
    }

    notifyMotion() {
        this.lastMotionPerf = performance.now();
    }

    getStatus() {
        return {
            mode: this.activeMode,
            status: this.status,
            sseHasOpened: this.sseHasOpened,
            lastHeartbeatPerf: this.lastHeartbeatPerf
        };
    }

    setStatus(status, detail = {}) {
        this.status = status;
        this.emit("status", { status, mode: this.activeMode, ...detail });
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.startPtpPeriodicSync();
        this.startSse();
    }

    stop() {
        this.running = false;
        this.stopPtpPeriodicSync();
        this.stopPolling();
        this.clearSseFallbackTimer();

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        this.activeMode = "none";
        this.sseHasOpened = false;
        this.setStatus("offline");
    }

    startSse() {
        if (!this.running) return;

        if (!this.EventSourceClass) {
            this.startPollingFallback("EventSource not supported");
            return;
        }

        if (this.eventSource) {
            this.eventSource.close();
            this.eventSource = null;
        }

        this.sseHasOpened = false;
        this.activeMode = "sse";
        this.setStatus("connecting", { transport: "SSE" });

        const url = typeof this.sseUrl === "function" ? this.sseUrl() : this.sseUrl;
        const events = new this.EventSourceClass(url);
        this.eventSource = events;

        this.armSseFallbackTimer(this.sseOpenTimeoutMs);

        events.onopen = () => {
            if (events !== this.eventSource || !this.running) return;
            this.sseHasOpened = true;
            this.activeMode = "sse";
            this.lastHeartbeatPerf = performance.now();
            this.clearSseFallbackTimer();
            this.stopPolling();
            this.setStatus("connected", { transport: "SSE" });
        };

        events.onmessage = (event) => {
            if (events !== this.eventSource || !this.running) return;
            let state = null;
            try {
                state = JSON.parse(event.data);
            } catch (_) {
                this.setStatus("error", { message: "bad SSE data", transport: "SSE" });
                return;
            }
            this.emit("state", { state, transport: "SSE" });
        };

        events.addEventListener("annotation-revision", (event) => {
            if (events !== this.eventSource || !this.running) return;
            this.lastHeartbeatPerf = performance.now();
            this.emit("annotation-revision", event);
        });

        events.addEventListener("cue-revision", (event) => {
            if (events !== this.eventSource || !this.running) return;
            this.lastHeartbeatPerf = performance.now();
            this.emit("cue-revision", event);
        });

        events.addEventListener("department-settings", (event) => {
            if (events !== this.eventSource || !this.running) return;
            this.lastHeartbeatPerf = performance.now();
            this.emit("department-settings", event);
        });

        events.addEventListener("server-heartbeat", (event) => {
            if (events !== this.eventSource || !this.running) return;
            const nowPerf = performance.now();
            this.lastHeartbeatPerf = nowPerf;
            let data = null;
            if (event && event.data) {
                try { data = JSON.parse(event.data); } catch (_) {}
            }
            this.emit("server-heartbeat", { data, nowPerf });
        });

        events.onerror = () => {
            if (events !== this.eventSource || !this.running) return;
            this.setStatus("reconnecting", { transport: "SSE" });
            this.armSseFallbackTimer(this.sseHasOpened ? this.sseReconnectGraceMs : this.sseOpenTimeoutMs);
        };
    }

    clearSseFallbackTimer() {
        if (this.sseFallbackTimer !== null) {
            clearTimeout(this.sseFallbackTimer);
            this.sseFallbackTimer = null;
        }
    }

    armSseFallbackTimer(delay) {
        this.clearSseFallbackTimer();
        if (!this.running) return;

        this.sseFallbackTimer = setTimeout(() => {
            this.sseFallbackTimer = null;
            if (this.running && (!this.eventSource || this.eventSource.readyState !== 1 /* EventSource.OPEN */)) {
                this.startPollingFallback("SSE timeout");
            }
        }, delay);
    }

    startPollingFallback(reason = "") {
        if (!this.running) return;
        if (this.activeMode === "poll") return;

        this.activeMode = "poll";
        this.stopPolling();
        this.setStatus("fallback_poll", { transport: "POLL", reason });
        this.scheduleNextPoll(0);
    }

    stopPolling() {
        if (this.pollTimer !== null) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }
    }

    computePollDelay() {
        const idleFor = performance.now() - this.lastMotionPerf;
        if (idleFor >= this.followSleepAfterMs) return this.followSleepPollMs;
        if (idleFor >= this.followIdleAfterMs) return this.followIdlePollMs;
        return this.followPollIntervalMs;
    }

    scheduleNextPoll(delay = null) {
        this.stopPolling();
        if (!this.running || this.activeMode !== "poll") return;

        const nextDelay = delay === null ? this.computePollDelay() : delay;

        if (performance.now() - this.lastMotionPerf >= this.followSleepAfterMs) {
            this.setStatus("sleeping", { transport: "POLL" });
        }

        this.pollTimer = setTimeout(async () => {
            this.pollTimer = null;
            await this.executePoll();
            this.scheduleNextPoll();
        }, nextDelay);
    }

    async executePoll() {
        if (!this.running || this.activeMode !== "poll") return;

        const url = typeof this.syncUrl === "function" ? this.syncUrl() : this.syncUrl;
        const t1 = (performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());

        try {
            const res = await this.fetchFn(url + "&t1=" + t1 + "&_=" + Date.now(), {
                method: "GET",
                cache: "no-store"
            });

            if (!res.ok) throw new Error("HTTP " + res.status);

            const t4 = (performance.timeOrigin ? performance.timeOrigin + performance.now() : Date.now());
            const body = await res.json();
            const nowPerf = performance.now();
            this.lastHeartbeatPerf = nowPerf;

            if (body && Number.isFinite(Number(body.serverTime))) {
                if (this.ptpClock) {
                    this.ptpClock.recordSample(t1, Number(body.serverTime), t4);
                }
            }

            const state = body && body.state ? body.state : null;
            if (state && body && Number.isFinite(Number(body.serverTime))) {
                state.deliveryServerTime = Number(body.serverTime);
            }

            // Emit revision signals if present for 100% parity with SSE
            if (body && body.cueRevisions) {
                this.emit("cue-revision", { data: body.cueRevisions });
            }
            if (body && body.annotationRevisions) {
                this.emit("annotation-revision", { data: body.annotationRevisions });
            }
            if (body && body.departmentSettings) {
                this.emit("department-settings", { data: body.departmentSettings });
            }

            this.emit("state", { state, transport: "POLL" });
        } catch (err) {
            if (this.running && this.activeMode === "poll") {
                this.setStatus("error", { message: "connection lost · POLL", transport: "POLL" });
            }
        }
    }

    startPtpPeriodicSync() {
        this.stopPtpPeriodicSync();
        if (!this.ptpClock || !this.activePtpIntervalMs) return;

        this.ptpIntervalTimer = setInterval(async () => {
            if (!this.running) return;
            try {
                await this.ptpClock.measureOffset();
            } catch (_) {}
        }, this.activePtpIntervalMs);
    }

    stopPtpPeriodicSync() {
        if (this.ptpIntervalTimer !== null) {
            clearInterval(this.ptpIntervalTimer);
            this.ptpIntervalTimer = null;
        }
    }
}
