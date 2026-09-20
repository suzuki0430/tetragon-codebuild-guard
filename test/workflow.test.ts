import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface WorkflowStep {
  readonly uses?: string;
  readonly name?: string;
  readonly run?: string;
  readonly if?: string;
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

  it('uses the portable local address helper and skips assertions after setup failures', () => {
    const workflow = parse(
      readFileSync(resolve('.github/workflows/tetragon-ci.yml'), 'utf8'),
    ) as GuardWorkflow;
    const steps = workflow.jobs['guard-demo'].steps;
    const sink = steps.find((step) => step.name === 'Start the local canary sink');
    const assertion = steps.find(
      (step) => step.name === 'Assert the expected security result',
    );

    expect(sink?.run).toContain('node scripts/local-ipv4.mjs');
    expect(sink?.run).not.toContain('hostname');
    expect(assertion?.if).toContain("steps.attack.outcome == 'success'");
    expect(assertion?.if).toContain("steps.attack.outcome == 'failure'");
  });
});
