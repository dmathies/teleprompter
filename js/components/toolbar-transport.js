import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import {
  IconPlay,
  IconPause,
  IconRotateLeft,
  IconMinus,
  IconPlus,
  IconAnglesUp,
  IconAnglesDown,
} from '../icons.js';

export class ToolbarTransport extends LitElement {
  static properties = {
    playing: { type: Boolean },
    disabled: { type: Boolean },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.playing = false;
    this.disabled = false;
  }

  _onPlayPause() {
    this.dispatchEvent(new CustomEvent('play-pause', { bubbles: true, composed: true }));
  }

  _onBack() {
    this.dispatchEvent(new CustomEvent('jump-back', { bubbles: true, composed: true }));
  }

  _onSlower() {
    this.dispatchEvent(new CustomEvent('slower', { bubbles: true, composed: true }));
  }

  _onFaster() {
    this.dispatchEvent(new CustomEvent('faster', { bubbles: true, composed: true }));
  }

  _onTop() {
    this.dispatchEvent(new CustomEvent('jump-top', { bubbles: true, composed: true }));
  }

  _onBottom() {
    this.dispatchEvent(new CustomEvent('jump-bottom', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <button
        id="playPauseBtn"
        class="icon-btn"
        title="${this.playing ? 'Pause' : 'Play'}"
        aria-label="${this.playing ? 'Pause' : 'Play'}"
        ?disabled=${this.disabled}
        @click=${this._onPlayPause}
      >
        ${unsafeHTML(this.playing ? IconPause : IconPlay)}
      </button>
      <button
        id="backBtn"
        class="icon-btn"
        title="Back one third page"
        aria-label="Back one third page"
        ?disabled=${this.disabled}
        @click=${this._onBack}
      >
        ${unsafeHTML(IconRotateLeft)}
      </button>
      <button
        id="slowerBtn"
        class="icon-btn"
        title="Slower"
        aria-label="Slower"
        @click=${this._onSlower}
      >
        ${unsafeHTML(IconMinus)}
      </button>
      <button
        id="fasterBtn"
        class="icon-btn"
        title="Faster"
        aria-label="Faster"
        @click=${this._onFaster}
      >
        ${unsafeHTML(IconPlus)}
      </button>
      <button
        id="topBtn"
        class="icon-btn"
        title="Jump to top"
        aria-label="Jump to top"
        ?disabled=${this.disabled}
        @click=${this._onTop}
      >
        ${unsafeHTML(IconAnglesUp)}
      </button>
      <button
        id="bottomBtn"
        class="icon-btn"
        title="Jump to bottom"
        aria-label="Jump to bottom"
        ?disabled=${this.disabled}
        @click=${this._onBottom}
      >
        ${unsafeHTML(IconAnglesDown)}
      </button>
    `;
  }
}

customElements.define('toolbar-transport', ToolbarTransport);
