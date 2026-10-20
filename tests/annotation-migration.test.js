import {test} from 'node:test';
import assert from 'node:assert/strict';
import {planAnnotationMigration, isAnnotationVisible} from '../js/annotation-migration.js';

const block = (prompt, text, overrides = {}) => ({prompt, blockText: text, speaker: 'GRETEL',
  previousText: 'before', nextText: 'after', structure: '<div>same</div>', ...overrides});
const anchor = block('p000001', 'We must leave tomorrow before the witch returns.', {styles: '', spansBlocks: false});
const annotation = {id: 'ann-1', prompt: anchor.prompt, sourceRevision: 'old', anchor,
  points: [[.1, .2], [.3, .5]], pressures: [.2, .7]};
const plan = (blocks, ann = annotation, styles = '') => planAnnotationMigration([ann], {blocks, styles}, 'new')[0];

test('moved and renumbered unchanged dialogue retains geometry without mutating input', () => {
  const before = JSON.stringify(annotation);
  const result = plan([block('p000099', anchor.blockText)]);
  assert.equal(result.status, 'matched');
  assert.equal(result.prompt, 'p000099');
  assert.equal(JSON.stringify(annotation), before);
  assert.deepEqual(result.annotation.points, annotation.points);
  assert.deepEqual(result.annotation.pressures, annotation.pressures);
});
test('ID reuse does not identify unrelated dialogue', () => {
  assert.equal(plan([block('p000001', 'A completely different speech')]).status, 'unmatched');
});
test('repeated lyrics never resolve by proximity alone', () => {
  assert.equal(plan([block('p000002', anchor.blockText), block('p000003', anchor.blockText)]).status, 'review');
});
test('neighbours disambiguate repeated dialogue', () => {
  const result = plan([block('p000002', anchor.blockText), block('p000003', anchor.blockText, {previousText: 'different'})]);
  assert.equal(result.prompt, 'p000002');
});
test('changed styling, block HTML, speaker, and cross-block ink do not auto-migrate', () => {
  assert.equal(plan([block('p000002', anchor.blockText)], annotation, 'new CSS').status, 'review');
  assert.equal(plan([block('p000002', anchor.blockText, {structure: '<p>changed</p>'})]).status, 'review');
  assert.notEqual(plan([block('p000002', anchor.blockText, {speaker: 'WITCH'})]).status, 'matched');
  assert.equal(plan([block('p000002', anchor.blockText)], {...annotation, anchor: {...anchor, spansBlocks: true}}).status, 'review');
});
test('legacy and deleted targets remain recoverable', () => {
  assert.equal(plan([], {...annotation, anchor: undefined}).status, 'review');
  assert.equal(plan([]).status, 'unmatched');
});
test('edited passages receive manual suggestions, never automatic relocation', () => {
  const result = plan([block('p000002', 'We must leave today before the witch returns.')]);
  assert.equal(result.status, 'review');
  assert.equal(result.candidates.length, 1);
});
test('split passages are located across the whole script for review', () => {
  const text = anchor.blockText;
  const split = text.indexOf('before');
  const blocks = [block('p000002', text.slice(0, split), {start: 0, end: split}),
    block('p000003', text.slice(split), {start: split, end: text.length})];
  const result = planAnnotationMigration([annotation], {blocks, styles: '', text}, 'new')[0];
  assert.equal(result.status, 'review');
  assert.equal(result.candidates.length, 2);
});
test('duplicate IDs fail closed and unresolved or stale records are hidden', () => {
  assert.throws(() => plan([block('p000001', 'x'), block('p000001', 'y')]), /Duplicate/);
  assert.equal(isAnnotationVisible(annotation, 'new'), false);
  assert.equal(isAnnotationVisible({...annotation, sourceRevision: 'new'}, 'new'), true);
  assert.equal(isAnnotationVisible({...annotation, sourceRevision: 'new', unresolved: true}, 'new'), false);
  assert.equal(isAnnotationVisible({prompt: 'p000001'}, 'new'), true);
  assert.equal(isAnnotationVisible({prompt: 'p000001'}, 'new', new Set(['p000002'])), false);
});
