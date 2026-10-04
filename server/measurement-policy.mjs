// Vercel supplies geolocation at the edge. Missing/unknown locations require
// an explicit choice; a default must never overwrite a saved opt-out or GPC.
export function measurementPolicy(req){
  const privacySignal=req.headers?.['sec-gpc']==='1';
  return {defaultEnabled:req.headers?.['x-vercel-ip-country']==='US'&&!privacySignal,privacySignal};
}
export function measurementAllowed(req,choice){
  const policy=measurementPolicy(req);
  return !policy.privacySignal&&(choice==='granted'||(choice==='default'&&policy.defaultEnabled));
}
