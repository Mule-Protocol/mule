import assert from 'node:assert/strict';
import { test } from 'node:test';
import { I64_MAX, planClock, type Command, type MissionModel } from './model.js';
const command: Command={op:'clock',actor:-1,target:0,other:6,amount:1,boundary:'deadline',offset:0,window:60,flag:true,redirect:-1};
const mission: MissionModel={id:1n,client:0,agent:1,designated:null,amount:1n,deadline:100n,window:60n,state:'accepted',verdictAt:null,disputedAt:null,verdict:null,rent:1n};
test('a reachable requested boundary is recorded as actually reached',()=>{
  const plan=planClock(50n,mission,command);
  assert.equal(plan.requested,100n);assert.equal(plan.actual,100n);
  assert.equal(plan.actualOffset,0n);assert.equal(plan.available,true);assert.equal(plan.clamp,null);
});
test('a past requested minus-one is clamped to the actual exact boundary',()=>{
  const plan=planClock(100n,mission,{...command,offset:-1});
  assert.equal(plan.requested,99n);assert.equal(plan.actual,100n);
  assert.equal(plan.actualOffset,0n);assert.equal(plan.clamp,'monotonic');
});
test('missing verdict/dispute/mission anchors cannot inflate achieved boundary coverage',()=>{
  for(const boundary of ['window','dispute','stale'] as const) {
    const plan=planClock(50n,mission,{...command,boundary});
    assert.equal(plan.available,false);assert.equal(plan.actualOffset,null);
  }
  assert.equal(planClock(50n,undefined,command).available,false);
});
test('the i64 clock limit is reported as clamped instead of requested-plus-one reached',()=>{
  const plan=planClock(I64_MAX,{...mission,deadline:I64_MAX},{...command,offset:1});
  assert.equal(plan.requested,I64_MAX+1n);assert.equal(plan.actual,I64_MAX);
  assert.equal(plan.actualOffset,0n);assert.equal(plan.clamp,'i64-max');
});
