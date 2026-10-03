const PRODUCTION_ORIGINS = new Set([
  'https://buycfk.com', 'https://www.buycfk.com', 'https://buy-cfk.vercel.app'
]);

export function allowedRequestOrigin(origin, appUrl=process.env.APP_URL) {
  if (!origin || !appUrl) return true;
  let configured;
  try { configured = new URL(appUrl).origin; } catch { return false; }
  if (origin === configured) return true;
  // These verified aliases serve this project; unrelated origins stay blocked.
  return PRODUCTION_ORIGINS.has(configured) && PRODUCTION_ORIGINS.has(origin);
}
