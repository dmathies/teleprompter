import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PtpClock } from '../js/sync-ptp-clock.js';
import { FollowerInterpolator } from '../js/sync-follower-interpolator.js';

describe('PTP Clock Synchronization and Shared Cluster Timing', () => {
  test('PtpClock calculates RTT and clock offset from samples', () => {
    const clock = new PtpClock();
    assert.equal(clock.synced, false);

    // Round-trip 1:
    // Client send t1 = 1,000,000 ms
    // Server time t2 = 1,000,050 ms (server is 50ms ahead)
    // Client receive t4 = 1,000,020 ms (RTT = 20ms, one-way delay = 10ms)
    // True server time at midpoint (1,000,010) was 1,000,050 -> offset = +40ms
    const t1 = 1000000;
    const t2 = 1000050 / 1000; // in seconds
    const t4 = 1000020;

    clock.recordSample(t1, t2, t4);
    assert.equal(clock.synced, true);
    assert.equal(clock.rttMs, 20);
    assert.equal(clock.offsetMs, 40);
  });

  test('PtpClock filters outlier samples with large network delay', () => {
    const clock = new PtpClock({ sampleCount: 4 });

    // Baseline good sample: RTT 10ms, offset 50ms
    clock.recordSample(1000, 1.055, 1010); // RTT = 10, offset = 50ms

    // Outlier sample with 200ms network delay jitter
    clock.recordSample(2000, 2.190, 2200); // RTT = 200, offset = 90ms (noisy)

    // Another clean sample: RTT 10ms, offset 50ms
    clock.recordSample(3000, 3.055, 3010); // RTT = 10, offset = 50ms

    // Clock offset should remain heavily weighted around the low-RTT offset (approx 50ms)
    assert.ok(Math.abs(clock.offsetMs - 50) < 10, `Expected offset ~50, got ${clock.offsetMs}`);
    assert.ok(clock.rttMs < 100, `Expected low filtered RTT, got ${clock.rttMs}`);
  });

  test('PtpClock evaluates message age and playback lead accurately', () => {
    const clock = new PtpClock();
    // Simulate server 100ms ahead of client
    clock.recordSample(1000, 1.105, 1010);

    const nowPerf = 5000;
    const nowServerSec = clock.toServerTimeSec(nowPerf);
    assert.ok(nowServerSec > 0);

    // Message stamped 500ms ago on server clock
    const pastServerSec = nowServerSec - 0.5;
    const age = clock.messageAgeMs(pastServerSec, nowPerf);
    assert.ok(Math.abs(age - 500) < 5, `Expected age ~500ms, got ${age}ms`);

    // Target position 1500ms ahead of render buffer (buffer = 1000ms)
    const futureServerSec = nowServerSec + 0.5;
    const lead = clock.evaluatePlaybackLead(futureServerSec, 1000);
    assert.equal(lead.hasTime, true);
    assert.ok(lead.deltaMs > 0);
  });

  test('FollowerInterpolator utilizes synced PtpClock for estimatedServerNow', () => {
    const ptpClock = new PtpClock();
    // Set 0 offset for simple test arithmetic
    ptpClock.recordSample(1000, 1.005, 1010);

    const interpolator = new FollowerInterpolator({
      followBufferMs: 500,
      ptpClock
    });

    const nowServerMs = ptpClock.toServerTimeMs();
    interpolator.addSample({ serverMs: nowServerMs - 1000, target: 100, playing: false }, nowServerMs - 1000);
    interpolator.addSample({ serverMs: nowServerMs + 1000, target: 300, playing: false }, nowServerMs + 1000);

    const desired = interpolator.computeDesiredPosition(1000);
    assert.ok(Number.isFinite(desired));
    // renderServerMs = nowServerMs - 500ms -> desired should be ~150
    assert.ok(Math.abs(desired - 150) < 5.0, `Expected ~150, got ${desired}`);
  });
});
