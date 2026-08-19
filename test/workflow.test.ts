import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
  readonly uses?: string;
}

interface GuardWorkflow {
  readonly jobs: {
    readonly 'guard-demo': {
      readonly 'runs-on': string[];
      readonly steps: WorkflowStep[];
      readonly strategy: {
        readonly matrix: { readonly mode: string[] };
      };
    };
  };
  readonly name: string;
  readonly on: Record<string, unknown>;
}

describe('GitHub Actions workflow', () => {
  it('uses manual dispatch and the three security modes', () => {
    const path = resolve('.github/workflows/tetragon-ci.yml');
    const workflow = parse(readFileSync(path, 'utf8')) as GuardWorkflow;
    const job = workflow.jobs['guard-demo'];

    expect(workflow.name).toBe('Tetragon CodeBuild Guard');
    expect(workflow.on).toHaveProperty('workflow_dispatch');
    expect(job.strategy.matrix.mode).toEqual(['baseline', 'observe', 'enforce']);
    expect(job['runs-on']).toContain('buildspec-override:true');
  });

  it('pins every external action to a full commit SHA', () => {
    const path = resolve('.github/workflows/tetragon-ci.yml');
    const workflow = parse(readFileSync(path, 'utf8')) as GuardWorkflow;
    const externalActions = workflow.jobs['guard-demo'].steps
      .map((step) => step.uses)
      .filter((uses): uses is string => uses !== undefined);

    expect(externalActions.length).toBeGreaterThan(0);
    for (const action of externalActions) {
      expect(action).toMatch(/^[^@]+@[a-f0-9]{40}$/);
    }
  });
});
