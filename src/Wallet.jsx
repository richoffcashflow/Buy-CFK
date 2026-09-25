import React, {useEffect, useMemo, useRef} from 'react';
import {PrivyProvider, useLogin, usePrivy} from '@privy-io/react-auth';
import {useCreateWallet, useWallets, useSignTransaction} from '@privy-io/react-auth/solana';
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';
import {createWalletOnDemand} from './wallet-lifecycle.js';

function Bridge({onReady, onError, onCancel, activation, loginMethod}) {
  const {ready, authenticated, user, getAccessToken} = usePrivy();
  const {ready: walletsReady, wallets} = useWallets();
  const {createWallet} = useCreateWallet();
  const {signTransaction} = useSignTransaction();
  const wallet = wallets.find(w => w.standardWallet?.isPrivyWallet);
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
  const {login} = useLogin({
    onError: error => {
      if (String(error).includes('exited_auth_flow')) { onCancel(); return; }
      onError('Telegram sign-in did not finish. Please try again.');
    }
  });
  useEffect(() => {
    if (activation <= 0 || !ready || authenticated || loginStarted.current === activation) return;
    loginStarted.current = activation;
    // Always offer the sign-in screen after an explicit tap. Telegram context alone
    // is not proof that seamless authentication succeeded.
    login({loginMethods: ['telegram']});
  }, [ready, authenticated, login, activation, loginMethod]);
  useEffect(() => {
    if (!authenticated || !walletsReady || !user?.id) return;
    const key = user.id + ':' + (wallet?.address || 'no-wallet');
    if (lastAccount.current === key) return;
    lastAccount.current = key;
    const userId = user.id;
    // Sign-in is ready even when the user has never funded or created a wallet.
    onReady({userId, address: wallet?.address || null, getAccessToken: () => sdk.current.getAccessToken(), ensureWallet, sign: async base64 => {
      if (sdk.current.userId !== userId || !sdk.current.wallet) throw new Error('Your coin account is reconnecting. Please try again.');
      const transaction = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const {signedTransaction} = await sdk.current.signTransaction({transaction, wallet: sdk.current.wallet, chain: 'solana:mainnet', options: {uiOptions: {showWalletUIs: false}}});
      return btoa(String.fromCharCode(...signedTransaction));
    }});
  }, [authenticated, walletsReady, user?.id, wallet?.address, ensureWallet, onReady]);
  useEffect(() => {
    if (!activation || ready) return;
    const timer = setTimeout(() => onError('The sign-in service is taking longer than usual. Please try again.'), 20000);
    return () => clearTimeout(timer);
  }, [ready, onError, activation]);
  useEffect(() => {
    if (!activation || !authenticated || walletsReady) return;
    const timer = setTimeout(() => onError('You are signed in, but your coin account is still connecting. Please try again shortly.'), 30000);
    return () => clearTimeout(timer);
  }, [authenticated, walletsReady, onError, activation]);
  return null;
}
export default function Wallet({appId, onReady, onError, onCancel, activation, loginMethod}) {
  return <PrivyProvider appId={appId} config={{
    appearance: {theme: 'light', accentColor: '#1683f8', logo: '/assets/cfk-coin.png', walletChainType: 'solana-only'},
    loginMethods: ['telegram'],
    embeddedWallets: {ethereum: {createOnLogin: 'off'}, solana: {createOnLogin: 'off'}},
    solana: {rpcs: {'solana:mainnet': {rpc: createSolanaRpc(`${location.origin}/api/rpc`), rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')}}}
  }}><Bridge onReady={onReady} onError={onError} onCancel={onCancel} activation={activation} loginMethod={loginMethod}/></PrivyProvider>;
}
