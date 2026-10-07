import { canonicalJson } from './canonical.js';
import { MODELS, type Criteria, type CheckResult, type Fixture, type Model, type ValidationReport } from './types.js';

export interface ValidationRequest {
  mission: string;
  criteria: Criteria;
  delivery: unknown;
  criteriaHash?: string;
  deliveryHash?: string;
}
export interface SchemaValidationFunction {
  (data: unknown): boolean;
  errors?: unknown;
}
export interface ValidatorDependencies {
  fixtureFor(model: Model): Fixture;
  schemaValidator(schema: object): SchemaValidationFunction;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

/** Decimal strings are required: no binary floating-point arithmetic or rounding. */
export function decimalCents(value: unknown): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,17})\.[0-9]{2}$/.test(value)) {
    throw new Error('Expected a nonnegative decimal string with exactly two decimal places');
  }
  const [whole, fraction] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction!);
}


/** The same rules/messages run with Node Ajv or precompiled browser validators. */
export function createValidator({ fixtureFor, schemaValidator }: ValidatorDependencies): (args: ValidationRequest) => ValidationReport {
  return function validateDelivery(args: ValidationRequest): ValidationReport {
    const { criteria, delivery, mission } = args;
    if (!mission || !criteria || !MODELS.includes(criteria.model)) throw new Error('Unsupported validation request');
    // Templates are curated: reject weakened/unknown schemas and cross-check names.
    // Adding a new criteria version requires reviewed fixture changes.
    const trusted = fixtureFor(criteria.model).criteria;
    if (canonicalJson(criteria) !== canonicalJson(trusted)) throw new Error('Unsupported criteria; template does not match its version');
    const validate = schemaValidator(criteria.schema);
    const schemaPass = validate(delivery) === true;
    const results: CheckResult[] = [{
      check: 'json-schema.2020-12',
      pass: schemaPass,
      detail: schemaPass ? 'All JSON Schema constraints passed' : canonicalJson(validate.errors).trim(),
    }];
    const document = record(delivery);
    let message: string;
    if (criteria.model === 'address.v1') {
      const properties = criteria.schema.properties as Record<string, Record<string, unknown>>;
      const rowSchema = properties.rows!.items as object;
      const rowValidate = schemaValidator(rowSchema);
      const rows = Array.isArray(document.rows) ? document.rows : [];
      for (let index = 0; index < 12; index++) {
        const pass = index < rows.length && rowValidate(rows[index]) === true;
        results.push({ check: 'row.' + (index + 1), pass, detail: pass ? 'Row valid' : 'Row violates address.v1 schema' });
      }
      const postcodePass = rows.length === 12 && rows.every(row => /^[0-9]{5}$/.test(String(record(row).postcode ?? '')));
      results.push({ check: 'address.normalized_postcodes', pass: postcodePass, detail: postcodePass ? '12 French postcodes normalized to five ASCII digits' : 'Expected exactly 12 normalized French postcodes' });
      const validRows = results.filter(item => item.check.startsWith('row.') && item.pass).length;
      const firstInvalidPostcode = rows.findIndex(row => typeof record(row).postcode !== 'string' || !/^[0-9]{5}$/.test(String(record(row).postcode)));
      message = schemaPass && postcodePass ? '12/12 ROWS VALID'
        : firstInvalidPostcode >= 0
          ? validRows + '/12 · INVALID POSTCODE, ROW ' + (firstInvalidPostcode + 1)
          : validRows + '/12 · INVALID: address.v1';
    } else {
      const required = criteria.schema.required as string[];
      const properties = criteria.schema.properties as Record<string, object>;
      for (const field of required) {
        const present = Object.hasOwn(document, field);
        const pass = present && schemaValidator(properties[field]!)(document[field]) === true;
        results.push({ check: 'field.' + field, pass, detail: !present ? 'Missing required field' : pass ? 'Field valid' : 'Field violates schema' });
      }
      if (criteria.model === 'invoice.v1') {
        let totalPass = false;
        let detail = 'Invalid monetary fields prevent exact decimal comparison';
        try {
          const items = document.line_items;
          if (!Array.isArray(items) || !items.length) throw new Error('Missing line items');
          const sum = items.reduce<bigint>((acc, item) => acc + decimalCents(record(item).amount), 0n);
          const total = decimalCents(document.total_amount);
          totalPass = sum === total;
          detail = 'total_cents=' + total + '; line_sum_cents=' + sum;
        } catch { /* Invalid amounts are a failed check, never rounded or coerced. */ }
        results.push({ check: 'invoice.total_matches_lines', pass: totalPass, detail });
      }
      const validFields = results.filter(item => item.check.startsWith('field.') && item.pass).length;
      const missing = required.find(field => !Object.hasOwn(document, field));
      const invalid = required.find(field => !results.find(item => item.check === 'field.' + field)!.pass);
      message = missing ? validFields + '/' + required.length + ' · MISSING: ' + missing
        : invalid ? validFields + '/' + required.length + ' · INVALID: ' + invalid
        : results.some(item => item.check === 'invoice.total_matches_lines' && !item.pass)
          ? '6/6 · TOTAL MISMATCH'
          : !schemaPass ? validFields + '/' + required.length + ' · INVALID: ' + criteria.model
            : required.length + '/' + required.length + ' FIELDS VALID';
    }
    const report: ValidationReport = {
      mission, schema: criteria.model, results, pass: results.every(result => result.pass),
      message, agent: 'agent de référence scripté',
    };
    if (args.criteriaHash !== undefined) report.criteria_hash = args.criteriaHash;
    if (args.deliveryHash !== undefined) report.delivery_hash = args.deliveryHash;
    return report;

  };
}
