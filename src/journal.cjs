"use strict";
const { initial, fail } = require("./core.cjs");
const RETAIN = 16, COMPACT_AT = 32;
// Records remain immutable. A small, read-back-verified checkpoint commits the
// verified chain before any superseded snapshots are removed. Two alternating
// slots avoid overwriting the current checkpoint; damaged writes fail closed.
class Journal {
  constructor(fs, digest) { this.fs=fs; this.digest=digest; this.index=-1; this.poisoned=false; this.tail=[]; this.count=0; this.checkpoints=[]; }
  path(index) { return "ledger/r" + String(index).padStart(6,"0") + ".json"; }
  checkpointPath(slot) { return "ledger/checkpoint-"+slot+".json"; }
  async file(path) {
    const r=await this.fs({op:"read",root:"data",path});
    if(!r.ok&&r.errorCode==="NOT_FOUND")return null;
    if(!r.ok||typeof r.content!=="string")fail("STORAGE_UNAVAILABLE");
    return r.content;
  }
  async read(index) {
    const text=await this.file(this.path(index));if(text===null)return null;
    const r=JSON.parse(text);
    if(r.index!==index||typeof r.payload!=="string"||r.hash!==await this.digest(r.payload))fail("LEDGER_CORRUPT");
    return r;
  }
  async readCheckpoint(slot) {
    const text=await this.file(this.checkpointPath(slot));if(text===null)return null;
    const c=JSON.parse(text),{checksum,...body}=c;
    if(c.version!==1||!Number.isSafeInteger(c.index)||c.index<0||!Number.isSafeInteger(c.through)||c.through<c.index||typeof c.hash!=="string"||typeof c.throughHash!=="string"||checksum!==await this.digest(JSON.stringify(body)))fail("LEDGER_CHECKPOINT_CORRUPT");
    return {...c,slot};
  }
  async remove(path) {
    const r=await this.fs({op:"delete",root:"data",path});
    if(!r.ok||await this.file(path)!==null)fail("STORAGE_DELETE_FAILED");
  }
  async cleanup(checkpoint) {
    const r=await this.fs({op:"list",root:"data",path:"ledger"});
    if(!r.ok||r.truncated||!Array.isArray(r.entries))fail("STORAGE_LIST_FAILED");
    // Listing is used only to select superseded files, never to infer absence.
    for(const e of r.entries){const m=/^ledger[/]r([0-9]+)[.]json$/.exec(e.path);if(m&&Number(m[1])<checkpoint.index)await this.remove(e.path);}
    for(const c of this.checkpoints)if(c.slot!==checkpoint.slot)await this.remove(this.checkpointPath(c.slot));
    this.checkpoints=[checkpoint];
  }
  async compact() {
    const anchor=this.tail[Math.max(0,this.tail.length-RETAIN)];
    const current=this.checkpoints.at(-1);
    if(current)await this.cleanup(current);
    if(!anchor||anchor.index===current?.index)return;
    const listed=await this.fs({op:"list",root:"data",path:"ledger"});
    if(!listed.ok||listed.truncated||!Array.isArray(listed.entries))fail("STORAGE_LIST_FAILED");
    if(listed.entries.some(e=>{const m=/^ledger[/]r([0-9]+)[.]json$/.exec(e.path);return m&&Number(m[1])>this.index;}))fail("LEDGER_CHAIN_BROKEN");
    const slot=current?.slot==="a"?"b":"a";
    if(await this.file(this.checkpointPath(slot))!==null)fail("LEDGER_CONCURRENT_WRITE");
    const body={version:1,index:anchor.index,hash:anchor.hash,through:this.index,throughHash:this.previous};
    const content=JSON.stringify({...body,checksum:await this.digest(JSON.stringify(body))});
    const w=await this.fs({op:"write",root:"data",path:this.checkpointPath(slot),content});
    if(!w.ok)fail("STORAGE_WRITE_FAILED");
    if(await this.file(this.checkpointPath(slot))!==content)fail("STORAGE_READBACK_FAILED");
    const checkpoint={...JSON.parse(content),slot};this.checkpoints.push(checkpoint);
    await this.cleanup(checkpoint);
    this.tail=this.tail.filter(r=>r.index>=anchor.index);this.count=this.tail.length;
  }
  async load() {
    this.checkpoints=(await Promise.all([this.readCheckpoint("a"),this.readCheckpoint("b")])).filter(Boolean).sort((a,b)=>a.index-b.index);
    if(this.checkpoints.length===2&&this.checkpoints[0].index===this.checkpoints[1].index)fail("LEDGER_CHECKPOINT_CONFLICT");
    const checkpoint=this.checkpoints.at(-1);let last=null,throughVerified=!checkpoint;
    this.tail=[];this.count=0;
    for(let i=checkpoint?.index||0;this.count<1900;i++){
      const r=await this.read(i);
      if(!r){
        if(!last){if(checkpoint)fail("LEDGER_CHECKPOINT_MISSING");fail("LEDGER_NOT_INITIALIZED");}
        if(!throughVerified)fail("LEDGER_CHAIN_BROKEN");
        // Prove the tail within this format's write bound using exact reads.
        // Host list can skip unreadable directories and cannot prove absence.
        const limit=checkpoint?checkpoint.through+COMPACT_AT:1899;
        for(let probe=i+1;probe<=limit;probe++)if(await this.read(probe))fail("LEDGER_CHAIN_BROKEN");
        this.index=last.index;this.previous=last.hash;this.payload=last.payload;
        const state=JSON.parse(last.payload);
        if(checkpoint)await this.cleanup(checkpoint);
        if(this.count>=COMPACT_AT)await this.compact();
        return state;
      }
      if(last?r.previous!==last.hash:checkpoint?r.hash!==checkpoint.hash:r.previous!=="")fail("LEDGER_CHAIN_BROKEN");
      if(checkpoint&&i===checkpoint.through){if(r.hash!==checkpoint.throughHash)fail("LEDGER_CHAIN_BROKEN");throughVerified=true;}
      last=r;this.count++;this.tail.push(r);if(this.tail.length>COMPACT_AT)this.tail.shift();
    }
    fail("LEDGER_CAPACITY_REACHED");
  }
  async initialize() {
    if(await this.readCheckpoint("a")||await this.readCheckpoint("b")||await this.read(0))fail("LEDGER_ALREADY_EXISTS");
    this.index=-1;await this.save(initial());
  }
  async save(state) {
    if(this.poisoned)fail("STORAGE_RESTART_REQUIRED");
    const payload=JSON.stringify(state);if(payload===this.payload)return;
    if(new TextEncoder().encode(payload).length>1000000)fail("LEDGER_SIZE_LIMIT");
    try{
      if(this.count>=COMPACT_AT)await this.compact();
      const index=this.index+1,record={index,previous:this.previous||"",payload,hash:await this.digest(payload)};
      if(await this.read(index))fail("LEDGER_CONCURRENT_WRITE");
      const r=await this.fs({op:"write",root:"data",path:this.path(index),content:JSON.stringify(record)});
      if(!r.ok)fail("STORAGE_WRITE_FAILED");
      if(JSON.stringify(await this.read(index))!==JSON.stringify(record))fail("STORAGE_READBACK_FAILED");
      this.index=index;this.previous=record.hash;this.payload=payload;this.tail.push(record);this.count++;
    }catch(e){this.poisoned=true;throw e;}
  }
}
module.exports={Journal};
