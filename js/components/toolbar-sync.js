import { html } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { BaseControllerElement } from './base-controller-element.js';
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
import { formatHealthAge } from '../utils.js';

export class ToolbarSync extends BaseControllerElement {
  static properties = {
    ...BaseControllerElement.properties,
    activeDepartment: { type: String },
    allowedDepartments: { type: Array },
    departmentMetadata: { type: Object },
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
    healthItems: { type: Array },
    healthChecks: { type: Object },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.activeDepartment = null;
    this.allowedDepartments = ['FS', 'LX', 'SND', 'STG'];
    this.departmentMetadata = {};
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
    this.healthItems = null;
    this.healthChecks = null;
    this.healthTitle = 'Master/server heartbeat and time since PRM interaction';
  }

  focusPassword() {
    const input = this.querySelector('#masterPassword');
    if (input) input.focus();
  }

  clearPassword() {
    const input = this.querySelector('#masterPassword');
    if (input) input.value = '';
  }

  setSyncStatus(message, cls = '') {
    this.syncStatusText = message;
    this.syncStatusClass = cls;
  }

  onControllerUpdate(controller) {
    if (!controller) return;
    if (typeof controller.getHealthChecks === 'function') {
      this.healthChecks = controller.getHealthChecks();
    }
    if (typeof controller.getSyncMode === 'function') {
      this.syncMode = controller.getSyncMode();
      this.isMaster = this.syncMode === 'master';
    }
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

  _onDepartmentChange(e) {
    const department = e.target.value;
    this.dispatchEvent(new CustomEvent('select-department', {
      detail: { department },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    const deptMode = !!this.activeDepartment;
    const currentVal = this.activeDepartment || '';

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

    const depts = Array.isArray(this.allowedDepartments) && this.allowedDepartments.length > 0
      ? this.allowedDepartments
      : ['FS', 'LX', 'SND', 'STG'];

    const meta = this.departmentMetadata || {};

    return html`
      <select
        id="deptSelect"
        class="dept-select"
        title="Department role"
        aria-label="Department role"
        .value=${currentVal}
        @change=${this._onDepartmentChange}
      >
        <option value="" ?selected=${!this.activeDepartment}>PRM - Prompt</option>
        ${depts.map((d) => {
          const entry = meta[d];
          const label = entry && entry.label ? `${d} - ${entry.label}` : d;
          return html`<option value="${d}" ?selected=${this.activeDepartment === d}>${label}</option>`;
        })}
      </select>
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

      <div
        id="passwordBackdrop"
        class="password-backdrop"
        ?hidden=${!this.passwordOpen}
        @click=${this._onCancelPassword}
        @pointerdown=${(e) => e.stopPropagation()}
      ></div>

      <div
        id="passwordPanel"
        class="password-panel"
        role="dialog"
        aria-label="Authentication"
        ?hidden=${!this.passwordOpen}
        @pointerdown=${(e) => e.stopPropagation()}
      >
        <div class="password-panel-title">
          <span>${deptMode ? `${this.activeDepartment} Editor Access` : 'Master Control Access'}</span>
        </div>
        <div class="password-panel-inputs">
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
            class="password-btn primary"
            title="${loginBtnTitle}"
            ?hidden=${this.conflictActive}
            @click=${this._onSubmitPassword}
          >
            Unlock
          </button>
          <button
            id="takeControlBtn"
            class="password-btn danger"
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
      </div>

      <div
        id="statusIndicators"
        class="status-indicators-container"
        aria-label="System status"
      >
        <div class="status-indicator-item" role="status">
          <span class="status-indicator-dot ${this._getSyncIndicatorColorClass()}"></span>
          <span class="indicator-tooltip">Sync: ${this.syncStatusText || 'Unknown'}</span>
        </div>
        ${this._renderHealthIndicators()}
      </div>
    `;
  }

  _getSyncIndicatorColorClass() {
    const cls = this.syncStatusClass || '';
    if (cls.includes('error')) return 'indicator-error';
    if (cls.includes('warn')) return 'indicator-warn';
    if (cls.includes('ok')) return 'indicator-ok';
    const text = (this.syncStatusText || '').toLowerCase();
    if (text.includes('error') || text.includes('wrong')) return 'indicator-error';
    if (text.includes('warn') || text.includes('paused') || text.includes('connecting') || text.includes('fallback') || text.includes('waiting')) return 'indicator-warn';
    if (text.includes('ok') || text.includes('live') || text.includes('connected')) return 'indicator-ok';
    return 'indicator-idle';
  }

  _classToIndicator(className) {
    if (!className) return 'indicator-idle';
    if (className.includes('health-error') || className.includes('error')) return 'indicator-error';
    if (className.includes('health-warn') || className.includes('warn')) return 'indicator-warn';
    if (className.includes('health-ok') || className.includes('ok')) return 'indicator-ok';
    return 'indicator-idle';
  }

  _renderHealthIndicators() {
    if (this.healthChecks && typeof this.healthChecks === 'object') {
      const { mode, server, master, net, input, ptp } = this.healthChecks;

      const indicators = [];

      if (mode === 'master') {
        if (server) {
          const age = server.formattedAge || formatHealthAge(server.ageMs);
          indicators.push(html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(server.className)}"></span>
              <span class="indicator-tooltip">Server: ${age}</span>
            </div>
          `);
        }
        if (input) {
          const age = input.formattedAge || formatHealthAge(input.ageMs);
          const label = input.label || 'Input';
          indicators.push(html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(input.className)}"></span>
              <span class="indicator-tooltip">${label}: ${age}</span>
            </div>
          `);
        }
      } else if (mode === 'follower') {
        if (master) {
          const age = master.formattedAge || formatHealthAge(master.ageMs);
          indicators.push(html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(master.className)}"></span>
              <span class="indicator-tooltip">Master: ${age}</span>
            </div>
          `);
        }
        if (net) {
          const age = net.formattedAge || formatHealthAge(net.ageMs);
          indicators.push(html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(net.className)}"></span>
              <span class="indicator-tooltip">Net: ${age}</span>
            </div>
          `);
        }
        if (input) {
          const age = input.formattedAge || formatHealthAge(input.ageMs);
          const label = input.label || 'Input';
          indicators.push(html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(input.className)}"></span>
              <span class="indicator-tooltip">${label}: ${age}</span>
            </div>
          `);
        }
      }

      if (ptp && ptp.synced) {
        const ptpText = `PTP: ±${Math.abs(ptp.offsetMs)}ms (RTT ${ptp.rttMs}ms)`;
        indicators.push(html`
          <div class="status-indicator-item">
            <span class="status-indicator-dot indicator-ok"></span>
            <span class="indicator-tooltip">${ptpText}</span>
          </div>
        `);
      }

      return html`<div id="masterHealthStatus" class="health-indicators-group" title="${this.healthTitle}">${indicators}</div>`;
    }

    if (Array.isArray(this.healthItems)) {
      return html`
        <div id="masterHealthStatus" class="health-indicators-group" title="${this.healthTitle}">
          ${this.healthItems.map(item => html`
            <div class="status-indicator-item">
              <span class="status-indicator-dot ${this._classToIndicator(item.className)}"></span>
              <span class="indicator-tooltip">${item.label}: ${item.value}</span>
            </div>
          `)}
        </div>
      `;
    }

    if (this.healthText || this.healthHtml) {
      const txt = this.healthText || this.healthTitle;
      return html`
        <div id="masterHealthStatus" class="status-indicator-item">
          <span class="status-indicator-dot ${this._classToIndicator(this.healthClass)}"></span>
          <span class="indicator-tooltip">${txt}</span>
        </div>
      `;
    }

    return '';
  }
}

customElements.define('toolbar-sync', ToolbarSync);
