import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import './settings-dialog.scss';
import {
  IconSun,
  IconMoon,
} from '../icons.js';

export class SettingsDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    fontSize: { type: Number },
    wakeLockActive: { type: Boolean },
    wakeLockSupported: { type: Boolean },
    railSide: { type: String },
    annotationMarginSide: { type: String },
    annotationMarginWidth: { type: Number },
    activeDepartment: { type: String },
    canEditMargin: { type: Boolean },
    saveStatus: { type: String },
    isError: { type: Boolean },
  };

  createRenderRoot() {
    // Render to Light DOM so existing styles in css/teleprompter.css apply directly.
    return this;
  }

  constructor() {
    super();
    this.open = false;
    this.fontSize = 42;
    this.wakeLockActive = false;
    this.wakeLockSupported = true;
    this.railSide = 'right';
    this.annotationMarginSide = 'none';
    this.annotationMarginWidth = 0;
    this.activeDepartment = null;
    this.canEditMargin = false;
    this.saveStatus = '';
    this.isError = false;
  }

  connectedCallback() {
    super.connectedCallback();
    this._onKeyDown = (e) => {
      if (e.key === 'Escape' && this.open) {
        e.preventDefault();
        this.close();
      }
    };
    document.addEventListener('keydown', this._onKeyDown);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener('keydown', this._onKeyDown);
  }

  show() {
    this.open = true;
    this.updateComplete.then(() => this.focus());
  }

  close() {
    this.open = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  focus() {
    const input = this.querySelector('#fontSizeInput');
    if (input) {
      input.focus();
    } else {
      const select = this.querySelector('#railSideSelect');
      if (select) select.focus();
    }
  }

  _onPointerDown(e) {
    e.stopPropagation();
  }

  _onFontSizeInput(e) {
    const fontSize = parseInt(e.target.value, 10);
    this.fontSize = fontSize;
    this.dispatchEvent(new CustomEvent('font-size-input', {
      detail: { fontSize },
      bubbles: true,
      composed: true,
    }));
  }

  _onFontSizeChange(e) {
    const fontSize = parseInt(e.target.value, 10);
    this.fontSize = fontSize;
    this.dispatchEvent(new CustomEvent('font-size-change', {
      detail: { fontSize },
      bubbles: true,
      composed: true,
    }));
  }

  _onWakeLock() {
    this.dispatchEvent(new CustomEvent('toggle-wakelock', {
      bubbles: true,
      composed: true,
    }));
  }

  _wakeLockTitle() {
    if (!this.wakeLockSupported) {
      return 'Screen wake lock is not supported by this browser';
    }
    return this.wakeLockActive
      ? 'Screen will stay awake (click to disable)'
      : 'Keep screen awake';
  }

  _onRailSideChange(e) {
    const railSide = e.target.value === 'left' ? 'left' : 'right';
    this.railSide = railSide;
    this.dispatchEvent(new CustomEvent('rail-side-change', {
      detail: { railSide },
      bubbles: true,
      composed: true,
    }));
  }

  _onMarginSideChange(e) {
    const side = e.target.value;
    this.annotationMarginSide = side;
    this.dispatchEvent(new CustomEvent('margin-change', {
      detail: { side, width: this.annotationMarginWidth },
      bubbles: true,
      composed: true,
    }));
  }

  _onMarginWidthInput(e) {
    const width = Number(e.target.value);
    this.annotationMarginWidth = width;
    this.dispatchEvent(new CustomEvent('margin-input', {
      detail: { width },
      bubbles: true,
      composed: true,
    }));
  }

  _onMarginWidthChange(e) {
    const width = Number(e.target.value);
    this.annotationMarginWidth = width;
    this.dispatchEvent(new CustomEvent('margin-change', {
      detail: { side: this.annotationMarginSide, width },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    if (!this.open) {
      return html`
        <div id="settingsBackdrop" hidden></div>
        <div id="settingsPanel" hidden></div>
      `;
    }

    const marginWidthDisplay = this.activeDepartment
      ? (this.annotationMarginSide === 'none' ? 'Off' : `${this.annotationMarginWidth}%`)
      : 'Department views only';

    const marginDisabled = !this.canEditMargin;

    return html`
      <div id="settingsBackdrop" @pointerdown=${this._onPointerDown} @click=${this.close}></div>
      <div id="settingsPanel" role="dialog" aria-modal="true" aria-labelledby="settingsTitle" @pointerdown=${this._onPointerDown}>
        <h3 id="settingsTitle">Settings</h3>

        <div class="settings-row">
          <label for="fontSizeInput">Font size</label>
          <div class="settings-input-group">
            <input
              id="fontSizeInput"
              type="range"
              min="16"
              max="180"
              step="1"
              .value=${String(this.fontSize)}
              @input=${this._onFontSizeInput}
              @change=${this._onFontSizeChange}
            >
            <span id="fontSizeValue">${this.fontSize}px</span>
          </div>
        </div>

        <div class="settings-row">
          <label for="wakeLockBtn">Keep screen awake</label>
          <div class="settings-btn-group">
            <button
              id="wakeLockBtn"
              type="button"
              class="icon-btn ${this.wakeLockActive ? 'master-active' : ''}"
              title="${this._wakeLockTitle()}"
              aria-label="Keep screen awake"
              ?disabled=${!this.wakeLockSupported}
              @click=${this._onWakeLock}
            >
              ${unsafeHTML(this.wakeLockActive ? IconSun : IconMoon)}
            </button>
            <span id="wakeLockStatus" class="settings-text-muted">
              ${!this.wakeLockSupported ? 'Not supported' : (this.wakeLockActive ? 'Active' : 'Off')}
            </span>
          </div>
        </div>

        <div class="settings-row">
          <label for="railSideSelect">Overview rail</label>
          <select id="railSideSelect" .value=${this.railSide} @change=${this._onRailSideChange}>
            <option value="right">Right</option>
            <option value="left">Left</option>
          </select>
        </div>

        <div id="settingsMarginControls" aria-disabled="${marginDisabled ? 'true' : 'false'}">
          <div class="settings-row">
            <label for="annotationMarginSideSelect">Department annotation margin</label>
            <select
              id="annotationMarginSideSelect"
              .value=${this.activeDepartment ? this.annotationMarginSide : 'none'}
              ?disabled=${marginDisabled}
              @change=${this._onMarginSideChange}
            >
              <option value="none">None</option>
              <option value="left">Left</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div class="settings-row">
            <label for="annotationMarginWidth">Margin width</label>
            <div class="settings-input-group">
              <input
                id="annotationMarginWidth"
                type="range"
                min="0"
                max="40"
                step="1"
                .value=${String(this.activeDepartment ? this.annotationMarginWidth : 0)}
                ?disabled=${marginDisabled || this.annotationMarginSide === 'none'}
                @input=${this._onMarginWidthInput}
                @change=${this._onMarginWidthChange}
              >
              <span id="annotationMarginWidthValue">${marginWidthDisplay}</span>
            </div>
          </div>
        </div>

        <div id="settingsActions">
          <span id="settingsSaveStatus" role="status" class="${this.isError ? 'error' : ''}">${this.saveStatus}</span>
          <button id="settingsDoneBtn" type="button" @click=${this.close}>Done</button>
        </div>
      </div>
    `;
  }
}

customElements.define('settings-dialog', SettingsDialog);
