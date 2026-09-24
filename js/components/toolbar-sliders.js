import { html } from 'lit';
import { BaseControllerElement } from './base-controller-element.js';
import './toolbar-sliders.scss';

export class ToolbarSliders extends BaseControllerElement {
  static properties = {
    ...BaseControllerElement.properties,
    speed: { type: Number },
    statusText: { type: String },
    isPlaying: { type: Boolean },
    disabled: { type: Boolean },
    hideStatus: { type: Boolean },
  };

  createRenderRoot() {
    return this;
  }

  constructor() {
    super();
    this.speed = 2.0;
    this.statusText = '';
    this.isPlaying = false;
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

  onControllerUpdate(controller) {
    if (!controller) return;
    if (typeof controller.isPlaying === 'function') {
      this.isPlaying = controller.isPlaying();
    }
    if (typeof controller.getSpeed === 'function') {
      this.speed = controller.getSpeed();
    }
  }

  render() {
    const displayStatus = this.statusText || `${this.isPlaying ? 'Playing' : 'Paused'} | Speed: ${Number(this.speed).toFixed(1)}`;

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

      <div id="status" ?hidden=${this.hideStatus}>${displayStatus}</div>
    `;
  }
}

customElements.define('toolbar-sliders', ToolbarSliders);
