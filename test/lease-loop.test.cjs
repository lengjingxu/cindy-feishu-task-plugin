const {test}=require('node:test'),assert=require('node:assert/strict');const {LeaseLoop}=require('../src/lease-loop.cjs');
test('每租期退出后新RPC续接，最多10段，凭据不进入主逻辑参数',async()=>{let now=0;const calls=[],status=[];const l=new LeaseLoop(async(m,p)=>{calls.push({m,p});now+=60000;return{reason:'lease_expired',childExited:true}},s=>status.push(s),()=>now);l.start('app',0);await l.promise;assert.equal(calls.length,10);assert(calls.every(x=>x.p.durationMs===60000&&!('secret'in x.p)));assert(status.includes('renewing'));assert.equal(l.active,false);});
test('异常退出不自动重试；暂停等待当前子进程退出才结束',async()=>{let calls=0;const l=new LeaseLoop(async()=>{calls++;return{reason:'unexpected_exit',childExited:true}},()=>{},()=>0);l.start('app',0);await l.promise;assert.equal(calls,1);let finish;const second=new LeaseLoop(async(m)=>{if(m==='listener/run')return new Promise(r=>finish=r);finish({reason:'paused',childExited:true});return{}},()=>{},()=>0);second.start('app',0);await second.stop();assert.equal(second.active,false);});
test('首次测试必须等待真实连接就绪，停止解除等待',async()=>{
 let finish;const l=new LeaseLoop(async m=>m==='listener/run'?new Promise(r=>finish=r):(finish({reason:'paused',childExited:true}),{}),()=>{});
 l.start('app',0);let ready=false;const waiting=l.waitReady().then(()=>ready=true);await new Promise(r=>setImmediate(r));assert.equal(ready,false);l.connection('connected');await waiting;assert.equal(ready,true);await l.stop();
 const second=new LeaseLoop(async m=>m==='listener/run'?new Promise(r=>finish=r):(finish({reason:'paused',childExited:true}),{}),()=>{});second.start('app',0);const cancelled=assert.rejects(second.waitReady(),{code:'LISTENER_STOPPED'});await second.stop();await cancelled;
});

// Production reception is user-controlled, not limited by the diagnostic test budget.
test('正式接收超过十分钟仍续接，用户暂停后退出',async()=>{
 let now=0,calls=0;const l=new LeaseLoop(async()=>{calls++;now+=60000;if(calls===12)l.active=false;return{reason:'lease_expired',childExited:true}},()=>{},()=>now);
 l.start('app',0,Infinity);await l.promise;assert.equal(calls,12);assert.equal(l.active,false);
});
