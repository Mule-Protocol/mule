import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { MODELS, type Fixture, type Model } from './types.js';

export function loadFixture(model: Model, directory = resolve(__dirname, '../../../fixtures')): Fixture {
  if (!MODELS.includes(model)) throw new Error('Unsupported mission model');
  const criteria = JSON.parse(readFileSync(join(directory, model, 'criteria.json'), 'utf8'));
  const input = JSON.parse(readFileSync(join(directory, model, 'input.json'), 'utf8'));
  if (criteria.model !== model) throw new Error('Fixture model mismatch');
  return { criteria, input };
}
