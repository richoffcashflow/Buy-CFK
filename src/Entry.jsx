import React, {lazy, Suspense, useEffect} from 'react';
import {sandboxLaunchUrl} from './entry-policy.js';

const App = lazy(() => import('./App.jsx'));

export default function Entry() {
  const testUrl = sandboxLaunchUrl({hostname:location.hostname,search:location.search,hash:location.hash});
  useEffect(() => { if (testUrl) location.replace(testUrl); }, [testUrl]);
  if (testUrl) return <p className="app-loading" role="status">Opening CFK test checkout…</p>;
  return <Suspense fallback={<p className="app-loading" role="status">Opening CFK…</p>}><App /></Suspense>;
}
