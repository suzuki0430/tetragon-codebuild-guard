import { describe, expect, it } from 'vitest';

import {
  parseTetragonLog,
  summarizeTetragonEvents,
} from '../scripts/analyze-events.mjs';

describe('Tetragon event analysis', () => {
  it('parses newline-delimited events and counts malformed lines', () => {
    const parsed = parseTetragonLog('{"process_exec":{}}\nnot-json\n[]\n');

    expect(parsed.events).toHaveLength(1);
    expect(parsed.invalidLineCount).toBe(2);
  });

  it('summarizes curl tcp_connect action labels without retaining arguments', () => {
    const events = [
      { process_exec: { process: { binary: '/usr/bin/node' } } },
      {
        process_kprobe: {
          action: 'KPROBE_ACTION_SIGKILL',
          args: [
            {
              sock_arg: {
                daddr: '172.18.0.2',
                dport: 18080,
              },
            },
          ],
          function_name: 'tcp_connect',
          process: {
            arguments: '--data-urlencode canary=must-not-appear',
            binary: '/usr/bin/curl',
          },
        },
      },
    ];

    const summary = summarizeTetragonEvents(events);

    expect(summary).toEqual({
      curlDestinations: ['172.18.0.2:18080'],
      curlTcpConnectCount: 1,
      curlSigkillActionCount: 1,
      invalidLineCount: 0,
      processExecCount: 1,
      tcpConnectCount: 1,
      totalEventCount: 2,
      policyTcpConnectCount: 0,
      policyConnectMissingBinaryCount: 0,
      policySigkillActionCount: 0,
      policyDestinations: [],
    });
    expect(JSON.stringify(summary)).not.toContain('must-not-appear');
  });

  it('counts the exact demo policy without inventing missing process enrichment', () => {
    const event = {
      process_kprobe: {
        policy_name: 'block-curl-egress',
        function_name: 'tcp_connect',
        process: { pid: 123, flags: 'unknown' },
        action: 'KPROBE_ACTION_SIGKILL',
        args: [{ sock_arg: { daddr: '172.18.0.1', dport: 18080 } }],
      },
    };
    const unrelated = {
      process_kprobe: { ...event.process_kprobe, policy_name: 'another-policy' },
    };
    const summary = summarizeTetragonEvents([event, unrelated]);

    expect(summary.policyTcpConnectCount).toBe(1);
    expect(summary.policyConnectMissingBinaryCount).toBe(1);
    expect(summary.policySigkillActionCount).toBe(1);
    expect(summary.policyDestinations).toEqual(['172.18.0.1:18080']);
    expect(summary.curlTcpConnectCount).toBe(0);
    expect(summary.curlDestinations).toEqual([]);
  });
});
