import {PublicKey,TransactionMessage,VersionedTransaction,SystemProgram,SystemInstruction} from '@solana/web3.js';
import {appError} from './core.mjs';
import {validFeeRecipient} from './stripe-config.mjs';

// Append the platform transfer to the same transaction as the coin purchase.
// No standalone fee transaction is ever signed or submitted.
export function appendPlatformFee(tx,tables,wallet,fee){
  if(!validFeeRecipient(fee.recipient)||fee.recipient===wallet||!/^\d+$/.test(fee.lamports)||BigInt(fee.lamports)<=0n||BigInt(fee.lamports)>BigInt(Number.MAX_SAFE_INTEGER)||!Number.isSafeInteger(fee.cents)||fee.cents<=0)throw appError('The platform fee could not be verified.',502);
  const message=TransactionMessage.decompile(tx.message,{addressLookupTableAccounts:tables});
  if(message.payerKey.toBase58()!==wallet||tx.message.header.numRequiredSignatures!==1)throw appError('Invalid transaction payer.',502);
  // The admin must not be a trading route account. This makes its fee receipt unambiguous.
  if(message.instructions.some(ix=>ix.programId.toBase58()===fee.recipient||ix.keys.some(k=>k.pubkey.toBase58()===fee.recipient)))throw appError('The fee account overlaps this trade route.',502);
  message.instructions.push(SystemProgram.transfer({fromPubkey:new PublicKey(wallet),toPubkey:new PublicKey(fee.recipient),lamports:BigInt(fee.lamports)}));
  const next=new VersionedTransaction(message.compileToV0Message(tables));
  if(next.message.header.numRequiredSignatures!==1||next.serialize().length>1232)throw appError('This purchase cannot fit in one transaction. No fee has been collected.',409);
  return next;
}
export function verifyPlatformFee(tx,meta,wallet,fee){
  if(!fee)return 0;
  const keys=tx.message.getAccountKeys({accountKeysFromLookups:{writable:(meta.loadedAddresses?.writable||[]).map(k=>new PublicKey(k)),readonly:(meta.loadedAddresses?.readonly||[]).map(k=>new PublicKey(k))}});
  const last=tx.message.compiledInstructions.at(-1);
  if(!last||keys.get(last.programIdIndex)?.toBase58()!==SystemProgram.programId.toBase58())throw appError('The platform fee transfer is missing.',409);
  let transfer;
  try{transfer=SystemInstruction.decodeTransfer({programId:SystemProgram.programId,keys:Array.from(last.accountKeyIndexes,i=>({pubkey:keys.get(i),isSigner:tx.message.isAccountSigner(i),isWritable:tx.message.isAccountWritable(i)})),data:Buffer.from(last.data)});}catch{throw appError('The platform fee transfer is invalid.',409);}
  const index=Array.from({length:keys.length},(_,i)=>i).find(i=>keys.get(i).toBase58()===fee.recipient);
  if(transfer.fromPubkey.toBase58()!==wallet||transfer.toPubkey.toBase58()!==fee.recipient||BigInt(transfer.lamports)!==BigInt(fee.lamports)||!Number.isSafeInteger(fee.cents)||fee.cents<=0||!Number.isSafeInteger(meta.preBalances?.[index])||!Number.isSafeInteger(meta.postBalances?.[index])||BigInt(meta.postBalances[index])-BigInt(meta.preBalances[index])!==BigInt(fee.lamports))throw appError('The platform fee receipt could not be verified.',409);
  return fee.cents;
}
