import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SyncTransportCoordinator } from '../js/sync-transport-coordinator.js';

class MockEventSource {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.listeners = new Map();
    MockEventSource.instances.push(this);
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, new Set());
    }
    this.listeners.get(type).add(handler);
  }

  removeEventListener(type, handler) {
    if (this.listeners.has(type)) {
      this.listeners.get(type).delete(handler);
    }
  }

  dispatchEvent(type, event) {
    if (type === 'open' && typeof this.onopen === 'function') {
      this.onopen(event);
    } else if (type === 'message' && typeof this.onmessage === 'function') {
      this.onmessage(event);
    } else if (type === 'error' && typeof this.onerror === 'function') {
      this.onerror(event);
    }

    if (this.listeners.has(type)) {
      for (const handler of this.listeners.get(type)) {
        handler(event);
      }
    }
  }

  simulateOpen() {
    this.readyState = 1; // OPEN
    this.dispatchEvent('open', { type: 'open' });
  }

  simulateMessage(data) {
    this.dispatchEvent('message', {
      type: 'message',
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
  }

  simulateCustomEvent(type, data) {
    this.dispatchEvent(type, {
      type,
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
  }

  simulateError() {
    this.readyState = 2; // CLOSED
    this.dispatchEvent('error', { type: 'error' });
  }

  close() {
    this.readyState = 2;
    this.closed = true;
  }
}

describe('SyncTransportCoordinator', () => {
  test('initializes in offline state', () => {
    const coordinator = new SyncTransportCoordinator({
      syncUrl: () => 'http://localhost/sync.php',
      sseUrl: () => 'http://localhost/events.php',
      EventSourceClass: MockEventSource,
    });

    const status = coordinator.getStatus();
    assert.equal(status.mode, 'none');
    assert.equal(status.status, 'offline');
    assert.equal(status.sseHasOpened, false);
  });

  test('starts SSE transport and handles open/message lifecycle', () => {
    MockEventSource.instances = [];
    const coordinator = new SyncTransportCoordinator({
      syncUrl: () => 'http://localhost/sync.php',
      sseUrl: () => 'http://localhost/events.php',
      EventSourceClass: MockEventSource,
    });

    const statuses = [];
    coordinator.on('status', (s) => statuses.push(s));

    const states = [];
    coordinator.on('state', (st) => states.push(st));

    coordinator.start();
    assert.equal(coordinator.activeMode, 'sse');
    assert.equal(MockEventSource.instances.length, 1);

    const es = MockEventSource.instances[0];
    assert.equal(es.url, 'http://localhost/events.php');

    // Simulate connection open
    es.simulateOpen();
    assert.equal(coordinator.status, 'connected');
    assert.equal(coordinator.sseHasOpened, true);

    // Simulate state message
    es.simulateMessage({ script: 'test_script', prompt: 'p1', fraction: 0.25 });
    assert.equal(states.length, 1);
    assert.equal(states[0].transport, 'SSE');
    assert.equal(states[0].state.prompt, 'p1');

    coordinator.stop();
    assert.equal(es.closed, true);
    assert.equal(coordinator.status, 'offline');
  });

  test('dispatches revision and heartbeat events over SSE', () => {
    MockEventSource.instances = [];
    const coordinator = new SyncTransportCoordinator({
      syncUrl: () => 'http://localhost/sync.php',
      sseUrl: () => 'http://localhost/events.php',
      EventSourceClass: MockEventSource,
    });

    const cueRevisions = [];
    const annotationRevisions = [];
    const deptSettings = [];
    const heartbeats = [];

    coordinator.on('cue-revision', (e) => cueRevisions.push(e));
    coordinator.on('annotation-revision', (e) => annotationRevisions.push(e));
    coordinator.on('department-settings', (e) => deptSettings.push(e));
    coordinator.on('server-heartbeat', (e) => heartbeats.push(e));

    coordinator.start();
    const es = MockEventSource.instances[0];
    es.simulateOpen();

    // Cue revision
    es.simulateCustomEvent('cue-revision', { script_dept: 5 });
    assert.equal(cueRevisions.length, 1);

    // Annotation revision
    es.simulateCustomEvent('annotation-revision', { script_dept: 10 });
    assert.equal(annotationRevisions.length, 1);

    // Department settings
    es.simulateCustomEvent('department-settings', { revision: 3, departments: {} });
    assert.equal(deptSettings.length, 1);

    // Server heartbeat
    es.simulateCustomEvent('server-heartbeat', { serverTime: 12345.678 });
    assert.equal(heartbeats.length, 1);
    assert.equal(heartbeats[0].data.serverTime, 12345.678);

    coordinator.stop();
  });

  test('falls back to polling when SSE connection times out or fails', async () => {
    MockEventSource.instances = [];
    let fetchCalledWith = null;

    const mockFetch = async (url) => {
      fetchCalledWith = url;
      return {
        ok: true,
        json: async () => ({
          ok: true,
          serverTime: 2000.5,
          state: { prompt: 'poll_prompt', fraction: 0.5 },
          cueRevisions: { test_dept: 2 },
          annotationRevisions: { test_dept: 7 },
          departmentSettings: { revision: 4 },
        }),
      };
    };

    const coordinator = new SyncTransportCoordinator({
      syncUrl: () => 'http://localhost/sync.php?room=main',
      sseUrl: () => 'http://localhost/events.php?room=main',
      EventSourceClass: MockEventSource,
      fetchFn: mockFetch,
      sseOpenTimeoutMs: 10, // fast timeout for test
    });

    const statuses = [];
    coordinator.on('status', (s) => statuses.push(s));

    const states = [];
    coordinator.on('state', (st) => states.push(st));

    const cues = [];
    coordinator.on('cue-revision', (c) => cues.push(c));

    coordinator.start();
    assert.equal(coordinator.activeMode, 'sse');

    // Trigger error on SSE
    const es = MockEventSource.instances[0];
    es.simulateError();

    // Trigger fallback
    coordinator.startPollingFallback('simulated failure');
    assert.equal(coordinator.activeMode, 'poll');
    assert.equal(coordinator.status, 'fallback_poll');

    // Execute poll directly
    await coordinator.executePoll();

    assert.ok(fetchCalledWith && fetchCalledWith.includes('http://localhost/sync.php?room=main'));
    assert.equal(states.length, 1);
    assert.equal(states[0].transport, 'POLL');
    assert.equal(states[0].state.prompt, 'poll_prompt');
    assert.equal(states[0].state.deliveryServerTime, 2000.5);

    // Verify 100% parity: revisions received via polling
    assert.equal(cues.length, 1);
    assert.deepEqual(cues[0].data, { test_dept: 2 });

    coordinator.stop();
    assert.equal(coordinator.status, 'offline');
  });

  test('adapts polling frequency based on motion', () => {
    const coordinator = new SyncTransportCoordinator({
      syncUrl: () => 'http://localhost/sync.php',
      followPollIntervalMs: 250,
      followIdleAfterMs: 1000,
      followIdlePollMs: 2000,
      followSleepAfterMs: 5000,
      followSleepPollMs: 60000,
      EventSourceClass: null, // force no EventSource
    });

    // Fresh motion
    coordinator.notifyMotion();
    assert.equal(coordinator.computePollDelay(), 250);

    // Simulate idle for 2 seconds
    coordinator.lastMotionPerf = performance.now() - 2000;
    assert.equal(coordinator.computePollDelay(), 2000);

    // Simulate idle for 6 seconds (sleep)
    coordinator.lastMotionPerf = performance.now() - 6000;
    assert.equal(coordinator.computePollDelay(), 60000);
  });
});
