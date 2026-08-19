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

  it('summarizes curl tcp_connect enforcement without retaining arguments', () => {
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
      enforcedCurlConnectCount: 1,
      invalidLineCount: 0,
      processExecCount: 1,
      tcpConnectCount: 1,
      totalEventCount: 2,
    });
    expect(JSON.stringify(summary)).not.toContain('must-not-appear');
  });
});
