# Exact public consumer repro evidence for 6ef11f3

Source artifact6ef11f3ceb80c93db771e4f2064cd4e761781717, SHA256119c3326ea6e476239619c99a6ff6dec74a65762917456e2f170c7b33787d1c6. Installed201files/0mismatches. Consumer be632ec771a470fbe918e657212c23b2384d9335 unchanged. Aggregate FAIL:10 pass,2fail,1blocked,2detect-only; controller25/7; browsers2pass. No assertions relaxed.

Observed failures: LAN session setup_unknown no executable token/cause; owner-address session invalid reserved session handle after setup, reserved external generation1; locked ROTATED draft empty credentials after apply/new draft/clear/stage; generic HTTP session provider_unavailable no usable origin before effects/proof; listRoutes bare null publication despite verified current routeStatus; artifact-integrity rejection before effects leaves reserved attached handle that closeRoute cannot find; tunnl session execution-not-implemented. Generic session cleanup and killed-caller recovery, all durable recovery, old false boot/gen and raw detect-only now pass.

These are test source snippets from the consumer, not implementation changes or permission to weaken validation. Copyright/SPDX preserved where supplied; original sources Apache-2.0. Local imports refer to other snippets here; directory names are labels, not permission to read outside a job scope. Use them to author standalone Gozar public tests in the job's scoped test file. Do not run pasted standalone scripts unchanged: they intentionally retain evidence homes and may expect external fixture data. New tests must clean their own resources.


## boundary-repros-6ef11f3.mjs

```js
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createGozar,createServiceVerifier} from '@tnunamak/gozar';
import {fakeRegistry} from '@tnunamak/gozar/testing';
import {createEffectFixtureHost} from './testing-effects.mjs';
import {SecretBackend} from './public-journey.mjs';
import http from 'node:http';
import {once} from 'node:events';
const mode=process.argv[2],parent=join(homedir(),'.tmp','ra');await mkdir(parent,{recursive:true,mode:0o700});const root=await mkdtemp(join(parent,'boundary-')),home=join(root,'h'),owner='fixture-owner',report={mode,calls:[]};
const registry=await fakeRegistry({id:'fixture-saffron',proofProtocol:'http',transport:'http',kinds:['attached'],reach:'this-device',dir:join(root,'registry'),...(mode==='locked'?{setupActions:[{id:'saffron.credential',kind:'provide-secret',label:'Credential',secretLabel:'Credential',required:true,digest:'fixture-v1',disclosure:{revision:'fixture-v1',text:'Fixture custody',links:[]}}]}:{})});
class LockedBackend extends SecretBackend {locked=false;async withSecret(input,use){if(this.locked)throw Object.assign(new Error("backend locked"),{code:"secret_backend_locked"});return super.withSecret(input,use)}async presence(input){return this.locked?{known:false,reason:'secret_backend_locked'}:super.presence(input)}}
const backend=new LockedBackend(),harness=await createEffectFixtureHost({manifest:registry.manifest,root:registry.root,secretBackend:backend,hostCapabilities:{'secrets.backend':{known:true,value:true},'runtime.attached':{known:true,value:true}}},[]),gozar=mode==='enumeration'?createGozar({manifest:registry.manifest,root:registry.root,secretBackend:backend,identity:{instanceId:crypto.randomUUID(),bootId:crypto.randomUUID()},hostCapabilities:{'secrets.backend':{known:true,value:true},'runtime.attached':{known:true,value:true}}}):harness.gozar;
let app;
try{
 const provider=(await gozar.listProviders({home,owner})).providers[0];
 if(mode==='locked'){
  let draft=await gozar.beginConfigurationDraft({home,owner,providerId:provider.providerId,expectedConfigurationRevision:provider.configuration.revision});const c=draft.configuration,a=c.actions.find(a=>a.kind==='provide-secret'),f=c.inputRequirements.find(f=>f.actionId===a.id);
  const {handle}=await gozar.storeSecret({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:c.revision,scopeId:draft.scopeId,inputId:f.id,bytes:new TextEncoder().encode('fixture-only-credential')});
  await gozar.runSetupAction({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:c.revision,actionId:a.id,secretHandle:handle,approval:{kind:'setup',digest:a.digest,disclosureRevision:a.disclosure.revision,consentFactsDigest:a.consent.consentFactsDigest}});
  const fresh=await gozar.readConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId});const applied=await gozar.commitConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:fresh.configuration.revision});draft=await gozar.beginConfigurationDraft({home,owner,providerId:provider.providerId,expectedConfigurationRevision:applied.revision});const clear=draft.configuration.actions.find(a=>a.kind==='clear-input');draft.configuration=await gozar.clearConfigurationInput({home,owner,providerId:provider.providerId,draftId:draft.draftId,inputId:clear.inputId,expectedConfigurationRevision:draft.configuration.revision,approval:{kind:'setup',digest:clear.digest,disclosureRevision:clear.disclosure.revision,consentFactsDigest:clear.consent.consentFactsDigest}});const action=draft.configuration.actions.find(a=>a.kind==='provide-secret'),field=draft.configuration.inputRequirements.find(f=>f.actionId===action.id);const staged=await gozar.storeSecret({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,scopeId:draft.scopeId,inputId:field.id,bytes:new TextEncoder().encode('fixture-rotation-credential')});await gozar.runSetupAction({home,owner,providerId:provider.providerId,draftId:draft.draftId,expectedConfigurationRevision:draft.configuration.revision,actionId:action.id,secretHandle:staged.handle,approval:{kind:'setup',digest:action.digest,disclosureRevision:action.disclosure.revision,consentFactsDigest:action.consent.consentFactsDigest}});
  backend.locked=true;const seen=await gozar.readConfigurationDraft({home,owner,providerId:provider.providerId,draftId:draft.draftId});report.calls.push({method:'readConfigurationDraft',input:{home:'<owned test home>',providerId:provider.providerId,draftId:draft.draftId},expected:'nonempty unknown credential observations, reason secret_backend_locked',actual:seen.configuration.credentials});assert.ok(Object.keys(seen.configuration.credentials).length);for(const value of Object.values(seen.configuration.credentials)){assert.equal(value.known,false);assert.equal(value.reason,'secret_backend_locked')}
 }else{
  const verifier=createServiceVerifier();app=http.createServer((req,res)=>{if(!verifier(req,res))res.end('fixture application')});app.listen(0,'127.0.0.1');await once(app,'listening');
  const q={schemaVersion:1,home,owner,providerId:provider.providerId,target:`127.0.0.1:${app.address().port}`,usage:{kind:'attached'},requirements:{reach:'this-device',transport:'any',payloadAccess:'allow-provider',address:'any',setup:'allow',protocols:[]}};const c=(await gozar.catalogRoutes(q)).candidates[0];
  if(mode==='rejected'){
   const definitionPath=join(registry.root,registry.manifest.providers[0].definition),definition=JSON.parse(await readFile(definitionPath,'utf8'));definition.adapter.facts.push({id:'saffron.new-boundary',label:'New boundary',value:'changed',known:true,affectsConsent:true,group:'jurisdiction-new',source:'fixture-data',asOf:null});await writeFile(definitionPath,JSON.stringify(definition));
   const input={...q,operationId:crypto.randomUUID(),wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}};await assert.rejects(gozar.expose(input),{code:'artifact_integrity_failed'});report.calls.push({method:'expose',input:{...input,home:'<owned test home>'},actual:'artifact_integrity_failed',effects:harness.events});
   const listed=await gozar.listRoutes({home,owner});report.calls.push({method:'listRoutes',actual:listed});for(const r of listed.routes){const closed=await gozar.closeRoute({home,handle:r.handle,mode:'remove'});report.calls.push({method:'closeRoute',input:{home:'<owned test home>',handle:r.handle,mode:'remove'},expected:'confirmed',actual:closed.cleanup});assert.equal(closed.cleanup.state,'confirmed')}
  }else{
  const initial=await gozar.expose({...q,operationId:crypto.randomUUID(),wait:'verified',approval:{kind:'route',candidateToken:c.candidateToken,disclosureRevision:c.disclosure.revision,consentFactsDigest:c.consentFactsDigest}});assert.equal(initial.verification.status,'verified');const current=await gozar.routeStatus({home,handle:initial.handle});assert.equal(current.verification.status,'verified');const listed=(await gozar.listRoutes({home,owner})).routes.find(r=>r.operationId===initial.operationId);report.calls.push({method:'listRoutes',input:{home:'<owned test home>',owner},expected:{published:current.published,verification:current.verification},actual:{published:listed.published,verification:listed.verification}});assert.equal(listed.published,current.published);assert.deepEqual(listed.verification,current.verification);
  }
 }
}catch(error){report.error={code:error.code,message:error.message,expected:error.expected,actual:error.actual};process.exitCode=1}
finally{backend.locked=false;report.cleanup=[];try{for(const route of(await gozar.listRoutes({home,owner})).routes){try{const closed=await gozar.closeRoute({home,handle:route.handle,mode:'remove'});report.cleanup.push(closed.cleanup)}catch(e){report.cleanup.push({code:e.code})}}await harness.close()}catch(e){report.cleanup.push({code:e.code})}if(app){app.closeAllConnections();app.close();await once(app,'close')}console.log(JSON.stringify(report,null,2));console.error('Retained fixture:',root)}
process.exit(process.exitCode??0);

```

