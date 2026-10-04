import {appError,fetchJson} from './core.mjs';

const normalizeEmail=value=>typeof value==='string'?value.trim().toLowerCase():'';
export function isVerifiedAdmin(user,email){
  const expected=normalizeEmail(email);
  if(!expected||user?.is_guest!==false)return false;
  return (user.linked_accounts||[]).some(account=>account.type==='email'&&
    normalizeEmail(account.address)===expected&&
    [account.latest_verified_at,account.first_verified_at,account.verified_at].some(time=>Number.isSafeInteger(time)&&time>0));
}

export async function accountAccess(authenticatedUser){
  if(!process.env.CFK_ADMIN_EMAIL)return {isAdmin:false};
  if(!process.env.PRIVY_APP_ID||!process.env.PRIVY_APP_SECRET)throw appError('Account access could not be checked. Please try again.',503);
  // The API authenticates the bearer token first. Never accept an email, role,
  // or target user ID from a browser when deciding who receives owner access.
  const user=await fetchJson(`https://api.privy.io/v1/users/${encodeURIComponent(authenticatedUser.id)}`,{
    headers:{'privy-app-id':process.env.PRIVY_APP_ID,
      Authorization:`Basic ${Buffer.from(process.env.PRIVY_APP_ID+':'+process.env.PRIVY_APP_SECRET).toString('base64')}`}
  });
  if(user.id!==authenticatedUser.id)throw appError('Account access could not be verified.',502);
  return {isAdmin:isVerifiedAdmin(user,process.env.CFK_ADMIN_EMAIL)};
}
