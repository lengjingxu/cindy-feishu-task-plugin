"use strict";
// Retry the same startup operation within a bounded budget. Never import an
// inventory, switch identities, replay delivery or restart an exited listener.
class StartupRecovery {
  constructor(run, report, timers = {
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: id => clearTimeout(id)
  }) {
    this.run = run;
    this.report = report;
    this.timers = timers;
    this.epoch = 0;
    this.attempt = 0;
  }
  start() {
    if (this.pending) return this.pending;
    if (this.timer !== undefined || this.complete || this.attempt >= 3) return Promise.resolve();
    const epoch = this.epoch;
    this.attempt++;
    // Defer invocation so a synchronous throw cannot leave a settled promise
    // permanently assigned after finally has cleared the in-flight guard.
    this.pending = Promise.resolve().then(async () => {
      try {
        if (epoch !== this.epoch) return;
        await this.run(() => epoch === this.epoch);
        if (epoch === this.epoch) {
          this.complete = true;
          this.report(null);
        }
      } catch (error) {
        if (epoch !== this.epoch) return;
        this.report(error);
        if (this.attempt < 3) {
          this.timer = this.timers.setTimeout(() => {
            this.timer = undefined;
            this.start();
          }, this.attempt * 2000);
        }
      } finally {
        this.pending = null;
      }
    });
    return this.pending;
  }
  cancel() {
    this.epoch++;
    this.complete = true;
    if (this.timer !== undefined) this.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}
module.exports = { StartupRecovery };
