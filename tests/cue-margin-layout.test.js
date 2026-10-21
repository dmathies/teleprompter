import {test} from 'node:test';
import assert from 'node:assert/strict';
import {packCueLabels, cueMarginPixels} from '../js/cue-margin-layout.js';

test('multiple cues on the same text line receive distinct non-overlapping slots', () => {
  const input=[{id:'first',y:100,height:30},{id:'second',y:100,height:42},{id:'third',y:100,height:20}];
  const before=JSON.stringify(input);
  const result=packCueLabels(input,{bottom:500});
  assert.deepEqual(result.map(item=>item.id),['first','second','third']);
  for(let i=1;i<result.length;i++) assert.ok(result[i].top>=result[i-1].top+result[i-1].height+4);
  assert.equal(JSON.stringify(input),before);
});
test('collisions are resolved across consecutive script blocks, not just within one block', () => {
  const result=packCueLabels([{block:1,y:50,height:60},{block:2,y:55,height:60}],{bottom:500});
  assert.ok(result[1].top>=result[0].top+64);
});
test('late page cues are packed upward when they fit in the page margin', () => {
  const result=packCueLabels([{y:195,height:30},{y:198,height:30}],{top:10,bottom:200});
  assert.ok(result[0].top>=10);
  assert.ok(result[1].top>=result[0].top+34);
  assert.equal(result[1].top+result[1].height,200);
});
test('an overfull margin keeps all labels without overlap instead of silently dropping cues', () => {
  const result=packCueLabels(Array.from({length:10},(_,id)=>({id,y:40,height:30})),{bottom:100});
  assert.equal(result.length,10);
  assert.ok(result.at(-1).top+30>100);
  for(let i=1;i<result.length;i++) assert.ok(result[i].top>=result[i-1].top+34);
});
test('margin widths follow central percentage settings and resize correctly', () => {
  assert.equal(cueMarginPixels('20%',1000),200);
  assert.equal(cueMarginPixels('20%',390),78);
  assert.equal(cueMarginPixels('60px',390),60);
  assert.equal(cueMarginPixels('0px',390),0);
});
