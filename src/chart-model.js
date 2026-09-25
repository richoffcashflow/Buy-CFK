export function cleanPoints(points = []) {
  const byTime = new Map();
  for (const row of points) {
    if (Array.isArray(row) && Number.isFinite(row[0]) && Number.isFinite(row[4]) && row[0] > 0 && row[4] > 0) byTime.set(row[0], row);
  }
  return [...byTime.values()].sort((a, b) => a[0] - b[0]);
}
export function nearestPoint(points, time) {
  if (!points.length) return -1;
  let low = 0, high = points.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (points[mid][0] < time) low = mid + 1;
    else high = mid;
  }
  return low > 0 && time - points[low - 1][0] < points[low][0] - time ? low - 1 : low;
}
export function priceDomain(points) {
  let low = Infinity, high = -Infinity;
  for (const p of points) { low = Math.min(low, p[4]); high = Math.max(high, p[4]); }
  if (!Number.isFinite(low)) return [0, 1];
  const padding = Math.max((high - low) * .16, high * .0005);
  return [Math.max(0, low - padding), high + padding];
}
