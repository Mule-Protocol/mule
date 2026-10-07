export type Model = 'invoice.v1' | 'contract.v1' | 'address.v1';
export type Mode = 'honest' | 'dishonest';
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export interface Criteria {
  model: Model;
  schema: Record<string, unknown>;
  crossChecks: string[];
}
export interface Fixture {
  criteria: Criteria;
  input: JsonValue;
}
export interface CheckResult { check: string; pass: boolean; detail: string }
export interface ValidationReport {
  mission: string;
  schema: Model;
  results: CheckResult[];
  pass: boolean;
  message: string;
  agent: 'agent de référence scripté';
  criteria_hash?: string;
  delivery_hash?: string;
}
export const MODELS: readonly Model[] = ['invoice.v1', 'contract.v1', 'address.v1'];