## public-journey.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, statfs } from "node:fs/promises"
import http from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { createServiceVerifier } from "@tnunamak/gozar"
import { createEffectFixtures } from "./effects.mjs"
import { createEffectFixtureHost } from "./testing-effects.mjs"

export class SecretBackend {
  records = new Map()
  async put({ scopeId, bytes }) {
    const handle = randomUUID()
    this.records.set(handle, { scopeId, bytes: new Uint8Array(bytes) })
    return { handle }
  }
  async withSecret({ scopeId, handle }, use) {
    const record = this.records.get(handle)
    assert.equal(record?.scopeId, scopeId)
    const bytes = new Uint8Array(record.bytes)
    try {
      return await use(bytes)
    } finally {
      bytes.fill(0)
    }
  }
  async presence({ scopeId, handle }) {
    return { known: true, value: this.records.get(handle)?.scopeId === scopeId }
  }
  async delete({ scopeId, handle }) {
    const record = this.records.get(handle)
    if (record?.scopeId !== scopeId) return { deleted: false }
    record.bytes.fill(0)
    this.records.delete(handle)
    return { deleted: true }
  }
}
const approval = action => ({
  kind: "setup",
  digest: action.digest,
  disclosureRevision: action.disclosure.revision,
  consentFactsDigest: action.consent.consentFactsDigest,
})

