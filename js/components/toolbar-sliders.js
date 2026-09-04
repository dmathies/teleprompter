import { LitElement, html } from 'lit';
import './toolbar-sliders.scss';

export class ToolbarSliders extends LitElement {
  static properties = {
    speed: { type: Number },
    fontSize: { type: Number },
    statusText: { type: String },
    disabled: { type: Boolean },
    hideStatus: { type: Boolean },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.speed = 2.0;
    this.fontSize = 42;
    this.statusText = 'Paused | Speed: 2.0';
    this.disabled = false;
    this.hideStatus = false;
  }

  _onSpeedInput(e) {
    const speed = parseFloat(e.target.value);
    this.speed = speed;
    this.dispatchEvent(new CustomEvent('speed-input', {
      detail: { speed },
      bubbles: true,
      composed: true,
    }));
  }

  _onSpeedChange(e) {
    const speed = parseFloat(e.target.value);
    this.speed = speed;
    this.dispatchEvent(new CustomEvent('speed-change', {
      detail: { speed },
      bubbles: true,
      composed: true,
    }));
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

  render() {
    return html`
      <span id="speedControl">
        <label for="speedInput">Speed</label>
        <input
          id="speedInput"
          type="range"
          min="0"
          max="20"
          step="0.1"
          .value=${String(this.speed)}
          ?disabled=${this.disabled}
          @input=${this._onSpeedInput}
          @change=${this._onSpeedChange}
        >
      </span>

      <label for="fontSizeInput">Font</label>
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

      <div id="status" ?hidden=${this.hideStatus}>${this.statusText}</div>
    `;
  }
}

customElements.define('toolbar-sliders', ToolbarSliders);
