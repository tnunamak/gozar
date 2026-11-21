import { randomUUID } from 'node:crypto';
import { EffectDriver } from './driver.mjs';
import { acquireInstallIdentityLease, prepareInstallIdentities } from './host.mjs';
import { safeOrigin } from './catalog.mjs';

/**
 * One provider allocation: the pure core's transitions, the bounded effect driver and the journal, and nothing else.
 *
 * It is not a session controller and runs no phase of one. It starts no timer, keeps no lifetime, publishes nothing, approves no origin,
 * and never runs the core's proof on its own: the core's `http-probe` effect is kept, unrun, for the session controller to request with
 * `prove` after the host has acknowledged the exact announced origin. The session controller owns start, proof, publication, lifetime,
 * stop and cancel; this object only turns the core's allocate and remove steps into driver effects and records them in the journal.
 *
 * Stopping needs no proof: `shutdown` fences the core, removes what the journal records as owned (a stop while the core is still `validating`, the
 * probe never run, included), and reports what it could not prove removed. Nothing is ever fed to the core as a probe result that was
 * not observed.
 */
export class SessionAllocation {
  constructor({ step, journal, adapters, requirements, targetPort, servicePort, sessionId = randomUUID(), origin, bindAddresses = [], firewallApproved = false, driver, onProviderExit }) {
    Object.assign(this, { step, journal, adapters, requirements, targetPort, servicePort, sessionId, origin });
    this.state = undefined;
    this.last = undefined;
    this.queue = Promise.resolve();
    this.inFlight = new Set();
    this.hostLimitations = new Set();
    this.keyLease = null;
    this.heldProbe = null;
    this.driver = driver ?? new EffectDriver({ adapters, journal, sessionId, targetPort, origin, bindAddresses, firewallApproved,
      // Told to the session controller, which decides what the loss means. Never awaited from the effect completion it must drain.
      onExit: () => { if (!this.driver.stopped) setImmediate(() => Promise.resolve(onProviderExit ? onProviderExit() : this.shutdown()).catch(() => {})); } });
  }

  // Only core transitions are serialized. Slow effects do not prevent a stop from fencing the allocation.
  async advance(command) {
    const next = this.step({ ...(this.state ? { state: this.state } : {}), command: { sessionId: this.sessionId, ...command },
      adapters: this.adapters, requirements: this.requirements, host: { ...this.driver.host, nowMs: this.driver.nowMs?.() ?? 0 } });
    this.last = next;
    this.state = next.state;
    for (const generation of this.driver.proofExpiries?.keys() ?? []) if (generation !== this.state.generation) this.driver.proofExpiries.delete(generation);
    for (const resource of next.snapshot.resources ?? []) {
      if (resource.cleanup === 'removed' && this.journal.value.owned?.[resource.id]?.retired) delete this.journal.value.owned[resource.id];
    }
    await this.journal.save({ state: this.state, snapshot: next.snapshot, targetPort: this.servicePort ?? this.targetPort,
      ...(this.driver.proofGeneration === this.state.generation ? { validation: { probeReceipt: this.driver.acceptedProbeReceipt, provenance: this.driver.proofProvenance } } : { validation: null }) });
    return next;
  }
  apply(command) {
    const work = this.queue.then(() => this.advance(command));
    this.queue = work.catch(() => {});
    return work;
  }
  present() {
    if (!this.last) return undefined;
    return { ...this.last, snapshot: { ...this.last.snapshot, limitations: [...this.hostLimitations, ...(this.last.snapshot.limitations ?? [])] } };
  }

  async dispatch(effect) {
    const completion = await this.driver.execute(effect);
    if (!completion.ok && completion.result?.code === 'needs-validation') this.hostLimitations.add(completion.result.detail);
    const output = await this.apply(completion);
    await Promise.all(output.effects.map(next => this.schedule(next)));
  }
  schedule(effect) {
    // A timer is lifetime or expiry policy, and policy belongs to the session controller.
    if (effect.kind === 'timer') return Promise.resolve();
    // The core's proof is requested by the session controller (`prove`), never run here.
    if (effect.kind === 'http-probe' && effect.operation === 'probe') { this.heldProbe = effect; return Promise.resolve(); }
    if (this.inFlight.size >= 256) throw new Error('Core effect budget exceeded');
    const work = this.dispatch(effect);
    this.inFlight.add(work);
    work.then(() => this.inFlight.delete(work), () => this.inFlight.delete(work));
    return work;
  }

