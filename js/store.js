/**
 * Event emitter / observable store helper for teleprompter UI components and controllers.
 */
export class Store extends EventTarget {
  constructor(initialState = {}) {
    super();
    this._state = { ...initialState };
  }

  getState() {
    return this._state;
  }

  setState(partialState) {
    const nextState = typeof partialState === 'function'
      ? partialState(this._state)
      : { ...this._state, ...partialState };

    let changed = false;
    for (const key of Object.keys(nextState)) {
      if (nextState[key] !== this._state[key]) {
        changed = true;
        break;
      }
    }

    if (!changed && Object.keys(nextState).length === Object.keys(this._state).length) {
      return;
    }

    this._state = nextState;
    this.dispatchEvent(new CustomEvent('change', { detail: this._state }));
  }

  subscribe(listener) {
    const handler = (e) => listener(e.detail);
    this.addEventListener('change', handler);
    // Call immediately with initial state
    listener(this._state);
    return () => this.removeEventListener('change', handler);
  }
}
