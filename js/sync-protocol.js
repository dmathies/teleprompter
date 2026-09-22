export function stateAgeAtDeliveryMs(state) {
  if (!state) return null;
  if (typeof state.serverTime !== 'number' || typeof state.deliveryServerTime !== 'number' ||
      !Number.isFinite(state.serverTime) || !Number.isFinite(state.deliveryServerTime) ||
      state.serverTime <= 0 || state.deliveryServerTime < state.serverTime) return null;
  return Math.max(0, (state.deliveryServerTime - state.serverTime) * 1000);
}

export function motionSignature(state) {
  if (!state) return '';
  const fraction = Number(state.fraction);
  const stableFraction = Number.isFinite(fraction) ? Math.round(fraction * 10000) / 10000 : 0;
  return JSON.stringify([
    state.script || '', state.prompt || '', stableFraction,
    state.playing !== false, Number(state.speed) || 0
  ]);
}
