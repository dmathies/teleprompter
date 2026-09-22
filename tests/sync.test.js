import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PhpTestServer } from './harness/php-server.js';

describe('Teleprompter Sync & Master Lease Concurrency', () => {
  let server;
  const MASTER_PASSWORD = 'CHANGE-ME-MASTER';
  const ROOM = 'test_room_' + Date.now();

  before(async () => {
    server = new PhpTestServer({ port: 5500 });
    try {
      await server.start();
    } catch (err) {
      console.warn('PHP server not available, skipping live tests:', err.message);
    }
  });

  after(async () => {
    if (server) await server.stop();
  });

  test('POST /scripts/teleprompter_sync.php?auth=status and claim flow contract', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    // 1. Initial auth status without cookie
    const statusRes = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?auth=status`);
    assert.equal(statusRes.status, 200);
    const statusData = await statusRes.json();
    assert.equal(statusData.ok, true);
    assert.equal(statusData.authenticated, false);

    // 2. Reject state push without key
    const unauthPush = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${ROOM}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ promptId: 'p000001', fraction: 0 }),
    });
    assert.equal(unauthPush.status, 403);

    // 3. Claim control with master key
    const claimRes = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${ROOM}&control=claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
      },
      body: JSON.stringify({
        sessionId: 'master-session-alpha',
        force: false,
      }),
    });
    assert.equal(claimRes.status, 200);
    const claimData = await claimRes.json();
    assert.equal(claimData.ok, true);
    assert.equal(claimData.takenOver, false);
    assert.ok(typeof claimData.serverTime === 'number', 'serverTime must be present');

    // Verify auth cookie was set
    const setCookie = claimRes.headers.get('set-cookie');
    assert.ok(setCookie && setCookie.includes('tp_auth_master'), 'Must issue tp_auth_master cookie');
  });

  test('Race Condition: 5 clients simultaneously race to claim master control', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const raceRoom = 'race_room_' + Date.now();

    // 5 clients send claim requests at the exact same moment with force: false
    const claims = Array.from({ length: 5 }, (_, i) => {
      return fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${raceRoom}&control=claim`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Teleprompter-Key': MASTER_PASSWORD,
        },
        body: JSON.stringify({
          sessionId: `race-master-session-${i}`,
          force: false,
        }),
      }).then(async (r) => ({
        status: r.status,
        data: await r.json(),
      }));
    });

    const results = await Promise.all(claims);

    const winners = results.filter((r) => r.status === 200);
    const conflicts = results.filter((r) => r.status === 409);

    assert.equal(winners.length, 1, 'Exactly one master must win the simultaneous claim race');
    assert.equal(conflicts.length, 4, 'The other 4 candidates must receive 409 Conflict');

    for (const c of conflicts) {
      assert.equal(c.data.ok, false);
      assert.equal(c.data.active, true);
      assert.equal(c.data.error, 'Another master is active');
    }
  });

  test('Forced takeover: New master can steal lease with force=true', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const takeoverRoom = 'takeover_room_' + Date.now();

    // 1. Initial claim by Master 1
    const claim1 = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${takeoverRoom}&control=claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
      },
      body: JSON.stringify({
        sessionId: 'master-one',
        force: false,
      }),
    });
    assert.equal(claim1.status, 200);

    // 2. Master 1 pushes state successfully
    const push1 = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${takeoverRoom}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
        'X-Teleprompter-Master-Session': 'master-one',
      },
      body: JSON.stringify({
        promptId: 'p000001',
        fraction: 0.25,
        sequence: 1,
      }),
    });
    assert.equal(push1.status, 200);

    // 3. Master 2 takes over with force: true
    const claim2 = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${takeoverRoom}&control=claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
      },
      body: JSON.stringify({
        sessionId: 'master-two',
        force: true,
      }),
    });
    assert.equal(claim2.status, 200);
    const claim2Data = await claim2.json();
    assert.equal(claim2Data.takenOver, true, 'takenOver must be true on forced claim');

    // 4. Master 1 attempts to push state again -> Rejected with 409 "Master control lost"
    const pushZombie = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${takeoverRoom}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
        'X-Teleprompter-Master-Session': 'master-one',
      },
      body: JSON.stringify({
        promptId: 'p000001',
        fraction: 0.5,
        sequence: 2,
      }),
    });
    assert.equal(pushZombie.status, 409);
    const zombieData = await pushZombie.json();
    assert.equal(zombieData.ok, false);
    assert.equal(zombieData.error, 'Master control lost');
  });

  test('GET /scripts/teleprompter_sync.php follower polling contract', async (t) => {
    if (!server || server.workers.length === 0) return t.skip('PHP server unavailable');
    const pollRoom = 'poll_room_' + Date.now();

    // 1. Uninitialized room returns null state with current serverTime
    const initialGet = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${pollRoom}`);
    assert.equal(initialGet.status, 200);
    const initialData = await initialGet.json();
    assert.equal(initialData.ok, true);
    assert.equal(initialData.state, null);
    assert.ok(typeof initialData.serverTime === 'number');

    // 2. Claim and push state
    await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${pollRoom}&control=claim`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
      },
      body: JSON.stringify({ sessionId: 'poll-master' }),
    });

    await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${pollRoom}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Teleprompter-Key': MASTER_PASSWORD,
        'X-Teleprompter-Master-Session': 'poll-master',
      },
      body: JSON.stringify({
        script: 'pirates_test',
        promptId: 'p000005',
        fraction: 0.42,
        speed: 1.0,
        paused: false,
        sequence: 10,
      }),
    });

    // 3. Follower polls state
    const followGet = await fetch(`${server.baseUrl}/scripts/teleprompter_sync.php?room=${pollRoom}`);
    assert.equal(followGet.status, 200);
    const followData = await followGet.json();
    assert.equal(followData.ok, true);
    assert.ok(followData.state, 'state object must be present');
    assert.equal(followData.state.script, 'pirates_test');
    assert.equal(followData.state.promptId, 'p000005');
    assert.equal(followData.state.fraction, 0.42);
    assert.equal(followData.state.sequence, 10);
    assert.ok(typeof followData.state.serverTime === 'number', 'state.serverTime must be stamped by server');
    assert.ok(typeof followData.serverTime === 'number', 'response.serverTime must reflect server clock');
  });
});
