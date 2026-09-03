export function normalizeSemanticPosition(position, {defaultFraction = null} = {}) {
  if (!position || typeof position !== 'object') return null;
  const prompt = String(position.prompt || '').trim();
  let fraction = Number(position.fraction);
  if (!Number.isFinite(fraction) && defaultFraction !== null) fraction = Number(defaultFraction);
  if (!prompt || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) return null;
  return {prompt, fraction: Math.max(0, Math.min(1, fraction))};
}

export function createSemanticPositionApi({content, viewport, getPromptBlocks, referenceLineFraction = 0.35}) {
  const normalize = normalizeSemanticPosition;

  function resolveBlock(position) {
    const pos = normalize(position, {defaultFraction:0});
    if (!pos) return null;
    return content.querySelector('[data-prompt-id="' + CSS.escape(pos.prompt) + '"]');
  }

  function capture() {
    const blocks = getPromptBlocks();
    if (!blocks.length) return null;
    const referenceY = viewport.scrollTop + viewport.clientHeight * referenceLineFraction;
    let chosen = blocks[0];
    for (const block of blocks) {
      const top = block.offsetTop;
      const bottom = top + Math.max(1, block.offsetHeight);
      if (referenceY >= top && referenceY <= bottom) { chosen = block; break; }
      if (top <= referenceY) chosen = block;
      else break;
    }
    const top = chosen.offsetTop;
    const height = Math.max(1, chosen.offsetHeight);
    const prompt = chosen.dataset.promptId;
    const fraction = Math.max(0, Math.min(1, (referenceY - top) / height));
    return normalize({prompt, fraction});
  }

  function toDocumentY(position) {
    const pos = normalize(position, {defaultFraction:0});
    if (!pos) return null;
    const block = resolveBlock(pos);
    if (!block) return null;
    return block.offsetTop + Math.max(1, block.offsetHeight) * pos.fraction;
  }

  function toScrollTop(position) {
    const pos = normalize(position);
    if (!pos) return null;
    const block = content.querySelector('[data-prompt-id="' + CSS.escape(pos.prompt) + '"]');
    if (!block) return null;
    const y = block.offsetTop + Math.max(1, block.offsetHeight) * pos.fraction;
    return y - viewport.clientHeight * referenceLineFraction;
  }

  function compare(a, b) {
    const ay = toDocumentY(a);
    const by = toDocumentY(b);
    if (ay === null || by === null) return null;
    return ay < by ? -1 : ay > by ? 1 : 0;
  }

  function currentPromptId() {
    const pos = capture();
    return pos ? pos.prompt : null;
  }

  return {capture, normalize, resolveBlock, toDocumentY, toScrollTop, compare, currentPromptId};
}
