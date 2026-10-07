import { readFileSync } from 'node:fs';
import { createDelivery } from '../../packages/agent/src/index.js';
import { LocalContentStore, loadFixture, type StoredJson } from '../../packages/validator/src/index.js';
import { prepareValidationReport } from '../../packages/runner/src/validate.js';
import type { Behavior, Template } from '../../packages/console-core/src/index.js';

export interface Scenario {
  id: string; template: Template; behavior: Behavior; designatedAgent: boolean; message: string;
}

export const missionReference = (scenario: Scenario): string => 'SIM-MISSION-' + scenario.id;

/** Actual runner/agent/validator path. Only the reference is symbolic for comparison:
 * validateMission still supplies a real PDA in production/local campaigns. */
export async function prepareNodeMission(scenario: Scenario, directory: string) {
  const store = new LocalContentStore(directory);
  const fixture = loadFixture(`${scenario.template}.v1`);
  const criteria = store.put(fixture.criteria);
  const delivery = store.put(await createDelivery(fixture.criteria.model, scenario.behavior, fixture.input));
  const { report, stored } = prepareValidationReport(store, {
    mission: missionReference(scenario), criteriaHash: criteria.hash, deliveryHash: delivery.hash,
    criteriaUri: criteria.uri, deliveryUri: delivery.uri,
  });
  function artifact<T>(item: StoredJson, value: T) {
    return { value, json: readFileSync(item.path, 'utf8'), hash: item.hash, uri: item.uri };
  }
  return {
    criteria: artifact(criteria, fixture.criteria),
    delivery: artifact(delivery, store.read(delivery.uri, delivery.hash)),
    report: artifact(stored, report),
  };
}
