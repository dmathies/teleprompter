import { LitElement, html } from 'lit';
import './toolbar-navigation.scss';

export class ToolbarNavigation extends LitElement {
  static properties = {
    currentScriptId: { type: String },
    availableScripts: { type: Array },
    sceneList: { type: Array },
    songList: { type: Array },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.currentScriptId = '';
    this.availableScripts = [];
    this.sceneList = [];
    this.songList = [];
  }

  _onScriptChange(e) {
    const scriptId = e.target.value;
    this.dispatchEvent(new CustomEvent('select-script', {
      detail: { scriptId },
      bubbles: true,
      composed: true,
    }));
  }

  _onSceneChange(e) {
    const promptId = e.target.value;
    if (!promptId) return;
    this.dispatchEvent(new CustomEvent('jump-scene', {
      detail: { promptId },
      bubbles: true,
      composed: true,
    }));
    e.target.value = '';
  }

  _onSongChange(e) {
    const promptId = e.target.value;
    if (!promptId) return;
    this.dispatchEvent(new CustomEvent('jump-song', {
      detail: { promptId },
      bubbles: true,
      composed: true,
    }));
    e.target.value = '';
  }

  render() {
    return html`
      <select
        id="scriptSelect"
        title="Choose script"
        aria-label="Choose script"
        .value=${this.currentScriptId}
        @change=${this._onScriptChange}
      >
        <option value="">Script…</option>
        ${this.availableScripts.map(
          (s) => html`<option value="${s.id}" ?selected=${s.id === this.currentScriptId}>${s.name}</option>`
        )}
      </select>

      <select
        id="sceneSelect"
        title="Jump to scene"
        aria-label="Jump to scene"
        @change=${this._onSceneChange}
      >
        <option value="">Scene…</option>
        ${this.sceneList.map(
          (item) => html`<option value="${item.promptId}">${item.label}</option>`
        )}
      </select>

      <select
        id="songSelect"
        title="Jump to song"
        aria-label="Jump to song"
        @change=${this._onSongChange}
      >
        <option value="">Song…</option>
        ${this.songList.map(
          (item) => html`<option value="${item.promptId}">${item.label}</option>`
        )}
      </select>
    `;
  }
}

customElements.define('toolbar-navigation', ToolbarNavigation);
