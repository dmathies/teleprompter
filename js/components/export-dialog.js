import { LitElement, html } from 'lit';
import './export-dialog.scss';

export class ExportDialog extends LitElement {
  static properties = {
    open: { type: Boolean },
    department: { type: String },
    stageDirections: { type: String },
    exportCues: { type: Boolean },
    exportAnnotations: { type: Boolean },
    status: { type: String },
    isError: { type: Boolean },
    busy: { type: Boolean },
  };

  createRenderRoot() {
    // Render to Light DOM so existing styles in css/teleprompter.css apply directly.
    return this;
  }

  constructor() {
    super();
    this.open = false;
    this.department = 'ALL';
    this.stageDirections = 'all';
    this.exportCues = true;
    this.exportAnnotations = true;
    this.status = '';
    this.isError = false;
    this.busy = false;
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

  show(initialDept = 'ALL') {
    this.department = initialDept;
    this.status = '';
    this.isError = false;
    this.busy = false;
    this.open = true;
  }

  close() {
    this.open = false;
    this.status = '';
    this.isError = false;
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  _onPointerDown(e) {
    e.stopPropagation();
  }

  _onDepartmentChange(e) {
    this.department = e.target.value;
  }

  _onStageDirectionsChange(e) {
    this.stageDirections = e.target.value;
  }

  _onCuesChange(e) {
    this.exportCues = e.target.checked;
  }

  _onAnnotationsChange(e) {
    this.exportAnnotations = e.target.checked;
  }

  _onExportClick() {
    this.dispatchEvent(new CustomEvent('export', {
      detail: {
        department: this.department,
        stageDirections: this.stageDirections,
        exportCues: this.exportCues,
        exportAnnotations: this.exportAnnotations,
      },
      bubbles: true,
      composed: true,
    }));
  }

  render() {
    if (!this.open) {
      return html`
        <div id="exportBackdrop" hidden></div>
        <div id="exportPanel" hidden></div>
      `;
    }

    return html`
      <div id="exportBackdrop" @pointerdown=${this._onPointerDown} @click=${this.close}></div>
      <div id="exportPanel" role="dialog" aria-modal="true" aria-labelledby="exportTitle" @pointerdown=${this._onPointerDown}>
        <h3 id="exportTitle">Export marked-up script</h3>
        <div class="export-row">
          <label for="exportDepartment">Cues / annotations</label>
          <select id="exportDepartment" .value=${this.department} @change=${this._onDepartmentChange}>
            <option value="ALL">All departments</option>
            <option value="FS">FS</option>
            <option value="LX">LX</option>
            <option value="SND">SND</option>
            <option value="STG">STG</option>
            <option value="NONE">Script only</option>
          </select>
        </div>
        <div class="export-row">
          <label for="exportStageDirections">Stage directions</label>
          <select id="exportStageDirections" .value=${this.stageDirections} @change=${this._onStageDirectionsChange}>
            <option value="all">Show all</option>
            <option value="relevant">Relevant to selected cues</option>
            <option value="hide">Hide</option>
          </select>
        </div>
        <div class="export-row">
          <label for="exportCues">Cue markers</label>
          <input id="exportCues" type="checkbox" .checked=${this.exportCues} @change=${this._onCuesChange}>
        </div>
        <div class="export-row">
          <label for="exportAnnotations">Annotations</label>
          <input id="exportAnnotations" type="checkbox" .checked=${this.exportAnnotations} @change=${this._onAnnotationsChange}>
        </div>
        <div id="exportActions">
          <span id="exportStatus" role="status" class="${this.isError ? 'error' : ''}">${this.status}</span>
          <span class="spacer"></span>
          <button id="exportCancelBtn" type="button" @click=${this.close}>Cancel</button>
          <button id="exportOpenBtn" type="button" ?disabled=${this.busy} @click=${this._onExportClick}>Open print / PDF view</button>
        </div>
      </div>
    `;
  }
}

customElements.define('export-dialog', ExportDialog);
