import {database} from './db.mjs';

// Authentication happens in the API before this query. Never return provider
// client secrets, signed transactions, or another account's recovery references.
export async function accountHistory(user) {
  const {rows}=await database().query(`
    SELECT * FROM (
      SELECT 'payment' AS kind, r.id, r.direction AS action, r.status,
        r.gross_cents AS amount_cents, r.created_at, NULL::text AS signature,
        NULL::uuid AS funding_id,
        (r.status IN ('created','pending','review_required') OR
          (r.status='completed' AND r.direction='onramp' AND NOT EXISTS (
            SELECT 1 FROM cfk_orders o WHERE o.funding_id=r.id AND o.status='confirmed'
          ))) AS recoverable
      FROM cfk_ramps r WHERE r.user_id=$1
      UNION ALL
      SELECT 'trade' AS kind, o.id, o.side AS action, o.status,
        o.amount_usd_cents AS amount_cents, o.created_at, o.signature,
        o.funding_id, (o.status='submitted' AND o.signature IS NOT NULL) AS recoverable
      FROM cfk_orders o WHERE o.user_id=$1
    ) activity ORDER BY created_at DESC, id DESC LIMIT 20
  `,[user.id]);
  return {items:rows.map(row=>({
    kind:row.kind,id:row.id,action:row.action,status:row.status,
    amountCents:Number(row.amount_cents),createdAt:new Date(row.created_at).toISOString(),
    signature:row.signature,recoverable:row.recoverable,
    ...(row.funding_id?{rampId:row.funding_id}:{})
  }))};
}
