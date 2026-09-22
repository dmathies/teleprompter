import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Annotations API Contract & Schema Bounds', () => {
  let server;
  const DEPT_PASSWORD = 'CHANGE-ME-SND';
  let createdStrokeId = '';

  before(async () => {
    server = new PhpTestServer({ port: 5400 });
    await server.start();
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('GET /scripts/annotation_api.php?action=get validates schema contract', async () => {
    const res = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=get&script=pirates_test&dept=SND`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.ok, true);
    assert.equal(data.script, 'pirates_test');
    assert.equal(data.department, 'SND');
    assert.ok(typeof data.revision === 'number', 'revision must be a number');
    assert.ok(Array.isArray(data.annotations), 'annotations must be an array');
  });

  test('POST /scripts/annotation_api.php saves and returns stroke annotation', async () => {
    const strokeAnnotation = {
      type: 'stroke',
      prompt: 'p000001',
      color: '#ffeb3b',
      width: 4.5,
      fontPx: 38,
      coordMode: 'line',
      points: [
        [0.1, 0.2],
        [0.15, 0.25],
        [0.2, 0.3],
      ],
      pressures: [0.5, 0.6, 0.7],
    };

    const res = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'SND',
        annotation: strokeAnnotation,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(typeof data.revision === 'number');
    assert.ok(Array.isArray(data.annotations));

    const saved = data.annotations[data.annotations.length - 1];
    assert.ok(saved.id.startsWith('snd-ann-'));
    createdStrokeId = saved.id;
    assert.equal(saved.type, 'stroke');
    assert.equal(saved.prompt, 'p000001');
    assert.equal(saved.color, '#ffeb3b');
    assert.equal(saved.width, 4.5);
    assert.equal(saved.points.length, 3);
    assert.equal(saved.pressures.length, 3);
    assert.ok(typeof saved.updatedAt === 'number');
  });

  test('POST /scripts/annotation_api.php rejects invalid coordinates, modes, and stroke limits', async () => {
    // Single point stroke (minimum is 2 points)
    const resSinglePoint = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'SND',
        annotation: {
          type: 'stroke',
          prompt: 'p000001',
          points: [[0.5, 0.5]],
        },
      }),
    });
    assert.equal(resSinglePoint.status, 400);

    // Coordinate out of bounds (x < -2 or x > 3, y < -10 or y > 50)
    const resOutOfBounds = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'SND',
        annotation: {
          type: 'stroke',
          prompt: 'p000001',
          points: [[0.1, 0.1], [10.0, 999.0]],
        },
      }),
    });
    assert.equal(resOutOfBounds.status, 400);

    // Invalid coordinate mode
    const resBadMode = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'SND',
        annotation: {
          type: 'stroke',
          prompt: 'p000001',
          coordMode: 'invalid_mode',
          points: [[0.1, 0.1], [0.2, 0.2]],
        },
      }),
    });
    assert.equal(resBadMode.status, 400);
  });

  test('POST /scripts/annotation_api.php?action=delete removes annotation', async () => {
    if (!createdStrokeId) return;

    const res = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=delete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        script: 'pirates_test',
        department: 'SND',
        id: createdStrokeId,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(!data.annotations.some((a) => a.id === createdStrokeId));
  });
});