export async function run({ providerId, usage }) {
  assert.ok(
    (await statfs(process.cwd())).bavail * (await statfs(process.cwd())).bsize >
      105_000_000_000,
    "disk floor"
  )
  const parent = join(homedir(), ".tmp", "ra")
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const root = await mkdtemp(join(parent, "b-")),
    home = join(root, "h"),
    owner = "fixture-owner",
    canary = randomBytes(32).toString("hex")
  const hostCapabilities = Object.fromEntries(
    [
      "installer.execute",
      "privilege.elevate",
      "secrets.backend",
      "runtime.attached",
      "runtime.durable",
    ].map(id => [id, { known: true, value: id !== "privilege.elevate" }])
  )
  const effects = createEffectFixtures(),
    network = []
  const fetchEffect = effects.effects.find(
      effect => effect.kind === "network" && effect.operation === "fetch"
    ),
    fetchHandler = fetchEffect.handle
  fetchEffect.handle = async (input, context) => {
    const result = await fetchHandler(input, context)
    let body
    try {
      body = JSON.parse(
        Buffer.from(
          result.chunks.map(c => c.data).join(""),
          "base64"
        ).toString()
      )
    } catch {}
    const url = new URL(input.url)
    network.push({
      url: url.origin + url.pathname,
      requestHost: input.headers.host ?? input.headers.Host ?? null,
      status: result.status,
      challenge: body?.schemaVersion === 2,
      authority: body?.authority ?? null,
      localPort: body?.localPort ?? null,
    })
    return result
  }
  const identity = { instanceId: randomUUID(), bootId: randomUUID() }
  const harness = await createEffectFixtureHost(
      { secretBackend: new SecretBackend(), hostCapabilities, identity },
      effects.effects
    ),
    gozar = harness.gozar
  const verify = createServiceVerifier()
  const app = http.createServer((request, response) => {
    if (!verify(request, response)) response.end("fixture application")
  })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  effects.registerOwnedProxy(
    "https://fixture.invalid",
    `127.0.0.1:${app.address().port}`
  )
  const report = {
    providerId,
    usage,
    source: process.env.GOZAR_SOURCE_SHA,
    setup: [],
    call: null,
    result: null,
    cleanup: [],
    events: harness.events,
    network,
  }
  let failure
  const say = () =>
    new Promise(resolve =>
      process.stdout.write(JSON.stringify(report, null, 2) + "\n", resolve)
    )
  try {
    let provider = (await gozar.listProviders({ home, owner })).providers.find(
      p => p.providerId === providerId
    )
    assert.ok(provider)
    report.inputs = provider.configuration.inputRequirements.map(
      ({ id, actionId, required, secret, kind }) => ({
        id,
        actionId,
        required,
        secret,
        kind,
      })
    )
    let draft = await gozar.beginConfigurationDraft({
      home,
      owner,
      providerId,
      expectedConfigurationRevision: provider.configuration.revision,
    })
    const attempted = new Set()
    for (;;) {
      const config = draft.configuration
      const action = config.actions.find(
        a =>
          !attempted.has(a.id) &&
          [
            "provide-secret",
            "provide-value",
            "gozar-runs",
            "install-artifact",
          ].includes(a.kind)
      )
      if (!action) break
      attempted.add(action.id)
      const field = config.inputRequirements.find(f => f.actionId === action.id)
      const value =
        field?.kind === "https-origin"
          ? "https://fixture.invalid"
          : field?.kind === "domain"
            ? "fixture.invalid"
            : "8443"
      let secretHandle
      if (action.kind === "provide-secret") {
        const bytes = new Uint8Array(Buffer.from(canary))
        try {
          secretHandle = (
            await gozar.storeSecret({
              home,
              owner,
              providerId,
              draftId: draft.draftId,
              expectedConfigurationRevision: config.revision,
              scopeId: draft.scopeId,
              inputId: field.id,
              bytes,
            })
          ).handle
        } finally {
          bytes.fill(0)
        }
      }
      const result = await gozar.runSetupAction({
        home,
        owner,
        providerId,
        draftId: draft.draftId,
        expectedConfigurationRevision: config.revision,
        actionId: action.id,
        approval: approval(action),
        ...(secretHandle
          ? { secretHandle }
          : action.kind === "provide-value"
            ? { value }
            : {}),
      })
      report.setup.push({
        actionId: action.id,
        inputId: field?.id,
        kind: action.kind,
        state: result.state,
      })
      draft = await gozar.readConfigurationDraft({
        home,
        owner,
        providerId,
        draftId: draft.draftId,
      })
      assert.equal(result.configurationRevision, draft.configuration.revision)
    }
    const config = await gozar.commitConfigurationDraft({
      home,
      owner,
      providerId,
      draftId: draft.draftId,
      expectedConfigurationRevision: draft.configuration.revision,
    })
    report.remainingInputs = config.inputRequirements
      .filter(
        f =>
          f.required &&
          !(f.secret
            ? config.credentials[f.id]?.known && config.credentials[f.id].value
            : config.values[f.id])
      )
      .map(f => ({ id: f.id, actionId: f.actionId }))
    assert.deepEqual(
      report.remainingInputs,
      [],
      "Every required declared input must be configured"
    )
    provider = (await gozar.listProviders({ home, owner })).providers.find(
      p => p.providerId === providerId
    )
    const query = {
      schemaVersion: 1,
      home,
      owner,
      providerId,
      target: `127.0.0.1:${app.address().port}`,
      usage:
        usage === "session"
          ? { kind: usage, lifetimeMs: 120000 }
          : usage === "durable"
            ? { kind: usage, routeId: "fixture-route" }
            : { kind: usage },
      requirements: {
        reach: provider.reach,
        transport: provider.transport === "http" ? "any" : provider.transport,
        payloadAccess: "allow-provider",
        address: "any",
        setup: "allow",
        protocols: [],
      },
    }
    report.catalogCall = {
      method: "catalogRoutes",
      input: { ...query, home: "<owned test home>" },
    }
    const catalog = await gozar.catalogRoutes(query),
      candidate = catalog.candidates.find(c => c.providerId === providerId)
    report.candidate = {
      eligible: candidate?.eligible,
      unmet: candidate?.unmet,
      actions: candidate?.configuration.actions.map(a => ({
        id: a.id,
        kind: a.kind,
        required: a.required,
      })),
      detection: candidate?.setup?.state,
    }
    assert.ok(
      candidate?.candidateToken,
      "A fully configured admitted candidate must offer a token"
    )
    const request = {
      ...query,
      operationId: randomUUID(),
      intent: "create",
      wait: "verified",
      approval: {
        kind: "route",
        candidateToken: candidate.candidateToken,
        disclosureRevision: candidate.disclosure.revision,
        consentFactsDigest: candidate.consentFactsDigest,
      },
    }
    report.call = {
      method: usage === "durable" ? "ensureRoute" : "expose",
      input: {
        ...query,
        home: "<owned test home>",
        operationId: request.operationId,
        approval: {
          kind: "route",
          consentFactsDigest: candidate.consentFactsDigest,
        },
      },
    }
    const started = Date.now()
    const pending =
      usage === "durable" ? gozar.ensureRoute(request) : gozar.expose(request)
    let timer
    try {
      const route = await Promise.race([
        pending,
        new Promise((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                Object.assign(
                  new Error("Public call exceeds 90-second repro bound"),
                  { code: "repro_timeout" }
                )
              ),
            90000
          )
        }),
      ])
      report.elapsedMs = Date.now() - started
      report.result = {
        handle: route.handle,
        origin: route.origin,
        published: route.published,
        verification: route.verification,
        binding: route.binding,
        operationId: route.operationId,
      }
      assert.equal(route.verification.status, "verified")
      assert.equal(route.published, route.origin)
    } finally {
      clearTimeout(timer)
    }
  } catch (error) {
    failure = error
    report.failure = {
      code: error.code ?? "assertion_failed",
      message: error.message,
      expected: error.expected,
      actual: error.actual,
    }
  } finally {
    try {
      for (const route of (await gozar.listRoutes({ home, owner })).routes) {
        try {
          const closed = await gozar.closeRoute({
            home,
            handle: route.handle,
            mode: "remove",
          })
          report.cleanup.push({
            handle: route.handle,
            state: closed.cleanup.state,
          })
        } catch (error) {
          report.cleanup.push({ handle: route.handle, code: error.code })
        }
      }
    } catch (error) {
      report.cleanup.push({ code: error.code })
    }
    try {
      await harness.close()
    } catch (error) {
      report.harnessClose = error.code
    }
    await effects.close()
    app.closeAllConnections()
    app.close()
    await once(app, "close")
    assert.ok(!JSON.stringify(report).includes(canary))
    await say()
    if (
      report.cleanup.every(r => r.state === "confirmed") &&
      !report.harnessClose
    )
      await rm(root, { recursive: true, force: true })
    else console.error("Retained cleanup evidence:", root)
  }
  if (failure) process.exitCode = 1
}

