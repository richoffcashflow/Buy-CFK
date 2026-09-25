export const chartHours = {'1h': 1, '4h': 4, '1d': 24, '1w': 168, '1m': 720, all: null};

// Keep real observations and timestamps, even when a longer period is sampled.
export async function observedHistory(db, mint, range, now = Date.now()) {
  const hours = chartHours[range];
  const since = hours == null ? new Date(0) : new Date(now - hours * 3600000);
  const {rows: [bounds]} = await db.query(
    'SELECT min(observed_at) AS first, max(observed_at) AS last FROM cfk_market_samples WHERE mint=$1 AND observed_at >= $2',
    [mint, since]
  );
  if (!bounds?.first) return null;
  const bucket = Math.max(60, Math.ceil((new Date(bounds.last) - new Date(bounds.first)) / 1000 / 480 / 60) * 60);
  const {rows} = await db.query(`
    SELECT DISTINCT ON (floor(extract(epoch FROM observed_at) / $3))
      extract(epoch FROM observed_at) AS time, price_usd
    FROM cfk_market_samples WHERE mint=$1 AND observed_at >= $2
    ORDER BY floor(extract(epoch FROM observed_at) / $3), observed_at DESC`, [mint, since, bucket]);
  return {
    points: rows.map(r => [Number(r.time), r.price_usd, r.price_usd, r.price_usd, r.price_usd, 0]),
    source: 'Observed on-chain prices',
    historyStart: new Date(bounds.first).toISOString(),
    updatedAt: new Date(bounds.last).toISOString(),
    buildingHistory: hours != null && new Date(bounds.first).getTime() - since.getTime() > 600000
  };
}
