import {PublicKey,VersionedTransaction,AddressLookupTableAccount} from '@solana/web3.js';
import {mint,SOL_MINT,appError} from './core.mjs';
import {appendPlatformFee} from './platform-fee.mjs';

export const PUMP_PROGRAM='6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM='pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const ATA_PROGRAM='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const allowedPrograms=new Set([PUMP_PROGRAM,PUMP_AMM,TOKEN_PROGRAM,TOKEN_2022,ATA_PROGRAM,'11111111111111111111111111111111','ComputeBudget111111111111111111111111111111']);
// Discriminators and account positions from pump-fun/pump-public-docs IDLs.
const instructionKinds={
  '66063d1201daebea':{side:'buy',exact:false},
  '38fc74089edfcd5f':{side:'buy',exact:true},
  'c62e1552b4d9e870':{side:'buy',exact:true,amm:true},
  'b817ee6167c5d33d':{side:'buy',exact:false,v2:true},
  'c2ab1c46684d5b2f':{side:'buy',exact:true,v2:true},
  '33e685a4017f83ad':{side:'sell'},
  '5df6823ce7e940b2':{side:'sell',v2:true}
};
export function validateSwapInstruction(ix,keys,{program,side,wallet,input,cashLimit}){
  const bytes=Buffer.from(ix.data),kind=instructionKinds[bytes.subarray(0,8).toString('hex')];
  if(!kind||kind.side!==side||bytes.length<24)throw appError('This trade requested an unsupported action.',502);
  const amm=program===PUMP_AMM;
  if((kind.amm&&!amm)||(kind.v2&&amm))throw appError('This trade requested an unsupported route.',502);
  const mintIndex=amm?3:kind.v2?1:2,userIndex=amm?1:kind.v2?13:6;
  const key=i=>keys.get(ix.accountKeyIndexes[i])?.toBase58();
  if(key(mintIndex)!==mint()||key(userIndex)!==wallet)throw appError('The trade does not match your CFK account.',502);
  if((amm||kind.v2)&&![SOL_MINT,'11111111111111111111111111111111'].includes(key(amm?4:2)))throw appError('The quote asset is not supported.',502);
  const first=bytes.readBigUInt64LE(8),second=bytes.readBigUInt64LE(16);
  if(first<=0n||second<=0n||(side==='sell'&&first!==input)||(side==='buy'&&cashLimit&&(kind.exact?first:second)>cashLimit))throw appError('The trade exceeds your selected amount.',502);
}
export const curveAddress=()=>PublicKey.findProgramAddressSync([Buffer.from('bonding-curve'),new PublicKey(mint()).toBuffer()],new PublicKey(PUMP_PROGRAM))[0].toBase58();
export function decodeCurve(account){
  if(account?.owner!==PUMP_PROGRAM||!account.data?.[0])return null;
  const b=Buffer.from(account.data[0],'base64');
  if(b.length<49||!b.subarray(0,8).equals(Buffer.from([23,183,248,55,96,216,172,96])))return null;
  // Pump's current IDL appends quote_mint after the two flags. Legacy fields are unchanged.
  const quoteMint=b.length>=115?new PublicKey(b.subarray(83,115)).toBase58():'11111111111111111111111111111111';
  if(!['11111111111111111111111111111111',SOL_MINT].includes(quoteMint))return null;
  return {virtualToken:b.readBigUInt64LE(8),virtualSol:b.readBigUInt64LE(16),realToken:b.readBigUInt64LE(24),realSol:b.readBigUInt64LE(32),supply:b.readBigUInt64LE(40),complete:!!b[48]};
}
export async function fetchCurve(rpc){return decodeCurve((await rpc('getAccountInfo',[curveAddress(),{encoding:'base64',commitment:'confirmed'}])).value);}

