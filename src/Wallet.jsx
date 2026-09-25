import React, {useEffect, useRef} from 'react';
import {PrivyProvider, useLogin, usePrivy} from '@privy-io/react-auth';
import {useWallets, useSignTransaction} from '@privy-io/react-auth/solana';
import {createSolanaRpc, createSolanaRpcSubscriptions} from '@solana/kit';

function Bridge({onReady, onError, onCancel, activation, loginMethod}) {
  const {ready, authenticated, getAccessToken} = usePrivy();
  const {wallets} = useWallets();
  const {signTransaction} = useSignTransaction();
  const loginStarted = useRef(-1), lastAddress = useRef(null);
  const {login} = useLogin({
    onError: error => {
      if (String(error).includes('exited_auth_flow')) { onCancel(); return; }
      onError('Sign-in did not finish. You can try email or choose another available method.');
    }
  });
  useEffect(() => {
    if (activation <= 0 || !ready || authenticated || loginStarted.current === activation) return;
    loginStarted.current = activation;
    // Always offer the sign-in screen after an explicit tap. Telegram context alone
    // is not proof that seamless authentication succeeded.
    login(loginMethod ? {loginMethods: [loginMethod]} : undefined);
  }, [ready, authenticated, login, activation, loginMethod]);
  useEffect(() => {
    const wallet = wallets.find(w => w.standardWallet?.isPrivyWallet);
    if (!authenticated || !wallet || lastAddress.current === wallet.address) return;
    lastAddress.current = wallet.address;
    onReady({address: wallet.address, getAccessToken, sign: async base64 => {
      const transaction = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
      const {signedTransaction} = await signTransaction({transaction, wallet, chain: 'solana:mainnet', options: {uiOptions: {showWalletUIs: false}}});
      return btoa(String.fromCharCode(...signedTransaction));
    }});
  }, [authenticated, wallets, getAccessToken, signTransaction, onReady]);
  useEffect(() => {
    if (!activation || ready) return;
    const timer = setTimeout(() => onError('The sign-in service is taking longer than usual. Please try again.'), 20000);
    return () => clearTimeout(timer);
  }, [ready, onError, activation]);
  useEffect(() => {
    if (!activation || !authenticated || lastAddress.current) return;
    const timer = setTimeout(() => { if (!lastAddress.current) onError('You are signed in, but your coin account is still connecting. Please try again shortly.'); }, 30000);
    return () => clearTimeout(timer);
  }, [authenticated, onError, activation]);
  return null;
}
export default function Wallet({appId, onReady, onError, onCancel, activation, loginMethod}) {
  return <PrivyProvider appId={appId} config={{
    appearance: {theme: 'light', accentColor: '#1683f8', logo: '/assets/cfk-coin.png', walletChainType: 'solana-only'},
    loginMethods: ['email', 'telegram'],
    embeddedWallets: {solana: {createOnLogin: 'users-without-wallets'}},
    solana: {rpcs: {'solana:mainnet': {rpc: createSolanaRpc(`${location.origin}/api/rpc`), rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')}}}
  }}><Bridge onReady={onReady} onError={onError} onCancel={onCancel} activation={activation} loginMethod={loginMethod}/></PrivyProvider>;
}
