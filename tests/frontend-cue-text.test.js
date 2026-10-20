import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

if (typeof globalThis.CSS === 'undefined') {
  globalThis.CSS = {
    escape: (val) => String(val).replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, '\\$1')
  };
}

// Minimal DOM mock for TreeWalker and text extraction
class MockTextNode {
  constructor(text, parent) {
    this.nodeType = 3; // Node.TEXT_NODE
    this.nodeValue = text;
    this.parentElement = parent;
  }
}

class MockElement {
  constructor(tagName, parent = null) {
    this.nodeType = 1; // Node.ELEMENT_NODE
    this.tagName = tagName.toUpperCase();
    this.parentElement = parent;
    this.children = [];
    this.attributes = new Map();
    this.dataset = {};
    this.style = {
      setProperty(key, val) { this[key] = val; }
    };
    this.className = '';
  }

  closest(selector) {
    if (selector.includes('.cue-markers') && this.className.includes('cue-markers')) return this;
    if (selector.includes('.cue-connector-layer') && this.className.includes('cue-connector-layer')) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }

  querySelector(selector) {
    const match = selector.match(/\[data-word-index="([^"]+)"\]/);
    if (match) {
      const idx = match[1];
      return this.children.find(c => c.dataset && c.dataset.wordIndex === idx) || null;
    }
    return null;
  }

  ownerDocument = {
    createElement: (tag) => new MockElement(tag)
  };
}

// Mock document.createTreeWalker
if (typeof globalThis.document === 'undefined') {
  globalThis.NodeFilter = {
    SHOW_TEXT: 4,
    FILTER_ACCEPT: 1,
    FILTER_REJECT: 2,
    FILTER_SKIP: 3,
  };

  globalThis.document = {
    createElement(tag) {
      return new MockElement(tag);
    },
    createTreeWalker(root, whatToShow, filter) {
      const allTextNodes = [];
      function collect(node) {
        for (const child of node.children) {
          if (child.nodeType === 3) {
            if (!filter || filter.acceptNode(child) === NodeFilter.FILTER_ACCEPT) {
              allTextNodes.push(child);
            }
          } else if (child.nodeType === 1) {
            collect(child);
          }
        }
      }
      collect(root);
      let idx = -1;
      return {
        currentNode: null,
        nextNode() {
          idx++;
          if (idx < allTextNodes.length) {
            this.currentNode = allTextNodes[idx];
            return this.currentNode;
          }
          return null;
        }
      };
    },
    createRange() {
      return {
        setStart(node, start) { this.startNode = node; this.start = start; },
        setEnd(node, end) { this.endNode = node; this.end = end; },
        surroundContents(span) {
          this.surrounded = span;
        }
      };
    }
  };
}

import { cueTextNodes, cueWordEntries, wrapCueTriggerWord, cueWordOffset, alignCueRows } from '../js/cue-text.js';

