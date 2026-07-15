import {describe, expect, it} from 'vitest';
import type {WorkflowGraph} from '@ujima/shared';
import {
  findDownstreamOutputSpec,
  renderOutputFormatContract,
} from './workflow-node-executors.js';

function graphWithOutput(): WorkflowGraph {
  return {
    nodes: [
      {id: 't', kind: 'trigger', position: {x: 0, y: 0}, config: {source: 'mention'}},
      {id: 'a', kind: 'agent', position: {x: 1, y: 0}, config: {agentId: 'pm', prompt: 'x'}},
      {
        id: 'out',
        kind: 'output',
        position: {x: 2, y: 0},
        config: {format: 'table', instructions: 'columns A | B', outputPath: 'o.md'},
      },
    ],
    edges: [
      {id: 'e1', source: 't', sourcePort: 'main', target: 'a', targetPort: 'main'},
      {id: 'e2', source: 'a', sourcePort: 'main', target: 'out', targetPort: 'main'},
    ],
  };
}

describe('findDownstreamOutputSpec', () => {
  it("returns the output node feeding off an agent's main port", () => {
    const spec = findDownstreamOutputSpec(graphWithOutput(), 'a');
    expect(spec?.nodeId).toBe('out');
    expect(spec?.config.format).toBe('table');
  });

  it('returns null when the agent has no downstream output node', () => {
    expect(findDownstreamOutputSpec(graphWithOutput(), 't')).toBeNull();
  });
});

describe('renderOutputFormatContract', () => {
  it('renders the format, details, and path', () => {
    const out = renderOutputFormatContract(
      {format: 'table', instructions: 'columns A | B'},
      'report.md',
    );
    expect(out).toContain('table');
    expect(out).toContain('columns A | B');
    expect(out).toContain('report.md');
  });

  it('omits the details sentence when there are no instructions', () => {
    const out = renderOutputFormatContract({format: 'json'}, 'data.json');
    expect(out).toContain('JSON');
    expect(out).not.toContain('Format details:');
  });
});
