import { LitElement } from 'lit';

/**
 * Base LitElement that supports binding to an observable controller or store,
 * automatically requesting re-renders upon change events.
 */
export class BaseControllerElement extends LitElement {
  static properties = {
    controller: { type: Object, attribute: false },
  };

  createRenderRoot() {
    // Light DOM default across teleprompter components for stylesheet sharing
    return this;
  }

  constructor() {
    super();
    this.controller = null;
    this._unsubscribeController = null;
  }

  connectedCallback() {
    super.connectedCallback();
    this._bindController();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unbindController();
  }

  updated(changedProperties) {
    super.updated(changedProperties);
    if (changedProperties.has('controller')) {
      this._unbindController();
      this._bindController();
      this.onControllerAttached(this.controller);
    }
  }

  _bindController() {
    if (!this.controller) return;

    // 1. If controller is an EventTarget (or has addEventListener), listen for 'change' or 'update'
    if (typeof this.controller.addEventListener === 'function') {
      const handler = () => {
        this.onControllerUpdate(this.controller);
        this.requestUpdate();
      };
      this.controller.addEventListener('change', handler);
      this.controller.addEventListener('update', handler);
      this._unsubscribeController = () => {
        this.controller.removeEventListener('change', handler);
        this.controller.removeEventListener('update', handler);
      };
    }
    // 2. If controller provides a subscribe method (like our Store)
    else if (typeof this.controller.subscribe === 'function') {
      this._unsubscribeController = this.controller.subscribe(() => {
        this.onControllerUpdate(this.controller);
        this.requestUpdate();
      });
    }

    this.onControllerUpdate(this.controller);
  }

  _unbindController() {
    if (this._unsubscribeController) {
      this._unsubscribeController();
      this._unsubscribeController = null;
    }
  }

  /**
   * Hook called whenever the attached controller publishes an update.
   * Components can override this to pull new data or map properties.
   */
  onControllerUpdate(controller) {}

  /**
   * Hook called when a controller instance is newly assigned.
   */
  onControllerAttached(controller) {}
}
