export const TELEGRAM_BOT = 'Cashflowkeybot';
export const WEB_APP_URL = 'https://buy-cfk.vercel.app/';

// Telegram context is only a navigation hint. Account access still requires
// server-verified Privy authentication; this never grants authorization.
export function shouldOpenTelegram({hostname, pathname, search, hash, initData}) {
  if (!['buycfk.com', 'www.buycfk.com'].includes(hostname.toLowerCase())) return false;
  if (pathname !== '/') return false;
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.replace(/^#/, ''));
  if (initData || fragment.has('tgWebAppData') || query.has('tgWebAppData')) return false;
  // Payment and authentication callbacks must finish without a Telegram bounce.
  if (['code', 'state', 'privy_oauth_code', 'privy_oauth_state'].some(key => query.has(key))) return false;
  return true;
}

export function telegramLaunchUrl(search = '') {
  const query = new URLSearchParams(search);
  const requested = query.get('startapp') || query.get('ref') || 'buycfk';
  const start = /^[A-Za-z0-9_-]{1,512}$/.test(requested) ? requested : 'buycfk';
  return `https://t.me/${TELEGRAM_BOT}?startapp=${start}&mode=fullscreen`;
}

export function browserAppUrl(search = '') {
  const url = new URL(WEB_APP_URL);
  url.search = search;
  return url.href;
}
