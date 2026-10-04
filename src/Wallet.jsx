import React, {useEffect, useMemo, useRef} from 'react';
import {PrivyProvider, useGuestAccounts, useLinkAccount, useLogin, usePrivy} from '@privy-io/react-auth';
import {useCreateWallet, useWallets, useSignTransaction} from '@privy-io/react-auth/solana';
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';
import {createWalletOnDemand} from './wallet-lifecycle.js';

function Bridge({onReady, onError, onCancel, activation, loginMethod, guestCheckoutEnabled}) {
  const {ready, authenticated, user, getAccessToken} = usePrivy();
  const {ready: walletsReady, wallets} = useWallets();
  const {createWallet} = useCreateWallet();
  const {signTransaction} = useSignTransaction();
  const {createGuestAccount} = useGuestAccounts();
  const wallet = wallets.find(w => w.standardWallet?.isPrivyWallet);
  const displayName = typeof user?.customMetadata?.cfk_display_name === 'string' ? user.customMetadata.cfk_display_name.slice(0,80) : '';
  const loginStarted = useRef(-1), lastAccount = useRef(null);
  const sdk = useRef(null);
  sdk.current = {wallet, createWallet, getAccessToken, signTransaction, userId: authenticated ? user?.id : null};
  const ensureWallet = useMemo(() => {
    const userId = user?.id;
    const createOnDemand = createWalletOnDemand({
      findWallet: () => sdk.current.wallet,
      createWallet: () => sdk.current.createWallet()
    });
    return async () => {
      if (!userId || sdk.current.userId !== userId) throw new Error('Please sign in again to continue.');
      return createOnDemand();
    };
  }, [user?.id]);
  const accountError = error => {
    if (String(error).includes('exited_auth_flow')) { onCancel(); return; }
    onError('Sign-in did not finish. If this email already belongs to another account, use a different email to save this purchase. Your current account has not been removed.');
  };
  const {login} = useLogin({onError: accountError});
  const {linkEmail} = useLinkAccount({onError: accountError});
  useEffect(() => {
    if (activation <= 0 || !ready || authenticated || loginStarted.current === activation) return;
    loginStarted.current = activation;
    if (loginMethod === 'guest') {
      if (!guestCheckoutEnabled) { onError('Guest checkout is not available yet. No payment has been taken.'); return; }
      let active=true;
      createGuestAccount().catch(()=>{if(active)onError('Guest checkout could not connect. No payment has been taken. Please try again.');});
      return()=>{active=false;};
    }
    login({loginMethods: ['email']});
  }, [ready, authenticated, login, activation, loginMethod, createGuestAccount, onError, guestCheckoutEnabled]);
  useEffect(() => {
    if (!authenticated || !walletsReady || !user?.id) return;
    const key = user.id + ':' + (wallet?.address || 'no-wallet') + ':' + Boolean(user.isGuest) + ':' + (user.email?.address || '') + ':' + displayName;
    if (lastAccount.current === key) return;
    lastAccount.current = key;
    const userId = user.id;
    // Sign-in is ready even when the user has never funded or created a wallet.
    onReady({userId, displayName, isGuest:Boolean(user.isGuest), needsEmail:!user.email?.address, upgrade:()=>user.isGuest?login({loginMethods:['email']}):linkEmail(), address: wallet?.address || null, getAccessToken: () => sdk.current.getAccessToken(), ensureWallet, sign: async base64 => {
      if (sdk.current.userId !== userId || !sdk.current.wallet) throw new Error('Your coin account is reconnecting. Please try again.');
      const transaction = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const {signedTransaction} = await sdk.current.signTransaction({transaction, wallet: sdk.current.wallet, chain: 'solana:mainnet', options: {uiOptions: {showWalletUIs: false}}});
      return btoa(String.fromCharCode(...signedTransaction));
    }});
  }, [authenticated, walletsReady, user?.id, user?.isGuest, user?.email?.address, wallet?.address, displayName, ensureWallet, onReady, login, linkEmail]);
  useEffect(() => {
    // Do not interrupt a person reading an email or approving a sign-in.
    if (!activation || authenticated || (ready && loginMethod !== 'guest')) return;
    const timer = setTimeout(() => onError('Your account connection is taking longer than usual. Please try again.'), 30000);
    return () => clearTimeout(timer);
  }, [authenticated, ready, loginMethod, onError, activation]);
  useEffect(() => {
    if (!activation || !authenticated || walletsReady) return;
    const timer = setTimeout(() => onError('You are signed in, but your coin account is still connecting. Please try again shortly.'), 30000);
    return () => clearTimeout(timer);
  }, [authenticated, walletsReady, onError, activation]);
  return null;
}
export default function Wallet({appId, onReady, onError, onCancel, activation, loginMethod, guestCheckoutEnabled}) {
  return <PrivyProvider appId={appId} config={{
    appearance: {theme: 'light', accentColor: '#028de3', logo: '/assets/cashflow-user-logo.png', walletChainType: 'solana-only'},
    loginMethods: ['email'],
    embeddedWallets: {ethereum: {createOnLogin: 'off'}, solana: {createOnLogin: 'off'}},
    solana: {rpcs: {'solana:mainnet': {rpc: createSolanaRpc(`${location.origin}/api/rpc`), rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')}}}
  }}><Bridge onReady={onReady} onError={onError} onCancel={onCancel} activation={activation} loginMethod={loginMethod} guestCheckoutEnabled={guestCheckoutEnabled}/></PrivyProvider>;
}
