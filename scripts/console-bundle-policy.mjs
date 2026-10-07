import assert from 'node:assert/strict';
import { parse } from 'acorn';

/** Inspect the emitted module, not just the sources, including computed member access. */
export function inspectConsoleBundle(source) {
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const forbidden = new Set(['eval', 'Function', 'Buffer', 'process', 'require', '__dirname', '__filename',
    'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Worker', 'SharedWorker', 'importScripts',
    'Deno', 'Bun']);
  let nodes = 0;
  const visit = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (const item of node) visit(item); return; }
    nodes++;
    assert(!['ImportDeclaration', 'ImportExpression'].includes(node.type), 'Bundle must be autonomous: no imports');
    if (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') {
      assert(!node.source, 'Bundle must not re-export an external module');
    }
    if (node.type === 'Identifier') assert(!forbidden.has(node.name), 'Forbidden runtime identifier: ' + node.name);
    if (node.type === 'MemberExpression' && node.computed && node.property.type === 'Literal') {
      assert(!forbidden.has(node.property.value), 'Forbidden computed runtime property: ' + node.property.value);
    }
    for (const [key, value] of Object.entries(node)) {
      if (!['start', 'end', 'type'].includes(key)) visit(value);
    }
  };
  visit(tree);
  assert(!/\beval\s*\(/.test(source), 'eval text is forbidden');
  assert(!/\bnew\s+Function\b/.test(source), 'new Function text is forbidden');
  return { parsedAs: 'ECMAScript module', astNodes: nodes, imports: 0, eval: 0,
    functionConstructors: 0, nodeRuntimeReferences: 0, networkApiReferences: 0 };
}
