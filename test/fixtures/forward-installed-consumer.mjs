// The host side of the installed-package forward acceptance test. It is copied next to an installed package and runs there,
// so every `@tnunamak/gozar` import resolves to the bytes npm installed, never to the repository.
//
// It plays the application that owns a loopback listener (Faravan's role), and nothing else:
//   - a real HTTP listener that mounts the package's own service verifier and answers every other request with APP_BYTES;
//   - a UI mock whose `show(action)` approves a decision step and refuses anything it cannot answer, and whose
//     `untilClosed()` waits for the test to send `close` on stdin;
//   - `publishSignedAddress(origin)`, which records the origin and fetches it through the published address once.
// It then imports the consumer module named by argv[2] (the exact documentation example, or a test-written consumer), which
// reads these as globals the way a real host would pass them in. Each stdout line is one JSON report for the test.
import http from 'node:http';
import https from 'node:https';
import readline from 'node:readline';
import { createServiceVerifier } from '@tnunamak/gozar';

export const APP_BYTES = 'faravan-app-bytes';
const report = (type, data = {}) => process.stdout.write(JSON.stringify({ type, ...data }) + '\n');
const get = (url, transport) => new Promise((resolve, reject) => {
  transport.get(url, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
  }).on('error', reject);
});

const verifier = createServiceVerifier();
const app = http.createServer((request, response) => { if (!verifier(request, response)) response.end(APP_BYTES); });
// HOST_PORT lets a restart reuse the previous run's port, as an application with a configured port would.
await new Promise(resolve => app.listen(Number(process.env.HOST_PORT ?? 0), '127.0.0.1', resolve));
const port = app.address().port;

const closeRequested = new Promise(resolve => {
  readline.createInterface({ input: process.stdin }).on('line', line => { if (line.trim() === 'close') resolve(); });
});
const shown = [], signed = [], verifications = [], transitions = [];
const ui = {
  show: async action => {
    shown.push(structuredClone(action));
    return action.answer?.type === 'decision' ? { approve: true } : { approve: false };
  },
  untilClosed: async () => {
    const through = await Promise.all(verifications);
    report('published', { port, signed: structuredClone(signed), through, shown: structuredClone(shown) });
    await closeRequested;
  },
};
const publishSignedAddress = (origin, previous) => {
  signed.push({ origin, previous: previous ?? null });
  verifications.push(get(origin, https).then(result => ({ origin, ...result }), error => ({ origin, error: error.message })));
};
globalThis.faravanHost = { port, ui, publishSignedAddress,
  showOffline: downSince => transitions.push({ down: downSince }), showOnline: event => transitions.push({ back: event }), showRecoveryFailure: event => transitions.push({ halted: event }) };
// An error is data for the test, not a crash: it keeps its code, its per-provider rows and the absence of a next action.
const describe = error => ({ code: error?.code ?? null, message: String(error?.message ?? error), nextAction: error?.nextAction ?? null,
  unmet: error?.unmet ?? null });

let failure = null;
try { await import(new URL(process.argv[2], `file://${process.cwd()}/`).href); }
catch (error) { failure = describe(error); }
const survived = await get(`http://127.0.0.1:${port}/`, http).then(result => result.body === APP_BYTES, () => false);
report('done', { port, failure, listenerSurvived: survived, shown, signed, transitions });
app.closeAllConnections();
await new Promise(resolve => app.close(resolve));
process.exit(failure ? 1 : 0);
