import https from 'node:https';
import { BlockList, isIP } from 'node:net';
import { Readable, Transform } from 'node:stream';
import { performance } from 'node:perf_hooks';
import { safeOrigin } from './catalog.mjs';

const resolver = 'https://1.1.1.1/dns-query';
const ipv4Denied = new BlockList();
for (const [address, prefix] of [['0.0.0.0',8],['10.0.0.0',8],['100.64.0.0',10],['127.0.0.0',8],['169.254.0.0',16],['172.16.0.0',12],['192.0.0.0',24],['192.0.2.0',24],['192.88.99.0',24],['192.168.0.0',16],['198.18.0.0',15],['198.51.100.0',24],['203.0.113.0',24],['224.0.0.0',4],['240.0.0.0',4]]) ipv4Denied.addSubnet(address,prefix,'ipv4');
const ipv6Global = new BlockList(); ipv6Global.addSubnet('2000::',3,'ipv6');
const ipv6Denied = new BlockList();
for (const [address,prefix] of [['2001::',23],['2001:db8::',32],['2002::',16],['3fff::',20],['3ffe::',16]]) ipv6Denied.addSubnet(address,prefix,'ipv6');

// Fail closed on special-use ranges, mapped addresses, scope IDs and unknown address syntax.
export function isPublicIp(address) {
  if (typeof address !== 'string' || address.includes('%')) return false;
  const family = isIP(address);
  if (family === 4) return !ipv4Denied.check(address,'ipv4');
  return family === 6 && ipv6Global.check(address,'ipv6') && !ipv6Denied.check(address,'ipv6');
}

const headerNames = ['server','via','date','content-type','content-length','cache-control','age','x-cache','x-served-by','x-request-id'];
function headersForEvidence(headers) {
  return Object.fromEntries(headerNames.filter(name => headers[name] !== undefined).map(name => [name, String(headers[name]).slice(0,2048)]));
}

// https.request ignores proxy environment variables; an isolated agent prevents ambient agent/proxy reuse.
function pinnedResponse(url, address, options = {}, evidence = []) {
  return new Promise((resolve,reject) => {
    const limit = Math.min(options.maxResponseBytes ?? 65536,1048576);
    let received = 0, responseStarted = false, bodyStream;
    const request = https.request({ hostname: url.hostname, port: url.port || 443, path: url.pathname + url.search,
      method: options.method ?? 'GET', headers: options.headers, servername: isIP(url.hostname) ? undefined : url.hostname,
      rejectUnauthorized: true, agent: false, signal: options.signal,
      lookup: (_name, lookupOptions, callback) => lookupOptions.all ? callback(null,[{address,family:isIP(address)}]) : callback(null,address,isIP(address)),
    }, response => {
      responseStarted = true;
      if (response.socket.remoteAddress !== address || !response.socket.authorized) { clearTimeout(deadline); response.destroy(); request.destroy(); reject(new Error('Pinned TLS peer or certificate validation mismatch')); return; }
      if (response.statusCode >= 300 && response.statusCode < 400) { clearTimeout(deadline); response.destroy(); request.destroy(); reject(new Error('Public relay redirects are not admitted')); return; }
      evidence.push({ resolvedIp: address, tlsServername: url.hostname, tlsProtocol: response.socket.getProtocol(), status: response.statusCode,
        relayHeaders: headersForEvidence(response.headers), observedAtMs: Date.now() });
      const bounded = new Transform({ transform(chunk,_encoding,callback) {
        received += chunk.length;
        callback(received > limit ? new Error('Public response exceeds byte limit') : null, received > limit ? undefined : chunk);
      } });
      bodyStream = bounded;
      response.once('end',()=>clearTimeout(deadline));
      response.on('error',error => bounded.destroy(error));
      bounded.on('close',() => { clearTimeout(deadline); response.destroy(); request.destroy(); });
      response.pipe(bounded);
      const headers = new Headers();
      for (const [name,value] of Object.entries(response.headers)) if (value !== undefined) {
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name,item);
      }
      if ([204,205].includes(response.statusCode)) { response.resume(); bounded.resume(); resolve(new Response(null,{ status: response.statusCode, headers })); }
      else resolve(new Response(Readable.toWeb(bounded),{ status: response.statusCode, headers }));
    });
    const deadline = setTimeout(() => request.destroy(new Error('Public network request timed out')),options.timeoutMs ?? 10000);
    request.on('error',error => { clearTimeout(deadline); if (bodyStream) bodyStream.destroy(error); else if (!responseStarted) reject(error); });
    request.end(options.body);
  });
}

export async function resolvePublicOrigin(value, { signal, timeoutMs = 10000 } = {}) {
  const origin = safeOrigin(value), url = new URL(origin);
  if (url.protocol !== 'https:' || isIP(url.hostname.replace(/^\[|\]$/g,''))) throw new Error('Public relay verification requires an HTTPS DNS hostname');
  const answers = await Promise.all([1,28].map(async type => {
    const endpoint = new URL(resolver); endpoint.searchParams.set('name',url.hostname); endpoint.searchParams.set('type',String(type));
    const response = await pinnedResponse(endpoint,'1.1.1.1',{ signal, timeoutMs, maxResponseBytes: 32768, headers: { accept:'application/dns-json' } });
    if (response.status !== 200) throw new Error('Public DNS resolver failed');
    let document; try { document = await response.json(); } catch { throw new Error('Public DNS response is invalid'); }
    if (![0,3].includes(document.Status) || document.TC === true) throw new Error('Public DNS answer failed or was truncated');
    const addresses = (document.Answer ?? []).filter(answer => answer.type === type).map(answer => answer.data);
    if (addresses.some(address => !isPublicIp(address))) throw new Error('Public DNS returned a nonpublic IP address');
    return addresses;
  }));
  const addresses = [...new Set(answers.flat())];
  if (!addresses.length) throw new Error('Public DNS returned no usable public address');
  return { origin, hostname:url.hostname, resolver, resolvedIp:addresses[0], addresses, publicDns:true };
}

