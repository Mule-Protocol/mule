import { resolve } from 'node:path';
import { PublicKey } from '@solana/web3.js';
import { LocalContentStore } from '@mule/validator';
import { RpcRunner } from './rpc.js';
import { campaign } from './campaign.js';
import { validateMission, TestFault } from './validate.js';
import { sweep } from './sweep.js';

function required(name:string):string {
  const value=process.env[name];if(!value)throw new Error('Missing environment variable: '+name);return value;
}
async function main():Promise<void> {
  const keyDirectory=required('MULE_KEY_DIR');
  const runner=new RpcRunner({rpcUrl:required('MULE_RPC_URL'),keyDirectory,
    stateDirectory:process.env.MULE_STATE_DIR??resolve(keyDirectory,'state'),
    idlPath:process.env.MULE_IDL_PATH??resolve('target/idl/mule_escrow.json')});
  const store=new LocalContentStore(process.env.MULE_DATA_DIR??resolve('data'));
  const command=process.argv[2];
  if(command==='campaign') {
    const report=await campaign(runner,store,process.env.MULE_RUN_DIR??resolve('runs'),required('MULE_RUN_ID'));
    console.log(JSON.stringify({run:report.runId,missions:report.missions.length,checks:report.checks}));
    return;
  }
  await runner.bindChain();
  const saved=runner.journal.read<{mint:string;missions:Array<{address:string}>}>('campaign');
  if(!saved)throw new Error('No retained campaign manifest');
  runner.mint=new PublicKey(saved.mint);
  if(command==='validate') {
    const address=process.argv[3];if(!address)throw new Error('validate requires a mission address');
    console.log(JSON.stringify(await validateMission(runner,store,new PublicKey(address))));
  } else if(command==='sweep') {
    console.log(JSON.stringify(await sweep(runner,saved.missions.map(row=>new PublicKey(row.address)))));
  } else throw new Error('Usage: cli.ts campaign | validate <mission> | sweep');
}
main().catch((error:unknown)=>{
  console.error(error instanceof Error?error.message:String(error));
  process.exitCode=error instanceof TestFault?42:1;
});
