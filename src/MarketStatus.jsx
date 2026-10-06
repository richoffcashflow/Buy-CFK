import React, {useEffect, useState} from 'react';

export default function MarketStatus({market, online, error}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = setInterval(tick, 15000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick); };
  }, []);
  const age = now - Date.parse(market?.updatedAt);
  const live = online && !error && market?.priceUsd > 0 && Number.isFinite(age) && age < 120000 && age > -60000;
  const label = !online ? 'Offline' : error ? 'Reconnecting' : !market ? 'Connecting' : live ? 'Live price' : 'Last price';
  return <span className={'market-status'+(live?' is-live':'')} title={live?'Market refreshes every 30 seconds':label}>
    <span aria-hidden="true"/>{label}
  </span>;
}
