import { describe, expect, it } from 'vitest';

import { selectLocalIPv4 } from '../scripts/local-ipv4.mjs';

describe('selectLocalIPv4', () => {
  it('selects a local non-loopback IPv4 address without a hostname executable', () => {
    expect(
      selectLocalIPv4({
        lo: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
        eth0: [
          { address: 'fe80::1', family: 'IPv6', internal: false },
          { address: '172.18.0.2', family: 'IPv4', internal: false },
        ],
      }),
    ).toBe('172.18.0.2');
  });

  it('fails closed when no usable address exists', () => {
    expect(() =>
      selectLocalIPv4({
        missing: undefined,
        lo: [{ address: '127.1.2.3', family: 'IPv4', internal: false }],
      }),
    ).toThrow('No non-loopback local IPv4 address');
  });
});
