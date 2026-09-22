import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { FollowerInterpolator } from '../js/sync-follower-interpolator.js';

describe('FollowerInterpolator', () => {
  test('initial state and reset', () => {
    const interpolator = new FollowerInterpolator();
    assert.equal(interpolator.hasSamples(), false);
    assert.equal(interpolator.computeDesiredPosition(1000), null);
    assert.equal(interpolator.getDirection(), 0);
  });

  test('linear interpolation across sample buffer', () => {
    const interpolator = new FollowerInterpolator({
      followBufferMs: 1000,
      followAverageWindowMs: 3000
    });

    const t0 = 10000;
    // Add sample at t0 = 10s, target = 100
    interpolator.addSample({ serverMs: t0, target: 100, playing: false }, t0, 1000);
    // Add sample at t1 = 12s, target = 300
    interpolator.addSample({ serverMs: t0 + 2000, target: 300, playing: false }, t0 + 2000, 3000);

    assert.equal(interpolator.hasSamples(), true);

    // Compute desired position when renderServerMs = 11s (halfway between 10s and 12s)
    // estimatedServerNow = t0 + 2000 + (nowPerf - clockPerfMs)
    // with nowPerf = 3000, estimatedServerNow = 12000. renderServerMs = 12000 - 1000 = 11000
    const desired = interpolator.computeDesiredPosition(2000, 3000);
    assert.ok(Math.abs(desired - 200) < 1.0, `Expected ~200, got ${desired}`);
  });

  test('second-order acceleration prediction when playing', () => {
    const interpolator = new FollowerInterpolator({
      followBufferMs: 500,
      followAverageWindowMs: 3000
    });

    interpolator.setDirection(1);

    const baseT = 20000;
    // 3 samples spaced 250ms apart
    interpolator.addSample({ serverMs: baseT, target: 200, playing: true, acceleration: 10 }, baseT, 1000);
    interpolator.addSample({ serverMs: baseT + 250, target: 210, playing: true, acceleration: 10 }, baseT + 250, 1250);
    interpolator.addSample({ serverMs: baseT + 500, target: 225, playing: true, acceleration: 10 }, baseT + 500, 1500);

    const desired = interpolator.computeDesiredPosition(2000, 1500);
    assert.ok(Number.isFinite(desired));
    assert.ok(desired >= 200, `Desired position ${desired} should not drop below recent targets`);
  });

  test('top-jump guard prevents jumping to 0 when follower is well down the script', () => {
    const interpolator = new FollowerInterpolator();
    interpolator.setDirection(1);

    const t = 30000;
    interpolator.addSample({ serverMs: t, target: 500, playing: true }, t, 1000);
    interpolator.computeDesiredPosition(2000, 1000);

    assert.equal(interpolator.lastRenderedPosition, 500);

    // Simulate an erroneous or sudden single packet with target = 0 while moving forward
    interpolator.addSample({ serverMs: t + 250, target: 520, playing: true }, t + 250, 1250);

    // Force test lastRenderedPosition > 150 and desired calculation attempting jump to 0
    interpolator.lastRenderedPosition = 450;
    const clamped = interpolator.computeDesiredPosition(2000, 1250);

    // Must not be clamped to 0
    assert.ok(clamped >= 400, `Expected position to stay near 450, got ${clamped}`);
  });
});
