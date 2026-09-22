import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Cues API Contract & Concurrency', () => {
  let server;
  const DEPT_PASSWORD = 'CHANGE-ME-LX';
  let createdCueId = '';

  before(async () => {
    server = new PhpTestServer({ port: 5300 });
    try {
      await server.start();
    } catch (err) {
      console.warn('PHP server not available, skipping live tests:', err.message);
    }
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('GET /scripts/cue_api.php?action=get validates parameters and schema contract', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const res = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=get&script=pirates_test&dept=LX`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.ok, true);
    assert.equal(data.script, 'pirates_test');
    assert.equal(data.department, 'LX');
    assert.ok(typeof data.revision === 'number', 'revision must be a number');
    assert.ok(Array.isArray(data.cues), 'cues must be an array');
  });

  test('POST /scripts/cue_api.php saves, validates, and returns complete cue object', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const newCue = {
      number: 'LX-42',
      description: 'Spotlight on Pirate King',
      color: '#2f80ed',
      anchor: {
        type: 'word',
        prompt: 'p000001',
        fraction: 0.45,
        wordIndex: 12,
        text: 'Pour,',
      },
      endAnchor: {
        prompt: 'p000002',
        fraction: 0.1,
      },
    };

    const res = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'LX',
        cue: newCue,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.revision === 'number');
    assert.ok(Array.isArray(data.cues));

    const saved = data.cues.find((c) => c.number === 'LX-42');
    assert.ok(saved, 'Saved cue must be present in returned cues list');
    assert.ok(saved.id.startsWith('lx-'), 'ID generated with department prefix');
    createdCueId = saved.id;
    assert.equal(saved.description, 'Spotlight on Pirate King');
    assert.equal(saved.color, '#2f80ed');
    assert.equal(saved.anchor.type, 'word');
    assert.equal(saved.anchor.wordIndex, 12);
    assert.equal(saved.anchor.text, 'Pour,');
    assert.equal(saved.endAnchor.prompt, 'p000002');
  });

  test('POST /scripts/cue_api.php rejects invalid cue coordinates and anchors', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    // Bad fraction > 1
    const resBadFrac = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'LX',
        cue: {
          number: '99',
          anchor: { type: 'paragraph', prompt: 'p000001', fraction: 1.5 },
        },
      }),
    });
    assert.equal(resBadFrac.status, 400);

    // Bad prompt format (must match p[0-9]{6})
    const resBadPrompt = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'LX',
        cue: {
          number: '99',
          anchor: { type: 'paragraph', prompt: 'invalid_prompt_id', fraction: 0 },
        },
      }),
    });
    assert.equal(resBadPrompt.status, 400);
  });

  test('Concurrent cue mutations do not lose updates (flock serialization)', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    // Fire 6 simultaneous saves for distinct cues
    const promises = Array.from({ length: 6 }, (_, i) => {
      return fetch(`${server.baseUrl}/scripts/cue_api.php?action=save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Cue-Key': DEPT_PASSWORD,
        },
        body: JSON.stringify({
          script: 'pirates_test',
          department: 'LX',
          cue: {
            number: `RACE-${i}`,
            description: `Race cue ${i}`,
            anchor: { type: 'paragraph', prompt: 'p000001', fraction: 0.1 * i },
          },
        }),
      }).then((r) => r.json());
    });

    const results = await Promise.all(promises);
    for (const r of results) {
      assert.equal(r.ok, true, 'Each simultaneous save must succeed');
    }

    // Verify all 6 cues exist in the document
    const finalRes = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=get&script=pirates_test&dept=LX`);
    const finalDoc = await finalRes.json();
    for (let i = 0; i < 6; i++) {
      assert.ok(
        finalDoc.cues.some((c) => c.number === `RACE-${i}`),
        `Cue RACE-${i} must exist without being overwritten`
      );
    }

    // Clean up race cues
    for (let i = 0; i < 6; i++) {
      const cue = finalDoc.cues.find((c) => c.number === `RACE-${i}`);
      if (cue) {
        await fetch(`${server.baseUrl}/scripts/cue_api.php?action=delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Cue-Key': DEPT_PASSWORD,
          },
          body: JSON.stringify({
            script: 'pirates_test',
            department: 'LX',
            id: cue.id,
          }),
        });
      }
    }
  });

  test('POST /scripts/cue_api.php?action=delete deletes cue cleanly', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    if (!createdCueId) return;

    const res = await fetch(`${server.baseUrl}/scripts/cue_api.php?action=delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'LX',
        id: createdCueId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(!data.cues.some((c) => c.id === createdCueId), 'Deleted cue must no longer be present');
  });
});
