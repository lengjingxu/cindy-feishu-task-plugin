'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {Applications}=require('../src/applications.cjs');const {initial}=require('../src/core.cjs');
function fixture(seed=initial()) {let saved=structuredClone(seed),i=0;return {apps:new Applications({load:async()=>structuredClone(saved),save:async n=>{saved=structuredClone(n)}},()=> 'app-'+ ++i),saved:()=>saved};}
test('legacy migration preserves task receipts; concurrent per-app writes survive restart',async()=>{
 const original={...initial(),connection:{appId:'cli_legacy',partnerId:'old'},tasks:{same:{id:'same',bindingId:'legacy',state:'done'}}};
 const {apps,saved}=fixture(original);await apps.load();const second=await apps.add();
 const a=await apps.store('account').load(),b=await apps.store(second).load();b.connection={appId:'cli_new',partnerId:'new'};b.tasks.same={id:'same',bindingId:'new',state:'pending'};
 await Promise.all([apps.store('account').save(a),apps.store(second).save(b)]);
 const restarted=fixture(saved()).apps;await restarted.load();assert.deepEqual(restarted.get('account').state,original);assert.equal(restarted.get(second).state.connection.partnerId,'new');
 assert.equal(restarted.route({bindingId:'legacy'}),'account');assert.equal(restarted.route({bindingId:'new'}),second);
 assert.throws(()=>restarted.route({id:'same'}),{code:'APPLICATION_REQUIRED'});assert.equal(restarted.route({id:'same',applicationId:second}),second);
});
test('disconnect reserves credentials; deletion reuses slot but never overwrites history',async()=>{
 const {apps}=fixture({...initial(),connection:{appId:'cli_old'},tasks:{t:{id:'t',state:'done'}}});await apps.load();
 await apps.status('account','disconnected');const second=await apps.add();assert.equal(apps.get(second).slot,'account2');
 assert.throws(()=>apps.assertUnique(second,'cli_old'),{code:'APPLICATION_ALREADY_BOUND'});
 await apps.status('account','deleting');await apps.add();await apps.add();await assert.rejects(apps.add(),{code:'APPLICATION_LIMIT'});
 await apps.status('account','deleted');const replacement=await apps.add();assert.equal(apps.get(replacement).slot,'account');assert.equal(apps.get('account').state.tasks.t.state,'done');assert.deepEqual(apps.get(replacement).state.tasks,{});
});
