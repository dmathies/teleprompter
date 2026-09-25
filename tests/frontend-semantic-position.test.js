import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = {
    escape: (val) => String(val).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1')
  };
}

import { normalizeSemanticPosition, createSemanticPositionApi } from '../js/semantic-position.js';

describe('Frontend Semantic Position (js/semantic-position.js)', () => {
  describe('normalizeSemanticPosition', () => {
    test('normalizes valid semantic positions', () => {
      assert.deepEqual(normalizeSemanticPosition({ prompt: 'p000001', fraction: 0.5 }), {
        prompt: 'p000001',
        fraction: 0.5,
      });

      assert.deepEqual(normalizeSemanticPosition({ prompt: '  p000002  ', fraction: 0 }), {
        prompt: 'p000002',
        fraction: 0,
      });

      assert.deepEqual(normalizeSemanticPosition({ prompt: 'p000003', fraction: 1 }), {
        prompt: 'p000003',
        fraction: 1,
      });
    });

    test('clamps and handles defaultFraction', () => {
      // Clamping within [0, 1]
      assert.deepEqual(normalizeSemanticPosition({ prompt: 'p000001', fraction: 1.5 }), null);
      assert.deepEqual(normalizeSemanticPosition({ prompt: 'p000001', fraction: -0.1 }), null);

      // defaultFraction fallback when fraction is missing/NaN
      assert.deepEqual(
        normalizeSemanticPosition({ prompt: 'p000001' }, { defaultFraction: 0 }),
        { prompt: 'p000001', fraction: 0 }
      );
      assert.deepEqual(
        normalizeSemanticPosition({ prompt: 'p000001', fraction: 'invalid' }, { defaultFraction: 0.25 }),
        { prompt: 'p000001', fraction: 0.25 }
      );
    });

    test('rejects invalid inputs', () => {
      assert.equal(normalizeSemanticPosition(null), null);
      assert.equal(normalizeSemanticPosition(undefined), null);
      assert.equal(normalizeSemanticPosition('p000001'), null);
      assert.equal(normalizeSemanticPosition({ prompt: '' }), null);
      assert.equal(normalizeSemanticPosition({ fraction: 0.5 }), null);
    });
  });

  describe('createSemanticPositionApi with DOM mock', () => {
    // Mock minimal DOM structure
    function createMockEnvironment() {
      const blocks = [
        {
          dataset: { promptId: 'p000001' },
          offsetTop: 0,
          offsetHeight: 200,
        },
        {
          dataset: { promptId: 'p000002' },
          offsetTop: 200,
          offsetHeight: 300,
        },
        {
          dataset: { promptId: 'p000003' },
          offsetTop: 500,
          offsetHeight: 100,
        },
      ];

      const content = {
        querySelector(selector) {
          const match = selector.match(/\[data-prompt-id="([^"]+)"\]/);
          if (!match) return null;
          return blocks.find(b => b.dataset.promptId === match[1]) || null;
        }
      };

      const viewport = {
        scrollTop: 0,
        clientHeight: 1000,
      };

      const api = createSemanticPositionApi({
        content,
        viewport,
        getPromptBlocks: () => blocks,
        referenceLineFraction: 0.35, // Reference line is at 35% down viewport
      });

      return { api, blocks, viewport };
    }

    test('capture computes current reference position at 35% viewport height', () => {
      const { api, viewport } = createMockEnvironment();

      // With scrollTop = 0, clientHeight = 1000, referenceY = 350px.
      // Block 1: 0 - 200px
      // Block 2: 200 - 500px (contains referenceY 350px).
      // Intra-block offset = 350 - 200 = 150px.
      // Fraction = 150 / 300 = 0.5.
      const pos = api.capture();
      assert.ok(pos);
      assert.equal(pos.prompt, 'p000002');
      assert.equal(pos.fraction, 0.5);

      // Scroll viewport down: scrollTop = 300, referenceY = 300 + 350 = 650px.
      // Block 3: 500 - 600px. Reference is past block 3 -> clamped to block 3 end.
      viewport.scrollTop = 300;
      const pos2 = api.capture();
      assert.ok(pos2);
      assert.equal(pos2.prompt, 'p000003');
      assert.equal(pos2.fraction, 1);
    });

    test('toDocumentY calculates exact pixel coordinate from semantic position', () => {
      const { api } = createMockEnvironment();

      // Block 1 start: 0px
      assert.equal(api.toDocumentY({ prompt: 'p000001', fraction: 0 }), 0);
      // Block 1 halfway: 100px
      assert.equal(api.toDocumentY({ prompt: 'p000001', fraction: 0.5 }), 100);
      // Block 2 quarter: 200 + 300 * 0.25 = 275px
      assert.equal(api.toDocumentY({ prompt: 'p000002', fraction: 0.25 }), 275);
      // Non-existent prompt
      assert.equal(api.toDocumentY({ prompt: 'non_existent', fraction: 0.5 }), null);
    });

    test('compare evaluates semantic order between positions', () => {
      const { api } = createMockEnvironment();

      const p1Start = { prompt: 'p000001', fraction: 0 };
      const p1End = { prompt: 'p000001', fraction: 1 };
      const p2Start = { prompt: 'p000002', fraction: 0 };

      assert.equal(api.compare(p1Start, p1End), -1);
      assert.equal(api.compare(p1End, p1Start), 1);
      assert.equal(api.compare(p1End, p1End), 0);
      assert.equal(api.compare(p1End, p2Start), 0); // Both meet at 200px
      assert.equal(api.compare(p1Start, { prompt: 'non_existent' }), null);
    });
  });
});
