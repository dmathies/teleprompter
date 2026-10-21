// Labels on a shared text line still need separate, non-overlapping margin slots.
export function packCueLabels(items, {top = 0, bottom = Infinity, gap = 4} = {}) {
  const sorted = items.map((item, order) => ({...item, order})).sort((a,b) => a.y-b.y || a.order-b.order);
  let edge = top;
  for (const item of sorted) {
    item.top = Math.max(edge, item.y - item.height / 2);
    edge = item.top + item.height + gap;
  }
  const required = sorted.reduce((sum,item) => sum + item.height, 0) + Math.max(0, sorted.length-1)*gap;
  if (sorted.length && edge-gap > bottom && required <= bottom-top) {
    edge = bottom;
    for (let i=sorted.length-1;i>=0;i--) {
      sorted[i].top = Math.min(sorted[i].top, edge-sorted[i].height);
      edge = sorted[i].top-gap;
    }
  }
  return sorted;
}

export function cueMarginPixels(value, width) {
  const number = parseFloat(value) || 0;
  return Math.max(0, value.trim().endsWith('%') ? width*number/100 : number);
}

export function setCueMarginMode(root, enabled) {
  root.classList.toggle('cue-margin-layout', enabled);
  root.querySelector(':scope > .cue-margin-leaders')?.remove();
  if (!enabled) root.style.removeProperty('--cue-margin-extra');
}

export function layoutMarginCues(root, {left = 0, right = 0, print = false, sideForBadge = () => left > 0 ? 'left' : 'right'} = {}) {
  const enabled = left > 0 || right > 0;
  setCueMarginMode(root, enabled);
  if (!enabled) return;
  root.style.setProperty('--cue-margin-extra','0px');
  const doc = root.ownerDocument;
  const rootRect = root.getBoundingClientRect(), style = getComputedStyle(root);
  const inset = parseFloat(style.paddingLeft) || 0;
  const width = root.clientWidth-inset-(parseFloat(style.paddingRight)||0);
  const topInset = parseFloat(style.paddingTop) || 0;
  const bottom = root.clientHeight-(parseFloat(style.paddingBottom)||0);
  const groups = {left:[],right:[]};
  const badgeSelector = print ? '.print-cue-marker,.print-cue-end' : '.cue-marker,.cue-end-label';
  for (const badge of root.querySelectorAll(badgeSelector)) {
    const block = badge.dataset.anchorPrompt
      ? root.querySelector('[data-prompt-id="'+CSS.escape(badge.dataset.anchorPrompt)+'"]') : badge.closest('[data-prompt-id]');
    if (!block || !badge.getClientRects().length) continue;
    let side = sideForBadge(badge);
    if (!(side === 'right' ? right : left)) side = left > 0 ? 'left' : 'right';
    const margin = side === 'left' ? left : right;
    const gutter = Math.min(16, margin*.12);
    const badgeWidth = Math.max(1, margin-gutter*2);
    badge.style.setProperty('--cue-margin-width',badgeWidth+'px');
    badge.style.setProperty('--cue-margin-padding',Math.min(4,badgeWidth*.1)+'px');
    badge.style.left = '0px'; badge.style.top = '0px';
    const base = badge.getBoundingClientRect();
    const index = badge.dataset.triggerWordIndex;
    const trigger = index !== undefined ? block.querySelector('.'+(print?'print-trigger':'cue-trigger-word')+'[data-word-index="'+CSS.escape(index)+'"]') : null;
    const rect = trigger ? (trigger.getClientRects()[0] || trigger.getBoundingClientRect()) : block.getBoundingClientRect();
    if (!rect.height) continue;
    const blockStyle = getComputedStyle(block);
    const lineHeight = parseFloat(blockStyle.lineHeight) || parseFloat(blockStyle.fontSize)*1.4;
    const fraction = Math.max(0,Math.min(1,Number(badge.dataset.anchorFraction)||0));
    const targetY = trigger ? rect.bottom+1 : rect.top+Math.min(rect.height,Math.max(lineHeight*.5,rect.height*fraction));
    const targetX = trigger ? (side === 'left' ? rect.left : rect.right) :
      (side === 'left' ? rect.left+(parseFloat(blockStyle.paddingLeft)||0) : rect.right-(parseFloat(blockStyle.paddingRight)||0));
    groups[side].push({badge,base,side,gutter,height:base.height,y:targetY-rootRect.top,
      x:inset+(side==='left'?gutter:width-right+gutter),
      targetX:targetX-rootRect.left,targetY:targetY-rootRect.top,
      row:Math.round((trigger?rect.top:targetY)/3),lineHeight, targetHeight:trigger?rect.height:lineHeight});
  }
  const svg = doc.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.classList.add('cue-margin-leaders'); svg.setAttribute('aria-hidden','true');
  let extent = bottom;
  for (const side of ['left','right']) {
    const items = packCueLabels(groups[side], {top:topInset,bottom,gap:print?3:4});
    const rows = new Map();
    for (const item of items) {
      if (!rows.has(item.row)) rows.set(item.row,[]);
      rows.get(item.row).push(item);
    }
    for (const row of rows.values()) row.forEach((item,i) => {
      // Separate leaders for different words on the same baseline. The final
      // horizontal segments sit just below the words, rather than over glyphs.
      item.targetY += i*Math.min(2,Math.max(.5,(item.lineHeight-item.targetHeight-2)/(row.length+1)));
      item.laneOffset = i*Math.min(2,Math.max(0,item.gutter-3)/Math.max(1,row.length-1));
    });
    for (const item of items) {
      const {badge,base} = item;
      extent = Math.max(extent,item.top+item.height);
      badge.style.left = (rootRect.left+item.x-base.left)+'px';
      badge.style.top = (rootRect.top+item.top-base.top)+'px';
      const edgeX = item.x+(side==='left'?base.width:0);
      const edgeY = item.top+item.height/2;
      const bendX = side==='left'?inset+left-2-item.laneOffset:inset+width-right+2+item.laneOffset;
      const path = doc.createElementNS(svg.namespaceURI,'path');
      path.setAttribute('d',`M ${edgeX} ${edgeY} H ${bendX} V ${item.targetY} H ${item.targetX}`);
      const color = getComputedStyle(badge).getPropertyValue('--cue-color').trim()||'#ffd000';
      path.setAttribute('stroke',color);
      svg.appendChild(path);
      const dot = doc.createElementNS(svg.namespaceURI,'circle');
      dot.setAttribute('cx',String(item.targetX));dot.setAttribute('cy',String(item.targetY));dot.setAttribute('r','1.8');
      dot.setAttribute('fill',color);svg.appendChild(dot);
    }
  }
  if (print && extent > bottom+1) throw new Error('Cue labels do not fit in this page margin. Widen the margin, shorten descriptions, or export without cues.');
  if (!print) root.style.setProperty('--cue-margin-extra',Math.max(0,extent-bottom)+'px');
  svg.style.width = root.clientWidth+'px';svg.style.height = Math.max(root.clientHeight,extent)+'px';
  svg.style.left='0px';svg.style.top='0px';root.appendChild(svg);
  const origin=svg.getBoundingClientRect();
  svg.style.left=(rootRect.left-origin.left)+'px';svg.style.top=(rootRect.top-origin.top)+'px';
}
