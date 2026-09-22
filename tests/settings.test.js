import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Settings API Contract & Validation', () => {
  let server;
  const DEPT_PASSWORD = 'CHANGE-ME-FS';

  before(async () => {
    server = new PhpTestServer({ port: 5200 });
    await server.start();
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('GET /scripts/settings_api.php?action=get validates departments and response contract', async () => {
    // Valid department
    const res = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=get&dept=FS`);
    assert.equal(res.status, 200);
    const data = await res.json();

    assert.equal(data.ok, true);
    assert.equal(data.department, 'FS');
    assert.ok(typeof data.revision === 'number', 'revision must be a number');
    assert.ok(data.annotationMargin && typeof data.annotationMargin === 'object', 'annotationMargin must be an object');
    assert.ok(['none', 'left', 'right'].includes(data.annotationMargin.side), 'margin side must be none, left, or right');
    assert.ok(typeof data.annotationMargin.width === 'number', 'margin width must be a number');

    // Unknown department
    const resBadDept = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=get&dept=INVALID`);
    assert.equal(resBadDept.status, 404);
    const badData = await resBadDept.json();
    assert.equal(badData.ok, false);
    assert.equal(badData.error, 'Unknown department');
  });

  test('POST /scripts/settings_api.php requires authentication', async () => {
    const res = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=save`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department: 'FS',
        annotationMargin: { side: 'left', width: 25 },
      }),
    });
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.ok, false);
    assert.equal(data.error, 'Authentication failed');
  });

  test('POST /scripts/settings_api.php validates margin bounds and issues auth cookie', async () => {
    // Save valid margin with header key
    const res = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        department: 'FS',
        annotationMargin: { side: 'right', width: 22 },
      }),
    });
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.department, 'FS');
    assert.equal(data.annotationMargin.side, 'right');
    assert.equal(data.annotationMargin.width, 22);

    // Verify Set-Cookie was returned
    const cookie = res.headers.get('set-cookie');
    assert.ok(cookie && cookie.includes('tp_auth_dept_fs'), 'must issue signed department auth cookie');

    // Reject out-of-bounds width (> 40)
    const resBadWidth = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        department: 'FS',
        annotationMargin: { side: 'right', width: 99 },
      }),
    });
    assert.equal(resBadWidth.status, 400);
    const badWidthData = await resBadWidth.json();
    assert.equal(badWidthData.ok, false);

    // Reject invalid margin side
    const resBadSide = await fetch(`${server.baseUrl}/scripts/settings_api.php?action=save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Cue-Key': DEPT_PASSWORD,
      },
      body: JSON.stringify({
        department: 'FS',
        annotationMargin: { side: 'top', width: 20 },
      }),
    });
    assert.equal(resBadSide.status, 400);
  });
});
