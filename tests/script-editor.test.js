import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {PhpTestServer} from './harness/php-server.js';
import {newScriptEditorBlock, scriptEditorOperations} from '../js/script-editor-draft.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const row = id => ({id, page: '4', fields: [{key: '0', label: 'Text', value: 'Original'}]});

test('draft retains existing IDs and orders consecutive insertions before the first block', () => {
    const originals = [row('p000010'), row('p000011')];
    const a = newScriptEditorBlock('new-1', 'dialogue', originals[0]);
    const b = newScriptEditorBlock('new-2', 'lyrics', originals[0]);
    a.fields[1].value = 'New dialogue'; b.fields[1].value = 'First line\nSecond line';
    const edited = {...originals[0], fields: [{...originals[0].fields[0], value: 'Corrected'}]};
    const ops = scriptEditorOperations([a, b, edited, originals[1]], originals);
    assert.deepEqual(ops.map(op => [op.action, op.target, op.side]), [
        ['insert', 'p000010', 'before'], ['insert', 'new-1', 'after'], ['update', 'p000010', undefined]
    ]);
    assert.equal(ops[1].text, 'First line\nSecond line');
    assert.deepEqual(ops[2].fields, {'0': 'Corrected'});
    assert.deepEqual(scriptEditorOperations(originals, originals), []);
    assert.equal(originals[0].fields[0].value, 'Original');
    const changed = {...originals[0], kind: 'lyrics'};
    assert.deepEqual(scriptEditorOperations([changed, originals[1]], originals), [
        {action: 'change-type', target: 'p000010', kind: 'lyrics'}
    ]);
});

let server;
before(async () => { server = new PhpTestServer({port: 5800}); await server.start(); });
after(async () => { await server?.stop(); });

