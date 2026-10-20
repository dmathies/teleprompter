import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PhpTestServer} from './harness/php-server.js';

let server;
before(async () => { server = new PhpTestServer({port: 5700}); await server.start(); });
after(async () => { await server?.stop(); });
const hash = html => createHash('sha256').update(html).digest('hex');
const request = async (action, data, department = 'LX', password = 'CHANGE-ME-LX') => {
  const response = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=${action}`, {
    method: 'POST', headers: {'Content-Type': 'application/json', 'X-Cue-Key': password},
    body: JSON.stringify({script: 'pirates_test', department, ...data}),
  });
  return {status: response.status, body: await response.json()};
};
const ann = (revision, prompt = 'p000001') => ({id: 'lx-resilience', type: 'stroke', prompt,
  color: '#ffeb3b', width: 3, fontPx: 42, coordMode: 'line', lineHeightPx: 58,
  points: [[.1,.2],[.2,.3]], pressures: [.5,.7], sourceRevision: revision,
  anchor: {prompt, blockText: 'Original speech', speaker: 'GRETEL'}});

test('revision snapshots, stale saves, migration, recovery, and concurrent edits', async () => {
  const file = path.join(server.rootDir, 'show-scripts/pirates_test_script.html');
  const original = fs.readFileSync(file, 'utf8');
  const revision = hash(original);
  const response = await fetch(`${server.baseUrl}/scripts/get_script.php?id=pirates_test`);
  assert.equal(response.headers.get('x-script-revision'), revision);
  const saved = await request('save', {mutationId: 'retry-safe-save', sourceRevision: revision, annotation: ann(revision)});
  assert.equal(saved.status, 200);
  assert.equal(saved.body.annotations[0].anchor.blockText, 'Original speech');
  const retry = await request('save', {mutationId: 'retry-safe-save', sourceRevision: revision, annotation: ann(revision)});
  assert.equal(retry.body.revision, saved.body.revision);
  const snapshot = await request('snapshot', {sourceRevision: revision});
  assert.equal(snapshot.body.html, original);
  assert.equal((await request('snapshot', {sourceRevision: revision}, 'SND', 'wrong')).status, 403);

  const revised = original + '\n<div data-prompt-id="p999999">Original speech</div>';
  fs.writeFileSync(file, revised);
  const next = hash(revised);
  const stale = await request('save', {sourceRevision: revision, annotation: ann(revision)});
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'script_changed');
  assert.equal((await request('snapshot', {sourceRevision: revision})).body.html, original);
  const legacy = {...ann(revision)}; delete legacy.sourceRevision; delete legacy.anchor;
  assert.equal((await request('save', {annotation: legacy})).status, 409);

  const placements = [{id: 'lx-resilience', prompt: 'p999999', anchor: {prompt: 'p999999', blockText: 'Original speech'}}];
  assert.equal((await request('migrate', {sourceRevision: next, expectedRevision: 999, placements})).status, 409);
  assert.equal((await request('migrate', {sourceRevision: next, expectedRevision: saved.body.revision, placements: []})).status, 400);
  const migrated = await request('migrate', {sourceRevision: next, expectedRevision: saved.body.revision, placements});
  assert.equal(migrated.status, 200);
  assert.equal(migrated.body.annotations[0].prompt, 'p999999');
  assert.deepEqual(migrated.body.annotations[0].points, ann(revision).points);
  assert.deepEqual(migrated.body.annotations[0].pressures, ann(revision).pressures);
  const lostResponseRetry = await request('save', {mutationId: 'retry-safe-save', sourceRevision: revision, annotation: ann(revision)});
  assert.equal(lostResponseRetry.body.annotations[0].prompt, 'p999999');
  const restored = await request('restore', {sourceRevision: next, expectedRevision: migrated.body.revision});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.annotations[0].prompt, 'p000001');
  assert.equal(restored.body.annotations[0].sourceRevision, revision);

  const unresolved = await request('migrate', {sourceRevision: next, expectedRevision: restored.body.revision,
    placements: [{id: 'lx-resilience', prompt: ''}]});
  assert.equal(unresolved.status, 200);
  assert.equal(unresolved.body.annotations[0].unresolved, true);
  const edited = await request('save', {sourceRevision: next, annotation: ann(next, 'p999999')});
  assert.equal(edited.status, 200);
  const conflict = await request('save', {sourceRevision: next, baseUpdatedAt: 0, annotation: ann(next, 'p999999')});
  assert.equal(conflict.status, 409);
  assert.equal((await request('restore', {sourceRevision: next, expectedRevision: edited.body.revision})).status, 409);
  const deleted = await request('delete', {sourceRevision: next, id: 'lx-resilience', baseUpdatedAt: edited.body.annotations[0].updatedAt});
  assert.equal(deleted.status, 200);
  const resurrect = await request('save', {sourceRevision: next, baseUpdatedAt: edited.body.annotations[0].updatedAt, annotation: ann(next, 'p999999')});
  assert.equal(resurrect.status, 409);
  assert.equal(resurrect.body.code, 'annotation_deleted');
  const doc = await fetch(`${server.baseUrl}/scripts/annotation_api.php?action=get&script=pirates_test&dept=LX`).then(r => r.json());
  assert.equal(doc.history, undefined);
  assert.equal(doc.currentScriptRevision, next);
});
