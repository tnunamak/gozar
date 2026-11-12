// Test-only network double, loaded with --import. It routes a fake public origin
// (for example node.tailnet.test:8443) to a loopback HTTPS ingress. The agent has already
// set SNI from the original hostname, so certificate and hostname validation are unchanged.
// Any other non-loopback HTTPS destination is refused, so tests cannot reach the network.
import https from 'node:https';

const routes = JSON.parse(process.env.GOZAR_TEST_NETWORK ?? '{}');
const connect = https.globalAgent.createConnection;
https.globalAgent.createConnection = function (options, callback) {
  const port = routes[`${options.host}:${options.port}`];
  if (port !== undefined) options = { ...options, host: '127.0.0.1', port };
  else if (!['127.0.0.1', 'localhost', '::1'].includes(options.host)) throw new Error(`Test network refuses ${options.host}:${options.port}`);
  return connect.call(this, options, callback);
};
