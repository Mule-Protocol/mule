import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { loadFixture } from './fixtures.js';
import { canonicalJson, createValidator } from '@mule/mission-logic';

const ajv = new Ajv2020({ allErrors: true, strict: true, coerceTypes: false, useDefaults: false, removeAdditional: false });
addFormats(ajv, ['date']);
const validators = new Map<string, ReturnType<typeof ajv.compile>>();
function schemaValidator(schema: object) {
  const key = canonicalJson(schema);
  let validate = validators.get(key);
  if (!validate) {
    validate = ajv.compile(schema);
    validators.set(key, validate);
  }
  return validate;
}

export { decimalCents } from '@mule/mission-logic';
export const validateDelivery = createValidator({ fixtureFor: loadFixture, schemaValidator });