```

## consent-journey.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict"
import { randomBytes, randomUUID } from "node:crypto"
import { once } from "node:events"
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  statfs,
} from "node:fs/promises"
import http from "node:http"
import { homedir } from "node:os"
import { join } from "node:path"
import { createServiceVerifier } from "@tnunamak/gozar"
import { fakeRegistry } from "@tnunamak/gozar/testing"
import { SecretBackend } from "./public-journey.mjs"
import { createEffectFixtures } from "./effects.mjs"
import { createEffectFixtureHost } from "./testing-effects.mjs"

export async function runConsent(usage) {
  const disk = await statfs(process.cwd())
  assert.ok(disk.bavail * disk.bsize > 105_000_000_000, "disk floor")
  const parent = join(homedir(), ".tmp", "ra")
  await mkdir(parent, { recursive: true, mode: 0o700 })
  const root = await mkdtemp(join(parent, "consent-")),
    home = join(root, "h")
  const specification = JSON.parse(
    await readFile(new URL("./unknown-provider.json", import.meta.url), "utf8")
  )
  const { addedFact, secondId, ...definition } = specification
  const registry = await fakeRegistry({
    ...definition,
    kinds: ["attached", usage],
    dir: join(root, "registry"),
  })
  const providerDir = join(registry.root, "providers", definition.id)
  await writeFile(
    join(providerDir, "runtime.mjs"),
    await readFile(new URL("./runtime-provider.mjs", import.meta.url))
  )
  registry.manifest.providers[0].module = `providers/${definition.id}/runtime.mjs`
  const observations = join(root, "runtime-observations.json")
  await writeFile(observations, JSON.stringify({ costKind: "free" }))
  const effects = createEffectFixtures(),
    backend = new SecretBackend()
  const harness = await createEffectFixtureHost(
    {
      manifest: registry.manifest,
      root: registry.root,
      secretBackend: backend,
      identity: { instanceId: randomUUID(), bootId: randomUUID() },
      hostCapabilities: Object.fromEntries(
        [
          "installer.execute",
          "privilege.elevate",
          "secrets.backend",
          "runtime.attached",
          "runtime.durable",
        ].map(id => [id, { known: true, value: id !== "privilege.elevate" }])
      ),
    },
    effects.effects
  )
  const gozar = harness.gozar,
    canary = randomBytes(32).toString("hex"),
    secretHandles = []
  const verifier = createServiceVerifier()
  let gateRequests = 0
  const app = http.createServer((request, response) => {
    gateRequests++
    if (!verifier(request, response)) response.end("fixture application")
  })
  app.listen(0, "127.0.0.1")
  await once(app, "listening")
  const target = `127.0.0.1:${app.address().port}`
  const data = JSON.parse(
    await readFile(new URL("./consent-effects.json", import.meta.url), "utf8")
  )
  for (const origin of data["network/fetch"].proxyOrigins)
    effects.registerOwnedProxy(origin, target)
  const report = {
    usage,
    source: process.env.GOZAR_SOURCE_SHA,
    sha256: process.env.GOZAR_TARBALL_SHA256,
    calls: [],
    firstDivergence: null,
    cleanup: [],
    result: "not-completed",
  }
  let phase, failure
  async function call(method, input, invoke, project = value => value) {
    phase = method
    const row = { method, input }
    report.calls.push(row)
    try {
      const result = await invoke()
      row.observation = project(result)
      return result
    } catch (error) {
      row.error = {
        code: error.code,
        message: error.message,
        route: error.route,
      }
      throw error
    }
  }
  function expectProof(route, at) {
    phase = at
    if (
      route.verification.status !== "verified" ||
      !route.origin ||
      route.published !== route.origin
    ) {
      report.firstDivergence = {
        at,
        expected: { verification: "verified", published: "origin" },
        actual: route,
      }
    }
    assert.equal(
      route.verification.status,
      "verified",
      `${at}: current initial proof must verify`
    )
    assert.ok(route.origin)
    assert.equal(
      route.published,
      route.origin,
      `${at}: verified proof must publish`
    )
    assert.ok(route.verification.subject)
    assert.ok(route.verification.observedAt)
  }
  const configView = result => ({
    draftId: result.draftId,
    scopeId: result.scopeId,
    configurationRevision: result.configurationRevision,
    revision: (result.configuration ?? result).revision,
  })
  try {
    const owner = "fixture-owner",
      providerId = definition.id
    const inventory = await call(
      "listProviders",
      { home: "<owned test home>", owner },
      () => gozar.listProviders({ home, owner }),
      value => ({ providerIds: value.providers.map(p => p.providerId) })
    )
    const provider = inventory.providers.find(p => p.providerId === providerId)
    let draft = await call(
      "beginConfigurationDraft",
      {
        providerId,
        expectedConfigurationRevision: provider.configuration.revision,
      },
      () =>
        gozar.beginConfigurationDraft({
          home,
          owner,
          providerId,
          expectedConfigurationRevision: provider.configuration.revision,
        }),
      configView
    )
    const attempted = new Set()
    for (;;) {
      const configuration = draft.configuration
      const action = configuration.actions.find(
        a =>
          !attempted.has(a.id) &&
          ["provide-secret", "provide-value"].includes(a.kind)
      )
      if (!action) break
      attempted.add(action.id)
      const input = configuration.inputRequirements.find(
        f => f.actionId === action.id
      )
      let secretHandle
      if (input.secret) {
        const bytes = new Uint8Array(Buffer.from(canary))
        try {
          secretHandle = (
            await call(
              "storeSecret",
              {
                providerId,
                draftId: draft.draftId,
                expectedConfigurationRevision: configuration.revision,
                inputId: input.id,
                bytes: "<redacted>",
              },
              () =>
                gozar.storeSecret({
                  home,
                  owner,
                  providerId,
                  draftId: draft.draftId,
                  expectedConfigurationRevision: configuration.revision,
                  scopeId: draft.scopeId,
                  inputId: input.id,
                  bytes,
                }),
              () => ({ stored: true })
            )
          ).handle
          secretHandles.push(secretHandle)
        } finally {
          bytes.fill(0)
        }
      }
      const request = {
        home,
        owner,
        providerId,
        draftId: draft.draftId,
        expectedConfigurationRevision: configuration.revision,
        actionId: action.id,
        approval: {
          kind: "setup",
          digest: action.digest,
          disclosureRevision: action.disclosure.revision,
          consentFactsDigest: action.consent.consentFactsDigest,
        },
        ...(secretHandle ? { secretHandle } : { value: "fixture-label" }),
      }
      await call(
        "runSetupAction",
        {
          ...request,
          home: "<owned test home>",
          ...(secretHandle ? { secretHandle: "<redacted>" } : {}),
        },
        () => gozar.runSetupAction(request),
        configView
      )
      draft = await call(
        "readConfigurationDraft",
        { providerId, draftId: draft.draftId },
        () =>
          gozar.readConfigurationDraft({
            home,
            owner,
            providerId,
            draftId: draft.draftId,
          }),
        configView
      )
    }
    await call(
      "commitConfigurationDraft",
      {
        providerId,
        draftId: draft.draftId,
        expectedConfigurationRevision: draft.configuration.revision,
      },
      () =>
        gozar.commitConfigurationDraft({
          home,
          owner,
          providerId,
          draftId: draft.draftId,
          expectedConfigurationRevision: draft.configuration.revision,
        }),
      configView
    )
    const query = {
      schemaVersion: 1,
      home,
      owner,
      providerId,
      target,
      usage:
        usage === "durable"
          ? { kind: usage, routeId: "fixture-route" }
          : { kind: usage, lifetimeMs: 60000 },
      requirements: {
        reach: "this-device",
        transport: "any",
        payloadAccess: "allow-provider",
        address: "any",
        setup: "allow",
        protocols: [],
      },
    }
    const catalog = await call(
      "catalogRoutes",
      { ...query, home: "<owned test home>" },
      () => gozar.catalogRoutes(query),
      value => ({
        candidates: value.candidates.map(c => ({
          providerId: c.providerId,
          eligible: c.eligible,
          unmet: c.unmet,
          consent: c.consent,
          candidateToken: c.candidateToken,
        })),
      })
    )
    const candidate = catalog.candidates[0]
    assert.ok(candidate.candidateToken)
    const request = {
      ...query,
      operationId: randomUUID(),
      intent: "create",
      wait: "verified",
      approval: {
        kind: "route",
        candidateToken: candidate.candidateToken,
        disclosureRevision: candidate.disclosure.revision,
        consentFactsDigest: candidate.consentFactsDigest,
      },
    }
    const initial = await call(
      usage === "durable" ? "ensureRoute" : "expose",
      { ...request, home: "<owned test home>" },
      () =>
        usage === "durable" ? gozar.ensureRoute(request) : gozar.expose(request)
    )
    expectProof(initial, "initial allocation proof")
    const ref = { home, handle: initial.handle }
    const current = await call(
      "routeStatus",
      { ...ref, home: "<owned test home>" },
      () => gozar.routeStatus(ref)
    )
    expectProof(current, "current initial routeStatus proof")
    await writeFile(observations, JSON.stringify({ costKind: "paid" }))
    const changed = await call(
      "routeStatus",
      { ...ref, home: "<owned test home>" },
      () =>
        gozar.routeStatus(ref).catch(error => {
          if (error.code === "consent_changed" && error.route)
            return error.route
          throw error
        })
    )
    assert.equal(changed.published, null)
    assert.notEqual(changed.verification.status, "verified")
    const review = await call(
      "reviewRouteConsent",
      { ...ref, home: "<owned test home>" },
      () => gozar.reviewRouteConsent(ref)
    )
    assert.equal(review.scope.kind, "route")
    assert.ok(review.facts)
    assert.ok(review.disclosures)
    assert.notEqual(review.consentFactsDigest, candidate.consentFactsDigest)
    const approved = await call(
      "approveRouteConsent",
      {
        ...ref,
        home: "<owned test home>",
        approvalToken: review.approvalToken,
        consentFactsDigest: review.consentFactsDigest,
      },
      () =>
        gozar.approveRouteConsent({
          ...ref,
          approvalToken: review.approvalToken,
          consentFactsDigest: review.consentFactsDigest,
        })
    )
    assert.deepEqual(approved.handle, initial.handle)
    expectProof(approved, "same-generation re-consent")
    report.result = "verified"
  } catch (error) {
    failure = error
    report.firstDivergence ??= {
      at: phase,
      expected: ["expose", "ensureRoute"].includes(phase)
        ? { verification: "verified", published: "origin", wait: "verified" }
        : undefined,
      error: {
        code: error.code,
        message: error.message,
        expected: error.expected,
        actual: error.actual,
      },
    }
    report.result = "fail"
  } finally {
    try {
      const routes = (await gozar.listRoutes({ home, owner: "fixture-owner" }))
        .routes
      for (const route of routes) {
        try {
          const closed = await gozar.closeRoute({
            home,
            handle: route.handle,
            mode: "remove",
          })
          report.cleanup.push({ handle: route.handle, cleanup: closed.cleanup })
          if (closed.cleanup.state !== "confirmed")
            failure ??= new Error("Cleanup remains unconfirmed")
        } catch (error) {
          report.cleanup.push({
            handle: route.handle,
            error: { code: error.code, message: error.message },
          })
          failure ??= error
        }
      }
    } catch (error) {
      report.cleanup.push({
        error: { code: error.code, message: error.message },
      })
      failure ??= error
    }
    try {
      await harness.close()
    } catch (error) {
      report.cleanup.push({ harnessClose: error.code })
      failure ??= error
    }
    await effects.close()
    app.closeAllConnections()
    app.close()
    await once(app, "close")
    report.gateRequests = gateRequests
    report.effects = harness.events
    if (failure && !report.firstDivergence)
      report.firstDivergence = {
        at: "cleanup",
        code: failure.code,
        message: failure.message,
      }
    const serialized = JSON.stringify(report, null, 2)
    assert.ok(!serialized.includes(canary))
    for (const handle of secretHandles)
      assert.ok(
        !serialized.includes(handle),
        "A secret handle must never appear in the repro log"
      )
    await new Promise(resolve =>
      process.stdout.write(serialized + "\n", resolve)
    )
    if (!failure) {
      await registry.cleanup()
      await rm(root, { recursive: true, force: true })
    } else {
      console.error("Retained cleanup evidence:", root)
      process.exitCode = 1
    }
  }
}

```

