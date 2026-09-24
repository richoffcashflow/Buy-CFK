import React,{useEffect,useRef} from 'react';
import {PrivyProvider,usePrivy} from '@privy-io/react-auth';
import {useWallets,useSignAndSendTransaction} from '@privy-io/react-auth/solana';
import {getBase58Decoder,createSolanaRpc,createSolanaRpcSubscriptions} from '@solana/kit';

function Bridge({onReady,onError,activation}){
  const {ready,authenticated,login,getAccessToken}=usePrivy();
  const {wallets}=useWallets();
  const {signAndSendTransaction}=useSignAndSendTransaction();
  const loginStarted=useRef(-1),lastAddress=useRef(null);
  useEffect(()=>{if(ready&&!authenticated&&loginStarted.current!==activation){loginStarted.current=activation;if(!window.Telegram?.WebApp?.initData)login();}},[ready,authenticated,login,activation]);
  useEffect(()=>{
    if(!authenticated||!wallets[0]||lastAddress.current===wallets[0].address)return;
    const wallet=wallets[0];lastAddress.current=wallet.address;
    onReady({address:wallet.address,getAccessToken,sign:async base64=>{
      const transaction=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));
      const {signature}=await signAndSendTransaction({transaction,wallet,chain:'solana:mainnet',options:{skipPreflight:false,uiOptions:{showWalletUIs:true}}});
      return getBase58Decoder().decode(signature);
    }});
  },[authenticated,wallets,getAccessToken,signAndSendTransaction,onReady]);
  useEffect(()=>{const t=setTimeout(()=>{if(!lastAddress.current)onError('Your wallet is still connecting. Check your sign-in and try again.');},45000);return()=>clearTimeout(t);},[onError]);
  return null;
}
export default function Wallet({appId,onReady,onError,activation}){
  return <PrivyProvider appId={appId} config={{appearance:{theme:'light',accentColor:'#237db7',logo:'/assets/cashflow-logo.png',walletChainType:'solana-only'},loginMethods:['telegram','email'],embeddedWallets:{solana:{createOnLogin:'users-without-wallets'}},solana:{rpcs:{'solana:mainnet':{rpc:createSolanaRpc(`${location.origin}/api/rpc`),rpcSubscriptions:createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com')}}}}}><Bridge onReady={onReady} onError={onError} activation={activation}/></PrivyProvider>;
}
