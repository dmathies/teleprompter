export function cueTextNodes(block) {
  const nodes = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest('.cue-markers, .cue-connector-layer')) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

export function cueWordEntries(block) {
  const entries = [];
  let index = 0;
  for (const node of cueTextNodes(block)) {
    const text = node.nodeValue || '';
    const re = /\S+/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      entries.push({index:index++, node, start:match.index, end:match.index + match[0].length, text:match[0]});
    }
  }
  return entries;
}

export function wrapCueTriggerWord(block, cue, color) {
  const anchor = cue && cue.anchor;
  if (!anchor || anchor.type !== 'word') return null;
  const targetIndex = Number(anchor.wordIndex);
  if (!Number.isInteger(targetIndex) || targetIndex < 0) return null;
  const existing = block.querySelector('.cue-trigger-word[data-word-index="' + CSS.escape(String(targetIndex)) + '"]');
  if (existing) return existing;
  const entry = cueWordEntries(block).find(e => e.index === targetIndex);
  if (!entry) return null;
  const range = document.createRange();
  range.setStart(entry.node, entry.start);
  range.setEnd(entry.node, entry.end);
  const span = document.createElement('span');
  span.className = 'cue-trigger-word';
  span.dataset.wordIndex = String(targetIndex);
  span.style.setProperty('--cue-color', color);
  try { range.surroundContents(span); } catch (_) { return null; }
  return span;
}

// A word cue belongs next to the selected word, even inside a long monologue.
// A span remains valid within dialogue/lyrics spans; CSS makes it a full row.
export function cueMarkerHolder(block, trigger = null, className = 'cue-markers') {
  if (trigger) {
    const previous = trigger.previousSibling;
    if (previous?.nodeType === 1 && previous.classList.contains(className) && previous.dataset.cuePlacement === 'word') return previous;
    const holder = block.ownerDocument.createElement('span');
    holder.className = className;
    holder.dataset.cuePlacement = 'word';
    trigger.before(holder);
    return holder;
  }
  let holder = block.querySelector(':scope > .' + className + '[data-cue-placement="block"]');
  if (!holder) {
    holder = block.ownerDocument.createElement('div');
    holder.className = className;
    holder.dataset.cuePlacement = 'block';
    block.insertBefore(holder, block.firstChild);
  }
  return holder;
}

export function cueWordOffset(block, cue, triggerClass = 'cue-trigger-word') {
  if (cue?.anchor?.type !== 'word') return null;
  const index = Number(cue.anchor.wordIndex);
  if (!Number.isInteger(index) || index < 0) return null;
  const trigger = block.querySelector('.' + triggerClass + '[data-word-index="' + CSS.escape(String(index)) + '"]');
  if (!trigger) return null;
  const rect = trigger.getBoundingClientRect();
  return rect.top - block.getBoundingClientRect().top + rect.height * .5;
}

// Stage-direction margins belong to the script text, not its cue graphics.
// Measure in the final layout so em-sized indents and annotation margins work
// across font sizes, and never extend a cue into the other singer's column.
export function alignCueRows(root, className = 'cue-markers', stageOnly = false) {
  for (const holder of root.querySelectorAll('.' + className)) {
    if ((stageOnly && !holder.closest('.stage-direction,.stage-inline')) || !holder.getClientRects().length) continue;
    const boundary = holder.closest('.lyrics-column') || root;
    const style = getComputedStyle(boundary);
    const paddingLeft = parseFloat(style.paddingLeft) || 0;
    const paddingRight = parseFloat(style.paddingRight) || 0;
    const left = boundary.getBoundingClientRect().left + (parseFloat(style.borderLeftWidth) || 0) + paddingLeft;
    holder.style.width = Math.max(1, boundary.clientWidth - paddingLeft - paddingRight) + 'px';
    holder.style.marginLeft = '0px';
    holder.style.marginRight = '0px';
    holder.style.marginLeft = (left - holder.getBoundingClientRect().left) + 'px';
  }
}
