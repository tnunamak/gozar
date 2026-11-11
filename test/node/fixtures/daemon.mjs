import { serve } from '../../../packages/gozar-node/daemon.mjs';
import { atomicWrite } from '../../../packages/gozar-node/journal.mjs';
import { join } from 'node:path';
try { await serve(process.argv[3]); }
catch (error) { await atomicWrite(join(process.argv[3], 'failure.json'), { message: error.message }); process.exitCode = 1; }
