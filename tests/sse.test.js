import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Server-Sent Events (SSE) Protocol Contract', () => {
  let server;
  const MASTER_PASSWORD = 'CHANGE-ME-MASTER';
  const ROOM = 'sse_test_room_' + Date.now();

  before(async () => {
    server = new PhpTestServer({ port: 5600 });
    try {
      await server.start();
    } catch (err) {
      console.warn('PHP server not available, skipping live tests:', err.message);
    }
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('GET /scripts/teleprompter_events.php sets correct SSE headers & initial retry directive', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const controller = new AbortController();
    const res = await fetch(`${server.baseUrl}/scripts/teleprompter_events.php?room=${ROOM}`, {
      signal: controller.signal,
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') || '', /text\/event-stream/);
    assert.match(res.headers.get('cache-control') || '', /no-cache/);
    assert.equal(res.headers.get('x-accel-buffering'), 'no');

    // Read initial chunks
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.includes('retry: 1000')) break;
    }

    assert.ok(text.includes('retry: 1000\n\n'), 'Initial SSE handshake must send retry: 1000');
    controller.abort();
  });

  test('SSE stream emits state update with dynamic deliveryServerTime', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    // 1. Claim master
    await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${ROOM}&control=claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
      },
      body: JSON.stringify({ sessionId: 'sse-master' }),
    });

    // 2. Open SSE stream
    const controller = new AbortController();
    const sseRes = await fetch(`${server.baseUrl}/scripts/teleprompter_events.php?room=${ROOM}`, {
      signal: controller.signal,
    });
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();

    // 3. Push new state from master
    await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${ROOM}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
        'X-Teleprompter-Master-Session': 'sse-master',
      },
      body: JSON.stringify({
        script: 'pirates_test',
        promptId: 'p000003',
        fraction: 0.77,
        sequence: 101,
      }),
    });

    let buffer = '';
    let statePayload = null;
    const timeout = Date.now() + 3000;

    while (Date.now() < timeout) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n\n');
      for (const block of lines) {
        const dataLine = block.split('\n').find((l) => l.startsWith('data: '));
        if (dataLine) {
          try {
            const parsed = JSON.parse(dataLine.replace('data: ', ''));
            if (parsed.promptId === 'p000003') {
              statePayload = parsed;
              break;
            }
          } catch (_) {}
        }
      }
      if (statePayload) break;
    }

    controller.abort();

    assert.ok(statePayload, 'Must receive state update in SSE stream');
    assert.equal(statePayload.promptId, 'p000003');
    assert.equal(statePayload.fraction, 0.77);
    assert.equal(statePayload.sequence, 101);
    assert.ok(typeof statePayload.serverTime === 'number', 'state.serverTime must be present');
    assert.ok(
      typeof statePayload.deliveryServerTime === 'number',
      'state.deliveryServerTime must be stamped dynamically upon delivery'
    );
    assert.ok(statePayload.deliveryServerTime >= statePayload.serverTime);
  });
});
