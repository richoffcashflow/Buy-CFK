export const PURCHASE_INTENT_KEY = 'cfk_purchase_intent';
const LIFETIME = 10 * 60 * 1000;

export function validAmount(value) {
  return typeof value === 'string' && /^\d+(\.\d{0,2})?$/.test(value) &&
    Number(value) >= .01 && Number(value) <= 1000000;
}

// Retain only an explicit Buy tap in this tab, for ten minutes.
// This is a checkout instruction, never proof of identity or payment.
export function readPurchaseIntent(store, now=Date.now()) {
  try {
    const action = JSON.parse(store.get(PURCHASE_INTENT_KEY) || 'null');
    if (action?.side === 'buy' && Number.isFinite(action.savedAt) &&
        now >= action.savedAt && now-action.savedAt < LIFETIME &&
        validAmount(String(action.amountUsd))) return action;
  } catch {}
  store.remove(PURCHASE_INTENT_KEY);
  return null;
}
