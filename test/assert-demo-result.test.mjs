import { describe, expect, it } from 'vitest';

import { evaluateDemoResult } from '../scripts/assert-demo-result.mjs';

describe('demo result assertion', () => {
  it.each([
    {
      attackOutcome: 'success',
      curlEventCount: 0,
      mode: 'baseline',
      receiptExists: true,
    },
    {
      attackOutcome: 'success',
      curlEventCount: 1,
      mode: 'observe',
      receiptExists: true,
    },
    {
      attackOutcome: 'failure',
      curlEventCount: 1,
      mode: 'enforce',
      receiptExists: false,
    },
  ])('accepts the expected $mode outcome', (result) => {
    expect(evaluateDemoResult(result)).toEqual({ ok: true, reasons: [] });
  });

  it('reports both enforcement failures', () => {
    const result = evaluateDemoResult({
      attackOutcome: 'success',
      curlEventCount: 0,
      mode: 'enforce',
      receiptExists: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reasons).toHaveLength(3);
  });
});
