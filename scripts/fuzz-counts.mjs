export function requestedSequenceCounts(runs, fixed, regression) {
  const fixedRuns = Math.min(runs, fixed);
  const regressionRuns = Math.min(runs - fixedRuns, regression);
  return { fixed: fixedRuns, regression: regressionRuns, generated: runs - fixedRuns - regressionRuns };
}
export function sequenceCategory(evaluation, { fixed, regression, shrinking, sequenceReplay, pathReplay }) {
  if (shrinking) return 'shrink';
  if (sequenceReplay) return 'replay';
  if (pathReplay) return 'pathReplay';
  return evaluation <= fixed ? 'fixed' : evaluation <= fixed + regression ? 'regression' : 'generated';
}
