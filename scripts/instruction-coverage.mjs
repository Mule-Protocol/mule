import { readFileSync, writeFileSync } from 'node:fs';
const report=JSON.parse(readFileSync('coverage/instructions.json','utf8'));
const instructions=['initialize_config','update_config','propose_admin','accept_admin','cancel_admin_proposal','create_mission','cancel_mission','accept_mission',
  'submit_delivery','record_verdict','open_dispute','resolve_dispute','finalize','refund_expired','refund_stale'];
const rows=instructions.map(name=>{
  const hits=report.evidence.filter(e=>e.instruction===name);
  return {name,success:hits.filter(e=>e.outcome==='success').length,negative:hits.filter(e=>e.outcome!=='success').length,
    tests:[...new Set(hits.map(e=>e.test))]};
});
const passed=report.cases.every(c=>c.passed) && rows.every(r=>r.success>0&&r.negative>0);
const markdown=['# Instruction coverage','',
  'Executed against the compiled SBF in LiteSVM. This is instruction/scenario coverage, not Rust line or branch coverage.',
  '', 'Test cases: '+report.cases.filter(c=>c.passed).length+'/'+report.cases.length+' passed.',
  '', '| Instruction | Successful assertions | Rejected assertions |','| --- | ---: | ---: |',
  ...rows.map(r=>'| '+r.name+' | '+r.success+' | '+r.negative+' |'),'',
  'Counts include setup calls. Each recorded call asserted its expected result; successful calls also asserted its event.',
  '',...rows.flatMap(r=>['## '+r.name,'',...r.tests.map(t=>'- '+t),'']),''].join('\n');
writeFileSync('coverage/instructions.md',markdown);
console.log(markdown);
if(!passed)process.exitCode=1;
