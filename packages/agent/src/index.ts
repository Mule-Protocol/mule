import { ScriptedAgent, type DeliveryProducer } from '@mule/mission-logic';
import { loadFixture, type JsonValue, type Model, type Mode } from '@mule/validator';
export { ScriptedAgent, type DeliveryRequest, type DeliveryProducer } from '@mule/mission-logic';

export async function createDelivery(
  model: Model,
  mode: Mode,
  input: JsonValue = loadFixture(model).input,
  producer: DeliveryProducer = new ScriptedAgent(),
): Promise<JsonValue> {
  return producer.produce({ model, mode, input });
}
