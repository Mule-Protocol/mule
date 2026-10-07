import fc from 'fast-check';
import { atomicJson } from './fuzz-evidence.mjs';
import { requestedSequenceCounts, sequenceCategory } from './fuzz-counts.mjs';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

const cli = process.argv.slice(2).filter(arg => arg !== '--');
if (cli.includes('--help')) {
  console.log('pnpm fuzz:program --seed 20261007 --runs 64 --steps 80 [--path <fast-check path>]');
  console.log('Requires Node 24 on Linux, compiled target/deploy/mule_escrow.so and matching target/idl/mule_escrow.json.');
  console.log('Omit seed for a logged random seed. Results and reduced failures: coverage/fuzz/. No network is used.');
  console.log('Replay a saved provisional/final sequence directly: pnpm fuzz:program --sequence coverage/fuzz/minimal-sequence.json');
  process.exit(0);
}
const options = { seed: process.env.MULE_FUZZ_SEED, runs: process.env.MULE_FUZZ_RUNS ?? '64',
  steps: process.env.MULE_FUZZ_STEPS ?? '80', path: process.env.MULE_FUZZ_PATH, sequence: undefined };
for(let index=0;index<cli.length;index+=2) {
  const name=cli[index]?.slice(2);
  if(!['seed','runs','steps','path','sequence'].includes(name)||cli[index+1]===undefined)throw new Error('Unknown/incomplete fuzz option');
  options[name]=cli[index+1];
}
const seed=options.seed===undefined?randomBytes(4).readInt32LE():Number(options.seed);
const replaySequence=options.sequence===undefined?undefined:JSON.parse(readFileSync(resolve(options.sequence),'utf8'));
if(replaySequence!==undefined&&!Array.isArray(replaySequence))throw new Error('Replay file must contain a command array');
const runs=replaySequence===undefined?Number(options.runs):1,steps=Number(options.steps);
if(!Number.isInteger(seed)||seed < -2147483648||seed>2147483647)throw new Error('Seed must be a signed 32-bit integer');
if(!Number.isInteger(runs)||runs<1||runs>10000||!Number.isInteger(steps)||steps<1||steps>1000)throw new Error('Invalid fuzz run/step bounds');
if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])<24)throw new Error('The isolated native fuzz harness is verified for Linux with Node 24+; use the CI environment');
const output=resolve('coverage/fuzz'),work=join(output,'.work');
mkdirSync(work,{recursive:true});
for(const file of ['summary.json','progress.json','failure.json','minimal-sequence.json','failure-trace.json',
  ...readdirSync(output).filter(name=>/^(failure|reduction)-[0-9]+\.json$/.test(name))])rmSync(join(output,file),{force:true});
const binary='target/deploy/mule_escrow.so',idl='target/idl/mule_escrow.json';
if(!existsSync(binary)||!existsSync(idl))throw new Error('Compile SBF and IDL before fuzzing');
const operations=['initialize_config','update_config','propose_admin','accept_admin','cancel_admin_proposal',
  'create_mission','cancel_mission','accept_mission','submit_delivery','record_verdict','open_dispute',
  'resolve_dispute','finalize','refund_expired','refund_stale'];