## testing-effects.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0

// The sole effects-harness seam. Fixtures are keyed by exact kind + operation.
// No vocabulary is inferred here; adapters and the published harness own it.
/**
 * @param {import('@tnunamak/gozar').GozarOptions} createGozarOptions
 * @param {import('@tnunamak/gozar/testing').TestingEffect[]} effects
 * @returns {Promise<import('@tnunamak/gozar/testing').TestingHarness>}
 */
export async function createEffectFixtureHost(createGozarOptions, effects) {
	const testing = await import("@tnunamak/gozar/testing");
	if (typeof testing.createTestingGozar !== "function") {
		throw Object.assign(
			new Error("Installed tarball lacks the public effects harness"),
			{
				code: "blocked-on-harness",
			},
		);
	}
	return testing.createTestingGozar({ ...createGozarOptions, effects });
}

```

## effects.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import net from "node:net";
import http from "node:http";
import tls from "node:tls";
function effect(kind, operation, handler) {
    return {
        kind,
        operation,
        handle: (input, context) => handler(input, context),
    };
}
function unsupported() {
    throw Object.assign(new Error("Fixture effect is unsupported"), {
        code: "unsupported",
    });
}
function targetAddress(addr) {
    const parsed = new URL(addr.includes("://") ? addr : `tcp://${addr}`);
    // Fixture effects may reach only the owned local gate, never a public account.
    if (!["127.0.0.1", "[::1]", "localhost"].includes(parsed.hostname))
        unsupported();
    return {
        host: parsed.hostname.replace(/^\[|\]$/g, ""),
        port: Number(parsed.port),
    };
}
const fixtureData = JSON.parse(readFileSync(new URL("./effects.json", import.meta.url), "utf8"));
// Each handler is selected only by the public exact kind and operation pair.
export function createEffectFixtures({ uncertainCloseOnce = false, streamDelayMs = 0, failInitialStream = false, sdkOpenFailure = false, } = {}) {
    const listeners = new Map();
    const origins = new Map();
    const children = new Map();
    let serveConfig = {}, configRevision = 0;
    const nodeStatus = fixtureData["recipe/probe"].nodeStatus;
    const dnsName = nodeStatus.Self.DNSName.replace(/\.$/, "");
    function register(url, addr) {
        const parsed = new URL(url);
        url = `${parsed.protocol}//${parsed.host}`;
        const item = {
            handle: randomUUID(),
            url,
            target: targetAddress(addr),
            present: true,
            closeAttempts: 0,
        };
        listeners.set(item.handle, item);
        origins.set(url, item);
        return item;
    }
    function syncConfig() {
        for (const item of origins.values())
            if (item.url.includes(dnsName))
                item.present = false;
        const configs = [
            serveConfig,
            ...Object.values(serveConfig.Foreground ?? {}),
        ];
        for (const config of configs)
            for (const [authority, web] of Object.entries(config.Web ?? {})) {
                const proxy = web.Handlers?.["/"]?.Proxy;
                if (typeof proxy === "string")
                    register(`https://${authority}`, proxy);
            }
    }
    function sourceOutput(args) {
        const row = fixtureData["recipe/probe"].cases.find(row => JSON.stringify(row.args) === JSON.stringify(args));
        if (!row)
            unsupported();
        if (row.result)
            return row.result;
        return {
            stdout: JSON.stringify(row.output === "node-status" ? nodeStatus : serveConfig),
            stderr: "",
            exitCode: 0,
        };
    }
    async function closeChild(handle) {
        const record = children.get(handle);
        if (!record)
            unsupported();
        if (record.child.exitCode === null && record.child.signalCode === null) {
            const exited = new Promise(resolve => record.child.once("exit", () => resolve()));
            record.child.kill("SIGTERM");
            await exited;
        }
        if (record.listener)
            record.listener.present = false;
        delete serveConfig.Foreground?.[handle];
        syncConfig();
        return { closed: true };
    }
    let credentialSeen = false;
    let initialStreamSeen = false;
    let artifactExecutions = 0;
    function entry(endpoint) {
        const parsed = new URL(endpoint);
        const origin = `${parsed.protocol}//${parsed.host}`;
        const item = origins.get(origin);
        if (item?.present)
            return item;
        // Service verification checks both the proxy and its exact local target.
        // Only targets already registered by a present owned effect are admitted.
        if (parsed.protocol === "http:") {
            const host = parsed.hostname.replace(/^\[|\]$/g, "");
            const port = Number(parsed.port || "80");
            const owned = [...listeners.values()].find(listener => listener.present && listener.target.host === host && listener.target.port === port);
            if (owned)
                return owned;
        }
        unsupported();
    }
    const effects = [
        effect("process-runtime", "detect", async () => ({ available: true })),
        effect("process-runtime", "open", async (input) => {
            assertTransientProcessCredential(input);
            credentialSeen = Boolean(input.credential);
            const item = register(input.origin, input.target);
            return { handle: item.handle };
        }),
        effect("process-runtime", "read", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            return { present: item.present };
        }),
        effect("process-runtime", "close", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            if (uncertainCloseOnce && ++item.closeAttempts === 1)
                return { closed: false };
            item.present = false;
            return { closed: true };
        }),
        effect("recipe", "probe", async ({ recipe }) => {
            if (!recipe ||
                typeof recipe !== "object" ||
                Array.isArray(recipe) ||
                !Array.isArray(recipe.args))
                unsupported();
            return sourceOutput(recipe.args);
        }),
        effect("local-api", "request", async ({ path, method, headers, body, }) => {
            const data = fixtureData["local-api/request"];
            if (path === data.statusPath && method === "GET")
                return { status: 200, headers: {}, body: JSON.stringify(nodeStatus) };
            if (path !== data.configPath)
                unsupported();
            if (method === "GET")
                return {
                    status: 200,
                    headers: { etag: String(configRevision) },
                    body: JSON.stringify(serveConfig),
                };
            if (method !== "POST")
                unsupported();
            if (headers["If-Match"] !== String(configRevision))
                return { status: 412, headers: {}, body: "" };
            if (!body || typeof body !== "object" || Array.isArray(body))
                unsupported();
            serveConfig = structuredClone(body);
            configRevision++;
            syncConfig();
            return { status: 200, headers: {}, body: "" };
        }),
        effect("spawn", "run", async ({ args, longRunning }) => {
            if (!longRunning)
                return sourceOutput(args);
            const data = fixtureData["spawn/run"];
            let item, output = "";
            const handle = randomUUID();
            if (data.trialArgs.every((arg) => args.includes(arg))) {
                const redirect = args[args.indexOf(data.trialArgs[0]) + 1];
                const port = Number(redirect?.split(":").at(-1));
                if (!port)
                    unsupported();
                output = data.trialOutput;
                item = register(output.trim(), `localhost:${port}`);
            }
            else {
                const port = Number(args
                    .find(arg => arg.startsWith(data.httpsPrefix))
                    ?.slice(data.httpsPrefix.length));
                if (!port)
                    unsupported();
                const proxy = args.at(-1);
                const authority = `${dnsName}:${port}`;
                const config = {
                    TCP: { [port]: { HTTPS: true } },
                    Web: { [authority]: { Handlers: { "/": { Proxy: proxy } } } },
                };
                if (data.publicArgs.every((arg) => args.includes(arg)))
                    config.AllowFunnel = { [authority]: true };
                else if (!data.privateArgs.every((arg) => args.includes(arg)))
                    unsupported();
                (serveConfig.Foreground ??= {})[handle] = config;
                item = register(`https://${authority}`, proxy);
                output = data.startupOutput;
            }
            // An actual harmless child supplies a verifiable PID and birth identity.
            const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore", env: {} });
            if (!child.pid)
                unsupported();
            children.set(handle, { child, listener: item });
            child.once("exit", () => {
                item.present = false;
                delete serveConfig.Foreground?.[handle];
                syncConfig();
            });
            return {
                stdout: output,
                stderr: "",
                exitCode: null,
                handle,
                pid: child.pid,
            };
        }),
        effect("spawn", "read", async ({ handle }) => {
            const item = children.get(handle);
            if (!item)
                unsupported();
            return {
                present: item.child.exitCode === null && item.child.signalCode === null,
                ...(item.child.exitCode === null
                    ? {}
                    : { exitCode: item.child.exitCode }),
            };
        }),
        effect("spawn", "close", async ({ handle }) => closeChild(handle)),
        effect("sdk-listener", "detect", async () => ({
            available: true,
        })),
        effect("sdk-listener", "open", async ({ options }, { signal }) => {
            signal.throwIfAborted();
            if (sdkOpenFailure)
                return {
                    error: { code: fixtureData["sdk-listener/open"].safeFailureCode },
                };
            const target = targetAddress(options.addr);
            if (typeof options.authtoken !== "string" || !options.authtoken)
                unsupported();
            credentialSeen = true; // Never retain or log the token.
            const handle = randomUUID();
            const scheme = options.proto === "tcp" || options.proto === "tls"
                ? options.proto
                : "https";
            const authority = options.remote_addr ?? options.domain ?? `${handle}.invalid`;
            const allocated = new URL(authority.includes("://") ? authority : `${scheme}://${authority}`);
            if (scheme === "tls" && !allocated.port)
                allocated.port = "443";
            const url = `${allocated.protocol}//${allocated.host}`;
            const item = { handle, url, target, present: true, closeAttempts: 0 };
            listeners.set(handle, item);
            origins.set(url, item);
            return { handle, url };
        }),
        effect("sdk-listener", "read", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            return item.present
                ? { present: true, url: item.url }
                : { present: false };
        }),
        effect("sdk-listener", "close", async ({ handle }) => {
            const item = listeners.get(handle);
            if (!item)
                unsupported();
            item.closeAttempts++;
            if (uncertainCloseOnce && item.closeAttempts === 1)
                return { closed: false };
            item.present = false;
            return { closed: true };
        }),
        effect("artifact", "fetch", async () => ({
            bytes: Buffer.from(fixtureData["artifact/fetch"].content).toString("base64"),
        })),
        effect("artifact", "execute", async ({ bytes }) => {
            const expected = Buffer.from(fixtureData["artifact/fetch"].content).toString("base64");
            if (bytes !== expected)
                unsupported();
            artifactExecutions++;
            return fixtureData["artifact/execute"].result;
        }),
        effect("network", "fetch", async ({ url, method, headers }, { signal }) => {
            const item = entry(url), request = new URL(url);
            const target = new URL(`http://${net.isIP(item.target.host) === 6 ? `[${item.target.host}]` : item.target.host}:${item.target.port}`);
            target.pathname = request.pathname;
            target.search = request.search;
            const response = await new Promise((resolve, reject) => {
                const requestHeaders = { ...headers, host: headers.host ?? headers.Host ?? request.host };
                const upstream = http.request(target, { method, headers: requestHeaders, signal }, reply => {
                    const chunks = [];
                    const observedChunks = [];
                    let lastAt = performance.now();
                    let length = 0;
                    reply.on("data", (chunk) => {
                        length += chunk.length;
                        if (length > 4 * 1024 * 1024)
                            upstream.destroy(new Error("Fixture response exceeded its bound"));
                        else {
                            const at = performance.now();
                            chunks.push(chunk);
                            observedChunks.push({ data: chunk.toString("base64"), delayMs: at - lastAt });
                            lastAt = at;
                        }
                    });
                    reply.once("error", reject);
                    reply.once("end", () => resolve({ status: reply.statusCode ?? 500, headers: Object.fromEntries(Object.entries(reply.headers).filter((row) => row[1] !== undefined).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value])), bytes: Buffer.concat(chunks), chunks: observedChunks }));
                });
                upstream.once("error", reject);
                upstream.end();
            });
            const body = response.bytes;
            const stream = response.headers["content-type"]?.split(";")[0] ===
                "text/event-stream";
            if (stream)
                initialStreamSeen = true;
            return {
                status: response.status,
                headers: response.headers,
                chunks: stream && failInitialStream
                    ? [{ data: body.subarray(0, 1).toString("base64"), delayMs: streamDelayMs + (response.chunks[0]?.delayMs ?? 0) }]
                    : response.chunks.map((chunk, index) => ({ ...chunk, delayMs: chunk.delayMs + (stream && index === 0 ? streamDelayMs : 0) })),
            };
        }),
        effect("network", "exchange", async ({ endpoint, transport, bytes, pinnedCertificate, deadlineMs }, { signal }) => {
            const item = entry(endpoint);
            // A TLS result must carry real gate TLS evidence; never invent a cert.
            if (transport !== "tcp" && transport !== "tls")
                unsupported();
            return new Promise((resolve, reject) => {
                signal.throwIfAborted();
                const socket = transport === "tls"
                    ? tls.connect({ ...item.target, rejectUnauthorized: false })
                    : net.connect(item.target);
                const chunks = [];
                const timer = setTimeout(() => socket.destroy(new Error("Fixture exchange deadline exceeded")), Math.max(1, Math.min(10_000, deadlineMs - Date.now())));
                const abort = () => socket.destroy(new Error("Fixture exchange cancelled"));
                signal.addEventListener("abort", abort, { once: true });
                socket.once(transport === "tls" ? "secureConnect" : "connect", () => {
                    if (socket instanceof tls.TLSSocket &&
                        pinnedCertificate &&
                        socket
                            .getPeerCertificate()
                            .fingerprint256?.replaceAll(":", "")
                            .toLowerCase() !==
                            pinnedCertificate.replaceAll(":", "").toLowerCase()) {
                        socket.destroy(new Error("Fixture certificate mismatch"));
                        return;
                    }
                    socket.end(Buffer.from(bytes, "base64"));
                });
                socket.on("data", data => chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data)));
                socket.once("error", reject);
                socket.once("end", () => {
                    const result = {
                        bytes: Buffer.concat(chunks).toString("base64"),
                    };
                    if (socket instanceof tls.TLSSocket) {
                        const raw = socket.getPeerCertificate().raw;
                        if (raw)
                            result.certificate = `-----BEGIN CERTIFICATE-----\n${raw
                                .toString("base64")
                                .match(/.{1,64}/g)
                                ?.join("\n")}\n-----END CERTIFICATE-----\n`;
                    }
                    resolve(result);
                });
                socket.once("close", () => {
                    clearTimeout(timer);
                    signal.removeEventListener("abort", abort);
                });
            });
        }),
    ];
    return {
        effects,
        registerOwnedProxy: (origin, target) => { register(origin, target); },
        get initialStreamSeen() {
            return initialStreamSeen;
        },
        get credentialSeen() {
            return credentialSeen;
        },
        get artifactExecutions() {
            return artifactExecutions;
        },
        // Deliberately redacted ledger for leak assertions and independent absence.
        ledger: () => [...listeners.values()].map(({ handle, url, present }) => ({
            handle,
            url,
            present,
        })),
        close: async () => {
            for (const handle of children.keys())
                await closeChild(handle);
            for (const item of listeners.values())
                item.present = false;
            origins.clear();
        },
    };
}
// Check transient credential delivery before any trace or ledger write.
export function assertTransientProcessCredential(input) {
    if (!input ||
        typeof input !== "object" ||
        Array.isArray(input) ||
        typeof input.credential !== "string" ||
        !input.credential)
        return;
    const credential = input.credential;
    function contains(value) {
        if (typeof value === "string")
            return value.includes(credential);
        if (value && typeof value === "object")
            return Object.values(value).some(contains);
        return false;
    }
    if (Object.entries(input).some(([key, value]) => key !== "credential" && contains(value))) {
        throw new Error("Credential must not be delivered through process metadata");
    }
}

