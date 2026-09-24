import {reconcileTrades} from '../server/trade.mjs';
import {reconcileRamps} from '../server/ramp.mjs';
import {flushEvents} from '../server/events.mjs';
import {database} from '../server/db.mjs';
import {snapshotMarket} from '../server/market.mjs';

// Run on a persistent service with the same server environment as the API.
// Process serially: the PostgreSQL outbox and wallet locks make retries safe.
if(!process.env.DATABASE_URL&&!process.env.POSTGRES_URL)throw new Error('A database URL is required.');
let stopping=false;
for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stopping=true;});
while(!stopping){
  try{
    await reconcileRamps();
    await reconcileTrades();
    await flushEvents(25);
    await snapshotMarket();
    await database().query("DELETE FROM cfk_market_samples WHERE observed_at<now()-interval '8 days'");
    await database().query('DELETE FROM cfk_rate_limits WHERE expires_at<now()');
    await database().query("UPDATE cfk_sessions SET consent=false,attribution='{}',ip=NULL,user_agent=NULL WHERE expires_at<now() AND (consent OR attribution<>'{}'::jsonb)");
    await database().query("UPDATE cfk_events SET metadata=metadata-'measurement' WHERE created_at<now()-interval '30 days' AND metadata ? 'measurement'");
  }catch{console.error('Worker cycle failed; retrying without discarding queued events.');}
  if(!stopping)await new Promise(resolve=>setTimeout(resolve,15000));
}
await database().end();
