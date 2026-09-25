import test from 'node:test';
import assert from 'node:assert/strict';
import {Keypair,PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,SystemProgram} from '@solana/web3.js';
import {pumpTransaction,PUMP_PROGRAM,TOKEN_2022} from '../server/pump.mjs';
import {CFK_MINT,SOL_MINT} from '../server/core.mjs';

// Exercise the untrusted builder boundary and simulate the complete fee-bearing message.
test('official Pump route checks direction, mint, budget and simulation before returning a signable transaction',async()=>{
  const wallet=Keypair.generate().publicKey,admin=Keypair.generate().publicKey;
  let side='buy',wrongMint=false,program=PUMP_PROGRAM,maxCost=50500000n,simulationError=null;
  const accountKeys=Array.from({length:7},()=>Keypair.generate().publicKey);
  function unsigned(){
    const data=Buffer.alloc(24);Buffer.from(side==='buy'?'66063d1201daebea':'33e685a4017f83ad','hex').copy(data);
    data.writeBigUInt64LE(side==='buy'?1000n:200n,8);data.writeBigUInt64LE(side==='buy'?maxCost:500000n,16);
    const keys=[...accountKeys];keys[2]=wrongMint?SystemProgram.programId:new PublicKey(CFK_MINT);keys[6]=wallet;
    return new VersionedTransaction(new TransactionMessage({payerKey:wallet,recentBlockhash:SystemProgram.programId.toBase58(),instructions:[new TransactionInstruction({programId:new PublicKey(program),keys:keys.map(pubkey=>({pubkey,isSigner:pubkey.equals(wallet),isWritable:true})),data})]}).compileToV0Message());
  }
  const originalFetch=globalThis.fetch;let request,simulations=0;
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://fun-block.pump.fun/agents/swap');request=JSON.parse(options.body);
    return new Response(JSON.stringify({transaction:Buffer.from(unsigned().serialize()).toString('base64')}),{status:201});
  };
  const account=(lamports,tokens)=>{const data=Buffer.alloc(165);data.writeBigUInt64LE(tokens,64);return {lamports,data:[data.toString('base64'),'base64']};};
  const rpc=async(method,params)=>{
    if(method==='getAccountInfo')return {value:{owner:TOKEN_2022}};
    if(method==='getMultipleAccounts')return {value:[account(1000000000,0n),account(0,side==='buy'?0n:200n),account(0,0n)]};
    assert.equal(method,'simulateTransaction');simulations++;
    const tx=VersionedTransaction.deserialize(Buffer.from(params[0],'base64'));
    assert.equal(params[1].sigVerify,false);
    if(side==='buy'){
      assert.equal(tx.message.compiledInstructions.length,2);
      assert.equal(params[1].accounts.addresses[2],admin.toBase58());
    }
    return {value:{err:simulationError,accounts:[account(side==='buy'?939000000:1001000000,0n),account(0,side==='buy'?1000n:0n),account(10000000,0n)]}};
  };
  const options={wallet:wallet.toBase58(),side:'buy',input:50000000n,decimals:6,cashLimit:56000000n,platformFee:{recipient:admin.toBase58(),lamports:'10000000',cents:100},rpc};
  try{
    const result=await pumpTransaction(options);
    assert.equal(result.provider,'Pump');assert.equal(result.solAtomic,61000000n);assert.equal(result.tokenAtomic,1000n);
    assert.equal(request.amount,'50000000');assert.equal(request.inputMint,SOL_MINT);assert.equal(request.outputMint,CFK_MINT);assert.equal(request.encoding,'base64');assert.equal(request.slippagePct,1);
    wrongMint=true;await assert.rejects(pumpTransaction(options),/does not match/);wrongMint=false;
    maxCost=56000001n;await assert.rejects(pumpTransaction(options),/exceeds/);maxCost=50500000n;
    program='FAdo9NCw1ssek6Z6yeWzWjhLVsr8uiCwcWNUnKgzTnHe';await assert.rejects(pumpTransaction(options),/not supported/);program=PUMP_PROGRAM;
    assert.equal(simulations,1);
    simulationError={InstructionError:[0,'Custom']};await assert.rejects(pumpTransaction(options),/cannot complete/);simulationError=null;
    side='sell';const sell=await pumpTransaction({...options,side:'sell',input:200n,platformFee:undefined});
    assert.equal(sell.tokenAtomic,200n);assert.equal(request.inputMint,CFK_MINT);assert.equal(request.outputMint,SOL_MINT);assert.equal(request.amount,'200');
    await assert.rejects(pumpTransaction({...options,side:'sell',input:201n,platformFee:undefined}),/exceeds/);
  }finally{globalThis.fetch=originalFetch;}
});
