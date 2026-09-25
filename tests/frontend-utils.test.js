import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { contrastingTextColor, formatHealthAge, healthClass, hslToRgb } from '../js/utils.js';

describe('Frontend Pure Presentation Utilities (js/utils.js)', () => {
  describe('contrastingTextColor', () => {
    test('returns black for bright colors and white for dark colors', () => {
      // White and yellow have high luminance -> black text
      assert.equal(contrastingTextColor('#ffffff'), '#000');
      assert.equal(contrastingTextColor('#ffd000'), '#000');
      assert.equal(contrastingTextColor('#ffff00'), '#000');
      assert.equal(contrastingTextColor('#88ff88'), '#000');

      // Black, navy, dark red have low luminance -> white text
      assert.equal(contrastingTextColor('#000000'), '#fff');
      assert.equal(contrastingTextColor('#111111'), '#fff');
      assert.equal(contrastingTextColor('#2f80ed'), '#fff');
      assert.equal(contrastingTextColor('#a82424'), '#fff');
    });

    test('handles case sensitivity and shorthand/invalid hex values gracefully', () => {
      assert.equal(contrastingTextColor('#FFFFFF'), '#000');
      assert.equal(contrastingTextColor('#000000'), '#fff');
      assert.equal(contrastingTextColor(''), '#fff');
      assert.equal(contrastingTextColor(null), '#fff');
      assert.equal(contrastingTextColor(undefined), '#fff');
      assert.equal(contrastingTextColor('invalid'), '#fff');
    });
  });

  describe('formatHealthAge', () => {
    test('formats sub-minute durations into seconds', () => {
      assert.equal(formatHealthAge(0), '0s');
      assert.equal(formatHealthAge(500), '0s');
      assert.equal(formatHealthAge(1500), '1s');
      assert.equal(formatHealthAge(45000), '45s');
      assert.equal(formatHealthAge(59999), '59s');
    });

    test('formats minutes with padded seconds', () => {
      assert.equal(formatHealthAge(60000), '1m00s');
      assert.equal(formatHealthAge(65000), '1m05s');
      assert.equal(formatHealthAge(125000), '2m05s');
      assert.equal(formatHealthAge(3599000), '59m59s');
    });

    test('formats hours with padded minutes', () => {
      assert.equal(formatHealthAge(3600000), '1h00m');
      assert.equal(formatHealthAge(3660000), '1h01m');
      assert.equal(formatHealthAge(7200000), '2h00m');
    });

    test('handles negative and non-finite values', () => {
      assert.equal(formatHealthAge(-1), '—');
      assert.equal(formatHealthAge(Number.NaN), '—');
      assert.equal(formatHealthAge(Infinity), '—');
      assert.equal(formatHealthAge(null), '—');
    });
  });

  describe('healthClass', () => {
    test('classifies age against ok and warn boundaries', () => {
      const okMs = 1000;
      const warnMs = 5000;

      assert.equal(healthClass(500, okMs, warnMs), 'health-ok');
      assert.equal(healthClass(1000, okMs, warnMs), 'health-ok');
      assert.equal(healthClass(1001, okMs, warnMs), 'health-warn');
      assert.equal(healthClass(5000, okMs, warnMs), 'health-warn');
      assert.equal(healthClass(5001, okMs, warnMs), 'health-error');
      assert.equal(healthClass(10000, okMs, warnMs), 'health-error');
    });

    test('handles non-finite values as health-error', () => {
      assert.equal(healthClass(NaN, 1000, 5000), 'health-error');
      assert.equal(healthClass(Infinity, 1000, 5000), 'health-error');
      assert.equal(healthClass(null, 1000, 5000), 'health-error');
    });
  });

  describe('hslToRgb', () => {
    test('converts basic hues to RGB', () => {
      // Red: 0 deg, 100%, 50%
      assert.deepEqual(hslToRgb(0, 1, 0.5), [255, 0, 0]);
      // Green: 120 deg, 100%, 50%
      assert.deepEqual(hslToRgb(120, 1, 0.5), [0, 255, 0]);
      // Blue: 240 deg, 100%, 50%
      assert.deepEqual(hslToRgb(240, 1, 0.5), [0, 0, 255]);
      // White: any hue, 0%, 100%
      assert.deepEqual(hslToRgb(0, 0, 1), [255, 255, 255]);
      // Black: any hue, 0%, 0%
      assert.deepEqual(hslToRgb(0, 0, 0), [0, 0, 0]);
    });

    test('wraps hue angles greater than 360 or less than 0', () => {
      assert.deepEqual(hslToRgb(360, 1, 0.5), [255, 0, 0]);
      assert.deepEqual(hslToRgb(720, 1, 0.5), [255, 0, 0]);
      assert.deepEqual(hslToRgb(-240, 1, 0.5), [0, 255, 0]);
    });
  });
});
