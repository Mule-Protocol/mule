import assert from 'node:assert/strict';
import { PublicKey } from '@solana/web3.js';
import { missionStatus } from '@mule/sdk';
import { LocalContentStore, validateDelivery, type Criteria, type StoredJson, type ValidationReport } from '@mule/validator';
import { RpcRunner, type TransactionRecord } from './rpc.js';
import { testFault } from './faults.js';
export { TestFault } from './faults.js';

export interface ValidationResult { reportHash: string; reportUri: string; signature: string; message: string; passed: boolean; recovered: boolean }

export interface ValidationInput {
  mission: string;
  criteriaHash: string;
  deliveryHash: string;
  criteriaUri: string;
  deliveryUri: string;
}

/** The Node runner's content-verified, deterministic report pipeline. */
export function prepareValidationReport(
  store: LocalContentStore,
  input: ValidationInput,
): { report: ValidationReport; stored: StoredJson } {
  const criteria = store.read<Criteria>(input.criteriaUri, input.criteriaHash);
  const delivery = store.read(input.deliveryUri, input.deliveryHash);
  const report = validateDelivery({
    mission: input.mission, criteria, delivery,
    criteriaHash: input.criteriaHash, deliveryHash: input.deliveryHash,
  });
  return { report, stored: store.put(report) };
}

/** Re-read chain state on EVERY invocation, including recovery after a confirmed verdict. */
export async function validateMission(runner: RpcRunner, store: LocalContentStore, address: PublicKey): Promise<ValidationResult> {
  const mission = await runner.mission(address);
  assert(mission, 'Mission must still exist while validating');
  const state = missionStatus(mission);
  assert(['submitted', 'passed', 'failed', 'disputed'].includes(state), 'Mission is not ready for validation');
  assert(mission.deliveryHash && mission.deliveryUri);
  const criteriaHash = Buffer.from(mission.criteriaHash).toString('hex');
  const deliveryHash = Buffer.from(mission.deliveryHash).toString('hex');
  const { report, stored } = prepareValidationReport(store, {
    mission: address.toBase58(), criteriaHash, deliveryHash,
    criteriaUri: mission.criteriaUri, deliveryUri: mission.deliveryUri,
  });
  const key = 'validation:' + address.toBase58();
  const previous = runner.journal.read<Partial<ValidationResult>>(key);
  if (previous?.reportHash) assert.equal(stored.hash, previous.reportHash, 'Report changed across recovery');
  runner.journal.write(key, {...previous, reportHash: stored.hash, reportUri: stored.uri, message: report.message, passed: report.pass});
  if (state !== 'submitted') {
    assert(mission.reportHash, 'Chain verdict lacks report hash');
    assert.equal(Buffer.from(mission.reportHash).toString('hex'), stored.hash, 'Chain/report hash mismatch');
    const receipts = await runner.verdictReceipts(address);
    assert.equal(receipts.length, 1, 'Exactly one on-chain verdict is required');
    const signature = receipts[0]!.signature;
    const operation = address.toBase58() + ':record_verdict';
    const pending = runner.journal.read<TransactionRecord>('tx:' + operation);
    if (pending) {
      assert.equal(pending.signature, signature, 'Confirmed chain verdict must match retained signed transaction');
      // Reconcile even an outdated signed journal after a post-confirmation crash. This path never rebuilds or broadcasts a verdict.
      const confirmed = await runner.transact(operation, () => { throw new Error('Do not rebuild a recorded verdict'); }, []);
      assert.equal(confirmed.signature, signature);
    }
    const result = {reportHash: stored.hash, reportUri: stored.uri, signature, message: report.message, passed: report.pass, recovered: true};
    runner.journal.write(key, result);
    return result;
  }
  testFault('after-report');
  const receipt = await runner.instruction(address.toBase58() + ':record_verdict', 'record_verdict', address,
    runner.keys.validator, {pass: report.pass, report_hash: Array.from(Buffer.from(stored.hash, 'hex'))});
  const result = {reportHash: stored.hash, reportUri: stored.uri, signature: receipt.signature, message: report.message, passed: report.pass, recovered: false};
  runner.journal.write(key, result);
  return result;
}
