import { join } from 'node:path';
import { homedir } from 'node:os';

// The Gozar home used when a caller passes none: GOZAR_HOME, else ~/.local/state/gozar on every
// supported platform. One path on Linux and macOS keeps the control sockets under it well inside
// macOS's 104-byte socket path limit. The route preference profile is resolved separately, for the
// real OS user (route-preferences.mjs).
export const defaultHome = () => process.env.GOZAR_HOME ?? join(homedir(), '.local', 'state', 'gozar');
