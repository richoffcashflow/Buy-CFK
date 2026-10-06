import {PublicKey} from '@solana/web3.js';

export const CARD_CHAIN = 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp';
export const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function cardConfig(env = process.env) {
  // These are public on-chain targets, never API secrets. Do not fall back to
  // another merchant or a sandbox target when production configuration is absent.
  if (env.CARDS_ENABLED !== 'true') return {enabled: false};
  const programId = env.CARD_PROGRAM_ID, merchantId = env.CARD_MERCHANT_ID;
  try {
    if (new PublicKey(programId).toBase58() !== programId || !/^(0|[1-9]\d*)$/.test(merchantId || '') || BigInt(merchantId) > 18446744073709551615n) return {enabled: false};
  } catch {return {enabled: false};}
  if (env.CARD_STABLECOIN_ADDRESS !== USDC_MINT) return {enabled: false};
  return {enabled: true, environment: 'production', chainId: CARD_CHAIN, asset: 'usdc',
    spendApproval: {stablecoinAddress: USDC_MINT, programId, merchantId}};
}
