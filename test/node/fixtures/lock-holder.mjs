// Takes the lock named by argv[2], prints "held", then holds it until the process is killed.
import { acquireProcessLock } from '../../../packages/gozar-node/process-lock.mjs';
await acquireProcessLock(process.argv[2], { waitMs: 5000 });
process.stdout.write('held\n');
setInterval(() => {}, 1000);