export function createPinnedPublicRequest({ origin: value, resolvedIp, timeoutMs = 10000, signal } = {}) {
  const origin = safeOrigin(value);
  if (!origin.startsWith('https:') || !isPublicIp(resolvedIp)) throw new Error('An HTTPS origin and approved public IP are required');
  const evidence = [];
  const request = (value, options = {}) => {
    const url = new URL(value,origin);
    if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('Request is outside the approved public origin');
    const declaredHost = Object.entries(options.headers ?? {}).find(([name]) => name.toLowerCase() === 'host');
    if (declaredHost && declaredHost[1] !== url.host) throw new Error('Host header differs from approved TLS origin');
    return pinnedResponse(url,resolvedIp,{ timeoutMs, signal, ...options },evidence);
  };
  request.evidence = evidence;
  request.origin = origin; request.resolvedIp = resolvedIp; request.tlsServername = new URL(origin).hostname;
  return request;
}

export async function createPublicRelayTransport(origin,options = {}) {
  const resolution = await resolvePublicOrigin(origin,options);
  const request = createPinnedPublicRequest({ ...resolution, timeoutMs:options.timeoutMs, signal:options.signal });
  return { ...resolution, networkPath:'public-relay', tlsServername:resolution.hostname, request, evidence:request.evidence };
}

async function json(response) {
  if (response.status !== 200) throw new Error(`Public endpoint returned HTTP ${response.status}`);
  try { return await response.json(); } catch { throw new Error('Public endpoint returned invalid JSON'); }
}

export class PublicRelayVerifier {
  constructor({ protocolProbe, now = () => Math.floor(performance.timeOrigin + performance.now()) } = {}) { this.vantages = ['public']; this.protocolProbe = protocolProbe; this.now = now; }
  async verify({ origin, vantage, authorization, challenge, requirements, signal, networkTimeoutMs = 10000 }) {
    if (vantage !== 'public' || authorization.allowPublicRelay !== true) throw new Error('Public relay authority is not enabled');
    const transport = await createPublicRelayTransport(origin,{ signal, timeoutMs:networkTimeoutMs });
    const request = transport.request;
    const identity = await json(await request(origin+challenge.identityPath));
    if (identity.nonce !== challenge.nonce) throw new Error('Public route points to a different instance');
    let sse = false;
    const events = [];
    if (requirements.sse) {
      const response = await request(origin+challenge.streamPath,{ headers:{accept:'text/event-stream'},maxResponseBytes:4096 });
      if (response.status !== 200 || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new Error('Public timed SSE endpoint unavailable');
      let buffer = '';
      for await (const chunk of response.body) {
        buffer += new TextDecoder().decode(chunk);
        while (buffer.includes('\n\n')) {
          const end = buffer.indexOf('\n\n'), frame=buffer.slice(0,end); buffer=buffer.slice(end+2);
          if (!frame.startsWith('data: ')) throw new Error('Public SSE frame is invalid');
          let event; try { event=JSON.parse(frame.slice(6)); } catch { throw new Error('Public SSE JSON is invalid'); }
          const at=performance.now();
          if (event.nonce !== challenge.nonce || event.sequence !== events.length || (events.length && at-events.at(-1)<80)) throw new Error('Public SSE instance changed or frames were buffered');
          events.push(at);
        }
      }
      if (events.length !== 3) throw new Error('Public timed SSE sequence incomplete');
      sse=true;
    }
    let protocols = { streamableHttp:false, oauthDcr:false };
    if (requirements.streamableHttp || requirements.oauthDcr) {
      if (!this.protocolProbe) throw new Error('Requested application protocol checks need a trusted probe profile');
      protocols = await this.protocolProbe({ origin, request, requirements, signal });
      if ((requirements.streamableHttp && protocols.streamableHttp !== true) || (requirements.oauthDcr && protocols.oauthDcr !== true)) throw new Error('Requested application protocol verification failed');
    }
    const observedAtMs=this.now();
    const metadata = { networkPath:'public-relay',remote:false,publicDns:true,resolver:transport.resolver,resolvedIp:transport.resolvedIp,
      tlsServername:transport.tlsServername,relayHeaders:transport.evidence.map(item=>item.relayHeaders),requests:transport.evidence };
    return { probeReceipt:{ nonceRef:authorization.nonceRef,verifierRef:authorization.verifierRef,origin,vantage:'public',observedAtMs,
      expiresAtMs:Math.min(observedAtMs+30000,authorization.expiresAtMs),tls:true,instanceMatched:true,sse,
      streamableHttp:protocols.streamableHttp===true,oauthDcr:protocols.oauthDcr===true,...metadata },provenance:metadata };
  }
}
