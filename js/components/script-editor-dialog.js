import {LitElement, html} from 'lit';
import {newScriptEditorBlock, scriptEditorOperations} from '../script-editor-draft.js';
import './script-editor-dialog.scss';

export class ScriptEditorDialog extends LitElement {
    static properties = {
        open: {type: Boolean}, busy: {type: Boolean}, error: {type: String},
        title: {type: String}, blocks: {state: true}, selected: {state: true},
        filter: {state: true}, insertKind: {state: true}, discardConfirm: {state: true}
    };
    createRenderRoot() { return this; }
    constructor() {
        super();
        this.open = false; this.busy = false; this.error = ''; this.title = '';
        this.blocks = []; this.originals = []; this.selected = ''; this.filter = '';
        this.insertKind = 'dialogue'; this.nextId = 0; this.discardConfirm = false;
    }
    async show(blocks, prompt, title) {
        this.originals = blocks;
        this.blocks = blocks.map(block => ({...block, fields: block.fields.map(field => ({...field}))}));
        this.selected = blocks.some(block => block.id === prompt) ? prompt : blocks[0]?.id;
        this.filter = ''; this.error = ''; this.title = title; this.discardConfirm = false;
        this.nextId = 0; this.open = true;
        await this.updateComplete;
        const dialog = this.querySelector('dialog');
        dialog.showModal();
        this.querySelector('#scriptEditorBlock')?.focus();
    }
    get operations() { return scriptEditorOperations(this.blocks, this.originals); }
    close(force = false) {
        if (this.busy && !force) return;
        if (!force && this.operations.length && !this.discardConfirm) { this.discardConfirm = true; return; }
        this.querySelector('dialog')?.close(); this.open = false;
        this.dispatchEvent(new CustomEvent('editor-close', {bubbles: true}));
    }
    editField(key, value) {
        this.blocks = this.blocks.map(block => block.id === this.selected ? {...block,
            fields: block.fields.map(field => field.key === key ? {...field, value} : field)} : block);
        this.discardConfirm = false;
    }
    changeKind(kind) {
        this.blocks = this.blocks.map(block => block.id === this.selected ? {...block, kind,
            fields: block.fields.map((field, index) => ({...field, label: block.fields.length > 1 && index === 0
                ? (kind === 'lyrics' ? 'Singer' : 'Character (include colon if needed)')
                : (kind === 'lyrics' ? 'Lyrics (one line per sung line)' : 'Dialogue')}))} : block);
        this.discardConfirm = false;
    }
    insert(side) {
        const index = this.blocks.findIndex(block => block.id === this.selected);
        if (index < 0) return;
        const block = newScriptEditorBlock('new-' + (++this.nextId), this.insertKind, this.blocks[index]);
        const blocks = [...this.blocks]; blocks.splice(index + (side === 'after' ? 1 : 0), 0, block);
        this.blocks = blocks; this.selected = block.id; this.filter = ''; this.discardConfirm = false;
    }
    removeNew() {
        const index = this.blocks.findIndex(block => block.id === this.selected);
        if (index < 0 || !this.selected.startsWith('new-')) return;
        this.blocks = this.blocks.filter(block => block.id !== this.selected);
        this.selected = this.blocks[Math.max(0, index - 1)]?.id;
    }
    save() {
        if (this.busy) return;
        this.dispatchEvent(new CustomEvent('editor-save', {bubbles: true, detail: {operations: this.operations}}));
    }
    render() {
        if (!this.open) return html``;
        const current = this.blocks.find(block => block.id === this.selected);
        const needle = this.filter.toLocaleLowerCase();
        const filtered = this.blocks.filter(block => block.id === this.selected ||
            [block.id, block.page, ...block.fields.map(field => field.value)].join(' ').toLocaleLowerCase().includes(needle));
        return html`
          <dialog id="scriptEditorModal" aria-labelledby="scriptEditorTitle"
            @cancel=${event => { event.preventDefault(); this.close(); }}>
            <h2 id="scriptEditorTitle">Edit ${this.title}</h2>
            <p class="script-editor-help">Existing positions are preserved. New blocks get new positions when saved.
              Playback is stopped. Check cues and annotations on changed text after saving.</p>
            <fieldset ?disabled=${this.busy}>
              <label>Find text or page
                <input type="search" .value=${this.filter} @input=${event => { this.filter = event.target.value; }}>
              </label>
              <label>Script block
                <select id="scriptEditorBlock" .value=${this.selected}
                  @change=${event => { this.selected = event.target.value; this.discardConfirm = false; }}>
                  ${filtered.map(block => html`<option value=${block.id} ?selected=${block.id === this.selected}>
                    ${block.id.startsWith('new-') ? 'NEW' : block.id} · Page ${block.page || '—'} · ${block.fields.map(field => field.value).join(' ').slice(0, 120)}
                  </option>`)}
                </select>
              </label>
              ${current && ['dialogue', 'lyrics'].includes(current.kind) ? html`<label>Block type
                <select .value=${current.kind} @change=${event => this.changeKind(event.target.value)}>
                  <option value="dialogue">Dialogue</option>
                  <option value="lyrics">Lyrics</option>
                </select>
              </label>` : ''}
              <div class="script-editor-fields">
                ${current?.fields.map(field => html`<label>${field.label}
                  <textarea rows=${/character|singer|heading/i.test(field.label) ? 2 : 5} .value=${field.value}
                    @input=${event => this.editField(field.key, event.target.value)}></textarea>
                </label>`)}
              </div>
              <div class="script-editor-insert">
                <label>Add block
                  <select .value=${this.insertKind} @change=${event => { this.insertKind = event.target.value; }}>
                    ${Object.entries({paragraph: 'Paragraph', dialogue: 'Dialogue', lyrics: 'Lyrics', direction: 'Stage direction',
                        act: 'Act heading', scene: 'Scene heading', song: 'Song heading'}).map(([key, label]) => html`<option value=${key}>${label}</option>`)}
                  </select>
                </label>
                <button @click=${() => this.insert('before')}>Insert before</button>
                <button @click=${() => this.insert('after')}>Insert after</button>
                ${current?.id.startsWith('new-') ? html`<button @click=${() => this.removeNew()}>Remove new block</button>` : ''}
              </div>
            </fieldset>
            <p role="alert" class="script-editor-error">${this.error}</p>
            ${this.discardConfirm ? html`<p role="alert">Discard your unsaved changes?
              <button @click=${() => this.close()}>Discard changes</button>
              <button @click=${() => { this.discardConfirm = false; }}>Keep editing</button></p>` : ''}
            <div class="script-editor-actions">
              <span role="status">${this.busy ? 'Saving…' : `${this.operations.length} changed blocks`}</span>
              <button ?disabled=${this.busy} @click=${() => this.close()}>Cancel</button>
              <button ?disabled=${this.busy || !this.operations.length} @click=${() => this.save()}>Save script</button>
            </div>
          </dialog>`;
    }
}
customElements.define('script-editor-dialog', ScriptEditorDialog);
