import { canonicalJson } from './canonical.js';
import { MODELS, type JsonValue, type Model, type Mode } from './types.js';

export interface DeliveryRequest {
  model: Model;
  mode: Mode;
  input: JsonValue;
}
/** Replace only the producer to connect another implementation. The runner,
 * storage and deterministic validator keep the same interface. */
export interface DeliveryProducer {
  readonly description: string;
  produce(request: DeliveryRequest): Promise<JsonValue>;
}
export class ScriptedAgent implements DeliveryProducer {
  readonly description = 'agent de référence scripté';

  async produce({ model, mode, input }: DeliveryRequest): Promise<JsonValue> {
    if (!MODELS.includes(model) || !['honest', 'dishonest'].includes(mode)) throw new Error('Unsupported delivery request');
    // Canonical JSON also rejects values that serialization would silently drop.
    const output = JSON.parse(canonicalJson(input)) as Record<string, JsonValue>;
    if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('Fixture input must be a JSON object');
    if (model === 'address.v1') {
      if (!Array.isArray(output.rows) || output.rows.length !== 12) throw new Error('Expected twelve address rows');
      output.rows = output.rows.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.postcode !== 'string') {
          throw new Error('Expected address row with string postcode');
        }
        return { ...item, postcode: item.postcode.replace(/\s/g, '') };
      });
    }
    if (mode === 'dishonest') {
      if (model === 'invoice.v1') {
        if (!Object.hasOwn(output, 'total_amount')) throw new Error('Cannot corrupt an already missing total_amount');
        delete output.total_amount;
      }
      else if (model === 'contract.v1') {
        if (!Object.hasOwn(output, 'governing_law')) throw new Error('Cannot corrupt an already missing governing_law');
        delete output.governing_law;
      }
      else {
        const row = (output.rows as Record<string, JsonValue>[])[6]!;
        if (row.postcode === 'INVALID') throw new Error('Cannot corrupt an already invalid row 7 postcode');
        row.postcode = 'INVALID';
      }
    }
    return output;
  }
}
