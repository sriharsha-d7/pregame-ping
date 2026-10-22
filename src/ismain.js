import { fileURLToPath } from 'node:url';
import path from 'node:path';

// True when the given module is the script node was started with. Works on Windows and Unix.
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(metaUrl)) === path.resolve(process.argv[1]);
}
