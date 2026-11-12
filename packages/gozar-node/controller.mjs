import { randomUUID } from 'node:crypto';
import { EffectDriver } from './driver.mjs';
import { safeOrigin } from './catalog.mjs';

// Only core transitions are serialized. Slow effects do not prevent a stop from fencing publication.
export class Controller {
  constructor({ step, journal, adapters, requirements, targetPort, servicePort, sessionId = randomUUID(), origin, bindAddresses = [], firewallApproved = false, driver }) {
    Object.assign(this, { step, journal, adapters, requirements, targetPort, servicePort, sessionId, origin });
    this.state = undefined;
    this.last = undefined;
    this.queue = Promise.resolve();
    this.inFlight = new Set();
    this.background = new Set();
    this.hostLimitations = new Set();
    this.driver = driver ?? new EffectDriver({ adapters, journal, sessionId, targetPort, origin, bindAddresses, firewallApproved,
      onExit: () => { if (!this.driver.stopped) this.command({ type: 'stop' }).catch(() => {}); } });
  }
  async advance(command) {
    this.last = this.step({ ...(this.state ? { state: this.state } : {}), command: { sessionId: this.sessionId, ...command },
      adapters: this.adapters, requirements: this.requirements, host: { ...this.driver.host, nowMs: this.driver.nowMs?.() ?? 0 } });
    this.state = this.last.state;
    for (const resource of this.last.snapshot.resources ?? []) {
      if (resource.cleanup === 'removed' && this.journal.value.owned?.[resource.id]?.retired) delete this.journal.value.owned[resource.id];
    }
    await this.journal.save({ state: this.state, snapshot: this.last.snapshot, targetPort: this.servicePort ?? this.targetPort, ...(this.driver.proofGeneration === this.state.generation ? { validation: { probeReceipt: this.driver.acceptedProbeReceipt, provenance: this.driver.proofProvenance } } : { validation: null }) });
    return this.last;
  }
  apply(command) {
    const work = this.queue.then(() => this.advance(command));
    this.queue = work.catch(() => {});
    return work;
  }
  present() {
    if (!this.last) return undefined;
    return { ...this.last, ...(this.driver.proofGeneration === this.state.generation && this.driver.acceptedProbeReceipt?.expiresAtMs > this.driver.nowMs() ? { validation: { probeReceipt: this.driver.acceptedProbeReceipt, provenance: this.driver.proofProvenance } } : {}), ...(this.driver.gate ? { gateTarget: this.driver.gate.target } : {}), snapshot: { ...this.last.snapshot,
      limitations: [...this.hostLimitations, ...(this.last.snapshot.limitations ?? [])] } };
  }
  async dispatch(effect) {
    if (effect.kind === 'http-probe' && effect.operation === 'probe') {
      const candidate = this.last.snapshot.candidate;
      if (candidate) this.driver.origin = safeOrigin(candidate);
    }
    const completion = await this.driver.execute(effect);
    if (!completion.ok && completion.result?.code === 'needs-validation') this.hostLimitations.add(completion.result.detail);
    const output = await this.apply(completion);
    await Promise.all(output.effects.map(next => this.schedule(next)));
  }
  schedule(effect) {
    if (effect.kind !== 'timer') return this.track(effect);
    const work = this.dispatch(effect); this.background.add(work);
    work.then(() => this.background.delete(work), error => { this.background.delete(work); this.hostLimitations.add(error.message); });
    return Promise.resolve();
  }
  track(effect) {
    if (this.inFlight.size >= 256) throw new Error('Core effect budget exceeded');
    const work = this.dispatch(effect);
    this.inFlight.add(work);
    work.then(() => this.inFlight.delete(work), () => this.inFlight.delete(work));
    return work;
  }
  async command(command) {
    if (['health', 'update-origin', 'owned-process-origin'].includes(command.type) && this.driver.gate) {
      const refs = this.driver.gate.rotate();
      this.driver.host.probe = { ...refs, expiresAtMs: this.driver.nowMs() + 900000, ...(this.driver.publicRelay ? { allowPublicRelay:true } : {}) };
      this.driver.cancelTimers?.();
    }
    if (command.type === 'start' && command.consent === true) this.driver.authorize(command.adapterId);
    if (command.type === 'stop') { this.driver.stopped = true; this.driver.cancelTimers?.(); this.driver.cancelProbes?.(); }
    const output = await this.apply(command);
    await Promise.all(output.effects.map(effect => this.schedule(effect)));
    return this.present();
  }
  async approve() {
    if (this.driver.stopped || this.last?.snapshot.phase !== 'candidate-ready') return this.present();
    const { candidate, generation } = this.last.snapshot;
    return this.command({ type: 'approve-origin', origin: candidate, generation });
  }
  async shutdown() {
    await this.command({ type: 'stop' });
    await Promise.allSettled([...this.background]);
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
    return { ...this.present(), localCleanupFailures: failures };
  }
}