```

## runtime-provider.mjs

```js
// Copyright The PDP-Connect Contributors
// SPDX-License-Identifier: Apache-2.0
// Trusted fixture adapter decorator: changing an observation changes a typed
// consent disclosure without changing the registered code or configuration.

import { readFile } from "node:fs/promises";
import provider from "./index.mjs";

const observation = async () =>
  JSON.parse(await readFile(new URL("../../../runtime-observations.json", import.meta.url), "utf8"));
export default {
  ...provider,
  async detect(context) {
    const result = await provider.detect(context);
    return { ...result, facts: { ...result.facts, fixtureCostKind: (await observation()).costKind } };
  },
  properties(facts) {
    const properties = provider.properties(facts);
    return { ...properties, cost: { ...properties.cost, kind: facts.fixtureCostKind } };
  },
  async runtimeFacts(...args) {
    const result = await provider.runtimeFacts(...args);
    return {
      ...result,
      properties: { ...result.properties, cost: { ...result.properties.cost, kind: (await observation()).costKind } },
    };
  },
};

```

## unknown-provider.json

```json
{
  "id": "fixture-orchid",
  "label": "Orchid route",
  "kinds": ["attached"],
  "reach": "this-device",
  "transport": "http",
  "proofProtocol": "http",
  "facts": [
    {
      "id": "orchid.residency-window",
      "label": "Residency window",
      "value": "An additional consent boundary supplied only by registry data.",
      "group": "jurisdiction-new",
      "known": true,
      "affectsConsent": true,
      "source": "fixture-data",
      "asOf": null
    }
  ],
  "setupActions": [
    {
      "id": "orchid.credential",
      "kind": "provide-secret",
      "label": "Fixture credential",
      "secretLabel": "Credential",
      "required": true,
      "digest": "fixture-secret-v1",
      "disclosure": {
        "revision": "fixture-v1",
        "text": "Store the synthetic credential in host custody.",
        "links": []
      }
    },
    {
      "id": "orchid.value",
      "kind": "provide-value",
      "label": "Fixture label",
      "valueLabel": "Label",
      "valueFormat": "text",
      "required": true,
      "digest": "fixture-value-v1",
      "disclosure": {
        "revision": "fixture-v1",
        "text": "Store a non-secret label.",
        "links": []
      }
    }
  ],
  "addedFact": {
    "id": "orchid.storage-window",
    "label": "New storage window",
    "value": "This row arrived as data after the earlier approval.",
    "group": "jurisdiction-new",
    "known": true,
    "affectsConsent": true,
    "source": "fixture-data",
    "asOf": null
  },
  "secondId": "fixture-marigold"
}

