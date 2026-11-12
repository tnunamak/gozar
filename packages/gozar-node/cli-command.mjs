import { fileURLToPath } from 'node:url';

const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";
// Resolve relative to this installed module, including npm local and one-shot installs.
export const cliCommand = (command, port) => [process.execPath,
  fileURLToPath(new URL('../../bin/gozar.mjs', import.meta.url)), command,
  ...(port === undefined ? [] : ['--port', String(port)])].map(shellQuote).join(' ');
