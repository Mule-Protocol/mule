import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { atomicJson } from '../../scripts/fuzz-evidence.mjs';

test('provisional failure persists before a later reduction/timeout and can be atomically finalized',t=>{
  const directory=mkdtempSync(join(tmpdir(),'mule-fuzz-evidence-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  const path=join(directory,'failure.json');
  atomicJson(path,{seed:20261007,path:null,pathPending:true,status:'shrinking',minimalSequence:[{op:'finalize'}]});
  const provisional=JSON.parse(readFileSync(path,'utf8'));
  assert.equal(provisional.seed,20261007);
  assert.equal(provisional.pathPending,true);
  assert.deepEqual(provisional.minimalSequence,[{op:'finalize'}]);
  // A hypothetical stop here leaves a complete, explicitly provisional artifact.
  atomicJson(path,{...provisional,path:'1:0',pathPending:false,status:'complete'});
  assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),{...provisional,path:'1:0',pathPending:false,status:'complete'});
});
