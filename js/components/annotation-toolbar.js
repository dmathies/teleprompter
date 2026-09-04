import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import './annotation-toolbar.scss';
import {
  IconPen,
  IconArrowRight,
  IconCircle,
  IconFont,
  IconEraser,
  IconRotateLeft,
  IconCheck,
} from '../icons.js';

export class AnnotationToolbar extends LitElement {
  static properties = {
    open: { type: Boolean },
    tool: { type: String },
    color: { type: String },
    width: { type: Number },
    syncStatus: { type: String },
  };

  createRenderRoot() {
    // Render to Light DOM so existing styles in css/teleprompter.css apply directly.
    return this;
  }

  constructor() {
    super();
    this.open = false;
    this.tool = 'pen';
    this.color = '#ffd000';
    this.width = 3;
    this.syncStatus = '';
  }

  _selectTool(tool) {
    this.tool = tool;
    this.dispatchEvent(new CustomEvent('tool-change', {
      detail: { tool },
      bubbles: true,
      composed: true,
    }));
  }

  _onUndo() {
    this.dispatchEvent(new CustomEvent('undo', { bubbles: true, composed: true }));
  }

  _onDone() {
    this.dispatchEvent(new CustomEvent('done', { bubbles: true, composed: true }));
  }

  _onColorInput(e) {
    this.color = e.target.value;
    this.dispatchEvent(new CustomEvent('color-change', {
      detail: { color: this.color },
      bubbles: true,
      composed: true,
    }));
  }

  _onColorChange(e) {
    this.color = e.target.value;
    this.dispatchEvent(new CustomEvent('color-change', {
      detail: { color: this.color },
      bubbles: true,
      composed: true,
    }));
  }

  _onWidthInput(e) {
    this.width = Number(e.target.value) || 3;
    this.dispatchEvent(new CustomEvent('width-change', {
      detail: { width: this.width },
      bubbles: true,
      composed: true,
    }));
  }

  _onWidthChange(e) {
    this.width = Number(e.target.value) || 3;
    this.dispatchEvent(new CustomEvent('width-change', {
      detail: { width: this.width },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    if (!this.open) {
      return html`<div id="annotationTools" hidden></div>`;
    }

    return html`
      <div id="annotationTools">
        <button
          type="button"
          data-ann-tool="pen"
          class="${this.tool === 'pen' ? 'active' : ''}"
          title="Freehand pen"
          aria-label="Freehand pen"
          @click=${() => this._selectTool('pen')}
        >
          ${unsafeHTML(IconPen)}
        </button>
        <button
          type="button"
          data-ann-tool="arrow"
          class="${this.tool === 'arrow' ? 'active' : ''}"
          title="Arrow"
          aria-label="Arrow"
          @click=${() => this._selectTool('arrow')}
        >
          ${unsafeHTML(IconArrowRight)}
        </button>
        <button
          type="button"
          data-ann-tool="ellipse"
          class="${this.tool === 'ellipse' ? 'active' : ''}"
          title="Circle / ellipse"
          aria-label="Circle or ellipse"
          @click=${() => this._selectTool('ellipse')}
        >
          ${unsafeHTML(IconCircle)}
        </button>
        <button
          type="button"
          data-ann-tool="text"
          class="${this.tool === 'text' ? 'active' : ''}"
          title="Text note"
          aria-label="Text note"
          @click=${() => this._selectTool('text')}
        >
          ${unsafeHTML(IconFont)}
        </button>
        <button
          type="button"
          data-ann-tool="erase"
          class="${this.tool === 'erase' ? 'active' : ''}"
          title="Erase annotation"
          aria-label="Erase annotation"
          @click=${() => this._selectTool('erase')}
        >
          ${unsafeHTML(IconEraser)}
        </button>
        <button
          type="button"
          id="annotationUndoBtn"
          title="Undo last annotation change"
          aria-label="Undo last annotation change"
          @click=${this._onUndo}
        >
          ${unsafeHTML(IconRotateLeft)}
        </button>
        <input
          id="annotationColor"
          type="color"
          .value=${this.color}
          title="Annotation colour"
          aria-label="Annotation colour"
          @input=${this._onColorInput}
          @change=${this._onColorChange}
        >
        <input
          id="annotationWidth"
          type="range"
          min="1"
          max="10"
          step="0.5"
          .value=${String(this.width)}
          title="Line width"
          aria-label="Annotation line width"
          @input=${this._onWidthInput}
          @change=${this._onWidthChange}
        >
        <span id="annotationSyncStatus">${this.syncStatus}</span>
        <button
          type="button"
          id="annotationDoneBtn"
          title="Finish annotating"
          aria-label="Finish annotating"
          @click=${this._onDone}
        >
          ${unsafeHTML(IconCheck)}
        </button>
      </div>
    `;
  }
}

customElements.define('annotation-toolbar', AnnotationToolbar);
