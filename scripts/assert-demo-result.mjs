#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SUPPORTED_MODES = new Set(['baseline', 'observe', 'enforce']);

/**
 * Evaluates whether one matrix run demonstrated its expected security behavior.
 *
 * @param {{
 *   mode: 'baseline' | 'observe' | 'enforce',
 *   attackOutcome: 'success' | 'failure',
 *   receiptExists: boolean,
 *   curlEventCount: number
 * }} result Observed workflow, canary, and Tetragon state.
 * @returns {{ok: boolean, reasons: string[]}} Pass/fail decision with actionable reasons.
 *
 * @example
 * const result = evaluateDemoResult({
 *   mode: 'enforce',
 *   attackOutcome: 'failure',
 *   receiptExists: false,
 *   curlEventCount: 1,
 * });
 * console.log(result.ok); // true
 */
export function evaluateDemoResult(result) {
  const reasons = [];
  const protectedMode = result.mode === 'observe' || result.mode === 'enforce';

  if (protectedMode && result.curlEventCount < 1) {
    reasons.push('Tetragon did not record the expected curl tcp_connect event.');
  }
  if (result.mode === 'baseline' && result.curlEventCount !== 0) {
    reasons.push('Baseline unexpectedly loaded a tcp_connect tracing policy.');
  }

  if (result.mode === 'enforce') {
    if (result.attackOutcome !== 'failure') {
      reasons.push('The simulated compromised dependency was not terminated.');
    }
    if (result.receiptExists) {
      reasons.push('The canary reached the sink while enforcement was active.');
    }
  } else {
    if (result.attackOutcome !== 'success') {
      reasons.push('The baseline/observe simulation should complete successfully.');
    }
    if (!result.receiptExists) {
      reasons.push('The canary did not reach the sink in baseline/observe mode.');
    }
  }

  return { ok: reasons.length === 0, reasons };
}

/**
 * Parses the assertion command-line options.
 *
 * @param {string[]} arguments_ Arguments excluding the Node executable and script path.
 * @returns {{mode: string, attackOutcome: string, receiptPath: string, summaryPath: string}}
 * Validated named options.
 */
function parseArguments(arguments_) {
  const options = new Map();
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (key === undefined || value === undefined || !key.startsWith('--')) {
      throw new Error('Each option requires a value.');
    }
    options.set(key.slice(2), value);
  }

  const mode = options.get('mode');
  const attackOutcome = options.get('attack-outcome');
  const receiptPath = options.get('receipt');
  const summaryPath = options.get('summary');
  if (
    mode === undefined ||
    !SUPPORTED_MODES.has(mode) ||
    (attackOutcome !== 'success' && attackOutcome !== 'failure') ||
    receiptPath === undefined ||
    summaryPath === undefined
  ) {
    throw new Error(
      'Usage: assert-demo-result.mjs --mode <mode> --attack-outcome <success|failure> --receipt <path> --summary <path>',
    );
  }

  return { mode, attackOutcome, receiptPath, summaryPath };
}

/**
 * Runs the demo assertion command-line interface.
 *
 * @param {string[]} arguments_ Arguments excluding the Node executable and script path.
 * @returns {void}
 */
function main(arguments_) {
  const options = parseArguments(arguments_);
  const summary = JSON.parse(readFileSync(options.summaryPath, 'utf8'));
  const result = evaluateDemoResult({
    mode: options.mode,
    attackOutcome: options.attackOutcome,
    receiptExists: existsSync(options.receiptPath),
    curlEventCount: summary.curlTcpConnectCount,
  });

  if (!result.ok) {
    for (const reason of result.reasons) {
      console.error(`- ${reason}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`The ${options.mode} scenario produced the expected result.`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2));
}
