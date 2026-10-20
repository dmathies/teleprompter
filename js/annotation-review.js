import { planAnnotationMigration } from './annotation-migration.js';
import { captureAnchor } from './annotation-anchors.js';
import './annotation-review.scss';

// Native modal makes the rest of the page inert on Chrome and Safari.
// Plans remain read-only until the editor explicitly applies their selections.
export async function reviewAnnotations({index, revision, request, store, key, isCurrent}) {
  if (document.getElementById('annotationReviewDialog')) return;
  const pending = await store.opsFor(key);
  const server = await request('review', {});
  if (!isCurrent()) throw new Error('Script or department changed. Reopen review.');
  const queued = pending.filter(op => op.action === 'save');
  const annotations = pending.length ? queued.map(op => op.payload.annotation) : server.annotations;
  const plan = planAnnotationMigration(annotations, index, revision);
  const dialog = document.createElement('dialog');
  dialog.id = 'annotationReviewDialog';
  const element = (tag, text, parent = dialog) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    parent.appendChild(node);
    return node;
  };
  element('h2', pending.length ? 'Review pending annotations' : 'Review annotation positions');
  element('p', pending.length
    ? 'Pending drawings are kept until saved. Choose their positions in this script, then apply. Unresolved drawings stay queued.'
    : 'Only unchanged text and structure are suggested automatically. Check each result before applying. Drawing shapes are preserved.');
  element('p', 'Legacy annotations have no original text. Choose a position only after checking it against the script.');
  const targets = element('datalist'); targets.id = 'annotationReviewTargets';
  for (const block of index.blocks) {
    const option = element('option', block.blockText.slice(0, 100), targets);
    option.value = block.prompt;
  }
  const controls = plan.map(result => {
    const row = element('section');
    element('p', `${result.annotation.id}: ${result.reason}`, row);
    element('blockquote', result.annotation.anchor?.blockText || `Original block: ${result.annotation.prompt}`, row);
    if (result.candidates?.length) element('p', 'Suggested blocks: ' + result.candidates.map(b => b.prompt).join(', '), row);
    const select = element('input', undefined, row);
    select.setAttribute('list', targets.id);
    select.placeholder = 'Unresolved — choose or enter a block ID';
    select.setAttribute('aria-label', `Target for ${result.annotation.id}`);
    select.value = ['matched', 'unchanged'].includes(result.status) ? result.prompt : '';
    const preview = element('p', '', row);
    const update = () => { preview.textContent = index.blocks.find(b => b.prompt === select.value)?.blockText || 'Retained for recovery; hidden from the script.'; };
    select.addEventListener('input', update); update();
    return select;
  });
  const deletes = pending.filter(op => op.action === 'delete').map(op => {
    const label = element('label');
    const checkbox = element('input', undefined, label); checkbox.type = 'checkbox';
    label.appendChild(document.createTextNode(` Confirm pending deletion of ${op.payload.id}`));
    return {op, checkbox};
  });
  const status = element('p', ''); status.setAttribute('role', 'status');
  const apply = element('button', pending.length ? 'Apply pending positions' : 'Apply reviewed positions');
  apply.type = 'button';
  const rollback = element('button', 'Undo last migration');
  rollback.type = 'button'; rollback.disabled = pending.length > 0 || !server.canRestore;
  const download = element('button', 'Download recovery data'); download.type = 'button';
  download.onclick = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({scriptRevision: revision, server, pending}, null, 2)], {type: 'application/json'}));
    const link = document.createElement('a'); link.href = url; link.download = 'annotation-recovery.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const close = element('button', 'Close'); close.type = 'button'; close.onclick = () => dialog.close();
  await new Promise(resolve => {
    dialog.addEventListener('close', resolve, {once: true});
    const perform = async action => {
      apply.disabled = rollback.disabled = true;
      try {
        if (!isCurrent()) throw new Error('Script or department changed. Close and reopen review.');
        if (controls.some(control => control.value && !index.blocks.some(block => block.prompt === control.value))) {
          throw new Error('Choose an existing block ID or leave the position blank.');
        }
        if (action === 'restore') {
          await request('restore', {expectedRevision: server.revision});
        } else if (pending.length) {
          for (let i = 0; i < queued.length; i++) {
            if (!controls[i].value) continue;
            const op = queued[i];
            op.payload.annotation = {...op.payload.annotation, prompt: controls[i].value, sourceRevision: revision};
            op.payload.annotation.anchor = captureAnchor(index, op.payload.annotation);
            delete op.payload.annotation.unresolved;
            const existing = server.annotations.find(a => a.id === op.payload.annotation.id);
            if (existing) op.payload.baseUpdatedAt = existing.updatedAt;
            op.sourceRevision = revision;
            await store.replaceOp(op);
          }
          for (const {op, checkbox} of deletes) {
            if (!checkbox.checked) continue;
            const existing = server.annotations.find(a => a.id === op.payload.id);
            if (existing) op.payload.baseUpdatedAt = existing.updatedAt;
            op.sourceRevision = revision;
            await store.replaceOp(op);
          }
        } else {
          const placements = plan.map((result, i) => {
            const prompt = controls[i].value;
            return {id: result.annotation.id, prompt,
              anchor: prompt ? captureAnchor(index, {...result.annotation, prompt}) : null};
          });
          await request('migrate', {expectedRevision: server.revision, placements});
        }
        dialog.close();
      } catch (error) {
        status.textContent = error.message;
        apply.disabled = false;
      }
    };
    apply.onclick = () => perform('migrate');
    rollback.onclick = () => perform('restore');
    document.body.appendChild(dialog);
    dialog.showModal();
  });
  dialog.remove();
}