describe('Frontend Cue Text & Trigger Wrapping (js/cue-text.js)', () => {
  function createSampleBlock() {
    const block = new MockElement('div');
    block.dataset.promptId = 'p000001';

    // <span class="character">FREDERIC:</span>
    const charSpan = new MockElement('span', block);
    charSpan.className = 'character';
    const charText = new MockTextNode('FREDERIC:', charSpan);
    charSpan.children.push(charText);
    block.children.push(charSpan);

    // <span class="dialog">Pour, oh pour the pirate sherry!</span>
    const dialogSpan = new MockElement('span', block);
    dialogSpan.className = 'dialog';
    const dialogText = new MockTextNode('Pour, oh pour the pirate sherry!', dialogSpan);
    dialogSpan.children.push(dialogText);
    block.children.push(dialogSpan);

    return { block, charText, dialogText };
  }

  test('cueTextNodes extracts text nodes and ignores cue overlays', () => {
    const { block, charText, dialogText } = createSampleBlock();

    // Add marker overlay that should be filtered out
    const marker = new MockElement('div', block);
    marker.className = 'cue-markers';
    const markerText = new MockTextNode('LX 12', marker);
    marker.children.push(markerText);
    block.children.push(marker);

    const nodes = cueTextNodes(block);
    assert.equal(nodes.length, 2);
    assert.equal(nodes[0], charText);
    assert.equal(nodes[1], dialogText);
  });

  test('cueWordEntries enumerates words with accurate character ranges and indices', () => {
    const { block } = createSampleBlock();
    const entries = cueWordEntries(block);

    assert.equal(entries.length, 7);
    // Index 0: FREDERIC:
    assert.deepEqual(entries[0], {
      index: 0,
      node: entries[0].node,
      start: 0,
      end: 9,
      text: 'FREDERIC:'
    });

    // Index 1: Pour,
    assert.deepEqual(entries[1], {
      index: 1,
      node: entries[1].node,
      start: 0,
      end: 5,
      text: 'Pour,'
    });

    // Index 2: oh
    assert.deepEqual(entries[2], {
      index: 2,
      node: entries[2].node,
      start: 6,
      end: 8,
      text: 'oh'
    });

    // Index 6: sherry!
    assert.deepEqual(entries[6], {
      index: 6,
      node: entries[6].node,
      start: 25,
      end: 32,
      text: 'sherry!'
    });
  });

  test('wrapCueTriggerWord finds target word and surrounds it with trigger styling', () => {
    const { block } = createSampleBlock();
    const cue = {
      anchor: {
        type: 'word',
        wordIndex: 1, // "Pour,"
        text: 'Pour,'
      }
    };

    const span = wrapCueTriggerWord(block, cue, '#ffd000');
    assert.ok(span);
    assert.equal(span.className, 'cue-trigger-word');
    assert.equal(span.dataset.wordIndex, '1');
    assert.equal(span.style['--cue-color'], '#ffd000');
  });

  test('wrapCueTriggerWord ignores paragraph cues or invalid word indices', () => {
    const { block } = createSampleBlock();
    assert.equal(wrapCueTriggerWord(block, { anchor: { type: 'paragraph' } }, '#ffd000'), null);
    assert.equal(wrapCueTriggerWord(block, { anchor: { type: 'word', wordIndex: -1 } }, '#ffd000'), null);
    assert.equal(wrapCueTriggerWord(block, { anchor: { type: 'word', wordIndex: 999 } }, '#ffd000'), null);
    assert.equal(wrapCueTriggerWord(block, null, '#ffd000'), null);
  });

  test('word cue position uses its rendered line within a long semantic block', () => {
    const {block} = createSampleBlock();
    block.getBoundingClientRect = () => ({top: 100});
    const trigger = new MockElement('span', block);
    trigger.dataset.wordIndex = '6';
    trigger.getBoundingClientRect = () => ({top: 940, height: 42});
    block.children.push(trigger);
    const cue = {anchor: {type: 'word', wordIndex: 6}};
    assert.equal(cueWordOffset(block, cue), 861);
    // Responsive reflow changes the location without changing the saved cue.
    trigger.getBoundingClientRect = () => ({top: 1500, height: 64});
    assert.equal(cueWordOffset(block, cue), 1432);
    assert.equal(cueWordOffset(block, {anchor: {type: 'word', wordIndex: 99}}), null);
    assert.equal(cueWordOffset(block, {anchor: {type: 'paragraph'}}), null);
  });

  test('stage cue alignment removes text indentation without accumulating on reflow', t => {
    const originalStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({paddingLeft:'4px',paddingRight:'4px',borderLeftWidth:'0px'});
    t.after(() => { globalThis.getComputedStyle = originalStyle; });
    const holder = {style:{}, closest: selector => selector.includes('stage-direction') ? {} : null,
      getClientRects: () => [{}], getBoundingClientRect() {return {left:80+(parseFloat(this.style.marginLeft)||0)};} };
    const normal = {style:{},closest:()=>null};
    const root = {clientWidth:800,getBoundingClientRect:()=>({left:10}),querySelectorAll:()=>[holder,normal]};
    alignCueRows(root, 'cue-markers', true);
    assert.equal(holder.style.width, '792px');
    assert.equal(holder.getBoundingClientRect().left, 14);
    alignCueRows(root, 'cue-markers', true);
    assert.equal(holder.getBoundingClientRect().left, 14);
    root.clientWidth = 390;
    alignCueRows(root, 'cue-markers', true);
    assert.equal(holder.style.width, '382px');
    assert.deepEqual(normal.style, {});
  });

  test('stage cues within paired lyrics stay inside their own singer column', t => {
    const originalStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({paddingLeft:'12px',paddingRight:'8px',borderLeftWidth:'2px'});
    t.after(() => { globalThis.getComputedStyle = originalStyle; });
    const column = {clientWidth:300,getBoundingClientRect:()=>({left:400})};
    const holder = {style:{},closest:selector=>selector==='.lyrics-column'?column:{},getClientRects:()=>[{}],
      getBoundingClientRect(){return {left:460+(parseFloat(this.style.marginLeft)||0)}}};
    alignCueRows({querySelectorAll:()=>[holder]}, 'cue-markers', true);
    assert.equal(holder.style.width, '280px');
    assert.equal(holder.getBoundingClientRect().left, 414);
  });
});
