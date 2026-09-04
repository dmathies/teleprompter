import { LitElement, html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import './toolbar-sync.scss';
import {
  IconLock,
  IconLockOpen,
  IconPlus,
  IconPenToSquare,
  IconArrowDown,
  IconCircleDot,
  IconXmark,
} from '../icons.js';

export class ToolbarSync extends LitElement {
  static properties = {
    activeDepartment: { type: String },
    syncMode: { type: String },
    isMaster: { type: Boolean },
    cueEditorUnlocked: { type: Boolean },
    canRejoin: { type: Boolean },
    passwordOpen: { type: Boolean },
    conflictActive: { type: Boolean },
    syncStatusText: { type: String },
    syncStatusClass: { type: String },
    healthHtml: { type: String },
    healthText: { type: String },
    healthClass: { type: String },
    healthTitle: { type: String },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.activeDepartment = null;
    this.syncMode = 'follow';
    this.isMaster = false;
    this.cueEditorUnlocked = false;
    this.canRejoin = false;
    this.passwordOpen = false;
    this.conflictActive = false;
    this.syncStatusText = 'FOLLOW: connecting…';
    this.syncStatusClass = '';
    this.healthText = '';
    this.healthClass = '';
    this.healthTitle = 'Master/server heartbeat and time since ASM interaction';
  }

  focusPassword() {
    const input = this.querySelector('#masterPassword');
    if (input) input.focus();
  }

  clearPassword() {
    const input = this.querySelector('#masterPassword');
    if (input) input.value = '';
  }

  getPasswordValue() {
    const input = this.querySelector('#masterPassword');
    return input ? input.value : '';
  }

  _onMasterClick() {
    this.dispatchEvent(new CustomEvent('toggle-master', { bubbles: true, composed: true }));
  }

  _onAddCue() {
    this.dispatchEvent(new CustomEvent('add-cue', { bubbles: true, composed: true }));
  }

  _onAnnotate() {
    this.dispatchEvent(new CustomEvent('annotate', { bubbles: true, composed: true }));
  }

  _onNextCue() {
    this.dispatchEvent(new CustomEvent('next-cue', { bubbles: true, composed: true }));
  }

  _onRejoin() {
    this.dispatchEvent(new CustomEvent('rejoin', { bubbles: true, composed: true }));
  }

  _onSyncStatusClick() {
    this.dispatchEvent(new CustomEvent('sync-status-click', { bubbles: true, composed: true }));
  }

  _onSubmitPassword() {
    const password = this.getPasswordValue();
    this.dispatchEvent(new CustomEvent('submit-password', {
      detail: { password },
      bubbles: true,
      composed: true,
    }));
  }

  _onTakeControl() {
    const password = this.getPasswordValue();
    this.dispatchEvent(new CustomEvent('take-control', {
      detail: { password },
      bubbles: true,
      composed: true,
    }));
  }

  _onCancelPassword() {
    this.clearPassword();
    this.passwordOpen = false;
    this.dispatchEvent(new CustomEvent('cancel-password', { bubbles: true, composed: true }));
  }

  _onPasswordKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      this._onSubmitPassword();
    } else if (e.key === 'Escape') {
      this._onCancelPassword();
    }
  }

  render() {
    const deptMode = !!this.activeDepartment;
    const deptLabelText = deptMode ? this.activeDepartment : 'ASM';

    let masterActive = false;
    let masterUnlocked = false;
    let masterBtnTitle = '';

    if (deptMode) {
      masterActive = this.cueEditorUnlocked;
      masterUnlocked = this.cueEditorUnlocked;
      masterBtnTitle = this.cueEditorUnlocked
        ? `Lock ${this.activeDepartment} editing`
        : `Unlock ${this.activeDepartment} editing`;
    } else {
      masterActive = this.isMaster;
      masterUnlocked = this.isMaster;
      masterBtnTitle = this.isMaster ? 'Leave master mode' : 'Become master';
    }

    const passwordPlaceholder = deptMode
      ? `${this.activeDepartment} password`
      : 'Master password';
    const loginBtnTitle = deptMode
      ? `Unlock ${this.activeDepartment} cue editing`
      : 'Authenticate as master';

    return html`
      <span id="deptLabel">${deptLabelText}</span>
      <button
        id="masterBtn"
        class="icon-btn ${masterActive ? 'master-active' : ''}"
        title="${masterBtnTitle}"
        aria-label="${masterBtnTitle}"
        @click=${this._onMasterClick}
      >
        ${unsafeHTML(masterUnlocked ? IconLockOpen : IconLock)}
      </button>
      <button
        id="addCueBtn"
        class="icon-btn"
        title="Add cue at current position"
        aria-label="Add cue"
        ?hidden=${!deptMode || !this.cueEditorUnlocked}
        @click=${this._onAddCue}
      >
        ${unsafeHTML(IconPlus)}<span>C</span>
      </button>
      <button
        id="annotateBtn"
        class="icon-btn"
        title="Draw script annotations"
        aria-label="Draw script annotations"
        ?hidden=${!deptMode || !this.cueEditorUnlocked}
        @click=${this._onAnnotate}
      >
        ${unsafeHTML(IconPenToSquare)}
      </button>
      <button
        id="nextCueBtn"
        class="icon-btn"
        title="Jump to next cue"
        aria-label="Jump to next cue"
        ?hidden=${!deptMode}
        @click=${this._onNextCue}
      >
        ${unsafeHTML(IconArrowDown)}<span>C</span>
      </button>
      <button
        id="rejoinBtn"
        class="icon-btn"
        title="Rejoin master position"
        aria-label="Rejoin master position"
        ?disabled=${!this.canRejoin}
        @click=${this._onRejoin}
      >
        ${unsafeHTML(IconCircleDot)}
      </button>

      <div id="passwordPanel" class="password-panel" ?hidden=${!this.passwordOpen}>
        <input
          id="masterPassword"
          type="password"
          autocomplete="current-password"
          placeholder="${passwordPlaceholder}"
          aria-label="${passwordPlaceholder}"
          ?hidden=${this.conflictActive}
          @keydown=${this._onPasswordKeyDown}
        >
        <button
          id="masterLoginBtn"
          title="${loginBtnTitle}"
          ?hidden=${this.conflictActive}
          @click=${this._onSubmitPassword}
        >
          Unlock
        </button>
        <button
          id="takeControlBtn"
          title="Take master control"
          ?hidden=${!this.conflictActive}
          @click=${this._onTakeControl}
        >
          Take control
        </button>
        <button
          id="masterCancelBtn"
          class="icon-btn"
          title="Cancel"
          aria-label="Cancel"
          @click=${this._onCancelPassword}
        >
          ${unsafeHTML(IconXmark)}
        </button>
      </div>

      <div
        id="syncStatus"
        class="${this.syncStatusClass}"
        @click=${this._onSyncStatusClick}
      >
        ${this.syncStatusText}
      </div>
      <div
        id="masterHealthStatus"
        class="${this.healthClass}"
        title="${this.healthTitle}"
      >
        ${this.healthHtml ? unsafeHTML(this.healthHtml) : (this.healthText || '')}
      </div>
    `;
  }
}

customElements.define('toolbar-sync', ToolbarSync);
