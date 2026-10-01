// Unresolved payments are not session data: never discard them merely because
// a browser was closed or provider verification took more than a day.
export function readPending(stores) {
  for (const store of stores) {
    try {
      const pending = JSON.parse(store.get('cfk_pending') || 'null');
      if (pending && ['payment', 'funded', 'trade'].includes(pending.type) &&
          (pending.type === 'trade' ? pending.orderId : pending.rampId)) return pending;
    } catch {}
    store.remove('cfk_pending');
  }
  return null;
}

export function pendingTrade(quote, previous, side, transaction) {
  return {
    type: 'trade', orderId: quote.orderId, side,
    ...(quote.signature ? {signature: quote.signature} : {}),
    ...(transaction ? {transaction} : {}),
    // Retain the funding reference through signing and confirmation failures.
    ...(side === 'buy' && previous?.rampId ? {rampId: previous.rampId} : {})
  };
}

export function savedAmount(store){
  const value=store.get('cfk_amount');
  return typeof value==='string'&&/^\d+(\.\d{0,2})?$/.test(value)&&Number(value)>0&&Number(value)<=1000000?value:'20';
}