export function pumpEvents(data,signature,decimals){
  if(!data||data.meta?.err)return [];
  const stack=[],items=[];
  for(const line of data.meta?.logMessages||[]){
    const invoke=line.match(/^Program (\w+) invoke \[/);if(invoke){stack.push(invoke[1]);continue;}
    if(/^Program \w+ (success|failed)/.test(line)){stack.pop();continue;}
    if(stack.at(-1)!==PUMP_PROGRAM||!line.startsWith('Program data: '))continue;
    const b=Buffer.from(line.slice(14),'base64');
    if(b.length<129||!b.subarray(0,8).equals(Buffer.from([189,219,127,211,78,230,97,238]))||new PublicKey(b.subarray(8,40)).toBase58()!==mint())continue;
    const timestamp=Number(b.readBigInt64LE(89));
    if(!Number.isSafeInteger(timestamp)||timestamp<=0)continue;
    items.push({id:signature,signature,side:b[56]?'buy':'sell',wallet:new PublicKey(b.subarray(57,89)).toBase58(),tokens:Number(b.readBigUInt64LE(48))/10**decimals,usd:null,timestamp:new Date(timestamp*1000).toISOString()});
  }
  return items.slice(0,1);
}
export async function pumpTransaction({wallet,side,input,decimals,slippageBps=100,cashLimit,platformFee,rpc}){
  // Official Pump builder supports the bonding curve and graduated AMM. Atomic
  // string amounts avoid float conversion; its unsigned response remains untrusted.
  const response=await fetch('https://fun-block.pump.fun/agents/swap',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({inputMint:side==='buy'?SOL_MINT:mint(),outputMint:side==='buy'?mint():SOL_MINT,amount:input.toString(),user:wallet,feePayer:wallet,slippagePct:slippageBps/100,frontRunningProtection:false,tipAmount:0,encoding:'base64'}),signal:AbortSignal.timeout(12000)});
  if(!response.ok)throw appError('A trade is not available for this amount right now. Please try again.',503);
  const result=await response.json();
  if(typeof result.transaction!=='string'||result.transaction.length>1644)throw appError('The trade response could not be verified.',502);
  const bytes=Buffer.from(result.transaction,'base64');
  if(bytes.length>1232)throw appError('The trade response could not be verified.',502);
  let tx=VersionedTransaction.deserialize(bytes);
  if(tx.message.header.numRequiredSignatures!==1||tx.message.staticAccountKeys[0].toBase58()!==wallet)throw appError('The trade does not match your account.',502);
  const tables=[];
  for(const lookup of tx.message.addressTableLookups||[]){const a=(await rpc('getAccountInfo',[lookup.accountKey.toBase58(),{encoding:'base64',commitment:'confirmed'}])).value;if(!a)throw appError('The trade route could not be verified.',502);tables.push(new AddressLookupTableAccount({key:lookup.accountKey,state:AddressLookupTableAccount.deserialize(Buffer.from(a.data[0],'base64'))}));}
  const keys=tx.message.getAccountKeys({addressLookupTableAccounts:tables});let hasPump=false;
  for(const ix of tx.message.compiledInstructions){
    const program=keys.get(ix.programIdIndex)?.toBase58();
    if(!allowedPrograms.has(program))throw appError('This trade route is not supported yet.',503);
    if(program===PUMP_PROGRAM||program===PUMP_AMM){validateSwapInstruction(ix,keys,{program,side,wallet,input,cashLimit});hasPump=true;}
    if([TOKEN_PROGRAM,TOKEN_2022].includes(program)&&![1,9,16,17,18,22].includes(ix.data[0]))throw appError('The trade requested an unsupported token permission.',502);
  }
  if(!hasPump||!Array.from({length:keys.length},(_,i)=>keys.get(i).toBase58()).includes(mint()))throw appError('The trade does not match CFK.',502);
  const mintAccount=(await rpc('getAccountInfo',[mint(),{encoding:'base64',commitment:'confirmed'}])).value;
  if(![TOKEN_PROGRAM,TOKEN_2022].includes(mintAccount?.owner))throw appError('The coin could not be verified.',503);
  const ata=PublicKey.findProgramAddressSync([new PublicKey(wallet).toBuffer(),new PublicKey(mintAccount.owner).toBuffer(),new PublicKey(mint()).toBuffer()],new PublicKey(ATA_PROGRAM))[0].toBase58();
  if(platformFee){if(side!=='buy')throw appError('Invalid fee direction.',502);tx=appendPlatformFee(tx,tables,wallet,platformFee);}
  const addresses=[wallet,ata,...(platformFee?[platformFee.recipient]:[])];
  const before=(await rpc('getMultipleAccounts',[addresses,{encoding:'base64',commitment:'confirmed'}])).value;
  const serialized=Buffer.from(tx.serialize()).toString('base64');
  const simulated=await rpc('simulateTransaction',[serialized,{encoding:'base64',sigVerify:false,commitment:'confirmed',accounts:{encoding:'base64',addresses}}]);
  if(simulated.value?.err||!simulated.value?.accounts?.[0])throw appError('This trade cannot complete right now. Try a smaller amount.',409);
  const tokenAmount=a=>a?.data?.[0]?Buffer.from(a.data[0],'base64').readBigUInt64LE(64):0n;
  const after=simulated.value.accounts;
  const tokenDelta=tokenAmount(after[1])-tokenAmount(before[1]);
  const cashDelta=BigInt(after[0].lamports)-BigInt(before[0]?.lamports||0);
  const feeLamports=platformFee?BigInt(platformFee.lamports):0n;
  if(platformFee&&(!Number.isSafeInteger(after[2]?.lamports)||BigInt(after[2].lamports)-BigInt(before[2]?.lamports||0)!==feeLamports))throw appError('The platform fee could not be simulated.',502);
  if(side==='buy'?(tokenDelta<=0n||cashDelta>=0n||-cashDelta>input*101n/100n+6000000n+feeLamports):(tokenDelta!==-input||cashDelta<=0n))throw appError('The expected trade amounts could not be verified.',502);
  return {transaction:serialized,tx,tokenAtomic:side==='buy'?tokenDelta:input,solAtomic:side==='buy'?-cashDelta:cashDelta,provider:'Pump'};
}
