// No wallet is created until the returned function is explicitly called for funding.
export function createWalletOnDemand({findWallet, createWallet}) {
  let createdAddress = null, pending = null;
  return async function ensureWallet() {
    const existing = findWallet();
    if (existing?.address) return existing.address;
    if (createdAddress) return createdAddress;
    if (!pending) {
      pending = Promise.resolve().then(createWallet).then(result => {
        if (!result?.wallet?.address) throw new Error('Your coin account could not be prepared. Please try again.');
        createdAddress = result.wallet.address;
        return createdAddress;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}

export async function walletForAction(bridge, side, checkout) {
  if (side === 'buy') {
    if (checkout?.buyEnabled !== true) throw new Error('Buying is being connected. No payment has been taken.');
    return bridge.address || bridge.ensureWallet();
  }
  if (!bridge.address) throw new Error(side === 'withdraw' ? 'There is no money to withdraw yet.' : 'You do not have any CFK to sell yet.');
  return bridge.address;
}
