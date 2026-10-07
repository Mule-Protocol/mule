import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Journal } from '../src/journal.js';
import { testFault, TestFault } from '../src/faults.js';

test('private operation journal survives reconstruction and atomically replaces state',()=>{
  const directory=mkdtempSync(join(tmpdir(),'mule-journal-'));
  try{
    const journal=new Journal(directory);assert.equal(journal.read('missing'),null);
    journal.write('tx:abc',{signature:'same-signature',state:'signed'});
    const reopened=new Journal(directory);
    assert.deepEqual(reopened.read('tx:abc'),{signature:'same-signature',state:'signed'});
    reopened.write('tx:abc',{signature:'same-signature',state:'confirmed'});
    assert.equal(JSON.parse(readFileSync(journal.path('tx:abc'),'utf8')).signature,'same-signature');
  } finally{rmSync(directory,{recursive:true,force:true});}
});
test('fault injection refuses to run outside the explicit test switch',()=>{
  const oldMode=process.env.MULE_TEST_MODE,oldFault=process.env.MULE_TEST_FAULT;
  try{
    process.env.MULE_TEST_FAULT='after-verdict';delete process.env.MULE_TEST_MODE;
    assert.throws(()=>testFault('after-verdict'),/requires MULE_TEST_MODE/);
    process.env.MULE_TEST_MODE='1';assert.throws(()=>testFault('after-verdict'),TestFault);
    assert.doesNotThrow(()=>testFault('after-report'));
  } finally{
    if(oldMode===undefined)delete process.env.MULE_TEST_MODE;else process.env.MULE_TEST_MODE=oldMode;
    if(oldFault===undefined)delete process.env.MULE_TEST_FAULT;else process.env.MULE_TEST_FAULT=oldFault;
  }
});
