import { describe, expect, it } from 'vitest';

import { evaluateDemoResult } from '../scripts/assert-demo-result.mjs';

describe('demo result assertion', () => {
  it.each([
    {
      attackOutcome: 'success',
      policyEventCount: 0,
      destinationMatched: false,
      attackSignal: null,
      mode: 'baseline',
      receiptExists: true,
    },
    {
      attackOutcome: 'success',
      policyEventCount: 1,
      destinationMatched: true,
      attackSignal: null,
      mode: 'observe',
      receiptExists: true,
    },
    {
      attackOutcome: 'failure',
      policyEventCount: 1,
      destinationMatched: true,
      attackSignal: 'SIGKILL',
      mode: 'enforce',
      receiptExists: false,
    },
  ])('accepts the expected $mode outcome', (result) => {
    expect(evaluateDemoResult(result)).toEqual({ ok: true, reasons: [] });
  });

  it('reports all independent enforcement failures', () => {
    const result = evaluateDemoResult({
      attackOutcome: 'success',
      policyEventCount: 0,
      destinationMatched: false,
      attackSignal: null,
      mode: 'enforce',
      receiptExists: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(4);
  });

  it('rejects unrelated request failures even when a policy event exists', () => {
    const result = evaluateDemoResult({
      attackOutcome: 'failure',
      policyEventCount: 1,
      destinationMatched: true,
      attackSignal: null,
      mode: 'enforce',
      receiptExists: false,
    });
    expect(result.ok).toBe(false);
    expect(result.reasons).toContain('The curl child process did not report SIGKILL.');
  });

  it.each([undefined, -1, NaN])('rejects an invalid policy count: %s', (count) => {
    expect(
      evaluateDemoResult({
        attackOutcome: 'failure',
        policyEventCount: count,
        destinationMatched: true,
        attackSignal: 'SIGKILL',
        mode: 'enforce',
        receiptExists: false,
      }).ok,
    ).toBe(false);
  });

  it('rejects policy events for a different destination', () => {
    expect(
      evaluateDemoResult({
        attackOutcome: 'failure',
        policyEventCount: 1,
        destinationMatched: false,
        attackSignal: 'SIGKILL',
        mode: 'enforce',
        receiptExists: false,
      }).ok,
    ).toBe(false);
  });
});
