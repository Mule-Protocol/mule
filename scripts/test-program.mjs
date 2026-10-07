import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';

// Each native VM scenario gets one fresh process; never retry a failed assertion.
const file='tests/escrow.test.ts';
const discovery=spawnSync(process.execPath,['--import','tsx',file],{
  env:{...process.env,MULE_LIST_TESTS:'1'},encoding:'utf8',
});
if(discovery.status!==0)throw new Error(discovery.stderr || 'Test discovery failed');
const names=JSON.parse(discovery.stdout);
if(!Array.isArray(names)||names.length===0)throw new Error('No program tests discovered');
const parts=resolve('coverage/parts');
mkdirSync(parts,{recursive:true});
const report={engine:'LiteSVM 0.8.0, compiled SBF, one process per scenario',cases:[],evidence:[]};
let failed=false;
for(let index=0;index<names.length;index++){
  const path=join(parts,index+'.json');
  rmSync(path,{force:true});
  const run=spawnSync(process.execPath,['--import','tsx','--test',file],{
    env:{...process.env,MULE_CASE_INDEX:String(index),MULE_COVERAGE_PART:path,MULE_LIST_TESTS:'0'},
    stdio:'inherit',
  });
  if(run.status!==0)failed=true;
  try{
    const part=JSON.parse(readFileSync(path,'utf8'));
    if(part.cases.length!==1 || part.cases[0].name!==names[index])throw new Error('Scenario evidence mismatch');
    report.cases.push(...part.cases);report.evidence.push(...part.evidence);
  }catch(error){
    failed=true;report.cases.push({name:names[index],passed:false});
    console.error('Missing/invalid scenario evidence:',names[index],String(error));
  }
}
writeFileSync('coverage/instructions.json',JSON.stringify(report,null,2));
console.log('Program scenarios: '+report.cases.filter(c=>c.passed).length+'/'+names.length+' passed');
if(failed||report.cases.some(c=>!c.passed))process.exitCode=1;
