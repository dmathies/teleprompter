import { ANCHOR_VERSION } from './annotation-migration.js';

// Index the pristine fragment, before cue decorations or annotations exist.
export function indexScript(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const normalize = value => (value || '').normalize('NFC').replace(/\s+/gu, ' ').trim();
  const elements = [...doc.querySelectorAll('[data-prompt-id]')];
  const styles = [...doc.querySelectorAll('style')].map(el => el.textContent).join('\n');
  let offset = 0, act = '', scene = '';
  const blocks = elements.map((el, blockIndex) => {
    act = el.dataset.act || act;
    scene = el.dataset.scene || scene;
    const clone = el.cloneNode(true);
    // Nested semantic blocks are indexed independently, never counted twice.
    clone.querySelectorAll('[data-prompt-id],script,style').forEach(node => node.remove());
    const blockText = normalize(clone.textContent);
    const structureNode = clone.cloneNode(true);
    structureNode.removeAttribute('data-prompt-id');
    structureNode.removeAttribute('data-page');
    const block = { prompt: el.dataset.promptId, blockText, blockIndex, act, scene,
      speaker: normalize(el.querySelector('.character,.lyrics-speaker')?.textContent),
      structure: structureNode.outerHTML, start: offset, end: offset + blockText.length };
    offset = block.end + 1;
    return block;
  });
  blocks.forEach((block, i) => {
    block.previousText = blocks[i - 1]?.blockText || '';
    block.nextText = blocks[i + 1]?.blockText || '';
  });
  return { version: ANCHOR_VERSION, blocks, styles, text: blocks.map(b => b.blockText).join('\n') };
}

export function captureAnchor(index, annotation) {
  const block = index?.blocks.find(b => b.prompt === annotation.prompt);
  if (!block) return null;
  // Conservative: any ink outside its anchor's first line needs human review
  // after a script change. Margin notes remain associated with their block.
  const points = annotation.points || [annotation.from, annotation.to, annotation.at].filter(Boolean);
  return { ...block, styles: index.styles,
    spansBlocks: points.some(point => point[1] < 0 || point[1] > 1) };
}
