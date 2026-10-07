/** Disabled unless explicitly enabled by the local integration test. Never a production retry policy. */
export class TestFault extends Error { constructor(readonly point: string) { super('Injected test fault: ' + point); } }
export function testFault(point: string): void {
  if (process.env.MULE_TEST_FAULT === point) {
    if (process.env.MULE_TEST_MODE !== '1') throw new Error('Fault injection requires MULE_TEST_MODE=1');
    throw new TestFault(point);
  }
}
