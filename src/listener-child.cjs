"use strict";
const SDK = require("@larksuiteoapi/node-sdk");
const { Listener } = require("./listener.cjs");
const notify = (method, params) => process.stdout.write(JSON.stringify({ method, params }) + "\n");
const listener = new Listener(SDK, notify);
let started = false;
require("node:readline").createInterface({ input: process.stdin }).on("line", async line => {
  let msg; try { msg = JSON.parse(line); } catch { process.exit(1); }
  try {
    if (msg.method === "ack") listener.ack(msg.params);
    else if (msg.method === "run" && !started) {
      started = true; const result=await listener.run(msg.params, msg.secret); delete msg.secret;
      notify("listener/ended", result); process.exit(0);
    } else process.exit(1);
  } catch { delete msg.secret; notify("listener/ended", {reason:"failed"}); process.exit(1); }
});
