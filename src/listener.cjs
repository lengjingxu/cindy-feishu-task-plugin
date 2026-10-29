"use strict";
const { fail } = require("./core.cjs");
class Listener {
  constructor(SDK, notify) { this.SDK = SDK; this.notify = notify; this.pending = new Map(); this.current = null; }
  ack({ token, accepted }) {
    const p = this.pending.get(token); if (!p) fail("ACK_EXPIRED");
    this.pending.delete(token); clearTimeout(p.timer);
    accepted === true ? p.resolve({}) : p.reject(new Error("PERSISTENCE_FAILED"));
    return { acknowledged: true };
  }
  async run(params, secret) {
    if (this.current) fail("LISTENER_BUSY");
    if (!secret || !/^cli_[0-9a-f]{16}$/i.test(params.appId || "")) fail("CONNECTION_REQUIRED");
    const duration = Math.min(60000, Math.max(1000, params.durationMs || 60000));
    const silent = { trace() {}, debug() {}, info() {}, warn() {}, error() {} };
    let client = new this.SDK.WSClient({ appId: params.appId, appSecret: secret, logger: silent });
    let finish; const ended = new Promise(resolve => { finish = resolve; });
    const timer = setTimeout(() => finish("lease_expired"), duration);
    this.current = { stop: () => finish("paused"), client };
    const heartbeat = setInterval(() => this.notify("listener/status", { state: client.getConnectionStatus().state }), 5000);
    const dispatcher = new this.SDK.EventDispatcher({ logger: silent }).register({
      "task.task.update_user_access_v2": async data => {
        if (data.app_id !== params.appId || !data.event_id || !data.task_guid) fail("EVENT_INVALID");
        const token = require("node:crypto").randomUUID();
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { this.pending.delete(token); reject(new Error("PERSISTENCE_TIMEOUT")); }, 10000);
          this.pending.set(token, { resolve, reject, timer });
          this.notify("inbox/event", { token, event: { id: data.event_id, guid: data.task_guid, appId: data.app_id,
            eventAt: /^\d+$/.test(data.create_time || "") && Number.isSafeInteger(Number(data.create_time)) ? Number(data.create_time) : null,
            assigneesChanged: Array.isArray(data.event_types) && data.event_types.includes("task_assignees_update"),
            isCreate: Array.isArray(data.event_types) && data.event_types.includes("task_create"), baseline: params.baseline } });
        });
        // SDK 1.76 awaits this handler before emitting the successful WebSocket ACK.
        return {};
      }
    });
    try { await client.start({ eventDispatcher: dispatcher }); return { reason: await ended, possibleGap: true }; }
    finally {
      clearTimeout(timer); clearInterval(heartbeat); client.close({ force: true });
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error("LISTENER_STOPPED")); }
      this.pending.clear(); this.current = null; client = null; secret = undefined;
    }
  }
  stop() { this.current?.stop(); return { stopping: Boolean(this.current) }; }
}
module.exports = { Listener };
