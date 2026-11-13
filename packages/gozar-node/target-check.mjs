import net from 'node:net';

/**
 * Does anything accept a TCP connection on this loopback port right now? Only a refusal proves nothing is there:
 * a timeout or any other error counts as "something is listening", so the answer never claims an absence it did not see.
 */
export function portListening(port, { host = '127.0.0.1', timeoutMs = 1000 } = {}) {
  return new Promise(resolve => {
    const socket = net.createConnection({ host, port });
    const done = value => { socket.destroy(); resolve(value); };
    socket.setTimeout(timeoutMs, () => done(true));
    socket.once('connect', () => done(true));
    socket.once('error', error => done(error.code !== 'ECONNREFUSED'));
  });
}

/** What a session reports about its target, in the words a durable route uses. A session's app does not answer the durable challenge, so presence is all it can say. */
export async function sessionTargetCheck(port, options) {
  return await portListening(port, options) ? 'listening' : 'nothing listening';
}
