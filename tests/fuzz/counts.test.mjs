import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { requestedSequenceCounts, sequenceCategory } from '../../scripts/fuzz-counts.mjs';

test('64 successful fast-check runs include ten fixed examples, one regression and 53 generated sequences', () => {
  let evaluation = 0;
  const counts = { fixed: 0, regression: 0, generated: 0 };
  const details = fc.check(fc.property(fc.integer(), () => {
    const category = sequenceCategory(++evaluation, { fixed: 10, regression: 1 });
    counts[category]++;
    return true;
  }), { seed: 20261007, numRuns: 64, examples: Array.from({ length: 11 }, (_, index) => [index]) });
  assert.equal(details.failed, false);
  assert.equal(details.numRuns, 64);
  assert.deepEqual(counts, { fixed: 10, regression: 1, generated: 53 });
  assert.deepEqual(counts, requestedSequenceCounts(64, 10, 1));
  assert.deepEqual(requestedSequenceCounts(512, 10, 1), { fixed: 10, regression: 1, generated: 501 });
});

test('reduction and explicit replay evaluations cannot inflate generated sequence counts', () => {
  assert.equal(sequenceCategory(5, { fixed: 10, regression: 1, shrinking: true }), 'shrink');
  assert.equal(sequenceCategory(1, { fixed: 10, regression: 1, sequenceReplay: true }), 'replay');
  assert.equal(sequenceCategory(1, { fixed: 10, regression: 1, pathReplay: true }), 'pathReplay');
});
