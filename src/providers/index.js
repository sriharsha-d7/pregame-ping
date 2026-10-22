import { createDemoProvider } from './demo.js';
import { createEspnProvider } from './espn.js';

let provider = null;

/** SPORTS_PROVIDER=demo (default, simulated league) or espn (live data). */
export function getProvider() {
  if (!provider) provider = process.env.SPORTS_PROVIDER === 'espn' ? createEspnProvider() : createDemoProvider();
  return provider;
}

/** Swap the provider (used by tests). */
export function setProvider(p) {
  provider = p;
}
