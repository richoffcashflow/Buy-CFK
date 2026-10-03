let cached;
export async function guestCheckoutReady(appId, fetcher=fetch) {
  if (!appId) return false;
  if (cached?.appId===appId && cached.expires>Date.now()) return cached.ready;
  try {
    const response=await fetcher('https://auth.privy.io/api/v1/apps/'+encodeURIComponent(appId),{
      headers:{'privy-app-id':appId},signal:AbortSignal.timeout(4000)
    });
    if (!response.ok) return false;
    const config=await response.json();
    const ready=config.guest_auth===true && config.email_auth===true;
    cached={appId,ready,expires:Date.now()+60000};
    return ready;
  } catch { return false; }
}
