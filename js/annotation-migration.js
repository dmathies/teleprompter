// Pure, conservative block matcher. Geometry is never rewritten here.
export const ANCHOR_VERSION = 1;

export function planAnnotationMigration(annotations, target, revision) {
  const blocks = target.blocks;
  const ids = new Set();
  for (const block of blocks) {
    if (!block.prompt || ids.has(block.prompt)) throw new Error('Duplicate or missing prompt ID');
    ids.add(block.prompt);
  }
  return annotations.map(annotation => {
    const anchor = annotation.anchor;
    if (annotation.sourceRevision === revision && ids.has(annotation.prompt) && !annotation.unresolved) {
      return { annotation, status: 'unchanged', prompt: annotation.prompt, reason: 'Current revision' };
    }
    if (typeof anchor?.blockText !== 'string') return { annotation, status: 'review', reason: 'Original text was not captured', candidates: [] };
    const exact = blocks.filter(b => b.blockText === anchor.blockText && b.speaker === anchor.speaker);
    const contextual = exact.filter(b => b.previousText === anchor.previousText && b.nextText === anchor.nextText);
    const candidates = contextual.length === 1 ? contextual : exact;
    const match = candidates.length === 1 ? candidates[0] : null;
    // Identical block HTML is required, including styles elsewhere in the script.
    // Cross-block ink has no safe automatic placement in this first release.
    if (match && !anchor.spansBlocks && match.structure === anchor.structure && target.styles === anchor.styles) {
      return { annotation, status: 'matched', prompt: match.prompt, reason: 'Unchanged text and structure', candidates };
    }
    // Whole-script text can locate passages spanning a split/merge. It is only
    // a review hint: block-relative handwriting cannot be moved across it safely.
    const at = target.text?.indexOf(anchor.blockText) ?? -1;
    const spanning = at >= 0 && anchor.blockText.length > 12
      ? blocks.filter(b => b.start < at + anchor.blockText.length && b.end > at) : [];
    const words = value => new Set(value.toLocaleLowerCase('en').match(/[\p{L}\p{N}]+/gu) || []);
    const original = words(anchor.blockText);
    const fuzzy = original.size >= 4 ? blocks.map(block => {
      const other = words(block.blockText);
      const common = [...original].filter(word => other.has(word)).length;
      return {block, score: common / Math.max(original.size, other.size)};
    }).filter(item => item.score >= .6).sort((a, b) => b.score - a.score).slice(0, 5).map(item => item.block) : [];
    const suggestions = exact.length ? exact : spanning.length ? spanning : fuzzy;
    return { annotation, status: suggestions.length ? 'review' : 'unmatched',
      reason: exact.length ? 'Ambiguous match or changed layout' : spanning.length ? 'Passage crosses changed block boundaries'
        : fuzzy.length ? 'Similar edited text; placement needs checking' : 'Text changed or removed', candidates: suggestions };
  });
}

export function isAnnotationVisible(annotation, revision, prompts = null) {
  return !annotation.unresolved && (!prompts || prompts.has(annotation.prompt)) &&
    (!annotation.sourceRevision || annotation.sourceRevision === revision);
}
