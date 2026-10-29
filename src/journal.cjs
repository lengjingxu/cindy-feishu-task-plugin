"use strict";
const { initial, fail } = require("./core.cjs");
// Immutable records: no overwrite or automatic rollback after damaged storage.
// Host fs durability and NOT_FOUND wire shape still require installation acceptance.
class Journal {
  constructor(fs, digest) { this.fs = fs; this.digest = digest; this.index = -1; this.poisoned = false; }
  path(index) { return "ledger/r" + String(index).padStart(6, "0") + ".json"; }
  async read(index) {
    const r = await this.fs({ op: "read", root: "data", path: this.path(index) });
    if (!r.ok && r.errorCode === "NOT_FOUND") return null;
    if (!r.ok || typeof r.content !== "string") fail("STORAGE_UNAVAILABLE");
    const record = JSON.parse(r.content);
    if (record.index !== index || record.hash !== await this.digest(record.payload)) fail("LEDGER_CORRUPT");
    return record;
  }
  async load() {
    let last = null;
    for (let i = 0; i < 1900; i++) {
      const r = await this.read(i);
      if (!r) { this.index = i - 1; if (!last) fail("LEDGER_NOT_INITIALIZED"); return JSON.parse(last.payload); }
      if (r.previous !== (last?.hash || "")) fail("LEDGER_CHAIN_BROKEN");
      last = r; this.previous = r.hash;
    }
    fail("LEDGER_CAPACITY_REACHED");
  }
  async initialize() {
    if (await this.read(0)) fail("LEDGER_ALREADY_EXISTS");
    this.index = -1; await this.save(initial());
  }
  async save(state) {
    if (this.poisoned) fail("STORAGE_RESTART_REQUIRED");
    if (this.index >= 1898) fail("LEDGER_CAPACITY_REACHED");
    const index = this.index + 1;
    const payload = JSON.stringify(state);
    if (payload.length > 1000000) fail("LEDGER_SIZE_LIMIT");
    const record = { index, previous: this.previous || "", payload, hash: await this.digest(payload) };
    try {
      if (await this.read(index)) fail("LEDGER_CONCURRENT_WRITE");
      const r = await this.fs({ op: "write", root: "data", path: this.path(index), content: JSON.stringify(record) });
      if (!r.ok) fail("STORAGE_WRITE_FAILED");
      const verified = await this.read(index);
      if (JSON.stringify(verified) !== JSON.stringify(record)) fail("STORAGE_READBACK_FAILED");
      this.index = index; this.previous = record.hash;
    } catch (e) { this.poisoned = true; throw e; }
  }
}
module.exports = { Journal };
