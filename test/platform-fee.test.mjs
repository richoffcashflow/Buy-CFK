import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {appendPlatformFee,verifyPlatformFee} from '../server/platform-fee.mjs';

test('the admin fee is part of one signed message and needs its exact finalized transfer receipt',()=>{
  const payer=Keypair.generate().publicKey,route=Keypair.generate().publicKey,recipient=Keypair.generate().publicKey;
  const original=new VersionedTransaction(new TransactionMessage({payerKey:payer,recentBlockhash:SystemProgram.programId.toBase58(),instructions:[SystemProgram.transfer({fromPubkey:payer,toPubkey:route,lamports:1000})]}).compileToV0Message());
  const fee={recipient:recipient.toBase58(),lamports:'300',cents:300};
  const tx=appendPlatformFee(original,[],payer.toBase58(),fee);
  assert.equal(tx.message.compiledInstructions.length,2);assert.equal(tx.message.header.numRequiredSignatures,1);
  assert.equal(original.message.compiledInstructions.length,1);
  const index=tx.message.staticAccountKeys.findIndex(k=>k.equals(recipient));
  const meta={preBalances:Array(tx.message.staticAccountKeys.length).fill(0),postBalances:Array(tx.message.staticAccountKeys.length).fill(0)};meta.postBalances[index]=300;
  assert.equal(verifyPlatformFee(tx,meta,payer.toBase58(),fee),300);
  assert.throws(()=>verifyPlatformFee(tx,meta,payer.toBase58(),{...fee,lamports:'301'}));
  meta.postBalances[index]=0;assert.throws(()=>verifyPlatformFee(tx,meta,payer.toBase58(),fee));
  assert.throws(()=>appendPlatformFee(original,[],payer.toBase58(),{...fee,recipient:route.toBase58()}));
  assert.throws(()=>appendPlatformFee(original,[],payer.toBase58(),{...fee,recipient:payer.toBase58()}));
});