```

## consent-effects.json

```json
{
  "network/fetch": {
    "proxyOrigins": [
      "https://a.fixture-orchid.invalid",
      "https://b.fixture-orchid.invalid",
      "https://c.fixture-orchid.invalid",
      "https://a.fixture-iris.invalid",
      "https://b.fixture-iris.invalid",
      "https://c.fixture-iris.invalid"
    ]
  }
}

```

## inventory-6ef11f3.mjs

```js
import {createEffectFixtures} from './effects.mjs';
import {createEffectFixtureHost} from './testing-effects.mjs';
import {SecretBackend} from './public-journey.mjs';
import {mkdtemp,mkdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
const parent=join(homedir(),'.tmp','ra');await mkdir(parent,{recursive:true,mode:0o700});const home=await mkdtemp(join(parent,'inventory-'));const effects=createEffectFixtures();const harness=await createEffectFixtureHost({secretBackend:new SecretBackend()},effects.effects);
try{const row=(await harness.gozar.listProviders({home,owner:'fixture-owner'})).providers.find(p=>p.providerId===process.argv[2]);console.log(JSON.stringify({method:'listProviders',input:{home:'<owned test home>',owner:'fixture-owner'},provider:row},null,2))}finally{await harness.close();await effects.close()}
process.exit(0);

```
