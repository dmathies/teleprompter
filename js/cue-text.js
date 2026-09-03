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
