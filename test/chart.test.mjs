import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {observedHistory} from '../server/chart-history.mjs';
import {cleanPoints, nearestPoint, priceDomain} from '../src/chart-model.js';

test('chart inspection follows timestamps, handles gaps, and has a finite flat-price scale', () => {
  const row = (time, price) => [time, price, price, price, price, 0];
  const points = cleanPoints([row(100, .01), row(1000, .02), row(150, .012), row(100, .011), row(0, 2), row(120, NaN)]);
  assert.deepEqual(points.map(p => p[0]), [100, 150, 1000]);
  assert.equal(nearestPoint(points, 500), 1);
  assert.equal(nearestPoint(points, 800), 2);
  assert.equal(nearestPoint(points, -1), 0);
  assert.equal(nearestPoint(points, 10000), 2);
  assert.equal(nearestPoint([], 20), -1);
  const [low, high] = priceDomain([row(100, .00000357)]);
  assert.ok(Number.isFinite(low) && high > low && low < .00000357 && high > .00000357);
});

test('month and all-time history select actual prices and never fill missing observations', async () => {
  const db = new PGlite();
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const now = Date.parse('2026-09-25T00:00:00Z');
  const history = [[40*86400, .000001], [20*86400, .000002], [2*86400, .000003], [1800, .000004], [60, .000005]];
  try {
    for (const [ago, price] of history) await db.query('INSERT INTO cfk_market_samples(mint,observed_at,price_usd) VALUES($1,$2,$3)', ['cfk', new Date(now-ago*1000), price]);
    const hour = await observedHistory(db, 'cfk', '1h', now);
    const month = await observedHistory(db, 'cfk', '1m', now);
    const all = await observedHistory(db, 'cfk', 'all', now);
    assert.equal(hour.points.length, 2);
    assert.equal(month.points[0][4], .000002);
    assert.equal(all.points[0][4], .000001);
    assert.equal(all.points.at(-1)[4], .000005);
    assert.ok(all.points.every(p => history.some(([ago, price]) => p[0] === now/1000-ago && p[4] === price)));
    assert.ok(all.points.every((p, i) => i === 0 || p[0] > all.points[i-1][0]));
    assert.equal(await observedHistory(db, 'other', 'all', now), null);
    assert.equal(all.buildingHistory, false);
  } finally { await db.close(); }
});