const command=fc.record({
  op:fc.oneof({weight:5,arbitrary:fc.constant('progress')},{weight:3,arbitrary:fc.constant('clock')},
    {weight:2,arbitrary:fc.constant('create_mission')},{weight:5,arbitrary:fc.constantFrom(...operations)}),
  actor:fc.oneof({weight:4,arbitrary:fc.constant(-1)},{weight:3,arbitrary:fc.integer({min:0,max:5})}),
  target:fc.nat({max:100}),
  other:fc.oneof({weight:3,arbitrary:fc.constant(6)},{weight:2,arbitrary:fc.integer({min:0,max:5})}),
  amount:fc.oneof(fc.constantFrom(0,1,100000000,100000001),fc.integer({min:1,max:200000000})),
  boundary:fc.constantFrom('delta','deadline','window','dispute','stale'),
  offset:fc.oneof(fc.constantFrom(-1,0,1,60,3600,604800,1209600,2147483647),fc.integer({min:1,max:1209601})),
  window:fc.oneof(fc.constantFrom(-1,0,1,60,3600),fc.integer({min:1,max:86400})),
  flag:fc.boolean(),
  redirect:fc.oneof({weight:7,arbitrary:fc.constant(-1)},{weight:1,arbitrary:fc.integer({min:0,max:5})}),
});
const arbitrary=replaySequence===undefined?fc.array(command,{minLength:0,maxLength:steps,size:'max'}):fc.constant(replaySequence);
const base={op:'create_mission',actor:-1,target:0,other:6,amount:5000000,boundary:'delta',offset:10000,window:3600,flag:true,redirect:-1};
const c=(op,changes={})=>({...base,op,...changes});
const create=c('create_mission'),accept=c('accept_mission'),submit=c('submit_delivery');
const verdict=pass=>c('record_verdict',{flag:pass});
const clock=(boundary,offset)=>c('clock',{boundary,offset});
const repeat=c('finalize');
const examples=[
  [create,c('cancel_mission',{actor:5}),c('cancel_mission'),c('cancel_mission')],
  [create,accept,submit,verdict(true),clock('window',-1),repeat,clock('window',0),repeat,repeat],
  [create,accept,submit,verdict(false),clock('window',0),repeat,repeat],
  ...[true,false].map(pass=>[create,accept,submit,verdict(pass),c('open_dispute'),clock('dispute',-1),repeat,clock('dispute',0),repeat,repeat]),
  [create,accept,submit,clock('stale',-1),c('refund_stale'),clock('stale',0),c('refund_stale'),c('refund_stale')],
  [create,clock('deadline',-1),c('refund_expired'),clock('deadline',0),c('refund_expired')],
  [create,accept,clock('deadline',0),submit,c('refund_expired')],
  [create,accept,submit,verdict(true),c('open_dispute'),c('resolve_dispute',{flag:false}),repeat],
  [c('propose_admin',{other:0}),c('cancel_admin_proposal',{actor:5}),c('cancel_admin_proposal'),c('accept_admin',{actor:0}),
    c('cancel_admin_proposal'),c('propose_admin',{other:0}),c('accept_admin',{actor:5}),c('accept_admin',{actor:0}),
    c('update_config',{actor:4,other:5}),c('update_config',{other:5,window:60,flag:true}),
    create,c('update_config',{other:3,window:60,flag:false}),c('create_mission',{target:1}),c('accept_mission',{target:1})],
];
const fixedExamples=examples.length;
for(const name of readdirSync('tests/fuzz/regressions').filter(name=>name.endsWith('.json')).sort()) examples.push(JSON.parse(readFileSync(join('tests/fuzz/regressions',name),'utf8')));
const regressionExamples=examples.length-fixedExamples;
const sequenceCounts=Object.fromEntries(['fixed','regression','generated','replay','pathReplay','shrink']
  .map(category=>[category,{attempted:0,passed:0,failed:0}]));
const totals={sequenceCounts,sequences:0,instructions:0,successful:0,rejected:0,clockJumps:0,invariantChecks:0,
  byInstruction:{},boundariesRequested:{},boundariesReached:{},boundariesClamped:{},boundariesUnavailable:{}};
let lastFailure;
const started=Date.now();
const input=join(work,'sequence.json'),resultPath=join(work,'result.json');
const common={seed,requestedRuns:runs,
  corpus:{fixed:fixedExamples,regression:regressionExamples},
  requestedSequenceCounts:replaySequence!==undefined||options.path!==undefined?null:requestedSequenceCounts(runs,fixedExamples,regressionExamples),maxCommands:steps,requestedPath:options.path??null,path:null,pathPending:true,
  reproductionFromSequence:'pnpm fuzz:program --sequence coverage/fuzz/minimal-sequence.json'};
