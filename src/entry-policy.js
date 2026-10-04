// Production always opens the website. Only an explicit test link may leave it.
export function sandboxLaunchUrl({hostname, search='', hash=''}) {
  if (!['buy-cfk.vercel.app','buycfk.com','www.buycfk.com'].includes(hostname.toLowerCase())) return null;
  const query = new URLSearchParams(search);
  if (query.get('checkout_test') !== 'stripe') return null;
  const url = new URL('https://buy-cfk-git-stripe-sandbox-cashflowkey.vercel.app/');
  url.search = search; url.hash = hash;
  return url.href;
}
