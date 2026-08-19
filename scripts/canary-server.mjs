#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

/**
 * Parses the canary server command-line options.
 *
 * @param {string[]} arguments_ Arguments excluding the Node executable and script path.
 * @returns {{port: number, readyPath: string, receiptPath: string}} Server options.
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

  const portText = options.get('port') ?? '18080';
  const port = Number.parseInt(portText, 10);
  const readyPath = options.get('ready');
  const receiptPath = options.get('receipt');
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`Invalid port: ${portText}`);
  }
  if (readyPath === undefined || receiptPath === undefined) {
    throw new Error(
      'Usage: canary-server.mjs [--port 18080] --ready <path> --receipt <path>',
    );
  }
  return { port, readyPath, receiptPath };
}

/**
 * Hashes a canary so the receipt proves arrival without storing the source value.
 *
 * @param {string} canary Canary value received from the simulated dependency.
 * @returns {string} Lowercase SHA-256 digest.
 */
function hashCanary(canary) {
  return createHash('sha256').update(canary).digest('hex');
}

/**
 * Starts a one-shot local HTTP sink for the safe exfiltration simulation.
 *
 * @param {{port: number, readyPath: string, receiptPath: string}} options Server paths and port.
 * @returns {void}
 */
function main(options) {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/collect') {
      response.writeHead(404).end();
      return;
    }

    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const canary = form.get('canary');
      if (canary === null) {
        response.writeHead(400).end();
        return;
      }

      writeFileSync(
        options.receiptPath,
        `${JSON.stringify(
          {
            canarySha256: hashCanary(canary),
            receivedAt: new Date().toISOString(),
            remoteAddress: request.socket.remoteAddress,
          },
          null,
          2,
        )}\n`,
        { encoding: 'utf8', mode: 0o644 },
      );
      response.writeHead(204).end();
      setImmediate(() => server.close());
    });
  });

  server.listen(options.port, '0.0.0.0', () => {
    writeFileSync(options.readyPath, 'ready\n', { encoding: 'utf8', mode: 0o644 });
    console.log(`Canary sink is listening on port ${options.port}.`);
  });

  process.on('SIGTERM', () => server.close());
  process.on('SIGINT', () => server.close());
}

main(parseArguments(process.argv.slice(2)));