atomicJson(join(output,'summary.json'),{...common,status:'running',passed:null,...totals});
function checkpoint(sequence,status,result) {
  const snapshot={...common,status,evaluation:totals.sequences,elapsedMs:Date.now()-started,sequence,result};
  atomicJson(join(output,'progress.json'),snapshot);
  if(status==='failed') {
    const failure={...snapshot,status:'shrinking',minimalSequence:sequence,error:result.error??'Native worker failed'};
    // Save an immutable failure first, then update the latest reduced candidate.
    atomicJson(join(output,'failure-'+String(totals.sequences).padStart(6,'0')+'.json'),failure);
    atomicJson(join(output,'minimal-sequence.json'),sequence);
    atomicJson(join(output,'failure-trace.json'),{sequence,...result});
    atomicJson(join(output,'failure.json'),failure);
  } else if(lastFailure&&status==='passed') {
    atomicJson(join(output,'reduction-'+String(totals.sequences).padStart(6,'0')+'.json'),snapshot);
  }
  atomicJson(join(output,'summary.json'),{...common,status:lastFailure?'shrinking':'running',passed:null,
    elapsedMs:Date.now()-started,...totals});
}
function evaluate(sequence) {
  totals.sequences++;
  const category=sequenceCategory(totals.sequences,{fixed:fixedExamples,regression:regressionExamples,
    shrinking:lastFailure!==undefined,sequenceReplay:replaySequence!==undefined,pathReplay:options.path!==undefined});
  sequenceCounts[category].attempted++;
  checkpoint(sequence,'running');
  writeFileSync(input,JSON.stringify(sequence)+'\n');
  rmSync(resultPath,{force:true});
  const child=spawnSync(process.execPath,['--import','tsx','tests/fuzz/worker.ts',input,resultPath],{
    encoding:'utf8',timeout:30000,maxBuffer:4*1024*1024,
  });
  let result;
  try{result=JSON.parse(readFileSync(resultPath,'utf8'));}
  catch {result={passed:false,error:child.error?.message??child.stderr??'Native worker produced no result',trace:[]};}
  if(result.stats) {
    for(const key of ['instructions','successful','rejected','clockJumps','invariantChecks'])totals[key]+=result.stats[key];
    for(const [name,counts] of Object.entries(result.stats.byInstruction)){
      totals.byInstruction[name]??={success:0,rejected:0};
      totals.byInstruction[name].success+=counts.success;totals.byInstruction[name].rejected+=counts.rejected;
    }
    for(const category of ['boundariesRequested','boundariesReached','boundariesClamped','boundariesUnavailable'])
      for(const [name,count] of Object.entries(result.stats[category]))totals[category][name]=(totals[category][name]??0)+count;
  }
  if(child.status!==0||!result.passed) {
    lastFailure={sequence,...result};
    sequenceCounts[category].failed++;
    checkpoint(sequence,'failed',result);
    return false;
  }
  sequenceCounts[category].passed++;
  checkpoint(sequence,'passed',result);
  return true;
}
console.log('MULE property fuzz: seed='+seed+' runs='+runs+' maxCommands='+steps+'; native SBF / isolated LiteSVM workers');
const details=fc.check(fc.property(arbitrary,evaluate),{
  seed,numRuns:runs,path:options.path,examples:replaySequence===undefined?examples.map(sequence=>[sequence]):undefined,
  endOnFailure:false,verbose:2,
});
const summary={...common,engine:'fast-check 4.10.2 / LiteSVM 0.8.0 / compiled SBF, fresh process per sequence',
  seed,requestedRuns:runs,maxCommands:steps,path:details.counterexamplePath??options.path??null,pathPending:false,status:'complete',passed:!details.failed,
  numRuns:details.numRuns,numShrinks:details.numShrinks,interrupted:details.interrupted,
  elapsedMs:Date.now()-started,
  sbfSha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),
  idlSha256:createHash('sha256').update(readFileSync(idl)).digest('hex'),...totals};
atomicJson(join(output,'summary.json'),summary);
if(details.failed) {
  const minimal=details.counterexample?.[0]??lastFailure?.sequence??[];
  atomicJson(join(output,'minimal-sequence.json'),minimal);
  atomicJson(join(output,'failure-trace.json'),lastFailure);
  const failure={seed,path:details.counterexamplePath,pathPending:false,status:'complete',numRuns:details.numRuns,numShrinks:details.numShrinks,
    interrupted:details.interrupted,error:String(details.errorInstance??lastFailure?.error??'Property failed'),
    minimalSequence:minimal,reproduce:replaySequence!==undefined?common.reproductionFromSequence:'pnpm fuzz:program --seed '+seed+' --runs '+runs+' --steps '+steps
      +(details.counterexamplePath?' --path '+details.counterexamplePath:'')};
  atomicJson(join(output,'failure.json'),failure);
  console.error(JSON.stringify(failure,null,2));
  process.exitCode=1;
}
console.log(JSON.stringify(summary,null,2));
// Known harness-owned scratch directory; no user data or keys are stored here.
rmSync(work,{recursive:true,force:true});
