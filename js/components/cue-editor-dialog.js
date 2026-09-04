import { LitElement, html } from 'lit';
import './cue-editor-dialog.scss';

export class CueEditorDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    isEditing: { type: Boolean },
    department: { type: String },
    cueNumber: { type: String },
    description: { type: String },
    color: { type: String },
    anchorInfo: { type: String },
    wordInfo: { type: String },
    endInfo: { type: String },
    wordMode: { type: Boolean },
    positionTracking: { type: String }, // 'start' | 'end' | null
    error: { type: String },
    busy: { type: Boolean },
  };

  createRenderRoot() {
    // Render to Light DOM so existing styles in css/teleprompter.css apply directly.
    return this;
  }

  constructor() {
    super();
    this.open = false;
    this.isEditing = false;
    this.department = 'LX';
    this.cueNumber = '';
    this.description = '';
    this.color = '#ffd000';
    this.anchorInfo = '';
    this.wordInfo = '';
    this.endInfo = 'No end position';
    this.wordMode = false;
    this.positionTracking = null;
    this.error = '';
    this.busy = false;
  }

  close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  focus() {
    const input = this.querySelector('#cueNumber');
    if (input) input.focus();
  }

  _onPointerDown(e) {
    e.stopPropagation();
  }

  _onNumberInput(e) {
    this.cueNumber = e.target.value;
  }

  _onDescriptionInput(e) {
    this.description = e.target.value;
  }

  _onColorInput(e) {
    this.color = e.target.value;
  }

  _onChooseWordClick() {
    this.dispatchEvent(new CustomEvent('choose-word', { bubbles: true, composed: true }));
  }

  _onTrackStartClick() {
    this.dispatchEvent(new CustomEvent('toggle-track-start', { bubbles: true, composed: true }));
  }

  _onTrackEndClick() {
    this.dispatchEvent(new CustomEvent('toggle-track-end', { bubbles: true, composed: true }));
  }

  _onClearEndClick() {
    this.dispatchEvent(new CustomEvent('clear-end', { bubbles: true, composed: true }));
  }

  _onDeleteClick() {
    this.dispatchEvent(new CustomEvent('delete', { bubbles: true, composed: true }));
  }

  _onSaveClick() {
    this.dispatchEvent(new CustomEvent('save', {
      detail: {
        number: this.cueNumber,
        description: this.description,
        color: this.color,
      },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    if (!this.open) {
      return html`<div id="cueEditorPanel" hidden></div>`;
    }

    const title = this.isEditing
      ? `Edit ${this.department} Cue`
      : `Add ${this.department} Cue`;

    const isTrackingStart = this.positionTracking === 'start';
    const isTrackingEnd = this.positionTracking === 'end';

    return html`
      <div id="cueEditorPanel" @pointerdown=${this._onPointerDown}>
        <h3 id="cueEditorTitle">${title}</h3>
        <div class="cue-form-row">
          <label for="cueNumber">Cue</label>
          <input
            id="cueNumber"
            type="text"
            maxlength="24"
            placeholder="e.g. 12"
            .value=${this.cueNumber}
            @input=${this._onNumberInput}
          >
        </div>
        <div class="cue-form-row">
          <label for="cueDescription">Description</label>
          <input
            id="cueDescription"
            type="text"
            maxlength="120"
            placeholder="e.g. Pick up Chaplin"
            .value=${this.description}
            @input=${this._onDescriptionInput}
          >
        </div>
        <div class="cue-form-row">
          <label for="cueColor">Colour</label>
          <input
            id="cueColor"
            type="color"
            .value=${this.color}
            @input=${this._onColorInput}
          >
        </div>
        <div class="cue-form-row">
          <label>Anchor</label>
          <span id="cueAnchorInfo">${this.anchorInfo || 'No prompt selected'}</span>
        </div>
        ${this.wordMode ? html`
          <div class="cue-form-row" id="cueWordRow">
            <label>Trigger</label>
            <button id="cueChooseWordBtn" type="button" @click=${this._onChooseWordClick}>Choose trigger word</button>
            <span id="cueWordInfo">${this.wordInfo || 'No trigger word selected'}</span>
          </div>
        ` : ''}
        <div class="cue-form-row buttons">
          <label>End</label>
          <button
            id="cueUseEndCurrentBtn"
            type="button"
            class="${isTrackingEnd ? 'active' : ''}"
            @click=${this._onTrackEndClick}
          >
            ${isTrackingEnd ? 'Choosing end position…' : 'Choose end position'}
          </button>
          <button id="cueClearEndBtn" type="button" @click=${this._onClearEndClick}>Clear end</button>
          <span id="cueEndInfo">${this.endInfo}</span>
        </div>
        <div id="cueEditorError">${this.error}</div>
        <div id="cueEditorActions">
          ${this.isEditing ? html`
            <button
              id="cueUseCurrentBtn"
              type="button"
              class="${isTrackingStart ? 'active' : ''}"
              @click=${this._onTrackStartClick}
            >
              ${isTrackingStart ? 'Choosing start position…' : 'Change start position'}
            </button>
            <button id="cueDeleteBtn" type="button" ?disabled=${this.busy} @click=${this._onDeleteClick}>Delete</button>
          ` : html`
            <button
              id="cueUseCurrentBtn"
              type="button"
              hidden
            ></button>
          `}
          <button id="cueCancelBtn" type="button" @click=${this.close}>Cancel</button>
          <button id="cueSaveBtn" type="button" ?disabled=${this.busy} @click=${this._onSaveClick}>Save</button>
        </div>
      </div>
    `;
  }
}

customElements.define('cue-editor-dialog', CueEditorDialog);
