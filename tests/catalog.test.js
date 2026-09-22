import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Scripts Catalog & Content API', () => {
  let server;

  before(async () => {
    server = new PhpTestServer({ port: 5100 });
    try {
      await server.start();
    } catch (err) {
      console.warn('PHP server not available, skipping live tests:', err.message);
    }
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('GET /scripts/list_scripts.php returns valid catalog object', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');

    const res = await fetch(`${server.baseUrl}/scripts/list_scripts.php`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /application\/json/);

    const data = await res.json();
    assert.equal(data.ok, true);
    assert.ok(Array.isArray(data.scripts), 'scripts should be an array');
    assert.ok(data.scripts.length > 0, 'should return at least one script');

    for (const item of data.scripts) {
      assert.ok(typeof item.id === 'string' && item.id.length > 0, 'each script needs a string id');
      assert.ok(typeof item.name === 'string' && item.name.length > 0, 'each script needs a string name');
      assert.match(item.id, /^[A-Za-z0-9_-]+$/, 'id matches valid pattern');
    }
  });

  test('GET /scripts/get_script.php returns script markup or 404 for unknown script', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');

    // Valid script
    const resValid = await fetch(`${server.baseUrl}/scripts/get_script.php?id=pirates_test`);
    assert.equal(resValid.status, 200);
    assert.match(resValid.headers.get('content-type') || '', /text\/html/);
    const html = await resValid.text();
    assert.ok(html.includes('data-prompt-id'), 'script markup must contain data-prompt-id blocks');

    // Unknown script
    const resNotFound = await fetch(`${server.baseUrl}/scripts/get_script.php?id=non_existent_script_xyz`);
    assert.equal(resNotFound.status, 404);

    // Malicious script path attempt
    const resBadId = await fetch(`${server.baseUrl}/scripts/get_script.php?id=../../etc/passwd`);
    assert.equal(resBadId.status, 404);
  });
});
