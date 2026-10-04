import {appError, fetchJson} from './core.mjs';

export function normalizeDisplayName(value) {
  if (typeof value !== 'string') throw appError('Enter your name.');
  const name = value.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || [...name].length > 40 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw appError('Use a name between 1 and 40 characters.');
  return name;
}

export async function saveAccountProfile(user, body) {
  const displayName = normalizeDisplayName(body.displayName);
  // PATCH merges only this presentation field. It cannot overwrite role,
  // verification or card eligibility metadata, or target another user's profile.
  const updated = await fetchJson(`https://auth.privy.io/api/v1/users/${encodeURIComponent(user.id)}/custom_metadata`, {
    method: 'PATCH', headers: {'Content-Type':'application/json','privy-app-id':process.env.PRIVY_APP_ID,
      Authorization:`Basic ${Buffer.from(process.env.PRIVY_APP_ID+':'+process.env.PRIVY_APP_SECRET).toString('base64')}`},
    body: JSON.stringify({custom_metadata:{cfk_display_name:displayName}})
  });
  if (updated.id !== user.id || updated.custom_metadata?.cfk_display_name !== displayName) throw appError('Your name could not be saved. Please try again.',502);
  return {displayName};
}
