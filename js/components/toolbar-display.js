import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import './toolbar-display.scss';
import {
  IconExpand,
  IconSun,
  IconMoon,
  IconGear,
  IconFilePdf,
} from '../icons.js';

export class ToolbarDisplay extends LitElement {
  static properties = {
    wakeLockActive: { type: Boolean },
    wakeLockSupported: { type: Boolean },
    showStageDirections: { type: Boolean },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.wakeLockActive = false;
    this.wakeLockSupported = true;
    this.showStageDirections = true;
  }

  _onFullscreen() {
    this.dispatchEvent(new CustomEvent('toggle-fullscreen', { bubbles: true, composed: true }));
  }

  _onWakeLock() {
    this.dispatchEvent(new CustomEvent('toggle-wakelock', { bubbles: true, composed: true }));
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

  _wakeLockTitle() {
    if (!this.wakeLockSupported) {
      return 'Screen wake lock is not supported by this browser';
    }
    return this.wakeLockActive
      ? 'Screen will stay awake (click to disable)'
      : 'Keep screen awake';
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
        id="wakeLockBtn"
        class="icon-btn ${this.wakeLockActive ? 'master-active' : ''}"
        title="${this._wakeLockTitle()}"
        aria-label="Keep screen awake"
        ?disabled=${!this.wakeLockSupported}
        @click=${this._onWakeLock}
      >
        ${unsafeHTML(this.wakeLockActive ? IconSun : IconMoon)}
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
    `;
  }
}

customElements.define('toolbar-display', ToolbarDisplay);
