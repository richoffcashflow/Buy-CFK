export const CARD_FEE_BPS = 1500;

// USDC uses six decimal places. Quotes and settlement must use the same integer
// calculation; this helper alone does not collect a fee or authorize a sale.
export function cardConversionAmounts(grossAtomic) {
  const gross = BigInt(grossAtomic);
  if (gross <= 0n) throw new Error('Choose a positive amount.');
  const fee = (gross * BigInt(CARD_FEE_BPS) + 5000n) / 10000n;
  return {gross: gross.toString(), fee: fee.toString(), net: (gross - fee).toString()};
}

export function cardWalletId(accounts, address) {
  return accounts?.find(account => account.type === 'wallet' &&
    account.walletClientType === 'privy' && account.connectorType === 'embedded' &&
    account.chainType === 'solana' && account.address === address)?.id;
}

export async function findOpenCard(getPage, environment, walletId) {
  let cursor;
  const seen = new Set();
  do {
    const page = await getPage({environment, limit: 20, ...(cursor ? {cursor} : {})});
    if (!Array.isArray(page?.data)) throw new Error('Your cards could not be loaded. Please retry.');
    const card = page.data.find(item => item.wallet_id === walletId && ['active', 'inactive'].includes(item.status));
    if (card) return card;
    cursor = page.next_cursor;
    if (cursor && seen.has(cursor)) throw new Error('Your cards could not be loaded. Please retry.');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return null;
}
