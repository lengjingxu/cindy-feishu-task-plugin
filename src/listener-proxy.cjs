"use strict";
const readline = require("node:readline");
const { fail } = require("./core.cjs");
// A per-lease Host-owned child is the credential/socket lifetime boundary.
// SDK close() alone cannot cancel a socket still in its handshake.
class ListenerProxy {
  constructor(spawn, notify) { this.spawn = spawn; this.notify = notify; this.current = null; }
  async run(params, secret) {
    if (this.current) fail("LISTENER_BUSY");
    if (!this.spawn) fail("HOST_CHILD_SPAWN_REQUIRED");
    if (!secret) fail("CONNECTION_REQUIRED");
    const slot = { child: null, stopped: false, reason: "unexpected_exit" }; this.current = slot;
    let timer, stream;
    try {
      const child = await this.spawn("node/listener.cjs", []); slot.child = child;
      const exited = new Promise((resolve, reject) => {
        child.on("exit", () => resolve({ reason: slot.reason, possibleGap: true, childExited: true }));
        child.on("error", () => reject(Object.assign(new Error("CHILD_FAILED"), { code: "CHILD_FAILED" })));
      });
      stream = readline.createInterface({ input: child.stdout });
      stream.on("line", line => {
        try {
          const msg = JSON.parse(line);
          if (msg.method === "listener/ended") { slot.reason=msg.params?.reason||"unexpected_exit"; child.kill(); }
          else if (["inbox/event", "listener/status"].includes(msg.method)) this.notify(msg.method, msg.params);
        } catch { slot.reason = "protocol_error"; child.kill(); }
      });
      // Child stderr is deliberately drained, never relayed: SDK errors may contain URLs.
      child.stderr.on("data", () => {});
      if (slot.stopped) child.kill();
      else {
        timer = setTimeout(() => { slot.reason="lease_expired"; child.kill(); }, Math.min(60000, Math.max(1000, params.durationMs || 60000)));
        child.stdin.write(JSON.stringify({ method: "run", params, secret }) + "\n");
      }
      secret = undefined;
      return await exited;
    } finally { clearTimeout(timer); stream?.close(); this.current = null; secret = undefined; }
  }
  ack(params) {
    const child = this.current?.child; if (!child || this.current.stopped) fail("ACK_EXPIRED");
    child.stdin.write(JSON.stringify({ method: "ack", params }) + "\n");
    return { forwarded: true };
  }
  stop() {
    const slot = this.current; if (slot) { slot.stopped = true; slot.reason = "paused"; slot.child?.kill(); }
    return { stopping: Boolean(slot) };
  }
}
module.exports = { ListenerProxy };