  /** One admitted core command. `start` first takes the installation-key lease and identities the adapter provisions, as the core's admission allows. */
  async command(command) {
    if (command.type === 'start' && command.consent === true) {
      if (this.driver.stopped) return this.present();
      const adapter = this.adapters.find(item => item.id === command.adapterId);
      if (Object.values(adapter?.bindings ?? {}).some(binding => binding.provision)) {
        // Ask the same pure core admission decision before creating any identity. This preview is never committed and dispatches nothing.
        const admission = this.step({ ...(this.state ? { state: this.state } : {}), command: { ...command, sessionId: this.sessionId, consent: false },
          adapters: this.adapters, requirements: this.requirements, host: { ...this.driver.host, nowMs: this.driver.nowMs?.() ?? 0 } });
        if (admission.action?.kind !== 'confirm' || admission.action.adapterId !== command.adapterId ||
            !Array.isArray(admission.effects) || admission.effects.length !== 0)
          throw new Error('Identity provisioning is not admitted by core');
      }
      if (!this.keyLease) {
        const lease = await acquireInstallIdentityLease(this.driver, adapter, this.servicePort ?? this.targetPort);
        if (this.driver.stopped) { await lease?.release(); return this.present(); }
        this.keyLease = lease;
      }
      await prepareInstallIdentities(this.driver, adapter);
      if (this.driver.stopped) return this.present();
      this.driver.authorize(command.adapterId);
    }
    if (command.type === 'stop') { this.driver.stopped = true; this.driver.cancelProbes?.(); }
    const output = await this.apply(command);
    await Promise.all(output.effects.map(effect => this.schedule(effect)));
    return this.present();
  }

  /**
   * Runs the core's held probe, through the driver's own authorized-vantage checks, for exactly `origin`. The probe the core asked for
   * decides what counts: its vantage, TLS, SSE and protocol requirements, and its generation. A remote vantage needs a trusted executor
   * on that vantage and a fresh receipt for this origin and this attempt's nonce; with none the driver refuses, and so does this.
   * The gate's current refs authorize the attempt, so a proof a former attempt earned cannot stand for this one.
   * Returns the driver's result (`probeReceipt`, `vantage`, `provenance` when the executor gave one); throws on anything it refused.
   */
  async prove({ origin, signal, deadlineMs }) {
    const { driver, heldProbe: held } = this;
    if (!held || driver.stopped || !driver.gate) throw new Error('No core probe is held for this allocation');
    if (safeOrigin(held.url ?? held.origin) !== safeOrigin(origin)) throw new Error('The announced origin is not the origin the core asked to have proven');
    const refs = { nonceRef: driver.gate.nonceRef, verifierRef: driver.gate.verifierRef };
    driver.host.probe = { ...driver.host.probe, ...refs, expiresAtMs: Math.min(driver.nowMs() + 900000, deadlineMs ?? Infinity) };
    const cancel = () => driver.cancelProbes();
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      if (signal?.aborted) throw new Error('Probe cancelled');
      // The core's own `probe` snapshot named the refs and expiry of the moment it asked; this attempt is authorized by the gate's current ones.
      const { probe: asked, ...request } = held;
      const result = await driver.probe({ ...request, ...refs });
      return { ...result, provenance: driver.proofProvenance };
    } finally { signal?.removeEventListener('abort', cancel); }
  }

  shutdown() {
    if (this.shuttingDown) return this.shuttingDown;
    this.shuttingDown = this.finalize().finally(() => { this.shuttingDown = null; });
    return this.shuttingDown;
  }
  async finalize() {
    await this.command({ type: 'stop' });
    await Promise.allSettled([...this.inFlight]);
    // Completion of a cancelled create may have introduced cleanup debt.
    await this.command({ type: 'reconcile' });
    const failures = await this.driver.closeLocal();
    if (this.last.snapshot.phase !== 'stopped') {
      for (const resource of Object.values(this.journal.value.owned)) {
        if (resource.kind !== 'process' || resource.sessionId !== this.sessionId ||
            !this.state.resources.some(item => item.id === resource.id && item.ownership === 'owned' && item.cleanup !== 'removed')) continue;
        try {
          const receipt = await this.driver.proveProcessAbsent(resource);
          this.driver.host.cleanupAbsent = { [resource.id]: receipt };
          await this.apply({ type: 'reconcile-absent', resourceId: resource.id });
          if (this.state.resources.find(item => item.id === resource.id)?.cleanup !== 'removed') throw new Error('Core did not accept the fresh resource absence proof');
        } catch (error) {
          this.hostLimitations.add(error.message);
          failures.push({ resourceId: resource.id, detail: error.message });
        } finally { delete this.driver.host.cleanupAbsent; }
      }
    }
    if (this.keyLease && this.last?.snapshot.phase === 'stopped' && !failures.length &&
        Object.keys(this.journal.value.owned).length === 0) {
      try { await this.keyLease.release(); this.keyLease = null; }
      catch (error) { failures.push({ resourceId: 'installation-key-lease', detail: error.message }); }
    }
    return { ...this.present(), localCleanupFailures: failures };
  }
}
