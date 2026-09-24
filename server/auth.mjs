import {importSPKI,jwtVerify} from 'jose';
import {appError,fetchJson,validAddress} from './core.mjs';
let key;
export async function authenticate(req,wallet){
  if(!process.env.PRIVY_APP_ID||!process.env.PRIVY_APP_SECRET||!process.env.PRIVY_VERIFICATION_KEY)throw appError('Account setup is being completed. Please try again later.',503);
  const token=String(req.headers.authorization||'').replace(/^Bearer /,'');
  if(!token)throw appError('Sign in to continue.',401);
  try{
    key??=await importSPKI(process.env.PRIVY_VERIFICATION_KEY.replace(/\\n/g,'\n'),'ES256');
    const {payload}=await jwtVerify(token,key,{issuer:'privy.io',audience:process.env.PRIVY_APP_ID,algorithms:['ES256']});
    if(!payload.sub||!String(payload.sub).startsWith('did:privy:'))throw new Error('Invalid user');
    if(wallet){
      if(!validAddress(wallet))throw appError('Invalid wallet.');
      const user=await fetchJson(`https://auth.privy.io/api/v1/users/${encodeURIComponent(payload.sub)}`,{headers:{Authorization:`Basic ${Buffer.from(process.env.PRIVY_APP_ID+':'+process.env.PRIVY_APP_SECRET).toString('base64')}`,'privy-app-id':process.env.PRIVY_APP_ID}});
      if(!(user.linked_accounts||[]).some(a=>a.type==='wallet'&&a.chain_type==='solana'&&a.address===wallet))throw appError('This wallet is not connected to your account.',403);
    }
    return {id:payload.sub};
  }catch(e){if(e.status)throw e;throw appError('Your session expired. Please sign in again.',401);}
}
