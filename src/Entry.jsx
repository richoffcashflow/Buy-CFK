import React, {lazy, Suspense, useEffect, useState} from 'react';
import {sandboxLaunchUrl, browserAppUrl, shouldOpenTelegram, telegramLaunchUrl} from './entry-policy.js';

const App = lazy(() => import('./App.jsx'));
const needsHandoff = () => shouldOpenTelegram({hostname:location.hostname, pathname:location.pathname, search:location.search, hash:location.hash, initData:window.Telegram?.WebApp?.initData});

export default function Entry() {
  const testUrl = sandboxLaunchUrl({hostname:location.hostname,search:location.search,hash:location.hash,startParam:window.Telegram?.WebApp?.initDataUnsafe?.start_param});
  useEffect(() => { if (testUrl) location.replace(testUrl); }, [testUrl]);
  const [handoff, setHandoff] = useState(needsHandoff);
  const telegramUrl = telegramLaunchUrl(location.search);
  useEffect(() => {
    if (testUrl || !handoff) return;
    let attempts = 0, redirect;
    // Allow late Telegram initialization before deciding this is an external visit.
    const timer = setInterval(() => {
      if (!needsHandoff()) { clearInterval(timer); setHandoff(false); return; }
      if (++attempts >= 15) {
        clearInterval(timer);
        redirect = setTimeout(() => { if (needsHandoff()) location.replace(telegramUrl); else setHandoff(false); }, 100);
      }
    }, 100);
    return () => { clearInterval(timer); clearTimeout(redirect); };
  }, [handoff, telegramUrl, testUrl]);
  if (testUrl) return <p className="app-loading" role="status">Opening CFK test checkout…</p>;
  if (!handoff) return <Suspense fallback={<p className="app-loading" role="status">Opening CFK…</p>}><App /></Suspense>;
  return <main className="telegram-launcher"><section>
    <img src="/assets/cfk-coin.png" width="80" height="80" alt="Cashflowkey"/>
    <h1>Buy $CFK</h1>
    <p>Opening Cashflowkey in Telegram.</p>
    <a className="primary" href={telegramUrl}>Open in Telegram</a>
    <a className="browser-fallback" href={browserAppUrl(location.search)}>Continue in browser</a>
    <small>Operated by Free Crypto App LLC</small>
  </section></main>;
}