test('script editor enforces PRM access, preserves anchors/markup, backs up, and rejects stale writes', async () => {
    const file = path.join(server.rootDir, 'show-scripts/pirates_test_script.html');
    const source = '<style>.lyrics{color:gold}</style>\n' +
        '<div class="cue" data-prompt-id="p000010" data-page="4" data-act="Act I"><span class="character">ALICE:</span> <span class="dialog">Café &amp; tea<br>Second line <em>softly</em>.</span></div>\n' +
        '<div class="two-column-lyrics" data-prompt-id="p000020" data-page="4"><div class="lyrics-column"><span class="lyrics-speaker">A</span><div class="lyrics">One<br>Two</div></div><div class="lyrics-column"><span class="lyrics-speaker">B</span><div class="lyrics">Three</div></div></div>';
    fs.writeFileSync(file, source);
    const endpoint = `${server.baseUrl}/scripts/script_editor_api.php`;
    const get = key => fetch(endpoint + '?script=pirates_test', {headers: {'X-Teleprompter-Key': key}});
    const post = (body, key = 'CHANGE-ME-MASTER') => fetch(endpoint, {method: 'POST',
        headers: {'Content-Type': 'application/json', 'X-Teleprompter-Key': key}, body: JSON.stringify({script: 'pirates_test', ...body})});
    assert.equal((await get('')).status, 403);
    assert.equal((await get('CHANGE-ME-LX')).status, 403);
    const response = await get('CHANGE-ME-MASTER');
    assert.equal(response.status, 200);
    const model = await response.json();
    assert.equal(model.revision, hash(source));
    assert.equal(model.blocks[0].fields[0].value, 'ALICE:');
    assert.ok(model.blocks[0].fields.some(field => field.value === 'softly'));
    assert.ok(model.blocks[1].fields.some(field => field.value === 'One\nTwo'));
    const operations = [
        {action: 'update', target: 'p000010', fields: {'0': 'BOB:'}},
        {action: 'change-type', target: 'p000010', kind: 'lyrics'},
        {action: 'insert', key: 'new-1', target: 'p000010', side: 'after', kind: 'dialogue', speaker: 'CAROL:', text: 'Corrected <script>alert(1)</script> & café'},
        {action: 'insert', key: 'new-2', target: 'new-1', side: 'after', kind: 'lyrics', speaker: 'ALL', text: 'First line\nSecond line'},
        {action: 'insert', key: 'new-3', target: 'p000010', side: 'before', kind: 'paragraph', text: 'Opening paragraph'}
    ];
    assert.equal((await post({expectedRevision: model.revision, operations}, 'CHANGE-ME-LX')).status, 403);
    const savedResponse = await post({expectedRevision: model.revision, operations});
    assert.equal(savedResponse.status, 200);
    const saved = await savedResponse.json();
    assert.deepEqual(saved.ids, {'new-1': 'p000021', 'new-2': 'p000022', 'new-3': 'p000023'});
    const output = fs.readFileSync(file, 'utf8');
    assert.equal(saved.revision, hash(output));
    assert.match(output, /<em>softly<\/em>/);
    assert.match(output, /<style>\.lyrics\{color:gold\}<\/style>/);
    assert.match(output, /&lt;script&gt;/);
    assert.ok(!output.includes('<script>'));
    assert.match(output, /First line<br>Second line/);
    assert.match(output, /Café &amp; tea/);
    assert.match(output, /class="lyrics-block" data-prompt-id="p000010"[^>]*><span class="lyrics-speaker">BOB:<\/span> <div class="lyrics">Café &amp; tea<br>Second line <em>softly<\/em>\.<\/div><\/div>/);
    assert.match(output, /data-prompt-id="p000021" data-page="4" data-act="Act I"/);
    assert.deepEqual([...output.matchAll(/data-prompt-id="(.*?)"/g)].map(item => item[1]),
        ['p000023', 'p000010', 'p000021', 'p000022', 'p000020']);
    const backup = path.join(server.rootDir, 'scripts/teleprompter_state/script_revisions/pirates_test');
    assert.equal(fs.readFileSync(path.join(backup, model.revision + '.html'), 'utf8'), source);
    const stale = await post({expectedRevision: model.revision, operations});
    assert.equal(stale.status, 409);
    assert.equal(fs.readFileSync(file, 'utf8'), output);
    assert.equal((await post({expectedRevision: saved.revision, operations: [{action: 'delete', target: 'p000010'}]})).status, 400);
    assert.equal((await post({expectedRevision: saved.revision, operations: [{action: 'update', target: 'p000010', fields: {'999': 'bad'}}]})).status, 400);
    assert.equal(fs.readFileSync(file, 'utf8'), output);
    const sync = await fetch(server.baseUrl + '/scripts/teleprompter_sync.php?room=main').then(res => res.json());
    assert.equal(sync.scriptRevisions.pirates_test.revision, saved.revision);
    const refreshed = await get('CHANGE-ME-MASTER').then(res => res.json());
    assert.equal(refreshed.blocks.find(block => block.id === 'p000022').fields[1].value, 'First line\nSecond line');
    assert.equal(refreshed.blocks.find(block => block.id === 'p000010').kind, 'lyrics');
    assert.equal((await post({expectedRevision: saved.revision, operations: []})).status, 200);
    assert.equal(fs.readFileSync(file, 'utf8'), output);
    const competing = await Promise.all(['DAVE:', 'ERIN:'].map(value => post({expectedRevision: saved.revision,
        operations: [{action: 'update', target: 'p000010', fields: {'0': value}}]})));
    assert.deepEqual(competing.map(res => res.status).sort(), [200, 409]);
    const latest = await get('CHANGE-ME-MASTER').then(res => res.json());
    const reversedResponse = await post({expectedRevision: latest.revision,
        operations: [{action: 'change-type', target: 'p000010', kind: 'dialogue'}]});
    assert.equal(reversedResponse.status, 200);
    const reversed = await fs.promises.readFile(file, 'utf8');
    assert.match(reversed, /class="cue" data-prompt-id="p000010"[^>]*><span class="character">(?:DAVE|ERIN):<\/span> <span class="dialog">Café &amp; tea<br>Second line <em>softly<\/em>\.<\/span><\/div>/);
    fs.writeFileSync(file, source + '<div data-prompt-id="p000010">duplicate</div>');
    assert.equal((await get('CHANGE-ME-MASTER')).status, 500);
});
