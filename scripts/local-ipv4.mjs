#!/usr/bin/env node
import { networkInterfaces } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Selects a local IPv4 address that exercises the non-loopback tracing policy.
 *
 * No DNS lookup or external connection is used. This also works in minimal build
 * images without the hostname command. The canary server binds all local interfaces.
 *
 * @param {ReturnType<typeof networkInterfaces>} [interfaces] Interfaces to inspect.
 * @returns {string} First non-loopback IPv4 address owned by this container.
 * @throws {Error} If the environment exposes no suitable local address.
 * @example
 * const address = selectLocalIPv4({ eth0: [
 *   { address: '172.18.0.2', family: 'IPv4', internal: false },
 * ] });
 * console.log(address); // 172.18.0.2
 */
export function selectLocalIPv4(interfaces = networkInterfaces()) {
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (
        address.family === 'IPv4' &&
        !address.internal &&
        !address.address.startsWith('127.')
      ) {
        return address.address;
      }
    }
  }
  throw new Error('No non-loopback local IPv4 address is available for the canary.');
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  console.log(selectLocalIPv4());
}
