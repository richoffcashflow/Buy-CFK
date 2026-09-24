import React,{useEffect,useRef} from 'react';
import {PrivyProvider,usePrivy} from '@privy-io/react-auth';
import {useWallets,useSignTransaction} from '@privy-io/react-auth/solana';
import {createSolanaRpc,createSolanaRpcSubscriptions} from '@solana/kit';

function Bridge({onReady,onError,activation}){
  const {ready,authenticated,login,getAccessToken}=usePrivy();
  const {wallets}=useWallets();
  const {signTransaction}=useSignTransaction();
  const loginStarted=useRef(-1),lastAddress=useRef(null);
  useEffect(()=>{if(activation>0&&ready&&!authenticated&&loginStarted.current!==activation){loginStarted.current=activation;if(!window.Telegram?.WebApp?.initData)login();}},[ready,authenticated,login,activation]);
  useEffect(()=>{
    const wallet=wallets.find(w=>w.standardWallet?.isPrivyWallet);
    if(!authenticated||!wallet||lastAddress.current===wallet.address)return;
    lastAddress.current=wallet.address;
    onReady({address:wallet.address,getAccessToken,sign:async base64=>{
      const transaction=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const {signedTransaction}=await signTransaction({transaction,wallet,chain:'solana:mainnet',options:{uiOptions:{showWalletUIs:false}}});
      return btoa(String.fromCharCode(...signedTransaction));
    }});
  },[authenticated,wallets,getAccessToken,signTransaction,onReady]);
  useEffect(()=>{if(!activation)return;const t=setTimeout(()=>{if(!lastAddress.current)onError('Sign-in is still connecting. Please try again.');},45000);return()=>clearTimeout(t);},[onError,activation]);
  return null;
}
export default function Wallet({appId,onReady,onError,activation}){
  return <PrivyProvider appId={appId} config={{appearance:{theme:'light',accentColor:'#237db7',logo:'/assets/cashflow-logo.png',walletChainType:'solana-only'},loginMethods:['telegram','email'],embeddedWallets:{solana:{createOnLogin:'users-without-wallets'}},solana:{rpcs:{'solana:mainnet':{rpc:createSolanaRpc(`${location.origin}/api/rpc`),rpcSubscriptions:createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')}}}}}><Bridge onReady={onReady} onError={onError} activation={activation}/></PrivyProvider>;
}
