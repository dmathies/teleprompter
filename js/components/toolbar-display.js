import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import './toolbar-display.scss';
import {
  IconExpand,
  IconGear,
  IconFilePdf,
} from '../icons.js';

export class ToolbarDisplay extends LitElement {
  static properties = {
    showStageDirections: { type: Boolean },
    canEditScript: { type: Boolean },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.showStageDirections = true;
    this.canEditScript = false;
  }

  _onFullscreen() {
    this.dispatchEvent(new CustomEvent('toggle-fullscreen', { bubbles: true, composed: true }));
  }

  _onStageDirections() {
    this.dispatchEvent(new CustomEvent('toggle-stage-directions', { bubbles: true, composed: true }));
  }

  _onSettings() {
    this.dispatchEvent(new CustomEvent('open-settings', { bubbles: true, composed: true }));
  }

  _onExport() {
    this.dispatchEvent(new CustomEvent('open-export', { bubbles: true, composed: true }));
  }

  render() {
    return html`
      <button
        id="fullscreenBtn"
        class="icon-btn"
        title="Fullscreen"
        aria-label="Fullscreen"
        @click=${this._onFullscreen}
      >
        ${unsafeHTML(IconExpand)}
      </button>
      <button
        id="stageDirectionsBtn"
        class="icon-btn ${this.showStageDirections ? 'master-active' : ''}"
        title="Show stage directions"
        aria-label="Show stage directions"
        @click=${this._onStageDirections}
      >
        SD
      </button>
      <button
        id="settingsBtn"
        class="icon-btn"
        title="Settings"
        aria-label="Settings"
        @click=${this._onSettings}
      >
        ${unsafeHTML(IconGear)}
      </button>
      <button
        id="exportBtn"
        class="icon-btn"
        title="Export marked-up script to PDF"
        aria-label="Export PDF"
        @click=${this._onExport}
      >
        ${unsafeHTML(IconFilePdf)}
      </button>
      ${this.canEditScript ? html`<button id="editScriptBtn" title="Edit script" aria-label="Edit script"
        @click=${() => this.dispatchEvent(new CustomEvent('edit-script', {bubbles: true, composed: true}))}>Edit script</button>` : ''}
    `;
  }
}

customElements.define('toolbar-display', ToolbarDisplay);
