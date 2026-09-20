#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/**
 * Parses newline-delimited Tetragon JSON while retaining a count of malformed lines.
 *
 * @param {string} content Newline-delimited JSON exported by Tetragon.
 * @returns {{events: Array<Record<string, unknown>>, invalidLineCount: number}}
 * Parsed events and the number of non-empty lines that were not valid JSON objects.
 *
 * @example
 * const parsed = parseTetragonLog('{"process_exec": {}}\n');
 * console.log(parsed.events.length); // 1
 */
export function parseTetragonLog(content) {
  const events = [];
  let invalidLineCount = 0;

  for (const line of content.split('\n')) {
    if (line.trim().length === 0) {
      continue;
    }

    try {
      const event = JSON.parse(line);
      if (event !== null && typeof event === 'object' && !Array.isArray(event)) {
        events.push(event);
      } else {
        invalidLineCount += 1;
      }
    } catch {
      invalidLineCount += 1;
    }
  }

  return { events, invalidLineCount };
}

/**
 * Extracts the first socket argument from a Tetragon kprobe event.
 *
 * @param {Record<string, unknown>} kprobe Tetragon `process_kprobe` payload.
 * @returns {Record<string, unknown> | undefined} Socket argument when present.
 */
function socketArgument(kprobe) {
  if (!Array.isArray(kprobe.args)) {
    return undefined;
  }

  for (const argument of kprobe.args) {
    if (
      argument !== null &&
      typeof argument === 'object' &&
      argument.sock_arg !== null &&
      typeof argument.sock_arg === 'object'
    ) {
      return argument.sock_arg;
    }
  }

  return undefined;
}

/**
 * Produces a stable, secret-free summary of Tetragon process and network events.
 *
 * @param {Array<Record<string, unknown>>} events Parsed Tetragon events.
 * @param {number} [invalidLineCount=0] Number of malformed source log lines.
 * @returns {{
 *   totalEventCount: number,
 *   invalidLineCount: number,
 *   processExecCount: number,
 *   tcpConnectCount: number,
 *   curlTcpConnectCount: number,
 *   curlSigkillActionCount: number,
 *   curlDestinations: string[],
 *   policyTcpConnectCount: number,
 *   policyConnectMissingBinaryCount: number,
 *   policySigkillActionCount: number,
 *   policyDestinations: string[]
 * }} Aggregated event counts and unique curl destinations.
 *
 * @example
 * const summary = summarizeTetragonEvents([]);
 * console.log(summary.curlTcpConnectCount); // 0
 */
export function summarizeTetragonEvents(events, invalidLineCount = 0) {
  let processExecCount = 0;
  let tcpConnectCount = 0;
  let curlTcpConnectCount = 0;
  let curlSigkillActionCount = 0;
  let policyTcpConnectCount = 0;
  let policyConnectMissingBinaryCount = 0;
  let policySigkillActionCount = 0;
  const curlDestinations = new Set();
  const policyDestinations = new Set();

  for (const event of events) {
    if (event.process_exec !== undefined) {
      processExecCount += 1;
    }

    const kprobe = event.process_kprobe;
    if (kprobe === null || typeof kprobe !== 'object') {
      continue;
    }
    if (kprobe.function_name !== 'tcp_connect') {
      continue;
    }

    tcpConnectCount += 1;
    const process = kprobe.process;
    const binary =
      process !== null && typeof process === 'object' ? process.binary : undefined;
    const socket = socketArgument(kprobe);
    const destination =
      socket !== undefined && typeof socket.daddr === 'string'
        ? typeof socket.dport === 'number'
          ? `${socket.daddr}:${socket.dport}`
          : socket.daddr
        : undefined;
    const sigkillAction =
      kprobe.action === 'KPROBE_ACTION_SIGKILL' || kprobe.action === 3;

    // Kernel-side binary matching can succeed even when userspace enrichment fails.
    // Keep policy matches separate; never invent a missing process.binary value.
    if (kprobe.policy_name === 'block-curl-egress') {
      policyTcpConnectCount += 1;
      if (typeof binary !== 'string' || binary.length === 0) {
        policyConnectMissingBinaryCount += 1;
      }
      if (sigkillAction) {
        policySigkillActionCount += 1;
      }
      if (destination !== undefined) {
        policyDestinations.add(destination);
      }
    }
    if (binary !== '/usr/bin/curl') {
      continue;
    }

    curlTcpConnectCount += 1;
    if (sigkillAction) {
      curlSigkillActionCount += 1;
    }

    if (destination !== undefined) {
      curlDestinations.add(destination);
    }
  }

  return {
    totalEventCount: events.length,
    invalidLineCount,
    processExecCount,
    tcpConnectCount,
    curlTcpConnectCount,
    curlSigkillActionCount,
    curlDestinations: [...curlDestinations].sort(),
    policyTcpConnectCount,
    policyConnectMissingBinaryCount,
    // A SIGKILL action label also appears in monitor mode; it is not proof of a kill.
    policySigkillActionCount,
    policyDestinations: [...policyDestinations].sort(),
  };
}

/**
 * Reads command-line options for the event analyzer.
 *
 * @param {string[]} arguments_ Arguments excluding the Node executable and script path.
 * @returns {{inputPath: string, outputPath?: string}} Validated analyzer options.
 */
function parseArguments(arguments_) {
  const [inputPath, option, outputPath] = arguments_;
  if (inputPath === undefined || (option !== undefined && option !== '--output')) {
    throw new Error('Usage: analyze-events.mjs <tetragon.log> [--output summary.json]');
  }
  if (option === '--output' && outputPath === undefined) {
    throw new Error('--output requires a path');
  }
  return outputPath === undefined ? { inputPath } : { inputPath, outputPath };
}

/**
 * Runs the event analyzer command-line interface.
 *
 * @param {string[]} arguments_ Arguments excluding the Node executable and script path.
 * @returns {void}
 */
function main(arguments_) {
  const { inputPath, outputPath } = parseArguments(arguments_);
  const parsed = parseTetragonLog(readFileSync(inputPath, 'utf8'));
  const summary = summarizeTetragonEvents(parsed.events, parsed.invalidLineCount);
  const json = `${JSON.stringify(summary, null, 2)}\n`;

  if (outputPath === undefined) {
    process.stdout.write(json);
    return;
  }
  writeFileSync(outputPath, json, { encoding: 'utf8', mode: 0o644 });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
