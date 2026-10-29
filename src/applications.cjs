'use strict';
const {initial,fail}=require('./core.cjs');
const slots=['account','account2','account3','account4'];
const copy=x=>JSON.parse(JSON.stringify(x));
// One checkpointed journal commits all application states. The legacy account is
// retained intact; deleted applications keep their task/receipt history.
class Applications {
 constructor(journal,uuid){this.journal=journal;this.uuid=uuid;this.tail=Promise.resolve();}
 serial(fn){const p=this.tail.then(fn);this.tail=p.catch(()=>{});return p;}
 async load(){
  let state;try{state=await this.journal.load();}catch(e){if(e.code!=='LEDGER_NOT_INITIALIZED')throw e;await this.journal.initialize();state=await this.journal.load();}
  this.state=state.applicationsVersion===1?state:{...initial(),applicationsVersion:1,applications:{account:{id:'account',slot:'account',status:'active',state}}};
  if(!this.state.credentialScope)await this.change(n=>{n.credentialScope=this.uuid();});
 }
 get(id){const a=this.state.applications[id];if(!a)fail('APPLICATION_NOT_FOUND');return a;}
 entries(){return Object.values(this.state.applications);}
 async change(fn){return this.serial(async()=>{const n=copy(this.state);const result=fn(n);if(JSON.stringify(n)===JSON.stringify(this.state))return result;n.revision++;await this.journal.save(n);this.state=n;return result;});}
 store(id){return {load:async()=>copy(this.get(id).state),save:s=>this.change(n=>{n.applications[id].state=copy(s);})};}
 async add(){return this.change(n=>{
  const slot=slots.find(s=>!Object.values(n.applications).some(a=>a.slot===s&&a.status!=='deleted'));
  if(!slot)fail('APPLICATION_LIMIT');
  const id=this.uuid();n.applications[id]={id,slot,status:'active',state:initial()};return id;
 });}
 async status(id,status){return this.change(n=>{if(!n.applications[id])fail('APPLICATION_NOT_FOUND');n.applications[id].status=status;});}
 assertUnique(id,appId){if(this.entries().some(a=>a.id!==id&&a.status!=='deleted'&&a.state.connection?.appId===appId))fail('APPLICATION_ALREADY_BOUND');}
 route(args){
  const matches=this.entries().filter(a=>Object.values(a.state.tasks).some(t=>args.bindingId?t.bindingId===args.bindingId:t.id===args.id));
  const match=args.applicationId?matches.filter(a=>a.id===args.applicationId):matches;
  if(match.length!==1)fail(match.length?'APPLICATION_REQUIRED':'TASK_NOT_FOUND');return match[0].id;
 }
}
module.exports={Applications,slots};
