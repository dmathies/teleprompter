import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PhpTestServer} from './harness/php-server.js';

function convert(input) {
  const result = spawnSync(new PhpTestServer().phpBin,
    [fileURLToPath(new URL('./harness/song-paragraphs.php', import.meta.url))], {input, encoding:'utf8', windowsHide:true});
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('song stanzas and singer changes get separate stable top-level positions', () => {
  const result = convert('<div class="lyrics-block" data-prompt-id="p000001" data-page="7"><div class="lyrics-speaker">SOLO:</div><div class="lyrics">First verse<br>last line<br> \n<br>Second verse</div><div class="lyrics-speaker">CHORUS:</div><div class="lyrics">Final verse</div></div>');
  assert.equal(result.added, 2);
  assert.deepEqual(result.rows.map(row=>row.prompt), ['p000001','p000002','p000003']);
  assert.ok(result.rows[0].text.includes('First verse'));
  assert.equal(result.rows[1].text, 'Second verse');
  assert.equal(result.rows[2].text, 'CHORUS:Final verse');
  assert.ok(result.rows.every(row=>row.page==='7'));
  assert.equal(result.idempotent, true);
  assert.equal(result.html.includes('data-song-word-origin'), false);
});

test('paired singers stay paired in independently positioned verse rows', () => {
  const result = convert('<div class="two-column-lyrics" data-prompt-id="p000050"><div class="lyrics-column"><div class="lyrics-speaker">LEFT:</div><div class="lyrics">Left one</div><div class="lyrics-speaker">LEFT:</div><div class="lyrics">Left two</div></div><div class="lyrics-column"><div class="lyrics-speaker">RIGHT:</div><div class="lyrics">Right one</div><div class="lyrics-speaker">RIGHT:</div><div class="lyrics">Right two</div></div></div>');
  assert.equal(result.added, 1);
  assert.deepEqual(result.rows[0].columns, ['LEFT:Left one', 'RIGHT:Right one']);
  assert.deepEqual(result.rows[1].columns, ['LEFT:Left two', 'RIGHT:Right two']);
  assert.equal(result.idempotent, true);
  const remapped = result.wordMap.p000050;
  assert.equal(remapped[3].prompt, 'p000051');
  assert.equal(remapped[6].prompt, 'p000050');
  assert.equal(remapped[9].prompt, 'p000051');
  assert.equal(remapped[9].wordIndex, 3);
});

test('unequal columns preserve all text with an empty partner cell', () => {
  const result = convert('<div class="two-column-lyrics" data-prompt-id="p000003"><div class="lyrics-column"><div class="lyrics">One<br><br>Two</div></div><div class="lyrics-column"><div class="lyrics">Other</div></div></div>');
  assert.deepEqual(result.rows.map(row=>row.columns), [['One','Other'],['Two','']]);
});

test('headings and ordinary dialogue remain intact; new IDs start above existing IDs', () => {
  const result = convert('<div class="song-heading lyrics-block" data-prompt-id="p000100">Song title</div><div class="cue" data-prompt-id="p000002">Dialogue<br><br>More dialogue</div><div class="lyrics-block" data-prompt-id="p000003"><div class="lyrics">Grüße<br><br>世界</div></div>');
  assert.equal(result.rows[0].text, 'Song title');
  assert.equal(result.rows[1].text, 'DialogueMore dialogue');
  assert.equal(result.rows[3].prompt, 'p000101');
  assert.equal(result.rows[3].text, '世界');
});
