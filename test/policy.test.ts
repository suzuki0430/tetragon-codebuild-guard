import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

interface TracingPolicyDocument {
  metadata: { name: string };
  spec: {
    kprobes: Array<{
      args: Array<{ index: number; type: string }>;
      call: string;
      selectors: Array<{
        matchActions: Array<{ action: string }>;
        matchArgs: Array<{ operator: string; values: string[] }>;
        matchBinaries: Array<{ operator: string; values: string[] }>;
      }>;
    }>;
  };
}

describe('block-curl-egress tracing policy', () => {
  it('matches non-loopback curl connections and defines synchronous enforcement', () => {
    const path = resolve('policies/block-curl-egress.yaml');
    const policy = parse(readFileSync(path, 'utf8')) as TracingPolicyDocument;
    const probe = policy.spec.kprobes[0];
    const selector = probe?.selectors[0];

    expect(policy.metadata.name).toBe('block-curl-egress');
    expect(probe?.call).toBe('tcp_connect');
    expect(selector?.matchArgs).toContainEqual({
      index: 0,
      operator: 'NotDAddr',
      values: ['127.0.0.0/8'],
    });
    expect(selector?.matchBinaries).toContainEqual({
      operator: 'In',
      values: ['/usr/bin/curl'],
    });
    expect(selector?.matchActions).toEqual([{ action: 'Sigkill' }]);
  });
});
