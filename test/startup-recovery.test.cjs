'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {StartupRecovery}=require('../src/startup-recovery.cjs');
const {createApplication}=require('../src/application.cjs');
const {initial}=require('../src/core.cjs');
const flush=async()=>{for(let i=0;i<50;i++)await Promise.resolve();};
function clock(){let seq=0;const jobs=new Map();return{jobs,setTimeout(fn,delay){const id=++seq;jobs.set(id,{fn,delay});return id;},clearTimeout(id){jobs.delete(id);},async next(){const [id,job]=jobs.entries().next().value;jobs.delete(id);job.fn();await flush();}};}
test('startup retries the same operation after a transient failure and stops after success',async()=>{
 const timers=clock(),reports=[];let runs=0;
 const r=new StartupRecovery(async()=>{if(++runs===1)throw Error('boot unavailable');},e=>reports.push(e?.message||null),timers);
 await r.start();assert.equal(runs,1);assert.equal([...timers.jobs.values()][0].delay,2000);
 await r.start();assert.equal(runs,1);await timers.next();assert.equal(runs,2);assert.deepEqual(reports,['boot unavailable',null]);
 await r.start();assert.equal(runs,2);assert.equal(timers.jobs.size,0);
});
test('startup has a three-attempt budget, never an unbounded retry loop',async()=>{
 const timers=clock();let runs=0;const r=new StartupRecovery(async()=>{runs++;throw Error('unavailable');},()=>{},timers);
 await r.start();await timers.next();assert.equal([...timers.jobs.values()][0].delay,4000);await timers.next();
 await r.start();assert.equal(runs,3);assert.equal(timers.jobs.size,0);
});
test('cancellation removes pending startup retries and invalidates an in-flight attempt',async()=>{
 const timers=clock();let release,current;const reports=[];
 const r=new StartupRecovery(async valid=>{current=valid;await new Promise(resolve=>release=resolve);throw Error('late failure');},e=>reports.push(e),timers);
 const p=r.start();await flush();assert.equal(current(),true);r.cancel();assert.equal(current(),false);release();await p;
 assert.deepEqual(reports,[]);assert.equal(timers.jobs.size,0);await r.start();
 const retry=new StartupRecovery(async()=>{throw Error('early failure');},()=>{},timers);await retry.start();assert.equal(timers.jobs.size,1);retry.cancel();assert.equal(timers.jobs.size,0);
});
test('overlapping startup calls share one attempt',async()=>{
 let release,runs=0;const r=new StartupRecovery(async()=>{runs++;await new Promise(resolve=>release=resolve);},()=>{},clock());
 const a=r.start(),b=r.start();assert.equal(a,b);await flush();assert.equal(runs,1);release();await Promise.all([a,b]);assert.equal(runs,1);
});
function fixture({requested=true,capabilities}={}){
 const appId='cli_0000000000000001',baseline=1700000000123;
 let data={...initial(),connection:{appId,partnerId:'bot',baseline,assignmentBaseline:{appId,at:baseline,assigned:['already-assigned']},receivingRequested:requested},onboarding:{epoch:1,identity:{state:'verified',appId},permissions:{state:'verified'},association:{state:'selected',target:{kind:'bot',id:'bot'}},test:{state:'passed',epoch:1},registration:{runtime:{state:'verified',epoch:1}},subscription:{runtime:{state:'verified',epoch:1}},events:{runtime:{state:'verified',epoch:1}}},testRun:{target:{id:'bot'}}};
 const calls=[],saved=[];let finish,r;
 global.cindy={targets:{list:async()=>({targets:[]}),resolve:async p=>p.target,get:async()=>({found:false}),capabilities:capabilities||async function(){return{delegation:{version:1,execution:true,receiptQuery:true,settled:true}};}}};
 const rawNode=async req=>{calls.push(req);if(req.method==='binding/restore')return{ok:true,result:{saved:true,appId}};
  if(req.method==='listener/run'){queueMicrotask(()=>r.onMessage({type:'event',name:'node-notification',method:'listener/status',params:{state:'connected'}}));return new Promise(resolve=>finish=()=>resolve({ok:true,result:{reason:'paused',childExited:true}}));}
  if(req.method==='listener/stop'){finish?.();return{ok:true,result:{}};}
  throw Error('Unexpected Node call: '+req.method+'/'+req.params?.action);
 };
 r=createApplication({id:'app',slot:'account',store:{load:async()=>structuredClone(data),save:async s=>{data=structuredClone(s);saved.push(structuredClone(s));}},channel:{postMessage(){}},rawNode,canOperate(){},assertUnique:async()=>{}});
 return{r,calls,saved,baseline,get data(){return data},get starts(){return calls.filter(c=>c.method==='listener/run')}};
}
test('saved receive intent resumes the listener with the original baseline, without importing a new inventory',async()=>{
 const h=fixture();try{await Promise.all([h.r.resume(),h.r.resume(),h.r.resume()]);assert.equal(h.starts.length,1);assert.equal(h.starts[0].params.baseline,h.baseline);assert.equal(h.calls.some(c=>c.params?.action==='assignment_baseline'),false);assert.deepEqual(h.data.connection.assignmentBaseline.assigned,['already-assigned']);assert.equal(h.r.publicState().receiving,true);}finally{await h.r.ui('pause');delete global.cindy;}
});
test('a saved paused application never spawns a listener during startup',async()=>{
 const h=fixture({requested:false});try{await h.r.resume();assert.equal(h.starts.length,0);assert.equal(h.data.connection.receivingRequested,false);assert.equal(h.r.publicState().receiving,false);}finally{await h.r.ui('pause');delete global.cindy;}
});
test('pause while startup awaits host capabilities prevents listener spawn and cannot rewrite requested=true',async()=>{
 let release,entered;const waiting=new Promise(resolve=>entered=resolve);
 const h=fixture({capabilities:async()=>{entered();await new Promise(resolve=>release=resolve);return{delegation:{version:1,execution:true,receiptQuery:true,settled:true}};}});
 try{const resume=h.r.resume();await waiting;const pause=h.r.ui('pause');await flush();assert.equal(h.data.connection.receivingRequested,false);release();await Promise.all([resume,pause]);assert.equal(h.starts.length,0);assert.equal(h.data.connection.receivingRequested,false);assert.equal(h.saved.some(s=>s.connection.receivingRequested===true),false);}finally{await h.r.ui('pause');delete global.cindy;}
});
test('one application startup failure does not block another application from receiving',async()=>{
 const timers=clock();let healthyRuns=0;
 const failed=new StartupRecovery(async()=>{throw Error('app A unavailable');},()=>{},timers);
 const healthy=new StartupRecovery(async()=>{healthyRuns++;},()=>{},timers);
 await failed.start();await healthy.start();assert.equal(healthyRuns,1);assert.equal(healthy.complete,true);assert.equal(timers.jobs.size,1);failed.cancel();
});
test('a real application exposes a boot failure, then automatically resumes after host capabilities recover',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let checks=0;
 const h=fixture({capabilities:async()=>{if(++checks===1)throw Object.assign(Error('host waking'),{code:'HOST_DELEGATION_UNAVAILABLE'});return{delegation:{version:1,execution:true,receiptQuery:true,settled:true}};}});
 try{await h.r.resume();assert.equal(h.starts.length,0);assert.equal(h.r.publicState().receivingRequested,true);assert.equal(h.r.publicState().recoveryError.code,'HOST_DELEGATION_UNAVAILABLE');
  t.mock.timers.tick(2000);await flush();assert.equal(h.starts.length,1);assert.equal(h.r.publicState().receiving,true);assert.equal(h.r.publicState().recoveryError,null);assert.equal(h.starts[0].params.baseline,h.baseline);
 }finally{await h.r.ui('pause');delete global.cindy;t.mock.timers.reset();}
});

test('synchronous startup failure clears the in-flight guard and retries',async()=>{
 const timers=clock();let runs=0;const r=new StartupRecovery(()=>{if(++runs===1)throw Error('sync');},()=>{},timers);
 await r.start();assert.equal(r.pending,null);await timers.next();assert.equal(runs,2);assert.equal(r.complete,true);
});

test('historical receipt lookup failure preserves its reservation without stopping a connected listener',async()=>{
 const h=fixture();h.data.tasks.old={id:'old',state:'write_uncertain',dispatch:{requestKey:'old-key',target:{kind:'bot',id:'bot'}}};
 h.data.tasks.next={id:'next',partnerId:'bot',state:'pending',queuedTarget:{kind:'bot',id:'bot'}};
 global.cindy.targets.get=async()=>{throw Object.assign(Error('offline'),{code:'HOST_OFFLINE'});};
 try{await h.r.resume();assert.equal(h.r.publicState().receiving,true);assert.equal(h.starts.length,1);assert.equal(h.data.tasks.old.state,'write_uncertain');assert.equal(h.data.tasks.next.queueError,'TARGET_BUSY');}finally{await h.r.ui('pause');delete global.cindy;}
});
